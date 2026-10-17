/**
 * Context Pack Builder Tests
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import type { CMClient } from "@flywheel/flywheel-clients";
import { eq } from "drizzle-orm";
import { agents, db, history } from "../db";
import { setCMClientForTesting } from "../services/cm.service";
import {
  completeHistoryEntry,
  createHistoryEntry,
} from "../services/history.service";
import {
  restoreBvService,
  restoreCassService,
} from "./test-utils/db-mock-restore";

function installContextServiceMocks() {
  // Mock BV service to avoid spawning external commands
  mock.module("../services/bv.service", () => ({
    getBvTriage: async () => ({
      triage: {
        recommendations: [
          {
            id: "test-bead-1",
            type: "task",
            title: "Test Task 1",
            description: "A test task description",
            score: 0.9,
            reasons: ["High priority"],
          },
          {
            id: "test-bead-2",
            type: "bug",
            title: "Test Bug 1",
            description: "A test bug description",
            score: 0.7,
            reasons: ["Urgent fix needed"],
          },
        ],
      },
      data_hash: "mock-hash-123",
    }),
    getBvClient: () => ({
      getTriage: async () => ({
        triage: { recommendations: [] },
        data_hash: "",
      }),
      getInsights: async () => ({ insights: {}, data_hash: "" }),
      getPlan: async () => ({ plan: {}, data_hash: "" }),
    }),
    getBvProjectRoot: () => "/mock/project/root",
    clearBvCache: () => {},
  }));

  // Mock CASS service to avoid external calls
  mock.module("../services/cass.service", () => ({
    isCassAvailable: async () => false,
    searchWithTokenBudget: async () => ({
      hits: [],
      total_matches: 0,
      query: "",
    }),
  }));
}

installContextServiceMocks();

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

restoreBvService();
restoreCassService();

beforeEach(() => {
  installContextServiceMocks();
});

afterEach(() => {
  setCMClientForTesting(null);
  restoreBvService();
  restoreCassService();
});

afterAll(() => {
  setCMClientForTesting(null);
  restoreBvService();
  restoreCassService();
});

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

  describe("Memory Section (CM Integration)", () => {
    it("populates memory rules and anti-patterns from CM task context", async () => {
      const mockCmClient: CMClient = {
        isAvailable: async () => true,
        context: async (task: string) => ({
          success: true,
          task,
          relevantBullets: [
            {
              id: "rule-1",
              text: "Always run bun typecheck before closing a bead.",
              category: "verification",
              kind: "rule",
              confidence: 0.95,
              score: 0.92,
            },
          ],
          antiPatterns: [
            {
              id: "anti-1",
              text: "Never use global mock.module without restoring in afterEach.",
              category: "testing",
              kind: "anti-pattern",
              confidence: 0.99,
              score: 0.98,
            },
          ],
          historySnippets: [],
        }),
        quickstart: async () => ({
          success: true,
          summary: "",
          oneCommand: "",
          expectations: {},
          whatItReturns: [],
          doNotDo: [],
          protocol: {},
          examples: [],
        }),
        stats: async () => ({
          success: true,
          total: 2,
          byScope: {},
          byState: {},
          byKind: {},
          scoreDistribution: { excellent: 2, good: 0, neutral: 0, atRisk: 0 },
          topPerformers: [],
          mostHelpful: [],
          atRiskCount: 0,
          staleCount: 0,
        }),
        listPlaybook: async () => ({
          success: true,
          bullets: [],
        }),
        doctor: async () => ({
          success: true,
          overallStatus: "healthy",
          checks: [],
        }),
        outcome: async () => ({
          success: true,
          recorded: 1,
        }),
      };

      setCMClientForTesting(mockCmClient);

      const pack = await buildContextPack({
        sessionId: "cm-test-session",
        taskContext: "Fix test isolation in gateway",
        maxTokens: 50000,
      });

      expect(pack.sections.memory.rules).toHaveLength(2);
      expect(pack.sections.memory.rules[0]?.id).toBe("rule-1");
      expect(pack.sections.memory.rules[0]?.category).toBe("verification");
      expect(pack.sections.memory.rules[1]?.id).toBe("anti-1");
      expect(pack.sections.memory.rules[1]?.content).toContain(
        "[ANTI-PATTERN]",
      );
      expect(pack.sections.memory.categories).toEqual([
        "verification",
        "testing",
      ]);
      expect(pack.sections.memory.metadata.totalRulesMatched).toBe(2);
      expect(pack.sections.memory.metadata.rulesIncluded).toBe(2);

      const rendered = renderContextPack(pack);
      expect(rendered).toContain("### Project Guidelines (Memory)");
      expect(rendered).toContain(
        "- [verification] Always run bun typecheck before closing a bead.",
      );
      expect(rendered).toContain(
        "- [testing] [ANTI-PATTERN] Never use global mock.module without restoring in afterEach.",
      );
    });

    it("falls back to listPlaybookRules when taskContext is omitted", async () => {
      const mockCmClient: CMClient = {
        isAvailable: async () => true,
        context: async (task: string) => ({
          success: true,
          task,
          relevantBullets: [],
          antiPatterns: [],
          historySnippets: [],
        }),
        quickstart: async () => ({
          success: true,
          summary: "",
          oneCommand: "",
          expectations: {},
          whatItReturns: [],
          doNotDo: [],
          protocol: {},
          examples: [],
        }),
        stats: async () => ({
          success: true,
          total: 1,
          byScope: {},
          byState: {},
          byKind: {},
          scoreDistribution: { excellent: 1, good: 0, neutral: 0, atRisk: 0 },
          topPerformers: [],
          mostHelpful: [],
          atRiskCount: 0,
          staleCount: 0,
        }),
        listPlaybook: async () => ({
          success: true,
          bullets: [
            {
              id: "rule-general-1",
              text: "Preserve existing comments and docstrings.",
              category: "style",
              state: "active",
              confidence: 0.85,
            },
          ],
        }),
        doctor: async () => ({
          success: true,
          overallStatus: "healthy",
          checks: [],
        }),
        outcome: async () => ({
          success: true,
          recorded: 1,
        }),
      };

      setCMClientForTesting(mockCmClient);

      const pack = await buildContextPack({
        sessionId: "cm-playbook-session",
        maxTokens: 50000,
      });

      expect(pack.sections.memory.rules).toHaveLength(1);
      expect(pack.sections.memory.rules[0]?.id).toBe("rule-general-1");
      expect(pack.sections.memory.rules[0]?.category).toBe("style");
    });
  });

  describe("History Section (History Service Integration)", () => {
    it("populates conversation history from history.service in chronological order", async () => {
      const sessionId = `ctx-hist-agent-${Date.now()}`;
      await db.insert(agents).values({
        id: sessionId,
        repoUrl: "/data/projects/flywheel_gateway",
        task: "context history test",
        status: "idle",
        model: "claude-sonnet-4-20250514",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        const entry1 = await createHistoryEntry(sessionId, {
          prompt: "First user prompt: inspect context service",
        });
        await completeHistoryEntry(
          entry1.id,
          {
            responseSummary: "First assistant response: found stubbed sections",
            outcome: "success",
          },
          120,
        );

        const pack = await buildContextPack({
          sessionId,
          maxTokens: 50000,
          historyOptions: { maxEntries: 10 },
        });

        expect(pack.sections.history.entries.length).toBeGreaterThanOrEqual(2);
        expect(pack.sections.history.entries[0]?.role).toBe("user");
        expect(pack.sections.history.entries[0]?.content).toContain(
          "First user prompt: inspect context service",
        );
        expect(pack.sections.history.entries[1]?.role).toBe("assistant");
        expect(pack.sections.history.entries[1]?.content).toContain(
          "First assistant response: found stubbed sections",
        );
        expect(pack.sections.history.metadata.includedEntries).toBe(2);
        expect(pack.sections.history.metadata.oldestIncluded).toBeInstanceOf(
          Date,
        );
        expect(pack.sections.history.metadata.newestIncluded).toBeInstanceOf(
          Date,
        );

        const rendered = renderContextPack(pack);
        expect(rendered).toContain("### Recent Conversation");
        expect(rendered).toContain(
          "**User**: First user prompt: inspect context service",
        );
        expect(rendered).toContain(
          "**Assistant**: First assistant response: found stubbed sections",
        );
      } finally {
        await db.delete(history).where(eq(history.agentId, sessionId));
        await db.delete(agents).where(eq(agents.id, sessionId));
      }
    });
  });
});
