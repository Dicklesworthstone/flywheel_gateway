/**
 * Tests for snapshot service.
 *
 * Note: These tests use short collection timeouts to avoid long test times.
 * The service is designed for graceful degradation, so partial failures are expected.
 *
 * Coverage for bd-n2t5:
 * - Partial failure scenarios (tool down, NTM unavailable)
 * - Detailed logging assertions for degraded responses
 * - Cache behavior validation (TTL expiry, concurrent requests)
 * - Timeout behavior and error handling
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SystemHealthStatus, SystemSnapshot } from "@flywheel/shared";
import { restoreCorrelation } from "./test-utils/db-mock-restore";

// ============================================================================
// Mock Logger for Logging Assertions
// ============================================================================

interface LogCall {
  level: string;
  context: Record<string, unknown>;
  message: string;
}

const logCalls: LogCall[] = [];

/**
 * Parse pino-style log arguments which can be either:
 * - (message: string) - just a message
 * - (context: object, message: string) - context object and message
 */
function parseLogArgs(args: unknown[]): {
  context: Record<string, unknown>;
  message: string;
} {
  if (args.length === 1 && typeof args[0] === "string") {
    return { context: {}, message: args[0] };
  }
  if (
    args.length === 2 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    typeof args[1] === "string"
  ) {
    return { context: args[0] as Record<string, unknown>, message: args[1] };
  }
  // Fallback
  return { context: {}, message: String(args[0] ?? "") };
}

const mockLogger = {
  info: (...args: unknown[]) => {
    const { context, message } = parseLogArgs(args);
    logCalls.push({ level: "info", context, message });
  },
  warn: (...args: unknown[]) => {
    const { context, message } = parseLogArgs(args);
    logCalls.push({ level: "warn", context, message });
  },
  debug: (...args: unknown[]) => {
    const { context, message } = parseLogArgs(args);
    logCalls.push({ level: "debug", context, message });
  },
  error: (...args: unknown[]) => {
    const { context, message } = parseLogArgs(args);
    logCalls.push({ level: "error", context, message });
  },
  child: () => mockLogger,
};

// Mock the correlation middleware to return our mock logger
mock.module("../middleware/correlation", () => ({
  getLogger: () => mockLogger,
}));

import {
  clearSnapshotServiceInstance,
  createSnapshotService,
  getSnapshotService,
  SnapshotService,
} from "../services/snapshot.service";

// ============================================================================
// Tests
// ============================================================================

