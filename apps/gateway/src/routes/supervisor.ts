/**
 * Supervisor Routes - REST API endpoints for daemon management.
 *
 * Provides endpoints for:
 * - Listing daemon status
 * - Starting/stopping/restarting daemons
 * - Viewing daemon logs
 */

import { type Context, Hono } from "hono";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  DaemonNotFoundError,
  getSupervisor,
} from "../services/supervisor.service";
import { daemonLinks, getLinkContext } from "../utils/links";
import {
  sendEmptyList,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
} from "../utils/response";

const supervisor = new Hono();
supervisor.use("*", requireAdminMiddleware());

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof DaemonNotFoundError) {
    return sendNotFound(c, "daemon", error.daemonName);
  }

  log.error({ error }, "Unexpected error in supervisor route");
  return sendInternalError(c);
}

// ============================================================================
// Status Routes
// ============================================================================

/**
 * GET /supervisor/status - Get status of all daemons
 */
supervisor.get("/status", async (c) => {
  try {
    const svc = getSupervisor();
    const statuses = svc.getStatus();

    if (statuses.length === 0) {
      return sendEmptyList(c);
    }

    const linkCtx = getLinkContext(c);
    return sendList(
      c,
      statuses.map((s) => ({
        ...s,
        startedAt: s.startedAt?.toISOString(),
        stoppedAt: s.stoppedAt?.toISOString(),
        lastHealthCheck: s.lastHealthCheck?.toISOString(),
        links: daemonLinks({ name: s.name }, linkCtx),
      })),
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /supervisor/:name/status - Get status of a specific daemon
 */
supervisor.get("/:name/status", async (c) => {
  try {
    const name = c.req.param("name");
    const svc = getSupervisor();
    const status = svc.getDaemonStatus(name);
    const linkCtx = getLinkContext(c);

    return sendResource(
      c,
      "daemon_status",
      {
        ...status,
        startedAt: status.startedAt?.toISOString(),
        stoppedAt: status.stoppedAt?.toISOString(),
        lastHealthCheck: status.lastHealthCheck?.toISOString(),
      },
      200,
      { links: daemonLinks({ name: status.name }, linkCtx) },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Control Routes
// ============================================================================

/**
 * POST /supervisor/:name/start - Start a daemon
 */
supervisor.post("/:name/start", async (c) => {
  try {
    const name = c.req.param("name");
    const svc = getSupervisor();
    const state = await svc.startDaemon(name);
    const linkCtx = getLinkContext(c);

    return sendResource(
      c,
      "daemon_status",
      {
        ...state,
        startedAt: state.startedAt?.toISOString(),
        stoppedAt: state.stoppedAt?.toISOString(),
        lastHealthCheck: state.lastHealthCheck?.toISOString(),
      },
      200,
      { links: daemonLinks({ name: state.name }, linkCtx) },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /supervisor/:name/stop - Stop a daemon
 */
supervisor.post("/:name/stop", async (c) => {
  try {
    const name = c.req.param("name");
    const svc = getSupervisor();
    const state = await svc.stopDaemon(name);
    const linkCtx = getLinkContext(c);

    return sendResource(
      c,
      "daemon_status",
      {
        ...state,
        startedAt: state.startedAt?.toISOString(),
        stoppedAt: state.stoppedAt?.toISOString(),
        lastHealthCheck: state.lastHealthCheck?.toISOString(),
      },
      200,
      { links: daemonLinks({ name: state.name }, linkCtx) },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /supervisor/:name/restart - Restart a daemon
 */
supervisor.post("/:name/restart", async (c) => {
  try {
    const name = c.req.param("name");
    const svc = getSupervisor();
    const state = await svc.restartDaemon(name);
    const linkCtx = getLinkContext(c);

    return sendResource(
      c,
      "daemon_status",
      {
        ...state,
        startedAt: state.startedAt?.toISOString(),
        stoppedAt: state.stoppedAt?.toISOString(),
        lastHealthCheck: state.lastHealthCheck?.toISOString(),
      },
      200,
      { links: daemonLinks({ name: state.name }, linkCtx) },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Logs Routes
// ============================================================================

/**
 * GET /supervisor/:name/logs - Get logs for a daemon
 */
supervisor.get("/:name/logs", async (c) => {
  try {
    const name = c.req.param("name");
    const limitStr = c.req.query("limit");
    let limit = 100;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 1000);
      }
    }

    const svc = getSupervisor();
    const logs = svc.getLogs(name, limit);
    const linkCtx = getLinkContext(c);

    return sendList(
      c,
      logs.map((entry) => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        links: daemonLinks({ name }, linkCtx),
      })),
    );
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * POST /supervisor/start-all - Start all daemons
 */
supervisor.post("/start-all", async (c) => {
  try {
    const svc = getSupervisor();
    await svc.startAll();
    const statuses = svc.getStatus();
    const linkCtx = getLinkContext(c);

    return sendResource(
      c,
      "supervisor_status",
      {
        message: "All daemons started",
        daemons: statuses.map((s) => ({
          ...s,
          startedAt: s.startedAt?.toISOString(),
          stoppedAt: s.stoppedAt?.toISOString(),
          lastHealthCheck: s.lastHealthCheck?.toISOString(),
          links: daemonLinks({ name: s.name }, linkCtx),
        })),
      },
      200,
      { links: { self: `${linkCtx.baseUrl}/supervisor/start-all` } },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /supervisor/stop-all - Stop all daemons
 */
supervisor.post("/stop-all", async (c) => {
  try {
    const svc = getSupervisor();
    await svc.stopAll();
    const statuses = svc.getStatus();
    const linkCtx = getLinkContext(c);

    return sendResource(
      c,
      "supervisor_status",
      {
        message: "All daemons stopped",
        daemons: statuses.map((s) => ({
          ...s,
          startedAt: s.startedAt?.toISOString(),
          stoppedAt: s.stoppedAt?.toISOString(),
          lastHealthCheck: s.lastHealthCheck?.toISOString(),
          links: daemonLinks({ name: s.name }, linkCtx),
        })),
      },
      200,
      { links: { self: `${linkCtx.baseUrl}/supervisor/stop-all` } },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /supervisor/daemons - List available daemon names
 */
supervisor.get("/daemons", async (c) => {
  try {
    const svc = getSupervisor();
    const names = svc.getDaemonNames();
    const linkCtx = getLinkContext(c);

    return sendList(
      c,
      names.map((name) => ({
        name,
        links: daemonLinks({ name }, linkCtx),
      })),
    );
  } catch (error) {
    return handleError(error, c);
  }
});

export { supervisor };
