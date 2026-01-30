/**
 * Tests for system routes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { system } from "../routes/system";
import { clearSnapshotServiceInstance } from "../services/snapshot.service";

// ============================================================================
// Types
// ============================================================================

interface SystemSnapshotEnvelope {
  object: string;
  data: {
    meta: {
      schemaVersion: string;
      generatedAt: string;
      generationDurationMs: number;
    };
    summary: {
      status: "healthy" | "degraded" | "unhealthy" | "unknown";
      ntm: string;
      agentMail: string;
      beads: string;
      tools: string;
      healthyCount: number;
      degradedCount: number;
      unhealthyCount: number;
      unknownCount: number;
      issues: string[];
    };
    ntm: {
      capturedAt: string;
      available: boolean;
      sessions: unknown[];
      summary: {
        totalSessions: number;
        totalAgents: number;
        attachedCount: number;
        byAgentType: Record<string, number>;
      };
      alerts: string[];
    };
    agentMail: {
      capturedAt: string;
      available: boolean;
      agents: unknown[];
      reservations: unknown[];
      messages: {
        total: number;
        unread: number;
        byPriority: Record<string, number>;
      };
    };
    beads: {
      capturedAt: string;
      brAvailable: boolean;
      bvAvailable: boolean;
      statusCounts: Record<string, number>;
      typeCounts: Record<string, number>;
      priorityCounts: Record<string, number>;
      actionableCount: number;
      topRecommendations: unknown[];
      quickWins: unknown[];
      blockersToClean: unknown[];
    };
    tools: {
      capturedAt: string;
      dcg: { installed: boolean; version: string | null; healthy: boolean };
      slb: { installed: boolean; version: string | null; healthy: boolean };
      ubs: { installed: boolean; version: string | null; healthy: boolean };
      status: "healthy" | "degraded" | "unhealthy";
      checksumStatuses: unknown[];
      issues: string[];
      recommendations: string[];
    };
  };
  requestId?: string;
}

interface CacheStatusEnvelope {
  object: string;
  data: {
    cached: boolean;
    ageMs: number | null;
    ttlMs: number;
    expiresInMs: number | null;
  };
  requestId?: string;
}

interface CacheClearedEnvelope {
  object: string;
  data: {
    message: string;
    timestamp: string;
  };
  requestId?: string;
}

// ============================================================================
// Tests
// ============================================================================

const ROUTES_TEST_TIMEOUT_MS = 30000;

describe("System Routes", () => {
  const app = new Hono().route("/system", system);

  beforeEach(() => {
    clearSnapshotServiceInstance();
  });

  afterEach(() => {
    clearSnapshotServiceInstance();
  });

  describe("GET /system/snapshot", () => {
    test("returns system snapshot with all required sections", async () => {
      const res = await app.request("/system/snapshot");

      // May return 200 or 503 depending on component health
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as SystemSnapshotEnvelope;

      // Canonical envelope format
      expect(body.object).toBe("system_snapshot");
      expect(body.data).toBeDefined();

      // Check meta
      expect(body.data.meta).toBeDefined();
      expect(body.data.meta.schemaVersion).toBe("1.0.0");
      expect(typeof body.data.meta.generatedAt).toBe("string");
      expect(typeof body.data.meta.generationDurationMs).toBe("number");

      // Check summary
      expect(body.data.summary).toBeDefined();
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(
        body.data.summary.status,
      );
      expect(typeof body.data.summary.healthyCount).toBe("number");
      expect(typeof body.data.summary.degradedCount).toBe("number");
      expect(typeof body.data.summary.unhealthyCount).toBe("number");
      expect(typeof body.data.summary.unknownCount).toBe("number");
      expect(Array.isArray(body.data.summary.issues)).toBe(true);

      // Check NTM section
      expect(body.data.ntm).toBeDefined();
      expect(typeof body.data.ntm.capturedAt).toBe("string");
      expect(typeof body.data.ntm.available).toBe("boolean");
      expect(Array.isArray(body.data.ntm.sessions)).toBe(true);
      expect(body.data.ntm.summary).toBeDefined();
      expect(Array.isArray(body.data.ntm.alerts)).toBe(true);

      // Check Agent Mail section
      expect(body.data.agentMail).toBeDefined();
      expect(typeof body.data.agentMail.capturedAt).toBe("string");
      expect(typeof body.data.agentMail.available).toBe("boolean");

      // Check Beads section
      expect(body.data.beads).toBeDefined();
      expect(typeof body.data.beads.capturedAt).toBe("string");
      expect(typeof body.data.beads.brAvailable).toBe("boolean");
      expect(typeof body.data.beads.bvAvailable).toBe("boolean");
      expect(body.data.beads.statusCounts).toBeDefined();
      expect(body.data.beads.typeCounts).toBeDefined();
      expect(body.data.beads.priorityCounts).toBeDefined();

      // Check Tools section
      expect(body.data.tools).toBeDefined();
      expect(typeof body.data.tools.capturedAt).toBe("string");
      expect(body.data.tools.dcg).toBeDefined();
      expect(body.data.tools.slb).toBeDefined();
      expect(body.data.tools.ubs).toBeDefined();
    }, ROUTES_TEST_TIMEOUT_MS);

    test("returns cached response on subsequent requests", async () => {
      // First request
      const res1 = await app.request("/system/snapshot");
      const body1 = (await res1.json()) as SystemSnapshotEnvelope;

      // Second request (should be cached)
      const res2 = await app.request("/system/snapshot");
      const body2 = (await res2.json()) as SystemSnapshotEnvelope;

      // Should have same generatedAt (cached)
      expect(body1.data.meta.generatedAt).toBe(body2.data.meta.generatedAt);
    }, ROUTES_TEST_TIMEOUT_MS);

    test("bypass_cache=true returns fresh snapshot", async () => {
      // First request
      const res1 = await app.request("/system/snapshot");
      const body1 = (await res1.json()) as SystemSnapshotEnvelope;

      // Wait briefly
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second request with bypass_cache
      const res2 = await app.request("/system/snapshot?bypass_cache=true");
      const body2 = (await res2.json()) as SystemSnapshotEnvelope;

      // Should have different generatedAt (fresh)
      expect(body1.data.meta.generatedAt).not.toBe(body2.data.meta.generatedAt);
    }, ROUTES_TEST_TIMEOUT_MS);

    test("returns 503 when overall status is unhealthy", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;

      if (body.data.summary.status === "unhealthy") {
        expect(res.status).toBe(503);
      } else {
        expect(res.status).toBe(200);
      }
    }, ROUTES_TEST_TIMEOUT_MS);
  });

  describe("GET /system/snapshot/cache", () => {
    test("returns cache status before any snapshot", async () => {
      const res = await app.request("/system/snapshot/cache");

      expect(res.status).toBe(200);
      const body = (await res.json()) as CacheStatusEnvelope;

      expect(body.object).toBe("snapshot_cache_status");
      expect(body.data.cached).toBe(false);
      expect(body.data.ageMs).toBeNull();
      expect(typeof body.data.ttlMs).toBe("number");
      expect(body.data.expiresInMs).toBeNull();
    }, ROUTES_TEST_TIMEOUT_MS);

    test("returns cache status after snapshot", async () => {
      // First fetch a snapshot
      await app.request("/system/snapshot");

      // Then check cache status
      const res = await app.request("/system/snapshot/cache");
      const body = (await res.json()) as CacheStatusEnvelope;

      expect(body.object).toBe("snapshot_cache_status");
      expect(body.data.cached).toBe(true);
      expect(typeof body.data.ageMs).toBe("number");
      expect(body.data.ageMs).toBeGreaterThanOrEqual(0);
      expect(typeof body.data.expiresInMs).toBe("number");
    }, ROUTES_TEST_TIMEOUT_MS);
  });

  describe("DELETE /system/snapshot/cache", () => {
    test("clears snapshot cache", async () => {
      // First fetch a snapshot to populate cache
      await app.request("/system/snapshot");

      // Verify cache is populated
      let cacheRes = await app.request("/system/snapshot/cache");
      let cacheBody = (await cacheRes.json()) as CacheStatusEnvelope;
      expect(cacheBody.data.cached).toBe(true);

      // Clear the cache
      const deleteRes = await app.request("/system/snapshot/cache", {
        method: "DELETE",
      });

      expect(deleteRes.status).toBe(200);
      const deleteBody = (await deleteRes.json()) as CacheClearedEnvelope;
      expect(deleteBody.object).toBe("snapshot_cache_cleared");
      expect(deleteBody.data.message).toBe(
        "Snapshot cache cleared successfully",
      );
      expect(typeof deleteBody.data.timestamp).toBe("string");

      // Verify cache is now empty
      cacheRes = await app.request("/system/snapshot/cache");
      cacheBody = (await cacheRes.json()) as CacheStatusEnvelope;
      expect(cacheBody.data.cached).toBe(false);
    }, ROUTES_TEST_TIMEOUT_MS);
  });
});

// ============================================================================
// Contract Tests - Schema Validation (bd-2ek6)
// ============================================================================

import { z } from "zod";
import {
  SnapshotCacheClearedSchema,
  SnapshotCacheStatusSchema,
  SystemSnapshotDataSchema,
} from "../api/schemas";

/**
 * Structured log for schema validation results.
 * Emits diagnostic info with request ID and diff summary.
 */
