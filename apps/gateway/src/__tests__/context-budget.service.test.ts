/**
 * Tests for context-budget service.
 */

import { describe, expect, test } from "bun:test";
import {
  allocateBudget,
  calculateRemaining,
  calculateUsage,
  createStrategy,
  getModelLimit,
  getTotalAllocated,
  needsTruncation,
  validateStrategy,
} from "../services/context-budget.service";
import {
  type BudgetStrategy,
  DEFAULT_BUDGET_STRATEGY,
  type TokenBreakdown,
} from "../types/context.types";

describe("Context Budget Service", () => {
  describe("allocateBudget", () => {
    test("returns zero breakdown for zero budget", () => {
      const result = allocateBudget(0);
      expect(result.system).toBe(0);
      expect(result.reserved).toBe(0);
      expect(result.triage).toBe(0);
      expect(result.memory).toBe(0);
      expect(result.search).toBe(0);
      expect(result.history).toBe(0);
    });

    test("returns zero breakdown for negative budget", () => {
      const result = allocateBudget(-1000);
      expect(getTotalAllocated(result)).toBe(0);
    });

    test("scales fixed allocations when budget is less than fixed total", () => {
      // Default fixed = 800 (system) + 3000 (reserved) = 3800
      const result = allocateBudget(1900); // Half of 3800
      expect(result.system).toBe(400); // Half of 800
      expect(result.reserved).toBe(1500); // Half of 3000
      expect(result.triage).toBe(0);
      expect(result.memory).toBe(0);
      expect(result.search).toBe(0);
      expect(result.history).toBe(0);
    });

    test("allocates proportionally when budget exceeds fixed", () => {
      // Default: fixed = 3800, proportional = 30/20/25/25
      const result = allocateBudget(10000);
      expect(result.system).toBe(800);
      expect(result.reserved).toBe(3000);
      // Available = 10000 - 3800 = 6200
      expect(result.triage).toBeGreaterThan(0);
      expect(result.memory).toBeGreaterThan(0);
      expect(result.search).toBeGreaterThan(0);
      expect(result.history).toBeGreaterThan(0);
    });

    test("never exceeds total budget", () => {
      const budgets = [1000, 5000, 10000, 50000, 100000];
      for (const budget of budgets) {
        const result = allocateBudget(budget);
        const total = getTotalAllocated(result);
        expect(total).toBeLessThanOrEqual(budget);
      }
    });

    test("respects minimums when budget allows", () => {
      // With large budget, minimums should be respected
      const result = allocateBudget(100000);
      expect(result.triage).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.triage,
      );
      expect(result.memory).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.memory,
      );
      expect(result.search).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.search,
      );
      expect(result.history).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.history,
      );
    });

    test("uses custom strategy when provided", () => {
      const customStrategy: BudgetStrategy = {
        fixed: { system: 1000, reserved: 2000 },
        proportional: { triage: 0.5, memory: 0.2, search: 0.2, history: 0.1 },
        minimums: { triage: 100, memory: 100, search: 100, history: 100 },
        priority: ["triage", "history", "search", "memory"],
      };
      const result = allocateBudget(10000, customStrategy);
      expect(result.system).toBe(1000);
      expect(result.reserved).toBe(2000);
      // Available = 10000 - 3000 = 7000
      // Triage gets 50% = 3500
      expect(result.triage).toBeGreaterThan(result.memory);
    });

    test("handles budget exactly equal to fixed allocations", () => {
      const fixedTotal = 800 + 3000; // 3800
      const result = allocateBudget(fixedTotal);
      expect(result.system).toBe(800);
      expect(result.reserved).toBe(3000);
      expect(result.triage).toBe(0);
      expect(result.memory).toBe(0);
    });
  });

  describe("calculateRemaining", () => {
    test("returns full breakdown when nothing used", () => {
      const breakdown: TokenBreakdown = {
        system: 800,
        reserved: 3000,
        triage: 1000,
        memory: 500,
        search: 750,
        history: 1000,
      };
      const result = calculateRemaining(breakdown, {});
      expect(result).toEqual(breakdown);
    });

    test("subtracts used tokens from breakdown", () => {
      const breakdown: TokenBreakdown = {
        system: 800,
        reserved: 3000,
        triage: 1000,
        memory: 500,
        search: 750,
        history: 1000,
      };
      const result = calculateRemaining(breakdown, {
        triage: 400,
        memory: 200,
      });
      expect(result.triage).toBe(600);
      expect(result.memory).toBe(300);
      expect(result.system).toBe(800); // Unchanged
      expect(result.search).toBe(750); // Unchanged
    });

    test("handles all sections being used", () => {
      const breakdown: TokenBreakdown = {
        system: 800,
        reserved: 3000,
        triage: 1000,
        memory: 500,
        search: 750,
        history: 1000,
      };
      const used = {
        system: 800,
        reserved: 2000,
        triage: 1000,
        memory: 500,
        search: 750,
        history: 500,
      };
      const result = calculateRemaining(breakdown, used);
      expect(result.system).toBe(0);
      expect(result.reserved).toBe(1000);
      expect(result.triage).toBe(0);
      expect(result.memory).toBe(0);
      expect(result.search).toBe(0);
      expect(result.history).toBe(500);
    });
  });

  describe("getTotalAllocated", () => {
    test("sums all sections correctly", () => {
      const breakdown: TokenBreakdown = {
        system: 100,
        reserved: 200,
        triage: 300,
        memory: 400,
        search: 500,
        history: 600,
      };
      expect(getTotalAllocated(breakdown)).toBe(2100);
    });

    test("handles zero breakdown", () => {
      const breakdown: TokenBreakdown = {
        system: 0,
        reserved: 0,
        triage: 0,
        memory: 0,
        search: 0,
        history: 0,
      };
      expect(getTotalAllocated(breakdown)).toBe(0);
    });
  });

  describe("validateStrategy", () => {
    test("returns empty array for valid default strategy", () => {
      const errors = validateStrategy(DEFAULT_BUDGET_STRATEGY);
      expect(errors).toEqual([]);
    });

    test("detects negative fixed system allocation", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        fixed: { system: -100, reserved: 3000 },
      };
      const errors = validateStrategy(strategy);
      expect(errors).toContain("Fixed system allocation must be non-negative");
    });

    test("detects negative fixed reserved allocation", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        fixed: { system: 800, reserved: -100 },
      };
      const errors = validateStrategy(strategy);
      expect(errors).toContain(
        "Fixed reserved allocation must be non-negative",
      );
    });

    test("detects proportional allocations not summing to 1.0", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        proportional: { triage: 0.5, memory: 0.5, search: 0.5, history: 0.5 },
      };
      const errors = validateStrategy(strategy);
      expect(
        errors.some((e) => e.includes("Proportional allocations should sum")),
      ).toBe(true);
    });

    test("detects proportional out of range", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        proportional: { triage: 1.5, memory: -0.5, search: 0, history: 0 },
      };
      const errors = validateStrategy(strategy);
      expect(errors.some((e) => e.includes("must be between 0 and 1"))).toBe(
        true,
      );
    });

    test("detects negative minimums", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        minimums: { triage: -100, memory: 300, search: 500, history: 1000 },
      };
      const errors = validateStrategy(strategy);
      expect(errors.some((e) => e.includes("must be non-negative"))).toBe(true);
    });

    test("detects missing priority sections", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        priority: ["triage", "memory", "search"] as (
          | "triage"
          | "memory"
          | "search"
          | "history"
        )[],
      };
      const errors = validateStrategy(strategy);
      expect(errors).toContain("Priority list must include history");
    });
  });

  describe("createStrategy", () => {
    test("creates strategy with partial overrides", () => {
      const strategy = createStrategy({
        fixed: { system: 1000, reserved: 4000 },
      });
      expect(strategy.fixed.system).toBe(1000);
      expect(strategy.fixed.reserved).toBe(4000);
      // Defaults preserved
      expect(strategy.proportional).toEqual(
        DEFAULT_BUDGET_STRATEGY.proportional,
      );
    });

    test("throws on invalid strategy", () => {
      expect(() =>
        createStrategy({
          proportional: { triage: 2, memory: 0, search: 0, history: 0 },
        }),
      ).toThrow();
    });

    test("merges nested overrides correctly", () => {
      const strategy = createStrategy({
        proportional: { triage: 0.4, memory: 0.2, search: 0.2, history: 0.2 },
      });
      expect(strategy.proportional.triage).toBe(0.4);
      expect(strategy.fixed).toEqual(DEFAULT_BUDGET_STRATEGY.fixed);
    });
  });

  describe("getModelLimit", () => {
    const limits = {
      "claude-3-opus": 200000,
      "claude-3-sonnet": 200000,
      "gpt-4": 128000,
    };

    test("returns limit for known model", () => {
      expect(getModelLimit("claude-3-opus", limits, 50000)).toBe(200000);
    });

    test("returns default for unknown model", () => {
      expect(getModelLimit("unknown-model", limits, 50000)).toBe(50000);
    });

    test("returns default when model is undefined", () => {
      expect(getModelLimit(undefined, limits, 50000)).toBe(50000);
    });

    test("returns default when model is empty string", () => {
      expect(getModelLimit("", limits, 50000)).toBe(50000);
    });
  });

  describe("calculateUsage", () => {
    test("returns 0 when allocated is 0", () => {
      expect(calculateUsage(0, 100)).toBe(0);
    });

    test("returns 0 when allocated is negative", () => {
      expect(calculateUsage(-100, 100)).toBe(0);
    });

    test("calculates correct percentage", () => {
      expect(calculateUsage(1000, 500)).toBe(0.5);
      expect(calculateUsage(1000, 250)).toBe(0.25);
      expect(calculateUsage(1000, 1000)).toBe(1);
    });

    test("caps at 1 when used exceeds allocated", () => {
      expect(calculateUsage(1000, 1500)).toBe(1);
    });
  });

  describe("needsTruncation", () => {
    test("returns false when required is within available", () => {
      expect(needsTruncation(1000, 500)).toBe(false);
      expect(needsTruncation(1000, 1000)).toBe(false);
    });

    test("returns true when required exceeds available", () => {
      expect(needsTruncation(1000, 1001)).toBe(true);
      expect(needsTruncation(500, 1000)).toBe(true);
    });

    test("handles zero available", () => {
      expect(needsTruncation(0, 1)).toBe(true);
      expect(needsTruncation(0, 0)).toBe(false);
    });
  });
});
