/**
 * History Service - Tracks agent activity and prompt/response history.
 *
 * Provides comprehensive history tracking including:
 * - Prompt and response recording
 * - Token usage tracking
 * - Outcome recording
 * - Full-text search
 * - Export capabilities
 */

import { and, count, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { agents as agentsTable, history as historyTable } from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export type HistoryOutcome =
  | "success"
  | "failure"
  | "interrupted"
  | "timeout"
  | "pending";

export interface HistoryEntry {
  id: string;
  agentId: string;
  timestamp: Date;
  prompt: string;
  promptTokens: number;
  responseSummary: string;
  responseTokens: number;
  durationMs: number;
  outcome: HistoryOutcome;
  error?: string;
  tags: string[];
  starred: boolean;
  replayCount: number;
  metadata?: Record<string, unknown>;
}

export interface HistoryInput {
  prompt: string;
  promptTokens?: number;
  contextPackId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface HistoryOutput {
  responseSummary: string;
  responseTokens?: number;
  outcome: HistoryOutcome;
  error?: string;
}

export interface HistoryStats {
  totalEntries: number;
  totalPromptTokens: number;
  totalResponseTokens: number;
  averageDurationMs: number;
  outcomeDistribution: Record<HistoryOutcome, number>;
  entriesByDay: Array<{ date: string; count: number }>;
}

export interface HistoryQueryOptions {
  agentId?: string;
  outcome?: HistoryOutcome[];
  starred?: boolean;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  tags?: string[];
  limit?: number;
  cursor?: string;
}

// ============================================================================
// ID Generation
// ============================================================================

function generateHistoryId(): string {
  const timestamp = Date.now().toString(36);
  // Use cryptographically secure random instead of Math.random()
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  let random = "";
  for (let i = 0; i < 8; i++) {
    random += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `hist_${timestamp}_${random}`;
}

// ============================================================================
// History Entry Management
// ============================================================================

/**
 * Create a new history entry when an agent interaction starts.
 */
export async function createHistoryEntry(
  agentId: string,
  input: HistoryInput,
): Promise<HistoryEntry> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, agentId });

  const id = generateHistoryId();
  const now = new Date();

  // Build entry conditionally (for exactOptionalPropertyTypes)
  const entry: HistoryEntry = {
    id,
    agentId,
    timestamp: now,
    prompt: input.prompt,
    promptTokens: input.promptTokens ?? estimateTokens(input.prompt),
    responseSummary: "",
    responseTokens: 0,
    durationMs: 0,
    outcome: "pending",
    tags: input.tags ?? [],
    starred: false,
    replayCount: 0,
  };
  if (input.metadata) entry.metadata = input.metadata;

  // Store in database
  await db.insert(historyTable).values({
    id,
    agentId,
    command: "send", // Type of operation
    input: {
      prompt: input.prompt,
      promptTokens: entry.promptTokens,
      contextPackId: input.contextPackId,
      tags: input.tags,
      metadata: input.metadata,
    },
    output: null,
    durationMs: 0,
    createdAt: now,
  });

  log.info(
    { entryId: id, promptTokens: entry.promptTokens },
    "History entry created",
  );

  return entry;
}

/**
 * Complete a history entry with the response.
 */
export async function completeHistoryEntry(
  entryId: string,
  output: HistoryOutput,
  durationMs: number,
): Promise<HistoryEntry | null> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, entryId });

  // Get existing entry
  const rows = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.id, entryId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0]!;
  const inputData = row.input as Record<string, unknown> | null;

  // Update with output
  await db
    .update(historyTable)
    .set({
      output: {
        responseSummary: output.responseSummary,
        responseTokens:
          output.responseTokens ?? estimateTokens(output.responseSummary),
        outcome: output.outcome,
        error: output.error,
      },
      durationMs,
    })
    .where(eq(historyTable.id, entryId));

  // Build entry conditionally (for exactOptionalPropertyTypes)
  // Use bracket notation for index signature access
  const entry: HistoryEntry = {
    id: entryId,
    agentId: row.agentId,
    timestamp: row.createdAt,
    prompt: (inputData?.["prompt"] as string) ?? "",
    promptTokens: (inputData?.["promptTokens"] as number) ?? 0,
    responseSummary: output.responseSummary,
    responseTokens:
      output.responseTokens ?? estimateTokens(output.responseSummary),
    durationMs,
    outcome: output.outcome,
    tags: (inputData?.["tags"] as string[]) ?? [],
    starred: false,
    replayCount: 0,
  };
  if (output.error) entry.error = output.error;
  const metadata = inputData?.["metadata"] as
    | Record<string, unknown>
    | undefined;
  if (metadata) entry.metadata = metadata;

  log.info(
    {
      entryId,
      outcome: output.outcome,
      responseTokens: entry.responseTokens,
      durationMs,
    },
    "History entry completed",
  );

  return entry;
}

