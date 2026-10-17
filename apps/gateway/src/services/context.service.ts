/**
 * Context Pack Builder Service - Assembles optimized context for agent prompts.
 *
 * Pulls from multiple data sources (Bead Valuation, Collective Memory, CASS)
 * and intelligently allocates token budget to maximize prompt effectiveness.
 */

import type { BvRecommendation } from "@flywheel/flywheel-clients";
import { ulid } from "ulid";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type ContextPack,
  type ContextPackPreview,
  type ContextPackRequest,
  DEFAULT_BUDGET_STRATEGY,
  DEFAULT_CONTEXT_BUILDER_CONFIG,
  type HistoryEntry,
  type HistorySection,
  type MemoryRule,
  type MemorySection,
  type SearchSection,
  type SystemSection,
  type TriagedBead,
  type TriageSection,
  type TruncationRecord,
} from "../types/context.types";
import { getBvTriage } from "./bv.service";
import {
  type CassSearchHit,
  isCassAvailable,
  searchWithTokenBudget,
} from "./cass.service";
import {
  type CMPlaybookBullet,
  getTaskContext,
  isCMAvailable,
  listPlaybookRules,
} from "./cm.service";
import {
  allocateBudget,
  createStrategy,
  getModelLimit,
  getTotalAllocated,
} from "./context-budget.service";
import { queryHistory } from "./history.service";
import { countTokens, truncateToTokens } from "./tokenizer.service";

// ============================================================================
// Section Builders
// ============================================================================

/**
 * Build the system section with default system prompt.
 */
async function buildSystemSection(tokenBudget: number): Promise<SystemSection> {
  const systemPrompt = `You are an AI coding assistant working on the Flywheel Gateway project.
Follow the guidelines in AGENTS.md and use structured logging patterns.
Prioritize correctness, maintainability, and clear communication.`;

  const tokens = countTokens(systemPrompt);
  const content =
    tokens > tokenBudget
      ? truncateToTokens(systemPrompt, tokenBudget)
      : systemPrompt;

  return {
    content,
    totalTokens: countTokens(content),
  };
}

/**
 * Build the triage section from Bead Valuation.
 */
async function buildTriageSection(
  sessionId: string,
  tokenBudget: number,
  options?: {
    maxBeads?: number;
    minScore?: number;
  },
): Promise<TriageSection> {
  const log = getLogger();
  const startTime = performance.now();
  const maxBeads = options?.maxBeads ?? 5;
  const minScore = options?.minScore ?? 0;

  let recommendations: BvRecommendation[] = [];
  let dataHash: string | undefined;
  try {
    const triage = await getBvTriage();
    recommendations = triage.triage.recommendations ?? [];
    dataHash = triage.data_hash;
  } catch (error) {
    log.warn(
      { error },
      "BV triage unavailable; returning empty triage section",
    );
  }

  const filtered = recommendations
    .filter((rec) => rec.score >= minScore)
    .slice(0, maxBeads);

  const beads: TriagedBead[] = [];
  let totalTokens = 0;
  let truncated = false;

  for (const rec of filtered) {
    const reason = rec.reasons?.[0] ?? "";
    const content = rec.description ?? `Score: ${rec.score.toFixed(3)}`;
    const tokens = countTokens(`${rec.title}\n${content}\n${reason}`);

    if (totalTokens + tokens > tokenBudget) {
      truncated = true;
      break;
    }

    beads.push({
      id: rec.id,
      type: normalizeBeadType(rec.type),
      title: rec.title,
      content,
      score: rec.score,
      tokens,
      reason,
    });
    totalTokens += tokens;
  }

  const topScore =
    recommendations.length > 0
      ? Math.max(...recommendations.map((rec) => rec.score))
      : 0;
  const avgScore =
    beads.length > 0
      ? beads.reduce((sum, bead) => sum + bead.score, 0) / beads.length
      : 0;

  const section: TriageSection = {
    beads,
    totalTokens,
    truncated:
      truncated ||
      beads.length < filtered.length ||
      recommendations.length > filtered.length,
    metadata: {
      totalAvailable: recommendations.length,
      included: beads.length,
      topScore,
      avgScore,
    },
  };

  log.debug(
    {
      sessionId,
      tokenBudget,
      buildTimeMs: Math.round(performance.now() - startTime),
      included: beads.length,
      dataHash,
    },
    "Built triage section",
  );

  return section;
}