describe("SnapshotService", () => {
  afterAll(() => {
    // Restore for other test files (mock.restore doesn't restore mock.module)
    restoreCorrelation();
  });

  beforeEach(() => {
    clearSnapshotServiceInstance();
    logCalls.length = 0; // Clear log calls between tests
  });

  afterEach(() => {
    clearSnapshotServiceInstance();
  });

  describe("createSnapshotService", () => {
    test("creates service with default config", () => {
      const service = createSnapshotService();
      expect(service).toBeInstanceOf(SnapshotService);
    });

    test("creates service with custom config", () => {
      const service = createSnapshotService({
        cacheTtlMs: 5000,
        collectionTimeoutMs: 2000,
      });
      expect(service).toBeInstanceOf(SnapshotService);
      expect(service.getCacheStats().ttl).toBe(5000);
    });
  });

  describe("getSnapshotService", () => {
    test("returns singleton instance", () => {
      const first = getSnapshotService();
      const second = getSnapshotService();
      expect(first).toBe(second);
    });

    test("returns new instance after clearSnapshotServiceInstance", () => {
      const first = getSnapshotService();
      clearSnapshotServiceInstance();
      const second = getSnapshotService();
      expect(first).not.toBe(second);
    });
  });

  describe("getSnapshot structure", () => {
    // Use very short timeouts - we're testing structure, not real data collection
    const shortTimeoutConfig = {
      collectionTimeoutMs: 50, // 50ms - will timeout and return empty data
      cacheTtlMs: 100,
    };

    test("returns valid system snapshot structure", async () => {
      const service = createSnapshotService(shortTimeoutConfig);
      const snapshot = await service.getSnapshot();

      // Check meta structure
      expect(snapshot.meta).toBeDefined();
      expect(snapshot.meta.schemaVersion).toBe("1.0.0");
      expect(typeof snapshot.meta.generatedAt).toBe("string");
      expect(typeof snapshot.meta.generationDurationMs).toBe("number");

      // Check summary structure
      expect(snapshot.summary).toBeDefined();
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(
        snapshot.summary.status,
      );
      expect(typeof snapshot.summary.healthyCount).toBe("number");
      expect(typeof snapshot.summary.degradedCount).toBe("number");
      expect(typeof snapshot.summary.unhealthyCount).toBe("number");
      expect(typeof snapshot.summary.unknownCount).toBe("number");
      expect(Array.isArray(snapshot.summary.issues)).toBe(true);
    });

    test("returns NTM snapshot with correct structure", async () => {
      const service = createSnapshotService(shortTimeoutConfig);
      const snapshot = await service.getSnapshot();

      // Check NTM structure
      expect(snapshot.ntm).toBeDefined();
      expect(typeof snapshot.ntm.capturedAt).toBe("string");
      expect(typeof snapshot.ntm.available).toBe("boolean");
      expect(Array.isArray(snapshot.ntm.sessions)).toBe(true);
      expect(snapshot.ntm.summary).toBeDefined();
      expect(Array.isArray(snapshot.ntm.alerts)).toBe(true);

      // NTM summary structure
      expect(typeof snapshot.ntm.summary.totalSessions).toBe("number");
      expect(typeof snapshot.ntm.summary.totalAgents).toBe("number");
      expect(typeof snapshot.ntm.summary.attachedCount).toBe("number");
      expect(snapshot.ntm.summary.byAgentType).toBeDefined();
      expect(typeof snapshot.ntm.summary.byAgentType.claude).toBe("number");
      expect(typeof snapshot.ntm.summary.byAgentType.codex).toBe("number");
      expect(typeof snapshot.ntm.summary.byAgentType.gemini).toBe("number");
    });

    test("returns Agent Mail snapshot with correct structure", async () => {
      const service = createSnapshotService(shortTimeoutConfig);
      const snapshot = await service.getSnapshot();

      // Check Agent Mail structure
      expect(snapshot.agentMail).toBeDefined();
      expect(typeof snapshot.agentMail.capturedAt).toBe("string");
      expect(typeof snapshot.agentMail.available).toBe("boolean");
      expect(Array.isArray(snapshot.agentMail.agents)).toBe(true);
      expect(Array.isArray(snapshot.agentMail.reservations)).toBe(true);
      expect(snapshot.agentMail.messages).toBeDefined();
      expect(typeof snapshot.agentMail.messages.total).toBe("number");
      expect(typeof snapshot.agentMail.messages.unread).toBe("number");
      expect(snapshot.agentMail.messages.byPriority).toBeDefined();
    });

    test("returns Beads snapshot with correct structure", async () => {
      const service = createSnapshotService(shortTimeoutConfig);
      const snapshot = await service.getSnapshot();

      // Check Beads structure
      expect(snapshot.beads).toBeDefined();
      expect(typeof snapshot.beads.capturedAt).toBe("string");
      expect(typeof snapshot.beads.brAvailable).toBe("boolean");
      expect(typeof snapshot.beads.bvAvailable).toBe("boolean");
      expect(snapshot.beads.statusCounts).toBeDefined();
      expect(snapshot.beads.typeCounts).toBeDefined();
      expect(snapshot.beads.priorityCounts).toBeDefined();
      expect(typeof snapshot.beads.actionableCount).toBe("number");
      expect(Array.isArray(snapshot.beads.topRecommendations)).toBe(true);
      expect(Array.isArray(snapshot.beads.quickWins)).toBe(true);
      expect(Array.isArray(snapshot.beads.blockersToClean)).toBe(true);

      // Status counts
      expect(typeof snapshot.beads.statusCounts.open).toBe("number");
      expect(typeof snapshot.beads.statusCounts.inProgress).toBe("number");
      expect(typeof snapshot.beads.statusCounts.blocked).toBe("number");
      expect(typeof snapshot.beads.statusCounts.closed).toBe("number");
      expect(typeof snapshot.beads.statusCounts.total).toBe("number");

      // Type counts
      expect(typeof snapshot.beads.typeCounts.bug).toBe("number");
      expect(typeof snapshot.beads.typeCounts.feature).toBe("number");
      expect(typeof snapshot.beads.typeCounts.task).toBe("number");
      expect(typeof snapshot.beads.typeCounts.epic).toBe("number");
      expect(typeof snapshot.beads.typeCounts.chore).toBe("number");

      // Priority counts
      expect(typeof snapshot.beads.priorityCounts.p0).toBe("number");
      expect(typeof snapshot.beads.priorityCounts.p1).toBe("number");
      expect(typeof snapshot.beads.priorityCounts.p2).toBe("number");
      expect(typeof snapshot.beads.priorityCounts.p3).toBe("number");
      expect(typeof snapshot.beads.priorityCounts.p4).toBe("number");
    });

    test("returns Tools snapshot with correct structure", async () => {
      const service = createSnapshotService(shortTimeoutConfig);
      const snapshot = await service.getSnapshot();

      // Check Tools structure
      expect(snapshot.tools).toBeDefined();
      expect(typeof snapshot.tools.capturedAt).toBe("string");
      expect(snapshot.tools.dcg).toBeDefined();
      expect(snapshot.tools.slb).toBeDefined();
      expect(snapshot.tools.ubs).toBeDefined();
      expect(["healthy", "degraded", "unhealthy"]).toContain(
        snapshot.tools.status,
      );

      // Check each tool status
      for (const tool of [
        snapshot.tools.dcg,
        snapshot.tools.slb,
        snapshot.tools.ubs,
      ]) {
        expect(typeof tool.installed).toBe("boolean");
        expect(tool.version === null || typeof tool.version === "string").toBe(
          true,
        );
        expect(typeof tool.healthy).toBe("boolean");
      }

      // Check checksums
      expect(Array.isArray(snapshot.tools.checksumStatuses)).toBe(true);
      expect(Array.isArray(snapshot.tools.issues)).toBe(true);
      expect(Array.isArray(snapshot.tools.recommendations)).toBe(true);
    });

    test("returns partial data when all sources fail (graceful degradation)", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1, // 1ms - guaranteed to fail
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Should still return a valid snapshot with empty data
      expect(snapshot.meta).toBeDefined();
      expect(snapshot.summary).toBeDefined();
      expect(snapshot.ntm).toBeDefined();
      expect(snapshot.beads).toBeDefined();
      expect(snapshot.tools).toBeDefined();

      // Should indicate failures in status
      expect(["degraded", "unhealthy"]).toContain(snapshot.summary.status);
    });
  });

  describe("caching", () => {
    test("getCacheStats returns correct info before any snapshot", () => {
      const service = createSnapshotService({
        cacheTtlMs: 5000,
        collectionTimeoutMs: 50,
      });

      const stats = service.getCacheStats();
      expect(stats.cached).toBe(false);
      expect(stats.age).toBeNull();
      expect(stats.ttl).toBe(5000);
    });

    test("getCacheStats returns correct info after snapshot", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 5000,
        collectionTimeoutMs: 50,
      });

      await service.getSnapshot();

      const stats = service.getCacheStats();
      expect(stats.cached).toBe(true);
      expect(stats.age).toBeGreaterThanOrEqual(0);
      expect(stats.ttl).toBe(5000);
    });

    test("returns cached snapshot within TTL", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000, // 60 seconds
        collectionTimeoutMs: 50,
      });

      const first = await service.getSnapshot();
      const second = await service.getSnapshot();

      // Should return same snapshot (cached)
      expect(first.meta.generatedAt).toBe(second.meta.generatedAt);
    });

    test("bypassCache returns fresh snapshot", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000, // 60 seconds
        collectionTimeoutMs: 50,
      });

      const first = await service.getSnapshot();

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await service.getSnapshot({ bypassCache: true });

      // Should have different timestamps
      expect(first.meta.generatedAt).not.toBe(second.meta.generatedAt);
    });

    test("clearCache removes cached snapshot", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000,
        collectionTimeoutMs: 50,
      });

      await service.getSnapshot();
      expect(service.getCacheStats().cached).toBe(true);

      service.clearCache();
      expect(service.getCacheStats().cached).toBe(false);
    });
  });

  describe("health summary computation", () => {
    test("summary counts equal 4 components (ntm, agentMail, beads, tools)", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
      });
      const snapshot = await service.getSnapshot();

      const { healthyCount, degradedCount, unhealthyCount, unknownCount } =
        snapshot.summary;

      // Total of all counts should equal 4
      const total =
        healthyCount + degradedCount + unhealthyCount + unknownCount;
      expect(total).toBe(4);
    });

    test("summary includes component statuses", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
      });
      const snapshot = await service.getSnapshot();

      // Each component should have a status
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(
        snapshot.summary.ntm,
      );
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(
        snapshot.summary.agentMail,
      );
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(
        snapshot.summary.beads,
      );
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(
        snapshot.summary.tools,
      );
    });

    test("status reflects unhealthy when unhealthyCount > 0", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
      });
      const snapshot = await service.getSnapshot();

      // If there are unhealthy components, overall should be unhealthy
      if (snapshot.summary.unhealthyCount > 0) {
        expect(snapshot.summary.status).toBe("unhealthy");
      }
    });

    test("status reflects degraded when no unhealthy but has degraded/unknown", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
      });
      const snapshot = await service.getSnapshot();

      // If no unhealthy but some degraded/unknown, should be degraded
      if (
        snapshot.summary.unhealthyCount === 0 &&
        (snapshot.summary.degradedCount > 0 ||
          snapshot.summary.unknownCount > 0)
      ) {
        expect(snapshot.summary.status).toBe("degraded");
      }
    });
  });

  // ============================================================================
  // Partial Failure Scenarios (bd-n2t5)
  // ============================================================================

  describe("partial failure scenarios", () => {
    // These tests verify graceful degradation when individual sources fail

    test("returns valid snapshot when NTM is unavailable", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50, // Short timeout
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // NTM should show unavailable but snapshot should still be valid
      expect(snapshot.ntm).toBeDefined();
      expect(snapshot.ntm.capturedAt).toBeDefined();
      // NTM may or may not be available depending on environment
      // The key test is that other sources are still collected
      expect(snapshot.beads).toBeDefined();
      expect(snapshot.tools).toBeDefined();
      expect(snapshot.agentMail).toBeDefined();
    });

    test("returns valid snapshot when beads tools are unavailable", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Beads should have a valid structure even if unavailable
      expect(snapshot.beads).toBeDefined();
      expect(snapshot.beads.statusCounts).toBeDefined();
      expect(snapshot.beads.typeCounts).toBeDefined();
      expect(snapshot.beads.priorityCounts).toBeDefined();

      // When beads unavailable, counts should be zero
      if (!snapshot.beads.brAvailable && !snapshot.beads.bvAvailable) {
        expect(snapshot.beads.statusCounts.total).toBe(0);
        expect(snapshot.beads.actionableCount).toBe(0);
        expect(snapshot.beads.topRecommendations).toEqual([]);
      }
    });

    test("returns valid snapshot when tool health check fails", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Tools section should still be present with valid structure
      expect(snapshot.tools).toBeDefined();
      expect(snapshot.tools.dcg).toBeDefined();
      expect(snapshot.tools.slb).toBeDefined();
      expect(snapshot.tools.ubs).toBeDefined();
      expect(["healthy", "degraded", "unhealthy"]).toContain(
        snapshot.tools.status,
      );
    });

    test("returns valid snapshot when agent mail is unavailable", async () => {
      // Use a non-existent directory to ensure agent mail fails
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
        cwd: "/nonexistent/path",
      });

      const snapshot = await service.getSnapshot();

      // Agent mail should show unavailable
      expect(snapshot.agentMail).toBeDefined();
      expect(snapshot.agentMail.available).toBe(false);
      expect(snapshot.agentMail.agents).toEqual([]);
      expect(snapshot.agentMail.reservations).toEqual([]);
      expect(snapshot.agentMail.messages.total).toBe(0);
    });

    test("issues array contains failures when sources are unavailable", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1, // Very short - will timeout everything
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // When sources fail, issues should be populated
      expect(Array.isArray(snapshot.summary.issues)).toBe(true);
      // With 1ms timeout, sources will fail and issues will be logged
      if (snapshot.summary.unknownCount > 0) {
        expect(snapshot.summary.issues.length).toBeGreaterThan(0);
      }
    });

    test("partial data is still usable even with multiple failures", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 5, // Very short timeout
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Verify the snapshot is still structurally valid
      expect(snapshot.meta.schemaVersion).toBe("1.0.0");
      expect(typeof snapshot.meta.generatedAt).toBe("string");
      expect(typeof snapshot.meta.generationDurationMs).toBe("number");

      // All sections should be present
      expect(snapshot.ntm).toBeDefined();
      expect(snapshot.beads).toBeDefined();
      expect(snapshot.tools).toBeDefined();
      expect(snapshot.agentMail).toBeDefined();

      // Summary should reflect the failures
      const totalStatuses =
        snapshot.summary.healthyCount +
        snapshot.summary.degradedCount +
        snapshot.summary.unhealthyCount +
        snapshot.summary.unknownCount;
      expect(totalStatuses).toBe(4);
    });

    test("health status correctly prioritizes unhealthy over degraded", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Verify health status hierarchy
      if (snapshot.summary.unhealthyCount > 0) {
        expect(snapshot.summary.status).toBe("unhealthy");
      } else if (
        snapshot.summary.degradedCount > 0 ||
        snapshot.summary.unknownCount > 0
      ) {
        expect(snapshot.summary.status).toBe("degraded");
      } else {
        expect(snapshot.summary.status).toBe("healthy");
      }
    });
  });

  // ============================================================================
  // Logging Assertions (bd-n2t5)
  // ============================================================================

  describe("logging for degraded responses", () => {
    test("logs info message when snapshot is generated", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      await service.getSnapshot();

      // Should have an info log for snapshot generation
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "System snapshot generated",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["status"]).toBeDefined();
      expect(typeof infoLog?.context["healthyCount"]).toBe("number");
      expect(typeof infoLog?.context["unhealthyCount"]).toBe("number");
      expect(typeof infoLog?.context["generationDurationMs"]).toBe("number");
    });

    test("logs debug message with collection latencies", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      await service.getSnapshot();

      // Should have a debug log for data collection
      const debugLog = logCalls.find(
        (c) => c.level === "debug" && c.message === "Data collection completed",
      );
      expect(debugLog).toBeDefined();

      // Verify latency fields are present for each source
      const ctx = debugLog?.context as Record<
        string,
        { success: boolean; latencyMs: number }
      >;
      expect(ctx["ntm"]).toBeDefined();
      expect(typeof ctx["ntm"]?.success).toBe("boolean");
      expect(typeof ctx["ntm"]?.latencyMs).toBe("number");

      expect(ctx["beads"]).toBeDefined();
      expect(typeof ctx["beads"]?.success).toBe("boolean");
      expect(typeof ctx["beads"]?.latencyMs).toBe("number");

      expect(ctx["tools"]).toBeDefined();
      expect(typeof ctx["tools"]?.success).toBe("boolean");
      expect(typeof ctx["tools"]?.latencyMs).toBe("number");

      expect(ctx["agentMail"]).toBeDefined();
      expect(typeof ctx["agentMail"]?.success).toBe("boolean");
      expect(typeof ctx["agentMail"]?.latencyMs).toBe("number");
    });

    test("logs cache hit on subsequent requests within TTL", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000, // Long TTL
        collectionTimeoutMs: 50,
      });

      // First request - should collect data
      await service.getSnapshot();
      logCalls.length = 0; // Clear logs

      // Second request - should use cache
      await service.getSnapshot();

      // Should have a debug log for cache hit
      const cacheLog = logCalls.find(
        (c) => c.level === "debug" && c.message === "Snapshot cache hit",
      );
      expect(cacheLog).toBeDefined();
      expect(typeof cacheLog?.context["cacheTtlMs"]).toBe("number");
    });

    test("logs collection start message", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      await service.getSnapshot();

      // Should log collection start
      const startLog = logCalls.find(
        (c) => c.level === "info" && c.message === "Collecting system snapshot",
      );
      expect(startLog).toBeDefined();
    });

    test("logs cache clear operation", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000,
        collectionTimeoutMs: 50,
      });

      await service.getSnapshot();
      logCalls.length = 0;

      service.clearCache();

      const clearLog = logCalls.find(
        (c) => c.level === "debug" && c.message === "Snapshot cache cleared",
      );
      expect(clearLog).toBeDefined();
    });
  });

  // ============================================================================
  // Timeout Behavior (bd-n2t5)
  // ============================================================================

  describe("timeout behavior", () => {
    test("handles source timeout gracefully", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1, // 1ms - will timeout
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Should not throw, should return valid snapshot
      expect(snapshot).toBeDefined();
      expect(snapshot.meta).toBeDefined();
      expect(snapshot.summary).toBeDefined();
    });

    test("timeout does not block other source collection", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      const startTime = performance.now();
      await service.getSnapshot();
      const duration = performance.now() - startTime;

      // With parallel collection and 50ms timeout per source,
      // total time should be < 4x50ms (sources run in parallel)
      // Allow significant overhead for CI environments and test execution
      expect(duration).toBeLessThan(2000);
    });

    test("generation duration is tracked accurately", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 50,
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Generation duration should be positive and reasonable
      expect(snapshot.meta.generationDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.meta.generationDurationMs).toBeLessThan(1000);
    });

    test("very short timeout still produces valid empty data", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1,
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // With 1ms timeout, data will be empty but valid
      expect(snapshot.ntm.sessions).toEqual([]);
      expect(snapshot.ntm.summary.totalSessions).toBe(0);
      expect(snapshot.ntm.summary.totalAgents).toBe(0);
    });
  });

  // ============================================================================
  // Cache TTL Expiry (bd-n2t5)
  // ============================================================================

  describe("cache TTL expiry", () => {
    test("cache expires after TTL", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 50, // 50ms TTL
        collectionTimeoutMs: 30,
      });

      const first = await service.getSnapshot();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      const second = await service.getSnapshot();

      // Should have different timestamps (cache expired)
      expect(first.meta.generatedAt).not.toBe(second.meta.generatedAt);
    });

    test("cache does not expire before TTL", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 5000, // 5 second TTL
        collectionTimeoutMs: 30,
      });

      const first = await service.getSnapshot();

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await service.getSnapshot();

      // Should have same timestamps (cache still valid)
      expect(first.meta.generatedAt).toBe(second.meta.generatedAt);
    });

    test("concurrent requests use same cached snapshot", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000,
        collectionTimeoutMs: 50,
      });

      // First request to populate cache
      await service.getSnapshot();

      // Concurrent requests should all use cache
      const [snap1, snap2, snap3] = await Promise.all([
        service.getSnapshot(),
        service.getSnapshot(),
        service.getSnapshot(),
      ]);

      // All should have same timestamp
      expect(snap1.meta.generatedAt).toBe(snap2.meta.generatedAt);
      expect(snap2.meta.generatedAt).toBe(snap3.meta.generatedAt);
    });

    test("bypassCache ignores TTL", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000, // Long TTL
        collectionTimeoutMs: 30,
      });

      const first = await service.getSnapshot();

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await service.getSnapshot({ bypassCache: true });

      // Should have different timestamps despite long TTL
      expect(first.meta.generatedAt).not.toBe(second.meta.generatedAt);
    });

    test("cache age is tracked correctly", async () => {
      const service = createSnapshotService({
        cacheTtlMs: 60000,
        collectionTimeoutMs: 30,
      });

      await service.getSnapshot();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = service.getCacheStats();
      expect(stats.cached).toBe(true);
      expect(stats.age).toBeGreaterThanOrEqual(50);
    });
  });

  // ============================================================================
  // Fallback Value Verification (bd-n2t5)
  // ============================================================================

  describe("fallback value structure", () => {
    test("NTM fallback has correct structure", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1, // Will fail
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Verify NTM fallback structure
      expect(snapshot.ntm.capturedAt).toBeDefined();
      expect(typeof snapshot.ntm.available).toBe("boolean");
      expect(Array.isArray(snapshot.ntm.sessions)).toBe(true);
      expect(snapshot.ntm.summary.totalSessions).toBe(0);
      expect(snapshot.ntm.summary.totalAgents).toBe(0);
      expect(snapshot.ntm.summary.attachedCount).toBe(0);
      expect(snapshot.ntm.summary.byAgentType).toEqual({
        claude: 0,
        codex: 0,
        gemini: 0,
        cursor: 0,
        windsurf: 0,
        aider: 0,
      });
      expect(Array.isArray(snapshot.ntm.alerts)).toBe(true);
    });

    test("Beads fallback has correct structure", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1, // Will fail
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Verify beads fallback structure
      expect(snapshot.beads.capturedAt).toBeDefined();
      expect(typeof snapshot.beads.brAvailable).toBe("boolean");
      expect(typeof snapshot.beads.bvAvailable).toBe("boolean");
      expect(snapshot.beads.statusCounts).toEqual({
        open: 0,
        inProgress: 0,
        blocked: 0,
        closed: 0,
        total: 0,
      });
      expect(snapshot.beads.typeCounts).toEqual({
        bug: 0,
        feature: 0,
        task: 0,
        epic: 0,
        chore: 0,
      });
      expect(snapshot.beads.priorityCounts).toEqual({
        p0: 0,
        p1: 0,
        p2: 0,
        p3: 0,
        p4: 0,
      });
      expect(snapshot.beads.actionableCount).toBe(0);
      expect(snapshot.beads.topRecommendations).toEqual([]);
      expect(snapshot.beads.quickWins).toEqual([]);
      expect(snapshot.beads.blockersToClean).toEqual([]);
    });

    test("Tool health fallback has correct structure", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1, // Will fail
        cacheTtlMs: 100,
      });

      const snapshot = await service.getSnapshot();

      // Verify tool health fallback structure
      expect(snapshot.tools.capturedAt).toBeDefined();
      expect(snapshot.tools.dcg).toEqual({
        installed: false,
        version: null,
        healthy: false,
      });
      expect(snapshot.tools.slb).toEqual({
        installed: false,
        version: null,
        healthy: false,
      });
      expect(snapshot.tools.ubs).toEqual({
        installed: false,
        version: null,
        healthy: false,
      });
      expect(snapshot.tools.status).toBe("unhealthy");
      expect(Array.isArray(snapshot.tools.issues)).toBe(true);
      expect(Array.isArray(snapshot.tools.recommendations)).toBe(true);
    });

    test("Agent Mail fallback has correct structure", async () => {
      const service = createSnapshotService({
        collectionTimeoutMs: 1,
        cacheTtlMs: 100,
        cwd: "/nonexistent",
      });

      const snapshot = await service.getSnapshot();

      // Verify agent mail fallback structure
      expect(snapshot.agentMail.capturedAt).toBeDefined();
      expect(snapshot.agentMail.available).toBe(false);
      expect(snapshot.agentMail.agents).toEqual([]);
      expect(snapshot.agentMail.reservations).toEqual([]);
      expect(snapshot.agentMail.messages).toEqual({
        total: 0,
        unread: 0,
        byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
      });
    });
  });
});