/**
 * Get a history entry by ID.
 */
export async function getHistoryEntry(
  entryId: string,
): Promise<HistoryEntry | null> {
  const rows = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.id, entryId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return rowToEntry(rows[0]!);
}

/**
 * Query history entries with filters.
 */
export async function queryHistory(options: HistoryQueryOptions = {}): Promise<{
  entries: HistoryEntry[];
  pagination: { cursor?: string; hasMore: boolean };
}> {
  const limit = options.limit ?? 50;
  const conditions = [];

  // Build conditions
  if (options.agentId) {
    conditions.push(eq(historyTable.agentId, options.agentId));
  }

  if (options.startDate) {
    conditions.push(gte(historyTable.createdAt, options.startDate));
  }

  if (options.endDate) {
    conditions.push(lte(historyTable.createdAt, options.endDate));
  }

  // Execute query
  let query = db
    .select()
    .from(historyTable)
    .orderBy(desc(historyTable.createdAt))
    .limit(limit + 1);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query;

  // Apply post-query filters (for JSON fields)
  let filtered = rows.map(rowToEntry);

  if (options.outcome?.length) {
    filtered = filtered.filter((e) => options.outcome!.includes(e.outcome));
  }

  if (options.starred !== undefined) {
    filtered = filtered.filter((e) => e.starred === options.starred);
  }

  if (options.search) {
    const searchLower = options.search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.prompt.toLowerCase().includes(searchLower) ||
        e.responseSummary.toLowerCase().includes(searchLower),
    );
  }

  if (options.tags?.length) {
    filtered = filtered.filter((e) =>
      options.tags!.some((tag) => e.tags.includes(tag)),
    );
  }

  // Apply cursor
  if (options.cursor) {
    const cursorIndex = filtered.findIndex((e) => e.id === options.cursor);
    if (cursorIndex >= 0) {
      filtered = filtered.slice(cursorIndex + 1);
    }
  }

  const hasMore = filtered.length > limit;
  const result = filtered.slice(0, limit);
  const lastEntry = result[result.length - 1];

  // Build pagination conditionally (for exactOptionalPropertyTypes)
  const pagination: { cursor?: string; hasMore: boolean } = { hasMore };
  if (lastEntry?.id) pagination.cursor = lastEntry.id;

  return { entries: result, pagination };
}

/**
 * Search history with full-text search.
 */
export async function searchHistory(
  query: string,
  options: { limit?: number; agentId?: string } = {},
): Promise<HistoryEntry[]> {
  const limit = options.limit ?? 20;
  const searchLower = query.toLowerCase();

  // Get all entries (in production, use FTS)
  const conditions = [];
  if (options.agentId) {
    conditions.push(eq(historyTable.agentId, options.agentId));
  }

  let dbQuery = db
    .select()
    .from(historyTable)
    .orderBy(desc(historyTable.createdAt))
    .limit(limit * 5); // Fetch more for filtering

  if (conditions.length > 0) {
    dbQuery = dbQuery.where(and(...conditions)) as typeof dbQuery;
  }

  const rows = await dbQuery;
  const entries = rows.map(rowToEntry);

  // Filter by search term
  const matched = entries.filter(
    (e) =>
      e.prompt.toLowerCase().includes(searchLower) ||
      e.responseSummary.toLowerCase().includes(searchLower) ||
      e.tags.some((t) => t.toLowerCase().includes(searchLower)),
  );

  return matched.slice(0, limit);
}

/**
 * Star or unstar a history entry.
 */
export async function toggleStar(
  entryId: string,
): Promise<HistoryEntry | null> {
  const entry = await getHistoryEntry(entryId);
  if (!entry) {
    return null;
  }

  // Get current row to update
  const rows = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.id, entryId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0]!;
  const inputData = (row.input as Record<string, unknown>) ?? {};
  const currentStarred = (inputData["starred"] as boolean) ?? false;

  // Toggle starred in input JSON
  await db
    .update(historyTable)
    .set({
      input: {
        ...inputData,
        starred: !currentStarred,
      },
    })
    .where(eq(historyTable.id, entryId));

  entry.starred = !currentStarred;

  logger.info(
    { entryId, starred: entry.starred },
    "History entry star toggled",
  );

  return entry;
}

/**
 * Increment replay count for an entry.
 */
