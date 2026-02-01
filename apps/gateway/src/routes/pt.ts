/**
 * Process Triage (pt) Routes - REST API for process management.
 *
 * Provides endpoints for:
 * - Scanning for suspicious/stuck processes
 * - Process inspection and termination
 * - Agent process cleanup for fleet management
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import { getPtService } from "../services/pt.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const pt = new Hono();
pt.use("*", requireAdminMiddleware());

// ============================================================================
// Validation Schemas
// ============================================================================

const ScanRequestSchema = z.object({
  minScore: z.number().int().min(0).max(100).optional(),
  minRuntimeSeconds: z.number().int().min(0).optional(),
  minMemoryMb: z.number().min(0).optional(),
  minCpuPercent: z.number().min(0).max(100).optional(),
  namePattern: z.string().max(200).optional(),
  excludePattern: z.string().max(200).optional(),
  users: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const KillRequestSchema = z.object({
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
  force: z.boolean().optional(),
  wait: z.boolean().optional(),
  waitTimeout: z.number().int().min(100).max(30000).optional(),
});

const BulkKillRequestSchema = z.object({
  pids: z.array(z.number().int().positive()).min(1).max(50),
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
  force: z.boolean().optional(),
});

const CleanupRequestSchema = z.object({
  minRuntimeSeconds: z.number().int().min(0).optional(),
  dryRun: z.boolean().optional(),
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
});

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

  log.error({ error }, "Unexpected error in pt route");
  return sendInternalError(c);
}

// ============================================================================
// Status and Health Routes
// ============================================================================

/**
 * GET /pt/status - Get pt system status
 */
