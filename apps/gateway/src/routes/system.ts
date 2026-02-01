/**
 * System Routes - System-wide status and snapshot endpoints.
 *
 * Provides unified system state visibility:
 * - /system/snapshot - Aggregated system snapshot (NTM, beads, tools)
 * - /system/snapshot/cache - Cache management for snapshot service
 */

import { Hono } from "hono";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import { getSnapshotService } from "../services/snapshot.service";
import { sendResource } from "../utils/response";

const system = new Hono();
system.use("*", requireAdminMiddleware());

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /system/snapshot - Get unified system snapshot
 *
 * Returns aggregated state from all subsystems:
 * - NTM session and agent status
 * - Beads (br/bv) issue tracking state
 * - Tool health (DCG, SLB, UBS)
 * - Agent Mail coordination state (placeholder)
 *
 * Query Parameters:
 * - bypass_cache: Set to "true" to force fresh data collection
 *
 * Response includes health summary with per-component status.
 * Uses caching (10s default) to reduce load on underlying services.
 */
system.get("/snapshot", async (c) => {
  const log = getLogger();
  const bypassCacheParam = c.req.query("bypass_cache");
  const bypassCache = bypassCacheParam === "true";

  log.info({ bypassCache }, "Fetching system snapshot");

  const startTime = performance.now();
  const service = getSnapshotService();
  const snapshot = await service.getSnapshot({ bypassCache });
  const latencyMs = Math.round(performance.now() - startTime);

  log.info(
    {
      status: snapshot.summary.status,
      healthyCount: snapshot.summary.healthyCount,
      latencyMs,
      cached: !bypassCache && latencyMs < 5,
    },
    "System snapshot retrieved",
  );

  // Determine HTTP status based on health
  const httpStatus = snapshot.summary.status === "unhealthy" ? 503 : 200;

  return sendResource(c, "system_snapshot", snapshot, httpStatus);
});

/**
 * GET /system/snapshot/cache - Get snapshot cache status
 *
 * Returns cache statistics for the snapshot service.
 */
system.get("/snapshot/cache", (c) => {
  const service = getSnapshotService();
  const stats = service.getCacheStats();

  return sendResource(c, "snapshot_cache_status", {
    cached: stats.cached,
    ageMs: stats.age,
    ttlMs: stats.ttl,
    expiresInMs:
      stats.cached && stats.age !== null ? stats.ttl - stats.age : null,
  });
});

/**
 * DELETE /system/snapshot/cache - Clear snapshot cache
 *
 * Forces the next snapshot request to collect fresh data.
 */
system.delete("/snapshot/cache", (c) => {
  const log = getLogger();
  const service = getSnapshotService();

  service.clearCache();
  log.info("Snapshot cache cleared via API");

  return sendResource(c, "snapshot_cache_cleared", {
    message: "Snapshot cache cleared successfully",
    timestamp: new Date().toISOString(),
  });
});

export { system };
