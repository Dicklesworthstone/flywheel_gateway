/**
 * Agent Output Search and Tagging Service (bd-39chi)
 *
 * Provides full-text search across agent output streams with keyword highlighting,
 * stable cursor pagination, session/output tagging with spam/abuse protection,
 * index health metrics + rebuild, and pinned/shared saved searches with RBAC.
 */

import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// Schemas & Types
// ============================================================================

export const IndexOutputChunkSchema = z.object({
  id: z.string().optional(),
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  content: z.string().min(1).max(100_000),
  toolCallType: z.string().optional(),
  isError: z.boolean().default(false),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  timestamp: z.string().optional(),
});

export const AddTagsSchema = z.object({
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-zA-Z0-9_.:-]+$/, "Invalid tag format"),
    )
    .min(1)
    .max(20),
});

export const SavedSearchInputSchema = z.object({
  name: z.string().min(1).max(100),
  query: z.string().min(1).max(300),
  ownerId: z.string().min(1),
  pinned: z.boolean().default(false),
  shared: z.boolean().default(false),
  allowedRoles: z
    .array(z.string())
    .default(["owner", "admin", "developer", "viewer"]),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export interface IndexedOutputRecord {
  id: string;
  seq: number;
  agentId: string;
  sessionId: string;
  content: string;
  tokens: string[];
  toolCallType?: string;
  isError: boolean;
  tags: string[];
  timestamp: string;
}

export interface OutputSearchHit {
  id: string;
  seq: number;
  agentId: string;
  sessionId: string;
  snippet: string;
  highlighted: string;
  score: number;
  toolCallType?: string;
  isError: boolean;
  tags: string[];
  timestamp: string;
}

export interface OutputSearchQuery {
  q?: string;
  agentId?: string;
  sessionId?: string;
  tag?: string;
  toolCallType?: string;
  errorOnly?: boolean;
  from?: string;
  to?: string;
  cursor?: number;
  limit?: number;
}

export interface SavedSearchRecord {
  id: string;
  name: string;
  query: string;
  ownerId: string;
  pinned: boolean;
  shared: boolean;
  allowedRoles: string[];
  filters: Record<string, unknown>;
  createdAt: string;
}

// ============================================================================
// State Stores
// ============================================================================

let nextOutputSeq = 1;
const indexedOutputs: IndexedOutputRecord[] = [];
const sessionTagsMap = new Map<string, Set<string>>();
const savedSearchesStore = new Map<string, SavedSearchRecord>();

let lastRebuildDurationMs = 1;
let lastUpdatedAt = new Date().toISOString();

const MAX_TAGS_PER_SESSION = 25;

// ============================================================================
// Tokenization & Highlighting
// ============================================================================

export function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((t) => t.length >= 2);
}

function buildHighlightSnippet(
  content: string,
  queryTerms: string[],
): {
  snippet: string;
  highlighted: string;
} {
  const snippet =
    content.length > 220 ? `${content.slice(0, 220)}...` : content;
  if (queryTerms.length === 0) {
    return { snippet, highlighted: snippet };
  }
  let highlighted = snippet;
  for (const term of queryTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    highlighted = highlighted.replace(regex, "<mark>$1</mark>");
  }
  return { snippet, highlighted };
}

// ============================================================================
// Indexing & Tagging
// ============================================================================

export function indexAgentOutput(
  input: z.input<typeof IndexOutputChunkSchema>,
): IndexedOutputRecord {
  const parsed = IndexOutputChunkSchema.parse(input);
  const existingSessionTags = Array.from(
    sessionTagsMap.get(parsed.sessionId) ?? [],
  );
  const mergedTags = Array.from(
    new Set([...existingSessionTags, ...(parsed.tags ?? [])]),
  );

  const record: IndexedOutputRecord = {
    id: parsed.id ?? `out_${ulid()}`,
    seq: nextOutputSeq++,
    agentId: parsed.agentId,
    sessionId: parsed.sessionId,
    content: parsed.content,
    tokens: tokenizeSearchText(parsed.content),
    ...(parsed.toolCallType !== undefined && {
      toolCallType: parsed.toolCallType,
    }),
    isError: parsed.isError,
    tags: mergedTags,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
  };

  indexedOutputs.push(record);
  lastUpdatedAt = record.timestamp;
  return record;
}

export function addSessionTags(
  sessionId: string,
  tagsInput: string[],
): string[] {
  const parsed = AddTagsSchema.parse({ tags: tagsInput });
  const current = sessionTagsMap.get(sessionId) ?? new Set<string>();

  if (current.size + parsed.tags.length > MAX_TAGS_PER_SESSION) {
    throw new Error(
      `Tag limit exceeded: maximum ${MAX_TAGS_PER_SESSION} tags per session`,
    );
  }

  for (const tag of parsed.tags) {
    current.add(tag.toLowerCase());
  }
  sessionTagsMap.set(sessionId, current);

  // Propagate tags to already-indexed outputs for this session
  const updatedTags = Array.from(current);
  for (const rec of indexedOutputs) {
    if (rec.sessionId === sessionId) {
      rec.tags = Array.from(new Set([...rec.tags, ...updatedTags]));
    }
  }

  return updatedTags;
}

export function listAllOutputTags(): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rec of indexedOutputs) {
    for (const tag of rec.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  for (const set of sessionTagsMap.values()) {
    for (const tag of set) {
      if (!counts.has(tag)) counts.set(tag, 0);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// Search, Pagination, and Index Health
// ============================================================================

export function searchAgentOutputs(query: OutputSearchQuery): {
  hits: OutputSearchHit[];
  totalCount: number;
  nextCursor?: string;
  hasMore: boolean;
} {
  const terms = query.q ? tokenizeSearchText(query.q) : [];
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 200);
  const fromMs = query.from ? Date.parse(query.from) : undefined;
  const toMs = query.to ? Date.parse(query.to) : undefined;

  const matching: Array<{ rec: IndexedOutputRecord; score: number }> = [];

  for (const rec of indexedOutputs) {
    if (query.agentId && rec.agentId !== query.agentId) continue;
    if (query.sessionId && rec.sessionId !== query.sessionId) continue;
    if (
      query.tag &&
      !rec.tags.includes(query.tag.toLowerCase()) &&
      !rec.tags.includes(query.tag)
    ) {
      continue;
    }
    if (query.toolCallType && rec.toolCallType !== query.toolCallType) {
      continue;
    }
    if (query.errorOnly && !rec.isError) continue;
    if (fromMs !== undefined && !Number.isNaN(fromMs)) {
      if (Date.parse(rec.timestamp) < fromMs) continue;
    }
    if (toMs !== undefined && !Number.isNaN(toMs)) {
      if (Date.parse(rec.timestamp) > toMs) continue;
    }

    let score = 1;
    if (terms.length > 0) {
      const lowerContent = rec.content.toLowerCase();
      let matchedTerms = 0;
      for (const t of terms) {
        if (rec.tokens.includes(t) || lowerContent.includes(t)) {
          matchedTerms++;
        }
      }
      if (matchedTerms < terms.length) continue;
      score = matchedTerms + (rec.isError ? 0.5 : 0);
    }

    matching.push({ rec, score });
  }

  const totalCount = matching.length;
  const cursorFiltered =
    query.cursor !== undefined && Number.isFinite(query.cursor)
      ? matching.filter((m) => m.rec.seq > query.cursor!)
      : matching;

  const page = cursorFiltered.slice(0, limit);
  const hasMore = cursorFiltered.length > limit;
  const lastInPage = page[page.length - 1];

  const hits: OutputSearchHit[] = page.map(({ rec, score }) => {
    const { snippet, highlighted } = buildHighlightSnippet(rec.content, terms);
    return {
      id: rec.id,
      seq: rec.seq,
      agentId: rec.agentId,
      sessionId: rec.sessionId,
      snippet,
      highlighted,
      score,
      ...(rec.toolCallType !== undefined && {
        toolCallType: rec.toolCallType,
      }),
      isError: rec.isError,
      tags: rec.tags,
      timestamp: rec.timestamp,
    };
  });

  return {
    hits,
    totalCount,
    ...(hasMore &&
      lastInPage !== undefined && {
        nextCursor: String(lastInPage.rec.seq),
      }),
    hasMore,
  };
}

export function rebuildOutputSearchIndex(): {
  documentCount: number;
  rebuildTimeMs: number;
  lastUpdatedAt: string;
} {
  const t0 = performance.now();
  for (const rec of indexedOutputs) {
    rec.tokens = tokenizeSearchText(rec.content);
  }
  lastRebuildDurationMs = Math.max(1, Math.round(performance.now() - t0));
  lastUpdatedAt = new Date().toISOString();
  return {
    documentCount: indexedOutputs.length,
    rebuildTimeMs: lastRebuildDurationMs,
    lastUpdatedAt,
  };
}

export function getOutputSearchIndexHealth() {
  const approxBytes = indexedOutputs.reduce(
    (sum, r) => sum + r.content.length,
    0,
  );
  return {
    documentCount: indexedOutputs.length,
    approxSizeBytes: approxBytes,
    lastRebuildDurationMs,
    lastUpdatedAt,
    status: "healthy" as const,
  };
}

// ============================================================================
// Saved Searches with Pin & Share RBAC
// ============================================================================

export function createSavedSearch(
  input: z.input<typeof SavedSearchInputSchema>,
): SavedSearchRecord {
  const parsed = SavedSearchInputSchema.parse(input);
  const record: SavedSearchRecord = {
    id: `ssr_${ulid()}`,
    name: parsed.name,
    query: parsed.query,
    ownerId: parsed.ownerId,
    pinned: parsed.pinned,
    shared: parsed.shared,
    allowedRoles: parsed.allowedRoles,
    filters: parsed.filters,
    createdAt: new Date().toISOString(),
  };
  savedSearchesStore.set(record.id, record);
  return record;
}

export function listSavedSearches(params: {
  userId: string;
  userRole?: string;
}): SavedSearchRecord[] {
  const role = params.userRole ?? "viewer";
  return Array.from(savedSearchesStore.values()).filter((s) => {
    if (s.ownerId === params.userId) return true;
    if (s.shared && s.allowedRoles.includes(role)) return true;
    return false;
  });
}

export function clearOutputSearchForTesting(): void {
  indexedOutputs.length = 0;
  sessionTagsMap.clear();
  savedSearchesStore.clear();
  nextOutputSeq = 1;
}