pt.get("/status", async (c) => {
  try {
    const service = getPtService();
    const status = await service.getStatus();
    return sendResource(c, "pt_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /pt/doctor - Run doctor check
 */
pt.get("/doctor", async (c) => {
  try {
    const service = getPtService();
    const doctor = await service.getDoctor();
    return sendResource(c, "pt_doctor", doctor);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /pt/health - Quick health check
 */
pt.get("/health", async (c) => {
  try {
    const service = getPtService();
    const available = await service.isAvailable();
    const version = available ? await service.getVersion() : null;

    const health: { available: boolean; version?: string } = { available };
    if (version) health.version = version;

    return sendResource(c, "pt_health", health);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Process Scanning Routes
// ============================================================================

/**
 * POST /pt/scan - Scan for suspicious processes
 */
pt.post("/scan", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = ScanRequestSchema.parse(body);
    const log = getLogger();

    log.info({ options: validated }, "Running pt scan");

    const service = getPtService();

    // Build options conditionally
    const options: Parameters<typeof service.scanProcesses>[0] = {};
    if (validated.minScore !== undefined) options.minScore = validated.minScore;
    if (validated.minRuntimeSeconds !== undefined)
      options.minRuntimeSeconds = validated.minRuntimeSeconds;
    if (validated.minMemoryMb !== undefined)
      options.minMemoryMb = validated.minMemoryMb;
    if (validated.minCpuPercent !== undefined)
      options.minCpuPercent = validated.minCpuPercent;
    if (validated.namePattern !== undefined)
      options.namePattern = validated.namePattern;
    if (validated.excludePattern !== undefined)
      options.excludePattern = validated.excludePattern;
    if (validated.users !== undefined) options.users = validated.users;
    if (validated.limit !== undefined) options.limit = validated.limit;

    const result = await service.scanProcesses(options);

    return sendResource(c, "pt_scan_result", {
      processes: result.processes.map((p) => ({
        pid: p.pid,
        ppid: p.ppid,
        name: p.name,
        cmdline: p.cmdline,
        user: p.user,
        state: p.state,
        cpu_percent: p.cpu_percent,
        memory_percent: p.memory_percent,
        memory_rss_mb: p.memory_rss_mb,
        started_at: p.started_at,
        runtime_seconds: p.runtime_seconds,
        score: p.score,
        score_breakdown: p.score_breakdown,
        flags: p.flags,
      })),
      total_scanned: result.total_scanned,
      suspicious_count: result.suspicious_count,
      scan_time_ms: result.scan_time_ms,
      timestamp: result.timestamp,
      thresholds: result.thresholds,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /pt/scan - Quick scan with query params
 */
pt.get("/scan", async (c) => {
  try {
    const minScoreParam = c.req.query("minScore");
    const limitParam = c.req.query("limit");
    const namePattern = c.req.query("name");

    const service = getPtService();

    const options: Parameters<typeof service.scanProcesses>[0] = {};
    if (minScoreParam) {
      const minScore = parseInt(minScoreParam, 10);
      if (!Number.isNaN(minScore)) options.minScore = minScore;
    }
    if (limitParam) {
      const limit = parseInt(limitParam, 10);
      if (!Number.isNaN(limit)) options.limit = limit;
    }
    if (namePattern) options.namePattern = namePattern;

    const result = await service.scanProcesses(options);

    return sendList(
      c,
      result.processes.map((p) => ({
        pid: p.pid,
        name: p.name,
        score: p.score,
        cpu_percent: p.cpu_percent,
        memory_rss_mb: p.memory_rss_mb,
        runtime_seconds: p.runtime_seconds,
        flags: p.flags,
      })),
      {
        total: result.suspicious_count,
      },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Process Inspection Routes
// ============================================================================

/**
 * GET /pt/processes/:pid - Get details for a specific process
 */
pt.get("/processes/:pid", async (c) => {
  try {
    const pidParam = c.req.param("pid");
    const pid = parseInt(pidParam, 10);

    if (Number.isNaN(pid) || pid < 0) {
      return sendValidationError(c, [{ path: "pid", message: "Invalid PID" }]);
    }

    const service = getPtService();
    const process = await service.getProcessDetails(pid);

    if (!process) {
      return sendNotFound(c, "process", pidParam);
    }

    return sendResource(c, "pt_process", process);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Process Termination Routes
// ============================================================================

/**
 * POST /pt/processes/:pid/kill - Terminate a process
 */
pt.post("/processes/:pid/kill", async (c) => {
  try {
    const pidParam = c.req.param("pid");
    const pid = parseInt(pidParam, 10);

    if (Number.isNaN(pid) || pid < 0) {
      return sendValidationError(c, [{ path: "pid", message: "Invalid PID" }]);
    }

    const body = await c.req.json().catch(() => ({}));
    const validated = KillRequestSchema.parse(body);
    const log = getLogger();

    log.info({ pid, options: validated }, "Kill request for process");

    const service = getPtService();

    // Build options conditionally
    const options: Parameters<typeof service.killProcess>[1] = {};
    if (validated.signal !== undefined) options.signal = validated.signal;
    if (validated.force !== undefined) options.force = validated.force;
    if (validated.wait !== undefined) options.wait = validated.wait;
    if (validated.waitTimeout !== undefined)
      options.waitTimeout = validated.waitTimeout;

    const result = await service.killProcess(pid, options);

    if (!result.success) {
      return sendError(
        c,
        "KILL_FAILED",
        result.error ?? "Failed to terminate process",
        400,
      );
    }

    return sendResource(c, "pt_kill_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /pt/processes/kill - Bulk terminate processes
 */
pt.post("/processes/kill", async (c) => {
  try {
    const body = await c.req.json();
    const validated = BulkKillRequestSchema.parse(body);
    const log = getLogger();

    log.info(
      { pids: validated.pids, signal: validated.signal },
      "Bulk kill request",
    );

    const service = getPtService();

    const options: Parameters<typeof service.killProcesses>[1] = {};
    if (validated.signal !== undefined) options.signal = validated.signal;
    if (validated.force !== undefined) options.force = validated.force;

    const results = await service.killProcesses(validated.pids, options);

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return sendResource(c, "pt_bulk_kill_result", {
      results,
      summary: {
        total: validated.pids.length,
        succeeded: successCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Agent Cleanup Routes (Fleet Management)
// ============================================================================

/**
 * GET /pt/agents/scan - Scan for stuck agent processes
 */
pt.get("/agents/scan", async (c) => {
  try {
    const minRuntimeParam = c.req.query("minRuntime");
    const minScoreParam = c.req.query("minScore");
    const includeGatewayParam = c.req.query("includeGateway");

    const service = getPtService();

    const options: Parameters<typeof service.scanAgentProcesses>[0] = {};
    if (minRuntimeParam) {
      const minRuntime = parseInt(minRuntimeParam, 10);
      if (!Number.isNaN(minRuntime)) options.minRuntimeSeconds = minRuntime;
    }
    if (minScoreParam) {
      const minScore = parseInt(minScoreParam, 10);
      if (!Number.isNaN(minScore)) options.minScore = minScore;
    }
    if (includeGatewayParam === "true") options.includeGateway = true;

    const result = await service.scanAgentProcesses(options);

    return sendResource(c, "pt_agent_scan", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /pt/agents/cleanup - Clean up orphaned agent processes
 */
pt.post("/agents/cleanup", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = CleanupRequestSchema.parse(body);
    const log = getLogger();

    // Default to dry run for safety
    const dryRun = validated.dryRun ?? true;

    log.info(
      { minRuntimeSeconds: validated.minRuntimeSeconds, dryRun },
      "Agent cleanup request",
    );

    const service = getPtService();

    const options: Parameters<typeof service.cleanupAgentProcesses>[0] = {};
    if (validated.minRuntimeSeconds !== undefined)
      options.minRuntimeSeconds = validated.minRuntimeSeconds;
    if (validated.dryRun !== undefined) options.dryRun = validated.dryRun;
    if (validated.signal !== undefined) options.signal = validated.signal;

    const result = await service.cleanupAgentProcesses(options);

    return sendResource(c, "pt_cleanup_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

export { pt };
