/**
 * Processes Routes - REST API endpoints for Process Triage (pt) integration.
 *
 * Provides endpoints to scan for suspicious/stuck processes and terminate them
 * safely via the pt CLI.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import { getPtService } from "../services/pt.service";
import {
  sendError,
  sendInternalError,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";

const processes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const ScanQuerySchema = z.object({
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  minRuntimeSeconds: z.coerce.number().int().min(0).optional(),
  minMemoryMb: z.coerce.number().min(0).optional(),
  minCpuPercent: z.coerce.number().min(0).max(100).optional(),
  namePattern: z.string().max(200).optional(),
  excludePattern: z.string().max(200).optional(),
  users: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const KillBodySchema = z.object({
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
  force: z.boolean().optional(),
  wait: z.boolean().optional(),
  waitTimeout: z.coerce.number().int().min(1000).max(30000).optional(),
});

const BulkKillBodySchema = z.object({
  pids: z.array(z.number().int().positive()).min(1).max(50),
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
  force: z.boolean().optional(),
  wait: z.boolean().optional(),
  waitTimeout: z.coerce.number().int().min(1000).max(30000).optional(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof Error) {
    // Check for pt not installed error
    if (
      error.message.includes("not installed") ||
      error.message.includes("ENOENT") ||
      error.message.includes("spawn pt")
    ) {
      return sendError(
        c,
        "PT_NOT_INSTALLED",
        "pt CLI is not installed. Install from: https://github.com/Dicklesworthstone/process_triage",
        503,
        {
          hint: "Install pt CLI to use the processes API",
          severity: "recoverable",
        },
      );
    }

    // Check for permission errors
    if (
      error.message.includes("permission") ||
      error.message.includes("EPERM")
    ) {
      return sendError(
        c,
        "PT_PERMISSION_ERROR",
        "Insufficient permissions to manage processes",
        403,
        {
          hint: "pt may need elevated permissions for some operations",
          severity: "recoverable",
        },
      );
    }

    log.error({ error: error.message }, "Error in processes route");
    return sendError(c, "PT_ERROR", error.message, 500);
  }

  log.error({ error }, "Unexpected error in processes route");
  return sendInternalError(c);
}

// ============================================================================
// Status Route
// ============================================================================

/**
 * GET /processes/status - Check pt availability and version
 */
