/**
 * Context Pack Builder Service - Assembles optimized context for agent prompts.
 *
 * Pulls from multiple data sources (Bead Valuation, Collective Memory, CASS)
 * and intelligently allocates token budget to maximize prompt effectiveness.
 */

import { ulid } from "ulid";
import { getLogger, getCorrelationId } from "../middleware/correlation";
import {
  type ContextPack,
  type ContextPackRequest,
  type ContextPackPreview,
  type TokenBreakdown,
  type BudgetStrategy,
  type TriageSection,
  type MemorySection,
  type SearchSection,
  type HistorySection,
  type SystemSection,
  type TruncationRecord,
  type TriagedBead,
  type MemoryRule,
  type SearchResult,
  type HistoryEntry,
  DEFAULT_BUDGET_STRATEGY,
  DEFAULT_CONTEXT_BUILDER_CONFIG,
} from "../types/context.types";
import {
  allocateBudget,
  getTotalAllocated,
  getModelLimit,
  createStrategy,
} from "./context-budget.service";
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
 *
 * Currently uses a stub implementation since BV is not yet integrated.
 * Will be replaced with actual BV queries when available.
 */
async function buildTriageSection(
  sessionId: string,
  tokenBudget: number,
  options?: {
    maxBeads?: number;
    minScore?: number;
  }
): Promise<TriageSection> {
  const log = getLogger();
  const startTime = performance.now();

  // Stub: In production, query BV for top-scored ready beads
  // const beads = await beadValuation.getTopBeads({ sessionId, ... });

  const section: TriageSection = {
    beads: [],
    totalTokens: 0,
    truncated: false,
    metadata: {
      totalAvailable: 0,
      included: 0,
      topScore: 0,
      avgScore: 0,
    },
  };

  // When BV integration is available, populate with real beads
  // For now, return empty section indicating BV is not yet available

  log.debug(
    {
      sessionId,
      tokenBudget,
      buildTimeMs: Math.round(performance.now() - startTime),
    },
    "Built triage section (stub)"
  );

  return section;
}

/**
 * Build the memory section from Collective Memory.
 *
 * Currently uses a stub implementation since CM is not yet integrated.
 */
async function buildMemorySection(
  sessionId: string,
  taskContext: string | undefined,
  tokenBudget: number
): Promise<MemorySection> {
  const log = getLogger();
  const startTime = performance.now();

  // Stub: In production, query CM for relevant rules
  // const rules = await collectiveMemory.queryRules({ context: taskContext, ... });

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

  // When CM integration is available, populate with real rules

  log.debug(
    {
      sessionId,
      tokenBudget,
      buildTimeMs: Math.round(performance.now() - startTime),
    },
    "Built memory section (stub)"
  );

  return section;
}

/**
 * Build the search section from CASS.
 *
 * Currently uses a stub implementation since CASS is not yet integrated.
 */
async function buildSearchSection(
  query: string | undefined,
  tokenBudget: number,
  options?: {
    maxResults?: number;
    minScore?: number;
  }
): Promise<SearchSection> {
  const log = getLogger();
  const startTime = performance.now();

  // Stub: In production, query CASS for semantically similar content
  // const results = await cass.search({ query, ... });

  const section: SearchSection = {
    results: [],
    totalTokens: 0,
    query: query ?? "",
    metadata: {
      totalMatches: 0,
      includedMatches: 0,
      searchTimeMs: Math.round(performance.now() - startTime),
    },
  };

  // When CASS integration is available, populate with real results

  log.debug(
    {
      query,
      tokenBudget,
      buildTimeMs: section.metadata.searchTimeMs,
    },
    "Built search section (stub)"
  );

  return section;
}

/**
 * Build the history section from conversation history.
 *
 * Currently uses a stub implementation.
 */
async function buildHistorySection(
  sessionId: string,
  tokenBudget: number,
  options?: {
    maxEntries?: number;
    maxAgeMs?: number;
  }
): Promise<HistorySection> {
  const log = getLogger();
  const startTime = performance.now();

  // Stub: In production, query conversation history
  // const history = await historyService.getRecent(sessionId, ...);

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

  // When history tracking is available, populate with real entries

  log.debug(
    {
      sessionId,
      tokenBudget,
      buildTimeMs: Math.round(performance.now() - startTime),
    },
    "Built history section (stub)"
  );

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
  request: ContextPackRequest
): Promise<ContextPack> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const startTime = performance.now();

  // Determine total budget
  const totalBudget = getModelLimit(
    request.model,
    DEFAULT_CONTEXT_BUILDER_CONFIG.modelLimits,
    request.maxTokens ?? DEFAULT_CONTEXT_BUILDER_CONFIG.defaultMaxTokens
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
    "Building context pack"
  );

  // Build sections in parallel
  const [system, triage, memory, search, history] = await Promise.all([
    buildSystemSection(breakdown.system),
    buildTriageSection(request.sessionId, breakdown.triage, request.triageOptions),
    buildMemorySection(request.sessionId, request.taskContext, breakdown.memory),
    buildSearchSection(request.searchQuery, breakdown.search, request.searchOptions),
    buildHistorySection(request.sessionId, breakdown.history, request.historyOptions),
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
      sourcesQueried: ["bead-valuation", "collective-memory", "cass", "history"],
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
    "Context pack built"
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
  request: ContextPackRequest
): Promise<ContextPackPreview> {
  const totalBudget = getModelLimit(
    request.model,
    DEFAULT_CONTEXT_BUILDER_CONFIG.modelLimits,
    request.maxTokens ?? DEFAULT_CONTEXT_BUILDER_CONFIG.defaultMaxTokens
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
      `Allocated tokens (${totalAllocated}) exceed budget (${totalBudget})`
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

  // Relevant context header
  sections.push("\n## Relevant Context\n");

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
      sections.push(`- **${result.source}** (score: ${result.score.toFixed(2)})`);
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
