/**
 * Memory Routes Tests
 *
 * Tests for the CM (Cass-Memory) REST API endpoints.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { memory } from "../routes/memory";
import type {
  CMContextResult,
  CMDoctorResult,
  CMOutcomeResult,
  CMPlaybookListResult,
  CMQuickstartResult,
  CMStatsResult,
} from "../services/cm.service";

// ============================================================================
// Mock Service
// ============================================================================

// Mock the cm.service module
type CMStatusResult = {
  available: boolean;
  healthy: boolean;
  version: string;
  overallStatus: "healthy" | "degraded" | "unhealthy";
  error?: string;
};

const mockGetCMStatus = mock(
  (): Promise<CMStatusResult> =>
    Promise.resolve({
      available: true,
      healthy: true,
      version: "0.2.0",
      overallStatus: "healthy",
    }),
);

const mockIsCMAvailable = mock(() => Promise.resolve(true));

const mockGetTaskContext = mock(
  (): Promise<CMContextResult> =>
    Promise.resolve({
      success: true,
      task: "test task",
      relevantBullets: [
        {
          id: "bullet_123",
          text: "Always use descriptive variable names",
          category: "code-style",
          scope: "global",
          state: "active",
          kind: "rule",
          confidence: 0.95,
          helpfulCount: 10,
          harmfulCount: 0,
        },
      ],
      antiPatterns: [],
      historySnippets: [
        {
          source_path: "/sessions/test.jsonl",
          line_number: 42,
          agent: "claude_code",
          workspace: "/data/projects/test",
          title: "Similar task example",
          snippet: "Here is how we solved this before...",
          score: 85.5,
          created_at: Date.now(),
          origin: { kind: "local" },
        },
      ],
      deprecatedWarnings: [],
      suggestedCassQueries: ['cass search "test" --days 30'],
    }),
);

const mockGetQuickstart = mock(
  (): Promise<CMQuickstartResult> =>
    Promise.resolve({
      success: true,
      summary: "Procedural memory system for AI coding agents",
      oneCommand: 'cm context "<task>" --json',
      expectations: {
        degradedMode: "If cass is missing, historySnippets may be empty",
      },
      whatItReturns: ["relevantBullets", "antiPatterns", "historySnippets"],
      doNotDo: ["Run cm reflect manually"],
      protocol: { start: "cm context", work: "Reference rule IDs" },
      examples: ['cm context "implement auth" --json'],
    }),
);

const mockGetPlaybookStats = mock(
  (): Promise<CMStatsResult> =>
    Promise.resolve({
      success: true,
      total: 50,
      byScope: { global: 30, project: 20 },
      byState: { active: 45, deprecated: 5 },
      byKind: { rule: 35, "anti-pattern": 10, procedure: 5 },
      scoreDistribution: { excellent: 10, good: 20, neutral: 15, atRisk: 5 },
      topPerformers: [],
      mostHelpful: [],
      atRiskCount: 5,
      staleCount: 3,
    }),
);

const mockListPlaybookRules = mock(
  (): Promise<CMPlaybookListResult> =>
    Promise.resolve({
      success: true,
      bullets: [
        {
          id: "bullet_123",
          text: "Always use descriptive variable names",
          category: "code-style",
          scope: "global",
          state: "active",
          kind: "rule",
          confidence: 0.95,
          helpfulCount: 10,
          harmfulCount: 0,
        },
        {
          id: "bullet_456",
          text: "Avoid using any type in TypeScript",
          category: "typescript",
          scope: "global",
          state: "active",
          kind: "anti-pattern",
          confidence: 0.88,
          helpfulCount: 8,
          harmfulCount: 1,
        },
      ],
    }),
);

const mockRunDiagnostics = mock(
  (): Promise<CMDoctorResult> =>
    Promise.resolve({
      success: true,
      version: "0.2.0",
      generatedAt: new Date().toISOString(),
      overallStatus: "healthy",
      checks: [
        {
          category: "Cass Integration",
          item: "cass",
          status: "pass",
          message: "cass CLI found",
        },
        {
          category: "Playbook",
          item: "rules",
          status: "pass",
          message: "50 rules loaded",
        },
      ],
    }),
);

const mockRecordOutcome = mock(
  (): Promise<CMOutcomeResult> =>
    Promise.resolve({
      success: true,
      message: "Outcome recorded",
      recorded: 2,
    }),
);

// Mock the service module
mock.module("../services/cm.service", () => ({
  getCMStatus: mockGetCMStatus,
  isCMAvailable: mockIsCMAvailable,
  getTaskContext: mockGetTaskContext,
  getQuickstart: mockGetQuickstart,
  getPlaybookStats: mockGetPlaybookStats,
  listPlaybookRules: mockListPlaybookRules,
  runDiagnostics: mockRunDiagnostics,
  recordOutcome: mockRecordOutcome,
  CMClientError: class CMClientError extends Error {
    kind: string;
    details: Record<string, unknown> | undefined;
    constructor(
      kind: string,
      message: string,
      details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = "CMClientError";
      this.kind = kind;
      this.details = details;
    }
  },
}));

afterAll(() => {
  mock.restore();
});

// ============================================================================
// Test Setup
// ============================================================================

const app = new Hono();
app.route("/memory", memory);

function resetMocks() {
  mockGetCMStatus.mockClear();
  mockIsCMAvailable.mockClear();
  mockGetTaskContext.mockClear();
  mockGetQuickstart.mockClear();
  mockGetPlaybookStats.mockClear();
  mockListPlaybookRules.mockClear();
  mockRunDiagnostics.mockClear();
  mockRecordOutcome.mockClear();
}

// ============================================================================
// Tests
// ============================================================================

describe("Memory Routes", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("GET /memory/health", () => {
    test("returns health status when healthy", async () => {
      const res = await app.request("/memory/health");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.available).toBe(true);
      expect(body.data.healthy).toBe(true);
      expect(body.data.version).toBe("0.2.0");
      expect(body.data.overallStatus).toBe("healthy");
      expect(mockGetCMStatus).toHaveBeenCalled();
    });

    test("returns 503 when unhealthy", async () => {
      mockGetCMStatus.mockImplementation(() =>
        Promise.resolve({
          available: true,
          healthy: false,
          version: "0.2.0",
          overallStatus: "degraded" as const,
          error: "Some checks failed",
        }),
      );

      const res = await app.request("/memory/health");

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.data.healthy).toBe(false);
    });
  });

  describe("GET /memory/available", () => {
    test("returns availability status", async () => {
      const res = await app.request("/memory/available");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.available).toBe(true);
      expect(mockIsCMAvailable).toHaveBeenCalled();
    });

    test("returns false when unavailable", async () => {
      mockIsCMAvailable.mockImplementation(() => Promise.resolve(false));

      const res = await app.request("/memory/available");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.available).toBe(false);
    });
  });

  describe("POST /memory/context", () => {
    test("returns context for a task", async () => {
      const res = await app.request("/memory/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "implement authentication" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.task).toBe("test task");
      expect(body.data.relevantBullets).toBeInstanceOf(Array);
      expect(body.data.historySnippets).toBeInstanceOf(Array);
      expect(mockGetTaskContext).toHaveBeenCalledWith(
        "implement authentication",
        {},
      );
    });

    test("passes options to service", async () => {
      const res = await app.request("/memory/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "fix bug",
          workspace: "/data/projects/test",
          top: 5,
          history: 10,
          days: 30,
        }),
      });

      expect(res.status).toBe(200);
      expect(mockGetTaskContext).toHaveBeenCalledWith("fix bug", {
        workspace: "/data/projects/test",
        top: 5,
        history: 10,
        days: 30,
      });
    });

    test("validates request body", async () => {
      const res = await app.request("/memory/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("GET /memory/quickstart", () => {
    test("returns quickstart documentation", async () => {
      const res = await app.request("/memory/quickstart");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.summary).toBeDefined();
      expect(body.data.oneCommand).toBeDefined();
      expect(body.data.examples).toBeInstanceOf(Array);
      expect(mockGetQuickstart).toHaveBeenCalled();
    });
  });

  describe("GET /memory/stats", () => {
    test("returns playbook statistics", async () => {
      const res = await app.request("/memory/stats");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.total).toBe(50);
      expect(body.data.byScope).toBeDefined();
      expect(body.data.byState).toBeDefined();
      expect(body.data.scoreDistribution).toBeDefined();
      expect(mockGetPlaybookStats).toHaveBeenCalled();
    });
  });

  describe("GET /memory/rules", () => {
    test("returns playbook rules list", async () => {
      const res = await app.request("/memory/rules");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBe(2);
      expect(body.data[0].id).toBe("bullet_123");
      expect(mockListPlaybookRules).toHaveBeenCalled();
    });

    test("passes filter options", async () => {
      const res = await app.request(
        "/memory/rules?category=code-style&state=active&limit=10",
      );

      expect(res.status).toBe(200);
      expect(mockListPlaybookRules).toHaveBeenCalledWith({
        category: "code-style",
        state: "active",
        limit: 10,
      });
    });
  });

  describe("GET /memory/doctor", () => {
    test("returns diagnostic results", async () => {
      const res = await app.request("/memory/doctor");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.version).toBe("0.2.0");
      expect(body.data.overallStatus).toBe("healthy");
      expect(body.data.checks).toBeInstanceOf(Array);
      expect(mockRunDiagnostics).toHaveBeenCalledWith({});
    });

    test("passes fix option", async () => {
      const res = await app.request("/memory/doctor?fix=true");

      expect(res.status).toBe(200);
      expect(mockRunDiagnostics).toHaveBeenCalledWith({ fix: true });
    });
  });

  describe("POST /memory/outcome", () => {
    test("records session outcome", async () => {
      const res = await app.request("/memory/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "success",
          ruleIds: ["bullet_123", "bullet_456"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.recorded).toBe(2);
      expect(mockRecordOutcome).toHaveBeenCalledWith(
        "success",
        ["bullet_123", "bullet_456"],
        {},
      );
    });

    test("passes session option", async () => {
      const res = await app.request("/memory/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "failure",
          ruleIds: ["bullet_789"],
          session: "session_abc",
        }),
      });

      expect(res.status).toBe(200);
      expect(mockRecordOutcome).toHaveBeenCalledWith(
        "failure",
        ["bullet_789"],
        { session: "session_abc" },
      );
    });

    test("validates request body", async () => {
      const res = await app.request("/memory/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "invalid",
          ruleIds: [],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });
});