export async function incrementReplayCount(entryId: string): Promise<void> {
  const rows = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.id, entryId))
    .limit(1);

  if (rows.length === 0) {
    return;
  }

  const row = rows[0]!;
  const inputData = (row.input as Record<string, unknown>) ?? {};
  const currentCount = (inputData["replayCount"] as number) ?? 0;

  await db
    .update(historyTable)
    .set({
      input: {
        ...inputData,
        replayCount: currentCount + 1,
      },
    })
    .where(eq(historyTable.id, entryId));

  logger.debug(
    { entryId, replayCount: currentCount + 1 },
    "Replay count incremented",
  );
}

/**
 * Delete history entries older than a given date.
 */
export async function pruneHistory(olderThan: Date): Promise<number> {
  const result = await db
    .delete(historyTable)
    .where(lte(historyTable.createdAt, olderThan))
    .returning({ id: historyTable.id });

  const deletedCount = result.length;

  logger.info({ olderThan, deletedCount }, "History pruned");

  return deletedCount;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get history statistics.
 */
export async function getHistoryStats(
  options: { agentId?: string; startDate?: Date; endDate?: Date } = {},
): Promise<HistoryStats> {
  const conditions = [];

  if (options.agentId) {
    conditions.push(eq(historyTable.agentId, options.agentId));
  }
  if (options.startDate) {
    conditions.push(gte(historyTable.createdAt, options.startDate));
  }
  if (options.endDate) {
    conditions.push(lte(historyTable.createdAt, options.endDate));
  }

  // Get all entries for stats
  let query = db.select().from(historyTable);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query;
  const entries = rows.map(rowToEntry);

  // Calculate stats
  let totalPromptTokens = 0;
  let totalResponseTokens = 0;
  let totalDuration = 0;
  const outcomeDistribution: Record<HistoryOutcome, number> = {
    success: 0,
    failure: 0,
    interrupted: 0,
    timeout: 0,
    pending: 0,
  };
  const entriesByDayMap = new Map<string, number>();

  for (const entry of entries) {
    totalPromptTokens += entry.promptTokens;
    totalResponseTokens += entry.responseTokens;
    totalDuration += entry.durationMs;
    outcomeDistribution[entry.outcome]++;

    const dateKey = entry.timestamp.toISOString().split("T")[0]!;
    entriesByDayMap.set(dateKey, (entriesByDayMap.get(dateKey) ?? 0) + 1);
  }

  const entriesByDay = Array.from(entriesByDayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalEntries: entries.length,
    totalPromptTokens,
    totalResponseTokens,
    averageDurationMs: entries.length > 0 ? totalDuration / entries.length : 0,
    outcomeDistribution,
    entriesByDay,
  };
}

// ============================================================================
// Export
// ============================================================================

export interface ExportOptions {
  format: "json" | "csv";
  agentId?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Export history entries.
 */
export async function exportHistory(options: ExportOptions): Promise<string> {
  // Build query options conditionally (for exactOptionalPropertyTypes)
  const queryOptions: HistoryQueryOptions = { limit: 10000 }; // Max export size
  if (options.agentId !== undefined) queryOptions.agentId = options.agentId;
  if (options.startDate !== undefined) queryOptions.startDate = options.startDate;
  if (options.endDate !== undefined) queryOptions.endDate = options.endDate;

  const { entries } = await queryHistory(queryOptions);

  if (options.format === "json") {
    return JSON.stringify(entries, null, 2);
  }

  // CSV format
  const headers = [
    "id",
    "agentId",
    "timestamp",
    "prompt",
    "promptTokens",
    "responseSummary",
    "responseTokens",
    "durationMs",
    "outcome",
    "tags",
    "starred",
  ];

  const rows = entries.map((e) => [
    e.id,
    e.agentId,
    e.timestamp.toISOString(),
    escapeCSV(e.prompt),
    e.promptTokens,
    escapeCSV(e.responseSummary),
    e.responseTokens,
    e.durationMs,
    e.outcome,
    escapeCSV(e.tags.join(";")),
    e.starred ? "true" : "false",
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ============================================================================
// Output Extraction
// ============================================================================

export type ExtractionType =
  | "code_blocks"
  | "json"
  | "file_paths"
  | "urls"
  | "errors"
  | "custom";

export interface ExtractionMatch {
  content: string;
  lineStart: number;
  lineEnd: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractionResult {
  matches: ExtractionMatch[];
  totalMatches: number;
}

/**
 * Extract structured content from output text.
 */
export function extractFromOutput(
  output: string,
  type: ExtractionType,
  options: { language?: string; customPattern?: string } = {},
): ExtractionResult {
  const lines = output.split("\n");
  const matches: ExtractionMatch[] = [];

  switch (type) {
    case "code_blocks": {
      // Extract markdown code blocks
      let inBlock = false;
      let blockStart = 0;
      let blockContent: string[] = [];
      let blockLang = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.startsWith("```")) {
          if (!inBlock) {
            inBlock = true;
            blockStart = i;
            blockLang = line.slice(3).trim();
            blockContent = [];
          } else {
            if (!options.language || blockLang === options.language) {
              matches.push({
                content: blockContent.join("\n"),
                lineStart: blockStart + 1,
                // Ensure lineEnd is at least lineStart if block is empty
                lineEnd: Math.max(blockStart + 1, i - 1),
                metadata: { language: blockLang },
              });
            }
            inBlock = false;
          }
        } else if (inBlock) {
          blockContent.push(line);
        }
      }
      break;
    }

    case "json": {
      // Extract JSON objects/arrays
      const jsonPattern = /(\{[\s\S]*?\}|\[[\s\S]*?\])/g;
      let match;
      while ((match = jsonPattern.exec(output)) !== null) {
        try {
          JSON.parse(match[1]!);
          const startLine = output.slice(0, match.index).split("\n").length - 1;
          const endLine =
            output.slice(0, match.index + match[1]!.length).split("\n").length -
            1;
          matches.push({
            content: match[1]!,
            lineStart: startLine,
            lineEnd: endLine,
          });
        } catch {
          // Not valid JSON, skip
        }
      }
      break;
    }

    case "file_paths": {
      // Extract file paths
      const pathPattern =
        /(?:^|\s)((?:\/[\w.-]+)+\/?|(?:[A-Za-z]:)?\\(?:[\w.-]+\\)*[\w.-]+)/gm;
      let match;
      while ((match = pathPattern.exec(output)) !== null) {
        const lineNum = output.slice(0, match.index).split("\n").length - 1;
        matches.push({
          content: match[1]!.trim(),
          lineStart: lineNum,
          lineEnd: lineNum,
        });
      }
      break;
    }

    case "urls": {
      // Extract URLs
      const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
      let match;
      while ((match = urlPattern.exec(output)) !== null) {
        const lineNum = output.slice(0, match.index).split("\n").length - 1;
        matches.push({
          content: match[0],
          lineStart: lineNum,
          lineEnd: lineNum,
        });
      }
      break;
    }

    case "errors": {
      // Extract error patterns
      const errorPatterns = [
        /Error:\s*.+/gi,
        /Exception:\s*.+/gi,
        /FAILED:\s*.+/gi,
        /error\[\w+\]:\s*.+/gi,
        /TypeError:\s*.+/gi,
        /SyntaxError:\s*.+/gi,
        /ReferenceError:\s*.+/gi,
      ];

      for (const pattern of errorPatterns) {
        let match;
        while ((match = pattern.exec(output)) !== null) {
          const lineNum = output.slice(0, match.index).split("\n").length - 1;
          matches.push({
            content: match[0],
            lineStart: lineNum,
            lineEnd: lineNum,
          });
        }
      }
      break;
    }

    case "custom": {
      if (options.customPattern) {
        try {
          const pattern = new RegExp(options.customPattern, "gi");
          let match;
          while ((match = pattern.exec(output)) !== null) {
            const lineNum = output.slice(0, match.index).split("\n").length - 1;
            matches.push({
              content: match[0],
              lineStart: lineNum,
              lineEnd: lineNum,
            });
          }
        } catch {
          // Invalid regex
        }
      }
      break;
    }
  }

  return {
    matches,
    totalMatches: matches.length,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a database row to a HistoryEntry.
 */
function rowToEntry(row: {
  id: string;
  agentId: string;
  command: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  createdAt: Date;
}): HistoryEntry {
  const inputData = (row.input as Record<string, unknown>) ?? {};
  const outputData = (row.output as Record<string, unknown>) ?? {};

  // Build entry conditionally (for exactOptionalPropertyTypes)
  const entry: HistoryEntry = {
    id: row.id,
    agentId: row.agentId,
    timestamp: row.createdAt,
    prompt: (inputData["prompt"] as string) ?? "",
    promptTokens: (inputData["promptTokens"] as number) ?? 0,
    responseSummary: (outputData["responseSummary"] as string) ?? "",
    responseTokens: (outputData["responseTokens"] as number) ?? 0,
    durationMs: row.durationMs,
    outcome: (outputData["outcome"] as HistoryOutcome) ?? "pending",
    tags: (inputData["tags"] as string[]) ?? [],
    starred: (inputData["starred"] as boolean) ?? false,
    replayCount: (inputData["replayCount"] as number) ?? 0,
  };

  const errorValue = outputData["error"] as string | undefined;
  if (errorValue !== undefined) entry.error = errorValue;

  const metadataValue = inputData["metadata"] as Record<string, unknown> | undefined;
  if (metadataValue !== undefined) entry.metadata = metadataValue;

  return entry;
}

/**
 * Estimate token count from text (rough approximation).
 */
function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Escape a value for CSV.
 */
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
