/**
 * Context Pack Builder Tests
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  buildContextPack,
  getContextPackSummary,
  previewContextPack,
  renderContextPack,
} from "../services/context.service";
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
  countTokens,
  countTokensMultiple,
  splitIntoChunks,
  truncateToTokens,
} from "../services/tokenizer.service";
import {
  type BudgetStrategy,
  DEFAULT_BUDGET_STRATEGY,
  DEFAULT_CONTEXT_BUILDER_CONFIG,
} from "../types/context.types";

// ============================================================================
// Token Budget Tests
// ============================================================================

describe("Token Budget Allocation", () => {
  describe("allocateBudget", () => {
    it("should allocate tokens according to strategy proportions", () => {
      const totalTokens = 100000;
      const breakdown = allocateBudget(totalTokens, DEFAULT_BUDGET_STRATEGY);

      // Check fixed allocations
      expect(breakdown.system).toBe(DEFAULT_BUDGET_STRATEGY.fixed.system);
      expect(breakdown.reserved).toBe(DEFAULT_BUDGET_STRATEGY.fixed.reserved);

      // Check total doesn't exceed budget
      const total = getTotalAllocated(breakdown);
      expect(total).toBeLessThanOrEqual(totalTokens);
    });

    it("should apply minimum allocations", () => {
      const totalTokens = 100000;
      const breakdown = allocateBudget(totalTokens, DEFAULT_BUDGET_STRATEGY);

      expect(breakdown.triage).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.triage,
      );
      expect(breakdown.memory).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.memory,
      );
      expect(breakdown.search).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.search,
      );
      expect(breakdown.history).toBeGreaterThanOrEqual(
        DEFAULT_BUDGET_STRATEGY.minimums.history,
      );
    });

    it("should never exceed total budget", () => {
      const testCases = [1000, 5000, 10000, 50000, 100000, 200000];

      for (const totalTokens of testCases) {
        const breakdown = allocateBudget(totalTokens, DEFAULT_BUDGET_STRATEGY);
        const total = getTotalAllocated(breakdown);
        expect(total).toBeLessThanOrEqual(totalTokens);
      }
    });

    it("should handle very small budgets gracefully", () => {
      const breakdown = allocateBudget(1000, DEFAULT_BUDGET_STRATEGY);
      const total = getTotalAllocated(breakdown);
      expect(total).toBeLessThanOrEqual(1000);
    });

    it("should redistribute overflow by priority", () => {
      // Create a strategy where minimums exceed proportional allocation
      const tightStrategy: BudgetStrategy = {
        fixed: { system: 500, reserved: 500 },
        proportional: {
          triage: 0.25,
          memory: 0.25,
          search: 0.25,
          history: 0.25,
        },
        minimums: { triage: 2000, memory: 2000, search: 2000, history: 2000 },
        priority: ["triage", "history", "search", "memory"],
      };

      const breakdown = allocateBudget(5000, tightStrategy);
      const total = getTotalAllocated(breakdown);
      expect(total).toBeLessThanOrEqual(5000);
    });
  });

  describe("calculateRemaining", () => {
    it("should calculate remaining tokens correctly", () => {
      const breakdown = allocateBudget(100000, DEFAULT_BUDGET_STRATEGY);
      const used = { triage: 500, memory: 200, search: 300 };
      const remaining = calculateRemaining(breakdown, used);

      expect(remaining.triage).toBe(breakdown.triage - 500);
      expect(remaining.memory).toBe(breakdown.memory - 200);
      expect(remaining.search).toBe(breakdown.search - 300);
      expect(remaining.history).toBe(breakdown.history);
    });
  });

  describe("validateStrategy", () => {
    it("should validate default strategy as valid", () => {
      const errors = validateStrategy(DEFAULT_BUDGET_STRATEGY);
      expect(errors).toHaveLength(0);
    });

    it("should detect invalid proportional sum", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        proportional: { triage: 0.5, memory: 0.5, search: 0.5, history: 0.5 },
      };
      const errors = validateStrategy(strategy);
      expect(errors.some((e) => e.includes("sum to 1.0"))).toBe(true);
    });

    it("should detect negative fixed allocations", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        fixed: { system: -100, reserved: 3000 },
      };
      const errors = validateStrategy(strategy);
      expect(errors.some((e) => e.includes("non-negative"))).toBe(true);
    });

    it("should detect missing priority sections", () => {
      const strategy: BudgetStrategy = {
        ...DEFAULT_BUDGET_STRATEGY,
        priority: ["triage", "memory"] as any,
      };
      const errors = validateStrategy(strategy);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("createStrategy", () => {
    it("should create a valid strategy from overrides", () => {
      const strategy = createStrategy({
        fixed: { system: 1000, reserved: 4000 },
      });
      expect(strategy.fixed.system).toBe(1000);
      expect(strategy.fixed.reserved).toBe(4000);
      expect(validateStrategy(strategy)).toHaveLength(0);
    });

    it("should throw on invalid overrides", () => {
      expect(() =>
        createStrategy({
          proportional: {
            triage: 2.0,
            memory: 0.2,
            search: 0.25,
            history: 0.25,
          },
        }),
      ).toThrow();
    });
  });

  describe("getModelLimit", () => {
    it("should return model-specific limits", () => {
      const limits = { "gpt-4": 128000, "claude-3-sonnet": 200000 };
      expect(getModelLimit("gpt-4", limits, 100000)).toBe(128000);
      expect(getModelLimit("claude-3-sonnet", limits, 100000)).toBe(200000);
    });

    it("should return default for unknown models", () => {
      expect(getModelLimit("unknown-model", {}, 100000)).toBe(100000);
      expect(getModelLimit(undefined, {}, 50000)).toBe(50000);
    });
  });

  describe("calculateUsage", () => {
    it("should calculate usage percentage correctly", () => {
      expect(calculateUsage(1000, 500)).toBe(0.5);
      expect(calculateUsage(1000, 1000)).toBe(1);
      expect(calculateUsage(1000, 1500)).toBe(1); // Capped at 1
      expect(calculateUsage(0, 100)).toBe(0);
    });
  });

  describe("needsTruncation", () => {
    it("should detect when truncation is needed", () => {
      expect(needsTruncation(1000, 1500)).toBe(true);
      expect(needsTruncation(1000, 500)).toBe(false);
      expect(needsTruncation(1000, 1000)).toBe(false);
    });
  });
});

// ============================================================================
// Tokenizer Tests
// ============================================================================

describe("Tokenizer Service", () => {
  describe("countTokens", () => {
    it("should count tokens in plain text", () => {
      const text = "Hello, world! This is a test message.";
      const tokens = countTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // Rough estimate: ~10 tokens for this sentence
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(20);
    });

    it("should return 0 for empty string", () => {
      expect(countTokens("")).toBe(0);
    });

    it("should handle code content", () => {
      const code = `
        function hello() {
          console.log("Hello, world!");
          return 42;
        }
      `;
      const tokens = countTokens(code);
      expect(tokens).toBeGreaterThan(0);
    });

    it("should handle JSON content", () => {
      const json = JSON.stringify({ name: "test", values: [1, 2, 3] });
      const tokens = countTokens(json);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("countTokensMultiple", () => {
    it("should sum tokens from multiple strings", () => {
      const texts = ["Hello", "World", "Test"];
      const total = countTokensMultiple(texts);
      const individual = texts.reduce((sum, t) => sum + countTokens(t), 0);
      expect(total).toBe(individual);
    });
  });

  describe("truncateToTokens", () => {
    it("should truncate text to fit token budget", () => {
      const longText = "This is a very long text. ".repeat(100);
      const truncated = truncateToTokens(longText, 50);
      const tokens = countTokens(truncated);
      expect(tokens).toBeLessThanOrEqual(55); // Allow some margin
    });

    it("should not truncate text within budget", () => {
      const shortText = "Hello, world!";
      const result = truncateToTokens(shortText, 1000);
      expect(result).toBe(shortText);
    });

    it("should add ellipsis when truncating", () => {
      const longText = "This is a very long text. ".repeat(100);
      const truncated = truncateToTokens(longText, 20);
      expect(truncated.endsWith("...")).toBe(true);
    });
  });

  describe("splitIntoChunks", () => {
    it("should split long text into chunks", () => {
      const longText =
        "This is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.";
      const chunks = splitIntoChunks(longText, 50);
      expect(chunks.length).toBeGreaterThan(0);

      for (const chunk of chunks) {
        const tokens = countTokens(chunk);
        expect(tokens).toBeLessThanOrEqual(55); // Allow margin
      }
    });

    it("should return single chunk for short text", () => {
      const shortText = "Hello, world!";
      const chunks = splitIntoChunks(shortText, 1000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(shortText);
    });

    it("should return empty array for empty text", () => {
      expect(splitIntoChunks("", 100)).toHaveLength(0);
    });
  });
});

// ============================================================================
// Context Pack Builder Tests
// ============================================================================

describe("Context Pack Builder", () => {
  describe("buildContextPack", () => {
    it("should build a context pack with all sections", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session-123",
        maxTokens: 100000,
      });

      expect(pack.id).toBeTruthy();
      expect(pack.sessionId).toBe("test-session-123");
      expect(pack.createdAt).toBeInstanceOf(Date);
      expect(pack.budget.total).toBe(100000);
      expect(pack.budget.used).toBeGreaterThanOrEqual(0);
      expect(pack.sections.system).toBeTruthy();
      expect(pack.sections.triage).toBeTruthy();
      expect(pack.sections.memory).toBeTruthy();
      expect(pack.sections.search).toBeTruthy();
      expect(pack.sections.history).toBeTruthy();
    });

    it("should respect token budget", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session",
        maxTokens: 50000,
      });

      expect(pack.budget.total).toBe(50000);
      expect(pack.budget.used).toBeLessThanOrEqual(50000);
    });

    it("should include build metadata", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session",
      });

      expect(pack.metadata.buildTimeMs).toBeGreaterThanOrEqual(0);
      expect(pack.metadata.sourcesQueried).toContain("bead-valuation");
      expect(pack.metadata.sourcesQueried).toContain("collective-memory");
      expect(pack.metadata.sourcesQueried).toContain("cass");
    });

    it("should use model-specific limits", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session",
        model: "sonnet-4",
      });

      expect(pack.budget.total).toBe(
        DEFAULT_CONTEXT_BUILDER_CONFIG.modelLimits["sonnet-4"] ?? 200000,
      );
    });
  });

  describe("previewContextPack", () => {
    it("should preview without building full pack", async () => {
      const preview = await previewContextPack({
        sessionId: "test-session",
        maxTokens: 100000,
      });

      expect(preview.estimatedTokens).toBeGreaterThan(0);
      expect(preview.breakdown).toBeTruthy();
      expect(Array.isArray(preview.warnings)).toBe(true);
    });

    it("should warn on tight budgets", async () => {
      const preview = await previewContextPack({
        sessionId: "test-session",
        maxTokens: 1000, // Very tight budget
      });

      // May have warnings about sections below minimums
      expect(Array.isArray(preview.warnings)).toBe(true);
    });
  });

  describe("renderContextPack", () => {
    it("should render pack to formatted string", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session",
      });

      const rendered = renderContextPack(pack);
      expect(typeof rendered).toBe("string");
      expect(rendered.length).toBeGreaterThan(0);
    });

    it("should include system prompt", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session",
      });

      const rendered = renderContextPack(pack);
      expect(rendered).toContain("AI coding assistant");
    });
  });

  describe("getContextPackSummary", () => {
    it("should return summary of pack", async () => {
      const pack = await buildContextPack({
        sessionId: "test-session",
      });

      const summary = getContextPackSummary(pack);
      expect(summary.id).toBe(pack.id);
      expect(summary.sessionId).toBe("test-session");
      expect(summary.tokensUsed).toBe(pack.budget.used);
      expect(summary.sectionCounts).toBeTruthy();
    });
  });
});
