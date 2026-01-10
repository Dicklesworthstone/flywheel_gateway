/**
 * Context Budget Service - Token budget allocation and management.
 *
 * Handles intelligent allocation of token budget across context sections
 * with support for minimum allocations, proportional distribution, and
 * overflow redistribution.
 */

import {
  type BudgetStrategy,
  DEFAULT_BUDGET_STRATEGY,
  type TokenBreakdown,
} from "../types/context.types";

/**
 * Proportional section keys for budget allocation.
 */
type ProportionalSection = "triage" | "memory" | "search" | "history";

/**
 * Allocate token budget according to a strategy.
 *
 * @param totalTokens - Total available tokens
 * @param strategy - Allocation strategy to use
 * @returns Token breakdown by section
 */
export function allocateBudget(
  totalTokens: number,
  strategy: BudgetStrategy = DEFAULT_BUDGET_STRATEGY,
): TokenBreakdown {
  const sections: ProportionalSection[] = [
    "triage",
    "memory",
    "search",
    "history",
  ];

  // Handle edge case: budget is zero or negative
  if (totalTokens <= 0) {
    return {
      system: 0,
      reserved: 0,
      triage: 0,
      memory: 0,
      search: 0,
      history: 0,
    };
  }

  // Calculate minimum required for fixed allocations
  const fixedRequired = strategy.fixed.system + strategy.fixed.reserved;

  // If budget is less than fixed allocations, scale everything proportionally
  if (totalTokens <= fixedRequired) {
    const ratio = totalTokens / fixedRequired;
    return {
      system: Math.floor(strategy.fixed.system * ratio),
      reserved: Math.floor(strategy.fixed.reserved * ratio),
      triage: 0,
      memory: 0,
      search: 0,
      history: 0,
    };
  }

  // Calculate available tokens after fixed allocations
  const available = totalTokens - fixedRequired;

  // Initial proportional allocation
  const allocation: TokenBreakdown = {
    system: strategy.fixed.system,
    reserved: strategy.fixed.reserved,
    triage: Math.floor(available * strategy.proportional.triage),
    memory: Math.floor(available * strategy.proportional.memory),
    search: Math.floor(available * strategy.proportional.search),
    history: Math.floor(available * strategy.proportional.history),
  };

  // Apply minimums only if we have enough budget
  const totalMinimums =
    strategy.minimums.triage +
    strategy.minimums.memory +
    strategy.minimums.search +
    strategy.minimums.history;

  if (available >= totalMinimums) {
    // We can afford minimums, apply them
    for (const key of sections) {
      allocation[key] = Math.max(allocation[key], strategy.minimums[key]);
    }

    // Calculate total used
    const used = getTotalAllocated(allocation);

    // Redistribute overflow if we exceed budget
    let overflow = used - totalTokens;

    if (overflow > 0) {
      // Take from lowest priority first
      const reversePriority = [...strategy.priority].reverse();
      for (const key of reversePriority) {
        const reduction = Math.min(
          overflow,
          allocation[key] - strategy.minimums[key],
        );
        allocation[key] -= reduction;
        overflow -= reduction;
        if (overflow <= 0) break;
      }
    }
  }

  // Final check: ensure we never exceed budget
  const finalTotal = getTotalAllocated(allocation);
  if (finalTotal > totalTokens) {
    // Scale down proportional sections to fit
    const proportionalTotal =
      allocation.triage +
      allocation.memory +
      allocation.search +
      allocation.history;
    if (proportionalTotal > 0) {
      const excess = finalTotal - totalTokens;
      const scale = Math.max(0, 1 - excess / proportionalTotal);
      for (const key of sections) {
        allocation[key] = Math.floor(allocation[key] * scale);
      }
    }
  }

  return allocation;
}

/**
 * Calculate remaining tokens in a budget.
 *
 * @param breakdown - Current token breakdown
 * @param used - Tokens already used per section
 * @returns Remaining tokens per section
 */