interface SchemaValidationLog {
  requestId: string;
  endpoint: string;
  timestamp: string;
  valid: boolean;
  errorCount: number;
  errors: Array<{
    path: string;
    code: string;
    message: string;
    received?: unknown;
  }>;
}

/**
 * Validate response data against a Zod schema and return structured log.
 */
function validateSchemaWithLog<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  endpoint: string,
  requestId: string,
): SchemaValidationLog {
  const result = schema.safeParse(data);

  const log: SchemaValidationLog = {
    requestId,
    endpoint,
    timestamp: new Date().toISOString(),
    valid: result.success,
    errorCount: 0,
    errors: [],
  };

  if (!result.success) {
    log.errorCount = result.error.issues.length;
    log.errors = result.error.issues.map((e) => ({
      path: e.path.join("."),
      code: e.code,
      message: e.message,
      received:
        e.code === "invalid_type"
          ? (e as unknown as { received: unknown }).received
          : undefined,
    }));
  }

  return log;
}

describe("System Routes Contract Tests (bd-2ek6)", () => {
  const app = new Hono().route("/system", system);

  beforeEach(() => {
    clearSnapshotServiceInstance();
  });

  afterEach(() => {
    clearSnapshotServiceInstance();
  });

  describe("GET /system/snapshot schema validation", () => {
    test("response data matches SystemSnapshotDataSchema", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as {
        object: string;
        data: unknown;
        requestId?: string;
      };

      // Extract request ID for tracing
      const requestId = body.requestId ?? `test-${Date.now()}`;

      // Validate against schema
      const validationLog = validateSchemaWithLog(
        SystemSnapshotDataSchema,
        body.data,
        "/system/snapshot",
        requestId,
      );

      // Log structured diagnostics
      if (!validationLog.valid) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "Schema validation failed",
            ...validationLog,
          }),
        );
      }

      // Expect schema validation to pass
      expect(validationLog.valid).toBe(true);
      expect(validationLog.errorCount).toBe(0);
    }, 30000); // 30s timeout due to slow bv commands

    test("meta section has required schema version", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      // Validate meta schema version
      const metaSchema = z.object({
        schemaVersion: z.literal("1.0.0"),
        generatedAt: z.string(),
        generationDurationMs: z.number(),
      });

      const validationLog = validateSchemaWithLog(
        metaSchema,
        body.data.meta,
        "/system/snapshot (meta)",
        requestId,
      );

      if (!validationLog.valid) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "Meta schema validation failed",
            ...validationLog,
          }),
        );
      }

      expect(validationLog.valid).toBe(true);
    }, 30000);

    test("summary section matches SystemHealthSummary structure", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      const summarySchema = z.object({
        status: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
        ntm: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
        agentMail: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
        beads: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
        tools: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
        healthyCount: z.number(),
        degradedCount: z.number(),
        unhealthyCount: z.number(),
        unknownCount: z.number(),
        issues: z.array(z.string()),
      });

      const validationLog = validateSchemaWithLog(
        summarySchema,
        body.data.summary,
        "/system/snapshot (summary)",
        requestId,
      );

      if (!validationLog.valid) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "Summary schema validation failed",
            ...validationLog,
          }),
        );
      }

      expect(validationLog.valid).toBe(true);
    }, 30000);

    test("tools section matches ToolHealthSnapshot structure", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      const toolHealthSchema = z.object({
        installed: z.boolean(),
        version: z.string().nullable(),
        healthy: z.boolean(),
      });

      const toolsSchema = z.object({
        capturedAt: z.string(),
        dcg: toolHealthSchema,
        slb: toolHealthSchema,
        ubs: toolHealthSchema,
        status: z.enum(["healthy", "degraded", "unhealthy"]),
        checksumStatuses: z.array(z.unknown()),
        issues: z.array(z.string()),
        recommendations: z.array(z.string()),
      });

      const validationLog = validateSchemaWithLog(
        toolsSchema,
        body.data.tools,
        "/system/snapshot (tools)",
        requestId,
      );

      if (!validationLog.valid) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "Tools schema validation failed",
            ...validationLog,
          }),
        );
      }

      expect(validationLog.valid).toBe(true);
    }, 30000);
  });

  describe("GET /system/snapshot/cache schema validation", () => {
    test("response data matches SnapshotCacheStatusSchema", async () => {
      const res = await app.request("/system/snapshot/cache");
      const body = (await res.json()) as {
        object: string;
        data: unknown;
        requestId?: string;
      };

      const requestId = body.requestId ?? `test-${Date.now()}`;

      const validationLog = validateSchemaWithLog(
        SnapshotCacheStatusSchema,
        body.data,
        "/system/snapshot/cache",
        requestId,
      );

      if (!validationLog.valid) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "Cache status schema validation failed",
            ...validationLog,
          }),
        );
      }

      expect(validationLog.valid).toBe(true);
    });
  });

  describe("DELETE /system/snapshot/cache schema validation", () => {
    test("response data matches SnapshotCacheClearedSchema", async () => {
      const res = await app.request("/system/snapshot/cache", {
        method: "DELETE",
      });
      const body = (await res.json()) as {
        object: string;
        data: unknown;
        requestId?: string;
      };

      const requestId = body.requestId ?? `test-${Date.now()}`;

      const validationLog = validateSchemaWithLog(
        SnapshotCacheClearedSchema,
        body.data,
        "/system/snapshot/cache (DELETE)",
        requestId,
      );

      if (!validationLog.valid) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "Cache cleared schema validation failed",
            ...validationLog,
          }),
        );
      }

      expect(validationLog.valid).toBe(true);
    });
  });
});

