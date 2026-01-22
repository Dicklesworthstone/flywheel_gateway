/**
 * Tests for system routes.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
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
    });

    test("returns cached response on subsequent requests", async () => {
      // First request
      const res1 = await app.request("/system/snapshot");
      const body1 = (await res1.json()) as SystemSnapshotEnvelope;

      // Second request (should be cached)
      const res2 = await app.request("/system/snapshot");
      const body2 = (await res2.json()) as SystemSnapshotEnvelope;

      // Should have same generatedAt (cached)
      expect(body1.data.meta.generatedAt).toBe(body2.data.meta.generatedAt);
    });

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
    });

    test("returns 503 when overall status is unhealthy", async () => {
      const res = await app.request("/system/snapshot");
      const body = (await res.json()) as SystemSnapshotEnvelope;

      if (body.data.summary.status === "unhealthy") {
        expect(res.status).toBe(503);
      } else {
        expect(res.status).toBe(200);
      }
    });
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
    });

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
    });
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
    });
  });
});