export function calculateRemaining(
  breakdown: TokenBreakdown,
  used: Partial<Record<keyof TokenBreakdown, number>>,
): TokenBreakdown {
  return {
    system: breakdown.system - (used.system ?? 0),
    reserved: breakdown.reserved - (used.reserved ?? 0),
    triage: breakdown.triage - (used.triage ?? 0),
    memory: breakdown.memory - (used.memory ?? 0),
    search: breakdown.search - (used.search ?? 0),
    history: breakdown.history - (used.history ?? 0),
  };
}

/**
 * Get the total allocated tokens from a breakdown.
 */
export function getTotalAllocated(breakdown: TokenBreakdown): number {
  return (
    breakdown.system +
    breakdown.reserved +
    breakdown.triage +
    breakdown.memory +
    breakdown.search +
    breakdown.history
  );
}

/**
 * Validate a budget strategy.
 *
 * @param strategy - Strategy to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateStrategy(strategy: BudgetStrategy): string[] {
  const errors: string[] = [];

  // Check fixed allocations are non-negative
  if (strategy.fixed.system < 0) {
    errors.push("Fixed system allocation must be non-negative");
  }
  if (strategy.fixed.reserved < 0) {
    errors.push("Fixed reserved allocation must be non-negative");
  }

  // Check proportional allocations sum to ~1.0
  const proportionalSum =
    strategy.proportional.triage +
    strategy.proportional.memory +
    strategy.proportional.search +
    strategy.proportional.history;

  if (Math.abs(proportionalSum - 1.0) > 0.001) {
    errors.push(
      `Proportional allocations should sum to 1.0, got ${proportionalSum.toFixed(3)}`,
    );
  }

  // Check each proportional is between 0 and 1
  const sections: ProportionalSection[] = [
    "triage",
    "memory",
    "search",
    "history",
  ];
  for (const key of sections) {
    if (strategy.proportional[key] < 0 || strategy.proportional[key] > 1) {
      errors.push(`Proportional ${key} must be between 0 and 1`);
    }
    if (strategy.minimums[key] < 0) {
      errors.push(`Minimum ${key} must be non-negative`);
    }
  }

  // Check priority contains all sections
  const prioritySet = new Set(strategy.priority);
  for (const key of sections) {
    if (!prioritySet.has(key)) {
      errors.push(`Priority list must include ${key}`);
    }
  }

  return errors;
}

/**
 * Create a custom budget strategy with validation.
 *
 * @param overrides - Partial strategy to merge with defaults
 * @returns Complete budget strategy
 * @throws Error if the resulting strategy is invalid
 */
export function createStrategy(
  overrides: Partial<BudgetStrategy>,
): BudgetStrategy {
  const strategy: BudgetStrategy = {
    fixed: { ...DEFAULT_BUDGET_STRATEGY.fixed, ...overrides.fixed },
    proportional: {
      ...DEFAULT_BUDGET_STRATEGY.proportional,
      ...overrides.proportional,
    },
    minimums: { ...DEFAULT_BUDGET_STRATEGY.minimums, ...overrides.minimums },
    priority: overrides.priority ?? [...DEFAULT_BUDGET_STRATEGY.priority],
  };

  const errors = validateStrategy(strategy);
  if (errors.length > 0) {
    throw new Error(`Invalid budget strategy: ${errors.join("; ")}`);
  }

  return strategy;
}

/**
 * Get model-specific token limit.
 *
 * @param model - Model identifier
 * @param limits - Model limits map
 * @param defaultLimit - Default limit if model not found
 * @returns Token limit for the model
 */
export function getModelLimit(
  model: string | undefined,
  limits: Record<string, number>,
  defaultLimit: number,
): number {
  if (!model) return defaultLimit;
  return limits[model] ?? defaultLimit;
}

/**
 * Calculate how much of a section's budget was used.
 *
 * @param allocated - Tokens allocated to section
 * @param used - Tokens actually used
 * @returns Usage percentage (0-1)
 */
export function calculateUsage(allocated: number, used: number): number {
  if (allocated <= 0) return 0;
  return Math.min(1, used / allocated);
}

/**
 * Determine if a section needs truncation.
 *
 * @param available - Available tokens
 * @param required - Required tokens
 * @returns True if truncation needed
 */
export function needsTruncation(available: number, required: number): boolean {
  return required > available;
}