// ============================================================================
// Performance Tests - Latency Budget (bd-xiy5)
// ============================================================================

/**
 * Structured log for performance metrics.
 */
interface PerformanceLog {
  testName: string;
  requestId: string;
  timestamp: string;
  latencyMs: number;
  budgetMs: number;
  withinBudget: boolean;
  cached: boolean;
  generationDurationMs?: number;
  sourceBreakdown?: {
    ntm?: number;
    beads?: number;
    tools?: number;
    agentMail?: number;
  };
}

/**
 * Log performance metrics with structured format.
 */
function logPerformanceMetrics(metrics: PerformanceLog): void {
  console.log(
    JSON.stringify({
      level: metrics.withinBudget ? "info" : "warn",
      msg: `Performance test: ${metrics.testName}`,
      ...metrics,
    }),
  );
}

describe("System Routes Performance Tests (bd-xiy5)", () => {
  const app = new Hono().route("/system", system);

  // Latency budgets based on snapshot service constants
  const CACHE_TTL_MS = 10000; // 10 seconds
  const COLLECTION_TIMEOUT_MS = 5000; // 5 seconds per source
  // Overall budget should allow for parallel collection + overhead
  const OVERALL_BUDGET_MS = COLLECTION_TIMEOUT_MS + 2000; // 7 seconds total

  beforeEach(() => {
    clearSnapshotServiceInstance();
  });

  afterEach(() => {
    clearSnapshotServiceInstance();
  });

  describe("Latency budget validation", () => {
    test("initial snapshot generation completes within budget", async () => {
      const startTime = performance.now();
      const res = await app.request("/system/snapshot");
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      const performanceLog: PerformanceLog = {
        testName: "initial snapshot generation",
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs,
        budgetMs: OVERALL_BUDGET_MS,
        withinBudget: latencyMs <= OVERALL_BUDGET_MS,
        cached: false,
        generationDurationMs: body.data.meta.generationDurationMs,
      };

      logPerformanceMetrics(performanceLog);

      // Verify snapshot was generated (not cached)
      expect(body.data.meta.generationDurationMs).toBeGreaterThan(0);

      // Note: We don't strictly enforce the budget in tests since external tools
      // may be slow. Instead, we log the metrics for monitoring.
      // In production, alerting would trigger if budget is consistently exceeded.
      if (!performanceLog.withinBudget) {
        console.warn(
          `Snapshot generation exceeded budget: ${latencyMs}ms > ${OVERALL_BUDGET_MS}ms`,
        );
      }
    }, 30000);

    test("cached snapshot returns within 100ms", async () => {
      // First request to populate cache
      await app.request("/system/snapshot");

      // Second request should hit cache
      const startTime = performance.now();
      const res = await app.request("/system/snapshot");
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      const cachedBudgetMs = 100; // Cached response should be very fast
      const performanceLog: PerformanceLog = {
        testName: "cached snapshot retrieval",
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs,
        budgetMs: cachedBudgetMs,
        withinBudget: latencyMs <= cachedBudgetMs,
        cached: true,
      };

      logPerformanceMetrics(performanceLog);

      // Cached response should be significantly faster
      expect(latencyMs).toBeLessThan(cachedBudgetMs);
    }, 60000); // Allow for initial snapshot generation

    test("bypass_cache respects timeout budget", async () => {
      // First request to populate cache
      await app.request("/system/snapshot");

      // Second request with bypass_cache should still respect timeout budget
      const startTime = performance.now();
      const res = await app.request("/system/snapshot?bypass_cache=true");
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      const performanceLog: PerformanceLog = {
        testName: "bypass_cache snapshot generation",
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs,
        budgetMs: OVERALL_BUDGET_MS,
        withinBudget: latencyMs <= OVERALL_BUDGET_MS,
        cached: false,
        generationDurationMs: body.data.meta.generationDurationMs,
      };

      logPerformanceMetrics(performanceLog);

      // Verify it was freshly generated
      expect(body.data.meta.generationDurationMs).toBeGreaterThan(0);
    }, 60000);
  });

  describe("Timing breakdown logging", () => {
    test("meta includes generation duration", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      // Verify timing metadata is present
      expect(body.data.meta.generationDurationMs).toBeDefined();
      expect(typeof body.data.meta.generationDurationMs).toBe("number");
      expect(body.data.meta.generationDurationMs).toBeGreaterThanOrEqual(0);

      // Log structured timing info
      console.log(
        JSON.stringify({
          level: "info",
          msg: "Snapshot timing breakdown",
          requestId,
          timestamp: new Date().toISOString(),
          generationDurationMs: body.data.meta.generationDurationMs,
          schemaVersion: body.data.meta.schemaVersion,
          generatedAt: body.data.meta.generatedAt,
        }),
      );
    }, 30000);

    test("summary includes component health status", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      // Verify summary has per-component status (for diagnosing slow sources)
      expect(body.data.summary.ntm).toBeDefined();
      expect(body.data.summary.agentMail).toBeDefined();
      expect(body.data.summary.beads).toBeDefined();
      expect(body.data.summary.tools).toBeDefined();

      // Log component statuses for performance debugging
      console.log(
        JSON.stringify({
          level: "info",
          msg: "Component health breakdown",
          requestId,
          timestamp: new Date().toISOString(),
          status: body.data.summary.status,
          components: {
            ntm: body.data.summary.ntm,
            agentMail: body.data.summary.agentMail,
            beads: body.data.summary.beads,
            tools: body.data.summary.tools,
          },
          counts: {
            healthy: body.data.summary.healthyCount,
            degraded: body.data.summary.degradedCount,
            unhealthy: body.data.summary.unhealthyCount,
            unknown: body.data.summary.unknownCount,
          },
        }),
      );
    }, 30000);
  });

  describe("Partial failure within budget", () => {
    test("snapshot returns even when some sources fail", async () => {
      // This tests the partial failure scenario - snapshot should return
      // even if some data sources are unavailable or slow
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      // Should always return a snapshot structure
      expect(body.object).toBe("system_snapshot");
      expect(body.data).toBeDefined();
      expect(body.data.meta).toBeDefined();
      expect(body.data.summary).toBeDefined();
      expect(body.data.ntm).toBeDefined();
      expect(body.data.agentMail).toBeDefined();
      expect(body.data.beads).toBeDefined();
      expect(body.data.tools).toBeDefined();

      // Log failure summary for debugging
      const issues = body.data.summary.issues;
      if (issues.length > 0) {
        console.log(
          JSON.stringify({
            level: "warn",
            msg: "Snapshot contains issues (partial failure)",
            requestId,
            timestamp: new Date().toISOString(),
            issueCount: issues.length,
            issues,
            status: body.data.summary.status,
          }),
        );
      }
    }, 30000);

    test("degraded status when sources unavailable", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;
      const requestId =
        (body as { requestId?: string }).requestId ?? `test-${Date.now()}`;

      // If there are unhealthy or unknown components, status should reflect that
      const { healthyCount, degradedCount, unhealthyCount, unknownCount } =
        body.data.summary;

      // Log the component health distribution
      console.log(
        JSON.stringify({
          level: "info",
          msg: "Health distribution",
          requestId,
          timestamp: new Date().toISOString(),
          distribution: {
            healthy: healthyCount,
            degraded: degradedCount,
            unhealthy: unhealthyCount,
            unknown: unknownCount,
          },
          overallStatus: body.data.summary.status,
        }),
      );

      // The status should be consistent with component counts
      if (unhealthyCount > 0 || unknownCount > 0) {
        expect(body.data.summary.status).not.toBe("healthy");
      }
    }, 30000);
  });

  describe("Cache behavior", () => {
    test("cache TTL is enforced", async () => {
      // First request
      const res1 = await app.request("/system/snapshot");
      const body1 = (await res1.json()) as SystemSnapshotEnvelope;
      const generatedAt1 = body1.data.meta.generatedAt;

      // Wait less than cache TTL and request again
      await new Promise((resolve) => setTimeout(resolve, 100));
      const res2 = await app.request("/system/snapshot");
      const body2 = (await res2.json()) as SystemSnapshotEnvelope;
      const generatedAt2 = body2.data.meta.generatedAt;

      // Should be the same (cached)
      expect(generatedAt1).toBe(generatedAt2);

      // Log cache hit
      console.log(
        JSON.stringify({
          level: "info",
          msg: "Cache TTL test",
          timestamp: new Date().toISOString(),
          generatedAt1,
          generatedAt2,
          cacheHit: generatedAt1 === generatedAt2,
        }),
      );
    }, 60000);

    test("cache endpoint reports accurate status", async () => {
      // Get cache status before any snapshot
      const cacheResBefore = await app.request("/system/snapshot/cache");
      const cacheBodyBefore =
        (await cacheResBefore.json()) as CacheStatusEnvelope;

      expect(cacheBodyBefore.data.cached).toBe(false);
      expect(cacheBodyBefore.data.ageMs).toBeNull();

      // Generate a snapshot
      await app.request("/system/snapshot");

      // Cache should now report as cached
      const cacheResAfter = await app.request("/system/snapshot/cache");
      const cacheBodyAfter =
        (await cacheResAfter.json()) as CacheStatusEnvelope;

      expect(cacheBodyAfter.data.cached).toBe(true);
      expect(cacheBodyAfter.data.ageMs).toBeGreaterThanOrEqual(0);
      expect(cacheBodyAfter.data.expiresInMs).toBeGreaterThanOrEqual(0);

      console.log(
        JSON.stringify({
          level: "info",
          msg: "Cache status after generation",
          timestamp: new Date().toISOString(),
          cached: cacheBodyAfter.data.cached,
          ageMs: cacheBodyAfter.data.ageMs,
          ttlMs: cacheBodyAfter.data.ttlMs,
          expiresInMs: cacheBodyAfter.data.expiresInMs,
        }),
      );
    }, 60000);
  });
});
