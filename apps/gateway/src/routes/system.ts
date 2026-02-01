/**
 * System Routes - System-wide status and snapshot endpoints.
 *
 * Provides unified system state visibility:
 * - /system/snapshot - Aggregated system snapshot (NTM, beads, tools)
 * - /system/snapshot/cache - Cache management for snapshot service
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  enterMaintenance,
  exitMaintenance,
  getMaintenanceSnapshot,
  type MaintenanceActor,
  startDraining,
} from "../services/maintenance.service";
import { getSnapshotService } from "../services/snapshot.service";
import { sendResource, sendValidationError } from "../utils/response";
import type { AuthContext } from "../ws/hub";
import { getHub } from "../ws/hub";

const system = new Hono<{
  Variables: {
    auth?: AuthContext;
  };
}>();
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

// ============================================================================
// Maintenance Mode
// ============================================================================

const MaintenanceUpdateSchema = z.object({
  enabled: z.boolean(),
  deadlineSeconds: z
    .number()
    .int()
    .min(1)
    .max(60 * 60)
    .optional(),
  reason: z.string().max(500).optional(),
});

/**
 * GET /system/maintenance - Current maintenance/drain status.
 */
system.get("/maintenance", (c) => {
  const hub = getHub();
  const wsStats = hub.getStats();

  const snapshot = getMaintenanceSnapshot();

  return sendResource(c, "maintenance_status", {
    ...snapshot,
    ws: {
      activeConnections: wsStats.activeConnections,
    },
  });
});

/**
 * POST /system/maintenance - Enable/disable maintenance or drain mode.
 *
 * Semantics:
 * - enabled=false: return to normal operation
 * - enabled=true + deadlineSeconds: enter draining mode (deadline bound)
 * - enabled=true + no deadlineSeconds: enter maintenance mode
 */
system.post("/maintenance", async (c) => {
  const log = getLogger();
  const raw = await c.req.json().catch(() => undefined);
  const parsed = MaintenanceUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return sendValidationError(
      c,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  const input = parsed.data;

  const auth = c.get("auth");
  const actor: MaintenanceActor = { actor: auth?.userId ?? "admin" };
  if (auth?.userId !== undefined) actor.userId = auth.userId;
  if (auth?.apiKeyId !== undefined) actor.apiKeyId = auth.apiKeyId;

  if (!input.enabled) {
    exitMaintenance({ actor });
    log.info({ enabled: false, actor }, "Maintenance disabled via API");
  } else if (typeof input.deadlineSeconds === "number") {
    const drainingOptions: Parameters<typeof startDraining>[0] = {
      deadlineSeconds: input.deadlineSeconds,
      actor,
    };
    if (input.reason !== undefined) drainingOptions.reason = input.reason;
    startDraining(drainingOptions);
    log.info(
      {
        enabled: true,
        mode: "draining",
        deadlineSeconds: input.deadlineSeconds,
        actor,
      },
      "Drain mode enabled via API",
    );
  } else {
    const maintenanceOptions: Parameters<typeof enterMaintenance>[0] = {
      actor,
    };
    if (input.reason !== undefined) maintenanceOptions.reason = input.reason;
    enterMaintenance(maintenanceOptions);
    log.info(
      { enabled: true, mode: "maintenance", actor },
      "Maintenance enabled via API",
    );
  }

  const hub = getHub();
  const wsStats = hub.getStats();
  const snapshot = getMaintenanceSnapshot();

  return sendResource(c, "maintenance_status", {
    ...snapshot,
    ws: {
      activeConnections: wsStats.activeConnections,
    },
  });
});

export { system };
