/**
 * RCH (Remote Compilation Helper) Routes - REST API for compilation offloading.
 *
 * Provides endpoints for:
 * - System status and health checks
 * - Worker management
 * - Agent listing
 * - Diagnostics
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import { getRchService } from "../services/rch.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const rch = new Hono();
rch.use("*", requireAdminMiddleware());

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return sendError(c, "INVALID_REQUEST", "Invalid JSON in request body", 400);
  }

  log.error({ error }, "Unexpected error in rch route");
  return sendInternalError(c);
}

// ============================================================================
// Status and Health Routes
// ============================================================================

/**
 * GET /rch/status - Get rch system status
 */
rch.get("/status", async (c) => {
  try {
    const service = getRchService();
    const status = await service.getStatus();
    return sendResource(c, "rch_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /rch/doctor - Run doctor check
 */
rch.get("/doctor", async (c) => {
  try {
    const service = getRchService();
    const doctor = await service.getDoctor();
    return sendResource(c, "rch_doctor", doctor);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /rch/health - Combined health status
 */
rch.get("/health", async (c) => {
  try {
    const service = getRchService();
    const health = await service.getHealth();
    return sendResource(c, "rch_health", health);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Worker Routes
// ============================================================================

/**
 * GET /rch/workers - List configured workers
 */
rch.get("/workers", async (c) => {
  try {
    const service = getRchService();
    const workers = await service.listWorkers();

    const onlineCount = workers.filter((w) => w.status === "online").length;
    const busyCount = workers.filter((w) => w.status === "busy").length;

    return sendResource(c, "rch_workers", {
      workers,
      summary: {
        total: workers.length,
        online: onlineCount,
        busy: busyCount,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Agent Routes
// ============================================================================

/**
 * GET /rch/agents - List detected agents
 */
rch.get("/agents", async (c) => {
  try {
    const service = getRchService();
    const agents = await service.listAgents();

    return sendList(c, agents, {
      total: agents.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { rch };