function normalizeBeadType(value?: string): TriagedBead["type"] {
  switch (value) {
    case "bug":
    case "feature":
    case "task":
    case "epic":
    case "chore":
      return value;
    default:
      return "task";
  }
}

/**
 * Convert a CM playbook bullet into a MemoryRule.
 */
function bulletToMemoryRule(bullet: CMPlaybookBullet): MemoryRule {
  const category = bullet.category ?? bullet.kind ?? "general";
  const content =
    bullet.kind === "anti-pattern"
      ? `[ANTI-PATTERN] ${bullet.text}`
      : bullet.text;
  const rawScore = bullet.score ?? bullet.confidence ?? 0.8;
  const applicability = Math.max(0, Math.min(1, rawScore));
  const priority = Math.round((bullet.confidence ?? rawScore) * 100);
  const tokens = countTokens(`[${category}] ${content}`);

  return {
    id: bullet.id,
    category,
    content,
    priority,
    tokens,
    applicability,
  };
}

/**
 * Build the memory section from Collective Memory (Cass-Memory / CM).
 */
async function buildMemorySection(
  sessionId: string,
  taskContext: string | undefined,
  tokenBudget: number,
): Promise<MemorySection> {
  const log = getLogger();
  const startTime = performance.now();

  const section: MemorySection = {
    rules: [],
    totalTokens: 0,
    categories: [],
    metadata: {
      totalRulesMatched: 0,
      rulesIncluded: 0,
      matchedCategories: [],
    },
  };

  if (tokenBudget <= 0) {
    return section;
  }

  try {
    const available = await isCMAvailable();
    if (!available) {
      log.debug(
        { sessionId, tokenBudget },
        "CM unavailable, returning empty memory section",
      );
      return section;
    }

    let bullets: CMPlaybookBullet[] = [];
    if (taskContext && taskContext.trim().length > 0) {
      const contextResult = await getTaskContext(taskContext.trim());
      bullets = [
        ...contextResult.relevantBullets,
        ...contextResult.antiPatterns.map((b) => ({
          ...b,
          kind: b.kind ?? ("anti-pattern" as const),
        })),
      ];
    } else {
      const listResult = await listPlaybookRules({ state: "active" });
      bullets = listResult.bullets;
    }

    const candidateRules = bullets.map(bulletToMemoryRule);
    const matchedCategoriesSet = new Set<string>(
      candidateRules.map((r) => r.category),
    );
    section.metadata.totalRulesMatched = candidateRules.length;
    section.metadata.matchedCategories = Array.from(matchedCategoriesSet);

    const includedCategoriesSet = new Set<string>();

    for (const rule of candidateRules) {
      if (section.totalTokens + rule.tokens > tokenBudget) {
        const remainingBudget = tokenBudget - section.totalTokens;
        if (remainingBudget > 10) {
          const truncatedContent = truncateToTokens(
            rule.content,
            remainingBudget,
          );
          if (truncatedContent.length > 20) {
            const truncatedTokens = countTokens(
              `[${rule.category}] ${truncatedContent}`,
            );
            if (section.totalTokens + truncatedTokens <= tokenBudget) {
              section.rules.push({
                ...rule,
                content: truncatedContent,
                tokens: truncatedTokens,
              });
              section.totalTokens += truncatedTokens;
              includedCategoriesSet.add(rule.category);
            }
          }
        }
        break;
      }

      section.rules.push(rule);
      section.totalTokens += rule.tokens;
      includedCategoriesSet.add(rule.category);
    }

    section.categories = Array.from(includedCategoriesSet);
    section.metadata.rulesIncluded = section.rules.length;

    log.debug(
      {
        sessionId,
        tokenBudget,
        totalRulesMatched: section.metadata.totalRulesMatched,
        rulesIncluded: section.metadata.rulesIncluded,
        buildTimeMs: Math.round(performance.now() - startTime),
      },
      "Built memory section from CM",
    );
  } catch (error) {
    log.warn(
      {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
      "CM query failed, returning empty memory section",
    );
  }

  return section;
}

/**
 * Build the search section from CASS.
 *
 * Queries CASS for semantically similar content from prior agent sessions.
 */
async function buildSearchSection(
  query: string | undefined,
  tokenBudget: number,
  options?: {
    maxResults?: number;
    minScore?: number;
  },
): Promise<SearchSection> {
  const log = getLogger();
  const startTime = performance.now();

  const section: SearchSection = {
    results: [],
    totalTokens: 0,
    query: query ?? "",
    metadata: {
      totalMatches: 0,
      includedMatches: 0,
      searchTimeMs: 0,
    },
  };

  // If no query or CASS unavailable, return empty section
  if (!query) {
    section.metadata.searchTimeMs = Math.round(performance.now() - startTime);
    log.debug({ tokenBudget }, "No search query provided, skipping CASS");
    return section;
  }

  // Check if CASS is available
  const cassAvailable = await isCassAvailable();
  if (!cassAvailable) {
    section.metadata.searchTimeMs = Math.round(performance.now() - startTime);
    log.debug(
      { query, tokenBudget },
      "CASS unavailable, returning empty search section",
    );
    return section;
  }

  try {
    const maxResults = options?.maxResults ?? 5;
    const minScore = options?.minScore ?? 0;

    const searchResult = await searchWithTokenBudget(query, tokenBudget, {
      limit: maxResults,
      fields: "summary",
    });

    section.metadata.totalMatches = searchResult.total_matches;

    // Convert CASS hits to SearchResult format
    for (const hit of searchResult.hits) {
      // Skip low-score results
      if (hit.score !== undefined && hit.score < minScore) {
        continue;
      }

      const content = hit.snippet ?? hit.content ?? hit.title ?? "";
      const resultTokens = countTokens(content);

      // Check if we can fit this result
      if (section.totalTokens + resultTokens > tokenBudget) {
        // Try truncating
        const truncatedContent = truncateToTokens(
          content,
          tokenBudget - section.totalTokens,
        );
        if (truncatedContent.length > 20) {
          const truncatedTokens = countTokens(truncatedContent);
          section.results.push({
            id: `${hit.source_path}:${hit.line_number}`,
            source: hit.source_path,
            content: truncatedContent,
            score: hit.score ?? 0,
            tokens: truncatedTokens,
            context: formatHitContext(hit),
          });
          section.totalTokens += truncatedTokens;
          section.metadata.includedMatches++;
        }
        break;
      }

      section.results.push({
        id: `${hit.source_path}:${hit.line_number}`,
        source: hit.source_path,
        content,
        score: hit.score ?? 0,
        tokens: resultTokens,
        context: formatHitContext(hit),
      });
      section.totalTokens += resultTokens;
      section.metadata.includedMatches++;
    }

    section.metadata.searchTimeMs = Math.round(performance.now() - startTime);

    log.debug(
      {
        query,
        tokenBudget,
        totalMatches: section.metadata.totalMatches,
        includedMatches: section.metadata.includedMatches,
        buildTimeMs: section.metadata.searchTimeMs,
      },
      "Built search section from CASS",
    );
  } catch (error) {
    section.metadata.searchTimeMs = Math.round(performance.now() - startTime);
    log.warn(
      {
        query,
        error: error instanceof Error ? error.message : String(error),
      },
      "CASS search failed, returning empty search section",
    );
  }

  return section;
}

/**
 * Format hit context for display.
 */
function formatHitContext(hit: CassSearchHit): string {
  const parts: string[] = [];
  if (hit.agent) parts.push(`agent: ${hit.agent}`);
  if (hit.workspace) parts.push(`workspace: ${hit.workspace}`);
  if (hit.title) parts.push(`title: ${hit.title}`);
  return parts.join(", ");
}

/**
 * Build the history section from conversation history.
 */
async function buildHistorySection(
  sessionId: string,
  tokenBudget: number,
  options?: {
    maxEntries?: number;
    maxAgeMs?: number;
  },
): Promise<HistorySection> {
  const log = getLogger();
  const startTime = performance.now();

  const section: HistorySection = {
    entries: [],
    totalTokens: 0,
    metadata: {
      totalEntries: 0,
      includedEntries: 0,
      oldestIncluded: null,
      newestIncluded: null,
    },
  };

  if (tokenBudget <= 0) {
    return section;
  }

  try {
    const maxEntries = options?.maxEntries ?? 20;
    const queryOpts: Parameters<typeof queryHistory>[0] = {
      agentId: sessionId,
      limit: maxEntries,
    };
    if (options?.maxAgeMs !== undefined && options.maxAgeMs > 0) {
      queryOpts.startDate = new Date(Date.now() - options.maxAgeMs);
    }

    const { entries: rawEntries } = await queryHistory(queryOpts);

    // Flatten each interaction (newest first from queryHistory) into conversation turns
    // in reverse chronological order (assistant response then user prompt) so we keep the
    // most recent turns within the token budget, then reverse to chronological order.
    const candidateTurnsNewestFirst: HistoryEntry[] = [];
    for (const item of rawEntries) {
      if (item.responseSummary && item.responseSummary.trim().length > 0) {
        const responseContent = item.responseSummary.trim();
        candidateTurnsNewestFirst.push({
          id: `${item.id}:assistant`,
          role: "assistant",
          content: responseContent,
          timestamp: new Date(
            item.timestamp.getTime() + Math.max(0, item.durationMs),
          ),
          tokens: countTokens(responseContent),
        });
      }
      if (item.prompt && item.prompt.trim().length > 0) {
        const promptContent = item.prompt.trim();
        candidateTurnsNewestFirst.push({
          id: `${item.id}:user`,
          role: "user",
          content: promptContent,
          timestamp: item.timestamp,
          tokens: countTokens(promptContent),
        });
      }
    }

    section.metadata.totalEntries = candidateTurnsNewestFirst.length;

    const selectedNewestFirst: HistoryEntry[] = [];
    for (const turn of candidateTurnsNewestFirst) {
      if (selectedNewestFirst.length >= maxEntries) {
        break;
      }
      if (section.totalTokens + turn.tokens > tokenBudget) {
        const remainingBudget = tokenBudget - section.totalTokens;
        if (remainingBudget > 10) {
          const truncatedContent = truncateToTokens(
            turn.content,
            remainingBudget,
          );
          if (truncatedContent.length > 20) {
            const truncatedTokens = countTokens(truncatedContent);
            if (section.totalTokens + truncatedTokens <= tokenBudget) {
              selectedNewestFirst.push({
                ...turn,
                content: truncatedContent,
                tokens: truncatedTokens,
              });
              section.totalTokens += truncatedTokens;
            }
          }
        }
        break;
      }

      selectedNewestFirst.push(turn);
      section.totalTokens += turn.tokens;
    }

    // Reverse to chronological order (oldest -> newest) for prompt rendering
    section.entries = selectedNewestFirst.reverse();
    section.metadata.includedEntries = section.entries.length;
    if (section.entries.length > 0) {
      section.metadata.oldestIncluded = section.entries[0]?.timestamp ?? null;
      section.metadata.newestIncluded =
        section.entries[section.entries.length - 1]?.timestamp ?? null;
    }

    log.debug(
      {
        sessionId,
        tokenBudget,
        totalEntries: section.metadata.totalEntries,
        includedEntries: section.metadata.includedEntries,
        buildTimeMs: Math.round(performance.now() - startTime),
      },
      "Built history section",
    );
  } catch (error) {
    log.warn(
      {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
      "History query failed, returning empty history section",
    );
  }

  return section;
}

// ============================================================================
// Context Pack Builder
// ============================================================================

/**
 * Build a complete context pack for an agent session.
 *
 * @param request - Context pack request
 * @returns Complete context pack
 */
export async function buildContextPack(
  request: ContextPackRequest,
): Promise<ContextPack> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const startTime = performance.now();

  // Determine total budget
  const totalBudget = getModelLimit(
    request.model,
    DEFAULT_CONTEXT_BUILDER_CONFIG.modelLimits,
    request.maxTokens ?? DEFAULT_CONTEXT_BUILDER_CONFIG.defaultMaxTokens,
  );

  // Allocate budget - merge partial strategy with defaults
  const strategy = request.strategy
    ? createStrategy(request.strategy)
    : DEFAULT_BUDGET_STRATEGY;
  const breakdown = allocateBudget(totalBudget, strategy);

  log.info(
    {
      sessionId: request.sessionId,
      totalBudget,
      breakdown,
      correlationId,
    },
    "Building context pack",
  );

  // Build sections in parallel
  const [system, triage, memory, search, history] = await Promise.all([
    buildSystemSection(breakdown.system),
    buildTriageSection(
      request.sessionId,
      breakdown.triage,
      request.triageOptions,
    ),
    buildMemorySection(
      request.sessionId,
      request.taskContext,
      breakdown.memory,
    ),
    buildSearchSection(
      request.searchQuery,
      breakdown.search,
      request.searchOptions,
    ),
    buildHistorySection(
      request.sessionId,
      breakdown.history,
      request.historyOptions,
    ),
  ]);

  // Collect truncations
  const truncations: TruncationRecord[] = [];
  if (triage.truncated) {
    truncations.push({
      section: "triage",
      originalTokens: triage.metadata.totalAvailable * 100, // Estimate
      truncatedTokens: triage.totalTokens,
      itemsRemoved: triage.metadata.totalAvailable - triage.metadata.included,
      reason: "Token budget exceeded",
    });
  }
  if (memory.metadata.totalRulesMatched > memory.metadata.rulesIncluded) {
    truncations.push({
      section: "memory",
      originalTokens: memory.metadata.totalRulesMatched * 40, // Estimate
      truncatedTokens: memory.totalTokens,
      itemsRemoved:
        memory.metadata.totalRulesMatched - memory.metadata.rulesIncluded,
      reason: "Token budget exceeded",
    });
  }
  if (history.metadata.totalEntries > history.metadata.includedEntries) {
    truncations.push({
      section: "history",
      originalTokens: history.metadata.totalEntries * 60, // Estimate
      truncatedTokens: history.totalTokens,
      itemsRemoved:
        history.metadata.totalEntries - history.metadata.includedEntries,
      reason: "Token budget exceeded",
    });
  }

  // Calculate totals
  const used =
    system.totalTokens +
    triage.totalTokens +
    memory.totalTokens +
    search.totalTokens +
    history.totalTokens;

  const buildTimeMs = Math.round(performance.now() - startTime);

  const pack: ContextPack = {
    id: ulid(),
    sessionId: request.sessionId,
    createdAt: new Date(),
    budget: {
      total: totalBudget,
      used,
      remaining: totalBudget - used - breakdown.reserved,
      breakdown,
    },
    sections: {
      system,
      triage,
      memory,
      search,
      history,
    },
    metadata: {
      buildTimeMs,
      sourcesQueried: [
        "bead-valuation",
        "collective-memory",
        "cass",
        "history",
      ],
      truncations,
    },
  };

  log.info(
    {
      packId: pack.id,
      sessionId: request.sessionId,
      totalTokens: used,
      buildTimeMs,
      correlationId,
    },
    "Context pack built",
  );

  return pack;
}

/**
 * Preview a context pack without fully building it.
 *
 * @param request - Context pack request
 * @returns Preview with estimates and warnings
 */
export async function previewContextPack(
  request: ContextPackRequest,
): Promise<ContextPackPreview> {
  const totalBudget = getModelLimit(
    request.model,
    DEFAULT_CONTEXT_BUILDER_CONFIG.modelLimits,
    request.maxTokens ?? DEFAULT_CONTEXT_BUILDER_CONFIG.defaultMaxTokens,
  );

  // Merge partial strategy with defaults
  const strategy = request.strategy
    ? createStrategy(request.strategy)
    : DEFAULT_BUDGET_STRATEGY;
  const breakdown = allocateBudget(totalBudget, strategy);

  const warnings: string[] = [];

  // Check if budget is sufficient
  const totalAllocated = getTotalAllocated(breakdown);
  if (totalAllocated > totalBudget) {
    warnings.push(
      `Allocated tokens (${totalAllocated}) exceed budget (${totalBudget})`,
    );
  }

  // Check minimum allocations
  if (breakdown.triage < strategy.minimums.triage) {
    warnings.push("Triage section below minimum allocation");
  }
  if (breakdown.memory < strategy.minimums.memory) {
    warnings.push("Memory section below minimum allocation");
  }
  if (breakdown.search < strategy.minimums.search) {
    warnings.push("Search section below minimum allocation");
  }
  if (breakdown.history < strategy.minimums.history) {
    warnings.push("History section below minimum allocation");
  }

  return {
    estimatedTokens: totalAllocated,
    breakdown,
    warnings,
    sectionsAvailable: {
      triage: true, // Will be true when BV is integrated
      memory: true, // Will be true when CM is integrated
      search: true, // Will be true when CASS is integrated
      history: true, // Will be true when history is integrated
    },
  };
}

/**
 * Render a context pack to a prompt string.
 *
 * @param pack - Context pack to render
 * @returns Formatted prompt string
 */
export function renderContextPack(pack: ContextPack): string {
  const sections: string[] = [];

  // System section
  if (pack.sections.system.content) {
    sections.push(pack.sections.system.content);
  }

  // Check if we have any relevant context to show
  const hasRelevantContext =
    pack.sections.triage.beads.length > 0 ||
    pack.sections.memory.rules.length > 0 ||
    pack.sections.search.results.length > 0;

  if (hasRelevantContext) {
    sections.push("\n## Relevant Context\n");
  }

  // Triage section
  if (pack.sections.triage.beads.length > 0) {
    sections.push("### Active Work Items (Triage)");
    for (const bead of pack.sections.triage.beads) {
      sections.push(`- **${bead.id}** [${bead.type}]: ${bead.title}`);
      if (bead.content) {
        sections.push(`  ${bead.content}`);
      }
      if (bead.reason) {
        sections.push(`  _Reason: ${bead.reason}_`);
      }
    }
    sections.push("");
  }

  // Memory section
  if (pack.sections.memory.rules.length > 0) {
    sections.push("### Project Guidelines (Memory)");
    for (const rule of pack.sections.memory.rules) {
      sections.push(`- [${rule.category}] ${rule.content}`);
    }
    sections.push("");
  }

  // Search section
  if (pack.sections.search.results.length > 0) {
    sections.push("### Related Information (Search)");
    for (const result of pack.sections.search.results) {
      sections.push(
        `- **${result.source}** (score: ${result.score.toFixed(2)})`,
      );
      sections.push(`  ${result.content}`);
    }
    sections.push("");
  }

  // History section
  if (pack.sections.history.entries.length > 0) {
    sections.push("### Recent Conversation");
    for (const entry of pack.sections.history.entries) {
      const role = entry.role.charAt(0).toUpperCase() + entry.role.slice(1);
      sections.push(`**${role}**: ${entry.content}`);
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

/**
 * Get a summary of a context pack for logging/display.
 */
export function getContextPackSummary(pack: ContextPack): {
  id: string;
  sessionId: string;
  tokensUsed: number;
  tokensRemaining: number;
  buildTimeMs: number;
  sectionCounts: {
    beads: number;
    rules: number;
    searchResults: number;
    historyEntries: number;
  };
} {
  return {
    id: pack.id,
    sessionId: pack.sessionId,
    tokensUsed: pack.budget.used,
    tokensRemaining: pack.budget.remaining,
    buildTimeMs: pack.metadata.buildTimeMs,
    sectionCounts: {
      beads: pack.sections.triage.beads.length,
      rules: pack.sections.memory.rules.length,
      searchResults: pack.sections.search.results.length,
      historyEntries: pack.sections.history.entries.length,
    },
  };
}