processes.get("/status", async (c) => {
  try {
    const pt = getPtService();
    const status = await pt.getStatus();

    return sendResource(c, "pt_status", {
      ...status,
      installUrl: "https://github.com/Dicklesworthstone/process_triage",
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /processes/doctor - Run pt doctor check
 */
processes.get("/doctor", async (c) => {
  try {
    const pt = getPtService();
    const available = await pt.isAvailable();

    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    const doctor = await pt.getDoctor();
    return sendResource(c, "pt_doctor", doctor);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Scan Routes
// ============================================================================

/**
 * GET /processes/scan - Scan for suspicious/stuck processes
 */
processes.get("/scan", async (c) => {
  try {
    const query = c.req.query();
    const validated = ScanQuerySchema.parse(query);
    const pt = getPtService();

    const available = await pt.isAvailable();
    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    // Build scan options conditionally (for exactOptionalPropertyTypes)
    const options: {
      minScore?: number;
      minRuntimeSeconds?: number;
      minMemoryMb?: number;
      minCpuPercent?: number;
      namePattern?: string;
      excludePattern?: string;
      users?: string[];
      limit?: number;
    } = {};

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
    if (validated.users !== undefined)
      options.users = validated.users.split(",").map((u) => u.trim());
    if (validated.limit !== undefined) options.limit = validated.limit;

    const result = await pt.scanProcesses(options);

    // Publish to WebSocket channel
    try {
      const channel: Channel = { type: "system:processes" };
      getHub().publish(channel, "processes.scan_result", {
        processes: result.processes,
        total_scanned: result.total_scanned,
        suspicious_count: result.suspicious_count,
        scan_time_ms: result.scan_time_ms,
        timestamp: result.timestamp,
      });
    } catch {
      // WebSocket hub may not be initialized, ignore
    }

    return sendResource(c, "process_scan", {
      processes: result.processes,
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
 * GET /processes/:pid - Get details for a specific process
 */
processes.get("/:pid", async (c) => {
  try {
    const pidStr = c.req.param("pid");
    const pid = Number.parseInt(pidStr, 10);

    if (Number.isNaN(pid) || pid < 1) {
      return sendValidationError(c, [{ path: "pid", message: "Invalid PID" }]);
    }

    const pt = getPtService();
    const available = await pt.isAvailable();

    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    const process = await pt.getProcessDetails(pid);

    if (!process) {
      return sendNotFound(c, "process", pidStr);
    }

    return sendResource(c, "process", process);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Kill Routes
// ============================================================================

/**
 * POST /processes/:pid/kill - Terminate a specific process
 */
processes.post("/:pid/kill", async (c) => {
  try {
    const pidStr = c.req.param("pid");
    const pid = Number.parseInt(pidStr, 10);

    if (Number.isNaN(pid) || pid < 1) {
      return sendValidationError(c, [{ path: "pid", message: "Invalid PID" }]);
    }

    const body = await c.req.json().catch(() => ({}));
    const validated = KillBodySchema.parse(body);
    const pt = getPtService();

    const available = await pt.isAvailable();
    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    // Build kill options conditionally (for exactOptionalPropertyTypes)
    const options: {
      signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
      force?: boolean;
      wait?: boolean;
      waitTimeout?: number;
    } = {};

    if (validated.signal !== undefined) options.signal = validated.signal;
    if (validated.force !== undefined) options.force = validated.force;
    if (validated.wait !== undefined) options.wait = validated.wait;
    if (validated.waitTimeout !== undefined)
      options.waitTimeout = validated.waitTimeout;

    const result = await pt.killProcess(pid, options);

    if (!result.success) {
      return sendError(
        c,
        "KILL_FAILED",
        `Failed to terminate process ${result.pid}: ${result.error ?? "unknown error"}`,
        400,
      );
    }

    // Publish to WebSocket channel
    try {
      const channel: Channel = { type: "system:processes" };
      getHub().publish(channel, "processes.terminate_result", {
        pid: result.pid,
        success: result.success,
        signal: result.signal,
        process_name: result.process_name,
      });
    } catch {
      // WebSocket hub may not be initialized, ignore
    }

    return sendResource(c, "kill_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /processes/kill - Terminate multiple processes
 */
processes.post("/kill", async (c) => {
  try {
    const body = await c.req.json();
    const validated = BulkKillBodySchema.parse(body);
    const pt = getPtService();

    const available = await pt.isAvailable();
    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    // Build kill options conditionally (for exactOptionalPropertyTypes)
    const options: {
      signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
      force?: boolean;
      wait?: boolean;
      waitTimeout?: number;
    } = {};

    if (validated.signal !== undefined) options.signal = validated.signal;
    if (validated.force !== undefined) options.force = validated.force;
    if (validated.wait !== undefined) options.wait = validated.wait;
    if (validated.waitTimeout !== undefined)
      options.waitTimeout = validated.waitTimeout;

    const results = await pt.killProcesses(validated.pids, options);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Publish to WebSocket channel
    try {
      const channel: Channel = { type: "system:processes" };
      getHub().publish(channel, "processes.bulk_terminate_result", {
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        results,
      });
    } catch {
      // WebSocket hub may not be initialized, ignore
    }

    return sendResource(c, "bulk_kill_result", {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      results,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Fleet Management / Agent Cleanup Routes
// ============================================================================

const AgentScanQuerySchema = z.object({
  minRuntimeSeconds: z.coerce.number().int().min(0).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  includeGateway: z.coerce.boolean().optional(),
});

const CleanupBodySchema = z.object({
  minRuntimeSeconds: z.coerce.number().int().min(0).optional(),
  dryRun: z.boolean().optional(),
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
});

/**
 * GET /processes/agents - Scan for stuck agent-related processes
 */
processes.get("/agents", async (c) => {
  try {
    const query = c.req.query();
    const validated = AgentScanQuerySchema.parse(query);
    const pt = getPtService();

    const available = await pt.isAvailable();
    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: {
      minRuntimeSeconds?: number;
      minScore?: number;
      includeGateway?: boolean;
    } = {};

    if (validated.minRuntimeSeconds !== undefined)
      options.minRuntimeSeconds = validated.minRuntimeSeconds;
    if (validated.minScore !== undefined) options.minScore = validated.minScore;
    if (validated.includeGateway !== undefined)
      options.includeGateway = validated.includeGateway;

    const result = await pt.scanAgentProcesses(options);

    // Publish to WebSocket channel
    try {
      const channel: Channel = { type: "system:processes" };
      getHub().publish(channel, "processes.agent_scan_result", {
        processes: result.processes,
        summary: result.summary,
        timestamp: result.timestamp,
      });
    } catch {
      // WebSocket hub may not be initialized, ignore
    }

    return sendResource(c, "agent_process_scan", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /processes/agents/cleanup - Clean up orphaned agent processes
 */
processes.post("/agents/cleanup", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = CleanupBodySchema.parse(body);
    const pt = getPtService();

    const available = await pt.isAvailable();
    if (!available) {
      return sendError(c, "PT_NOT_INSTALLED", "pt CLI is not installed", 503, {
        hint: "Install from: https://github.com/Dicklesworthstone/process_triage",
        severity: "recoverable",
      });
    }

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: {
      minRuntimeSeconds?: number;
      dryRun?: boolean;
      signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
    } = {};

    if (validated.minRuntimeSeconds !== undefined)
      options.minRuntimeSeconds = validated.minRuntimeSeconds;
    if (validated.dryRun !== undefined) options.dryRun = validated.dryRun;
    if (validated.signal !== undefined) options.signal = validated.signal;

    const result = await pt.cleanupAgentProcesses(options);

    // Publish to WebSocket channel
    try {
      const channel: Channel = { type: "system:processes" };
      getHub().publish(channel, "processes.agent_cleanup_result", {
        dryRun: result.dryRun,
        scanned: result.scanned,
        terminatedCount: result.terminated.length,
        skippedCount: result.skipped.length,
        timestamp: result.timestamp,
      });
    } catch {
      // WebSocket hub may not be initialized, ignore
    }

    log.info(
      {
        dryRun: result.dryRun,
        scanned: result.scanned,
        terminated: result.terminated.length,
        skipped: result.skipped.length,
      },
      "Agent cleanup completed",
    );

    return sendResource(c, "agent_cleanup_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// List Route (alias for scan with defaults)
// ============================================================================

/**
 * GET /processes - List all suspicious processes (alias for scan with defaults)
 */
processes.get("/", async (c) => {
  try {
    const pt = getPtService();
    const available = await pt.isAvailable();

    if (!available) {
      return sendResource(c, "processes_unavailable", {
        available: false,
        message: "pt CLI is not installed",
        installUrl: "https://github.com/Dicklesworthstone/process_triage",
        processes: [],
      });
    }

    // Default scan with moderate thresholds
    const result = await pt.scanProcesses({
      minScore: 30,
      limit: 50,
    });

    return sendResource(c, "process_list", {
      processes: result.processes,
      total: result.suspicious_count,
      total_scanned: result.total_scanned,
      scan_time_ms: result.scan_time_ms,
      timestamp: result.timestamp,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { processes };
