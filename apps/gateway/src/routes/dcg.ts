/**
 * DCG Routes - REST API endpoints for Destructive Command Guard.
 *
 * Provides endpoints for DCG configuration, block history, allowlist management,
 * and statistics.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  addToAllowlist,
  type DCGConfig,
  type DCGSeverity,
  disablePack,
  enablePack,
  getAllowlist,
  getBlockEvents,
  getConfig,
  getDcgVersion,
  getFullStats,
  getOverviewStats,
  getStats,
  getTrendStats,
  isDcgAvailable,
  listPacks,
  markFalsePositive,
  removeFromAllowlist,
  updateConfig,
} from "../services/dcg.service";
import {
  DCGCommandError,
  DCGNotAvailableError,
  DCGPackNotFoundError,
  type DCGScanResult,
  explainCommand,
  getPackInfo,
  getPacksCached,
  invalidatePacksCache,
  preValidateCommand,
  scanContent,
  scanFile,
  testCommand,
  validateAgentScript,
} from "../services/dcg-cli.service";
import {
  approvePendingException,
  denyPendingException,
  getPendingException,
  listPendingExceptions,
  PendingExceptionConflictError,
  PendingExceptionExpiredError,
  PendingExceptionNotFoundError,
  type PendingExceptionStatus,
  validateExceptionForExecution,
} from "../services/dcg-pending.service";
import {
  allowlistLinks,
  getLinkContext,
  pendingExceptionLinks,
} from "../utils/links";
import {
  sendEmptyList,
  sendError,
  sendInternalError,
  sendList,
  sendNoContent,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const dcg = new Hono();

/** Maximum items allowed in comma-separated list parameters */
const MAX_CSV_ITEMS = 50;

// ============================================================================
// Validation Schemas
// ============================================================================

const UpdateConfigSchema = z.object({
  enabledPacks: z.array(z.string()).optional(),
  disabledPacks: z.array(z.string()).optional(),
});

const AddAllowlistSchema = z.object({
  ruleId: z.string().min(1),
  pattern: z.string().min(1),
  reason: z.string().min(1).max(500),
  expiresAt: z.string().datetime().optional(),
});

const BlocksQuerySchema = z.object({
  agentId: z.string().optional(),
  severity: z.string().optional(),
  pack: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const PendingQuerySchema = z.object({
  status: z
    .enum(["pending", "approved", "denied", "expired", "executed"])
    .optional(),
  agentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const DenyRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

const ValidateRequestSchema = z.object({
  commandHash: z.string().length(64),
});

const ExplainRequestSchema = z.object({
  command: z.string().min(1).max(10000),
});

const TestRequestSchema = z.object({
  command: z.string().min(1).max(10000),
});

const ScanRequestSchema = z
  .object({
    filePath: z.string().min(1).optional(),
    content: z.string().max(1000000).optional(),
    filename: z.string().max(256).optional(),
  })
  .refine((data) => data.filePath || data.content, {
    message: "Either filePath or content must be provided",
  });

const PreValidateRequestSchema = z.object({
  command: z.string().min(1).max(10000),
  agentId: z.string().min(1).max(256),
});

const ValidateScriptRequestSchema = z.object({
  content: z.string().min(1).max(1000000),
  scriptName: z.string().min(1).max(256),
  agentId: z.string().min(1).max(256),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof DCGPackNotFoundError) {
    return sendNotFound(c, "pack", error.packId);
  }

  if (error instanceof DCGNotAvailableError) {
    return sendError(
      c,
      "DCG_NOT_AVAILABLE",
      "DCG CLI is not installed or not accessible",
      503,
    );
  }

  if (error instanceof DCGCommandError) {
    log.error({ error: error.message }, "DCG command failed");
    return sendError(
      c,
      "DCG_COMMAND_FAILED",
      "DCG command execution failed",
      500,
    );
  }

  if (error instanceof Error && error.message.includes("Unknown packs")) {
    return sendError(c, "INVALID_PACK", error.message, 400);
  }

  log.error({ error }, "Unexpected error in DCG route");
  return sendInternalError(c);
}

// ============================================================================
// Status Routes
// ============================================================================

/**
 * GET /dcg/status - Get DCG availability and version
 */
dcg.get("/status", async (c) => {
  try {
    const [available, version] = await Promise.all([
      isDcgAvailable(),
      getDcgVersion(),
    ]);

    const status = {
      available,
      version,
      message: available
        ? `DCG ${version ?? "unknown version"} is available`
        : "DCG is not installed. Install from https://github.com/Dicklesworthstone/dcg",
    };

    return sendResource(c, "dcg_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Configuration Routes
// ============================================================================

/**
 * GET /dcg/config - Get DCG configuration
 */
dcg.get("/config", async (c) => {
  try {
    const config = getConfig();
    return sendResource(c, "dcg_config", config);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PUT /dcg/config - Update DCG configuration
 */
dcg.put("/config", async (c) => {
  try {
    const body = await c.req.json();
    const validated = UpdateConfigSchema.parse(body);

    // Build update object conditionally (for exactOptionalPropertyTypes)
    const updates: Partial<DCGConfig> = {};
    if (validated.enabledPacks !== undefined)
      updates.enabledPacks = validated.enabledPacks;
    if (validated.disabledPacks !== undefined)
      updates.disabledPacks = validated.disabledPacks;

    const config = await updateConfig(updates);

    return sendResource(c, "dcg_config", config);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Pack Routes
// ============================================================================

/**
 * GET /dcg/packs - List available packs
 */
dcg.get("/packs", async (c) => {
  try {
    const packs = listPacks();
    if (packs.length === 0) {
      return sendEmptyList(c);
    }
    return sendList(c, packs);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/packs/:pack/enable - Enable a pack
 */
dcg.post("/packs/:pack/enable", async (c) => {
  try {
    const pack = c.req.param("pack");
    const success = await enablePack(pack);

    if (!success) {
      return sendNotFound(c, "pack", pack);
    }

    const result = {
      pack,
      enabled: true,
    };

    return sendResource(c, "pack_status", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/packs/:pack/disable - Disable a pack
 */
dcg.post("/packs/:pack/disable", async (c) => {
  try {
    const pack = c.req.param("pack");
    const success = await disablePack(pack);

    if (!success) {
      return sendNotFound(c, "pack", pack);
    }

    const result = {
      pack,
      enabled: false,
    };

    return sendResource(c, "pack_status", result);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Block History Routes
// ============================================================================

/**
 * GET /dcg/blocks - List block history
 */
dcg.get("/blocks", async (c) => {
  try {
    const query = BlocksQuerySchema.parse({
      agentId: c.req.query("agentId"),
      severity: c.req.query("severity"),
      pack: c.req.query("pack"),
      limit: c.req.query("limit"),
      starting_after: c.req.query("starting_after"),
      ending_before: c.req.query("ending_before"),
    });

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: Parameters<typeof getBlockEvents>[0] = {};
    if (query.agentId !== undefined) options.agentId = query.agentId;
    if (query.severity !== undefined) {
      options.severity = query.severity
        .split(",")
        .slice(0, MAX_CSV_ITEMS) as DCGSeverity[];
    }
    if (query.pack !== undefined) options.pack = query.pack;
    if (query.limit !== undefined) options.limit = query.limit;
    if (query.starting_after !== undefined)
      options.startingAfter = query.starting_after;
    if (query.ending_before !== undefined)
      options.endingBefore = query.ending_before;

    const result = await getBlockEvents(options);

    if (result.events.length === 0) {
      return sendEmptyList(c);
    }

    const ctx = getLinkContext(c);
    const eventsWithLinks = result.events.map((event) => ({
      ...event,
      links: { self: `${ctx.baseUrl}/dcg/blocks/${event.id}` },
    }));

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.hasMore,
    };
    if (result.nextCursor) listOptions.nextCursor = result.nextCursor;
    if (result.prevCursor) listOptions.prevCursor = result.prevCursor;

    return sendList(c, eventsWithLinks, listOptions);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/blocks/:id/false-positive - Mark as false positive
 */
dcg.post("/blocks/:id/false-positive", async (c) => {
  try {
    const id = c.req.param("id");
    // In production, this would come from auth context
    const markedBy = "api-user";

    const event = await markFalsePositive(id, markedBy);

    if (!event) {
      return sendNotFound(c, "block_event", id);
    }

    const ctx = getLinkContext(c);
    return sendResource(c, "block_event", event, 200, {
      links: { self: `${ctx.baseUrl}/dcg/blocks/${event.id}` },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Allowlist Routes
// ============================================================================

/**
 * GET /dcg/allowlist - List allowlist entries
 */
dcg.get("/allowlist", async (c) => {
  try {
    const entries = await getAllowlist();
    if (entries.length === 0) {
      return sendEmptyList(c);
    }

    const ctx = getLinkContext(c);
    const entriesWithLinks = entries.map((entry) => ({
      ...entry,
      links: allowlistLinks({ ruleId: entry.ruleId }, ctx),
    }));

    return sendList(c, entriesWithLinks);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/allowlist - Add allowlist entry
 */
dcg.post("/allowlist", async (c) => {
  try {
    const body = await c.req.json();
    const validated = AddAllowlistSchema.parse(body);

    // In production, addedBy would come from auth context
    // Build entry conditionally (for exactOptionalPropertyTypes)
    const entryInput: Parameters<typeof addToAllowlist>[0] = {
      ruleId: validated.ruleId,
      pattern: validated.pattern,
      reason: validated.reason,
      addedBy: "api-user",
    };
    if (validated.expiresAt)
      entryInput.expiresAt = new Date(validated.expiresAt);

    const entry = await addToAllowlist(entryInput);

    const ctx = getLinkContext(c);
    return sendResource(c, "allowlist_entry", entry, 201, {
      links: allowlistLinks({ ruleId: entry.ruleId }, ctx),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /dcg/allowlist/:ruleId - Remove allowlist entry
 */
dcg.delete("/allowlist/:ruleId", async (c) => {
  try {
    const ruleId = c.req.param("ruleId");
    const success = await removeFromAllowlist(ruleId);

    if (!success) {
      return sendNotFound(c, "allowlist_entry", ruleId);
    }

    return sendNoContent(c);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Pending Exception Routes (Allow-Once Workflow)
// ============================================================================

/**
 * GET /dcg/pending - List pending exceptions
 */
dcg.get("/pending", async (c) => {
  try {
    const query = PendingQuerySchema.parse({
      status: c.req.query("status"),
      agentId: c.req.query("agentId"),
      limit: c.req.query("limit"),
      starting_after: c.req.query("starting_after"),
      ending_before: c.req.query("ending_before"),
    });

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: Parameters<typeof listPendingExceptions>[0] = {};
    if (query.status !== undefined)
      options.status = query.status as PendingExceptionStatus;
    if (query.agentId !== undefined) options.agentId = query.agentId;
    if (query.limit !== undefined) options.limit = query.limit;
    if (query.starting_after !== undefined)
      options.startingAfter = query.starting_after;
    if (query.ending_before !== undefined)
      options.endingBefore = query.ending_before;

    const result = await listPendingExceptions(options);

    if (result.exceptions.length === 0) {
      return sendEmptyList(c);
    }

    const ctx = getLinkContext(c);
    const exceptionsWithLinks = result.exceptions.map((exception) => ({
      ...exception,
      links: pendingExceptionLinks({ shortCode: exception.shortCode }, ctx),
    }));

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.hasMore,
    };
    if (result.nextCursor) listOptions.nextCursor = result.nextCursor;
    if (result.prevCursor) listOptions.prevCursor = result.prevCursor;

    return sendList(c, exceptionsWithLinks, listOptions);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /dcg/pending/:shortCode - Get specific pending exception
 */
dcg.get("/pending/:shortCode", async (c) => {
  try {
    const shortCode = c.req.param("shortCode");
    const exception = await getPendingException(shortCode);

    if (!exception) {
      return sendNotFound(c, "pending_exception", shortCode);
    }

    const ctx = getLinkContext(c);
    return sendResource(c, "pending_exception", exception, 200, {
      links: pendingExceptionLinks({ shortCode: exception.shortCode }, ctx),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/pending/:shortCode/approve - Approve a pending exception
 */
dcg.post("/pending/:shortCode/approve", async (c) => {
  try {
    const shortCode = c.req.param("shortCode");
    // In production, this would come from auth context
    const approvedBy = "api-user";

    const exception = await approvePendingException(shortCode, approvedBy);

    const ctx = getLinkContext(c);
    return sendResource(c, "pending_exception", exception, 200, {
      links: pendingExceptionLinks({ shortCode: exception.shortCode }, ctx),
    });
  } catch (error) {
    if (error instanceof PendingExceptionNotFoundError) {
      return sendNotFound(c, "pending_exception", c.req.param("shortCode"));
    }
    if (error instanceof PendingExceptionExpiredError) {
      return sendError(
        c,
        "EXCEPTION_EXPIRED",
        error.message,
        410, // Gone
      );
    }
    if (error instanceof PendingExceptionConflictError) {
      return sendError(c, "EXCEPTION_CONFLICT", error.message, 409);
    }
    return handleError(error, c);
  }
});

/**
 * POST /dcg/pending/:shortCode/deny - Deny a pending exception
 */
dcg.post("/pending/:shortCode/deny", async (c) => {
  try {
    const shortCode = c.req.param("shortCode");
    // In production, this would come from auth context
    const deniedBy = "api-user";

    let reason: string | undefined;
    try {
      const body = await c.req.json();
      const validated = DenyRequestSchema.parse(body);
      reason = validated.reason;
    } catch {
      // Body is optional for deny
    }

    const exception = await denyPendingException(shortCode, deniedBy, reason);

    const ctx = getLinkContext(c);
    return sendResource(c, "pending_exception", exception, 200, {
      links: pendingExceptionLinks({ shortCode: exception.shortCode }, ctx),
    });
  } catch (error) {
    if (error instanceof PendingExceptionNotFoundError) {
      return sendNotFound(c, "pending_exception", c.req.param("shortCode"));
    }
    if (error instanceof PendingExceptionConflictError) {
      return sendError(c, "EXCEPTION_CONFLICT", error.message, 409);
    }
    return handleError(error, c);
  }
});

/**
 * POST /dcg/pending/:shortCode/validate - Validate exception for execution
 *
 * Used by DCG to check if a command hash has been approved before allowing execution.
 */
dcg.post("/pending/:shortCode/validate", async (c) => {
  try {
    const shortCode = c.req.param("shortCode");
    const body = await c.req.json();
    const validated = ValidateRequestSchema.parse(body);

    const exception = await getPendingException(shortCode);

    if (!exception) {
      return sendResource(c, "validation_result", {
        valid: false,
        reason: "Not found",
      });
    }

    if (exception.status !== "approved") {
      return sendResource(c, "validation_result", {
        valid: false,
        reason: `Status is ${exception.status}`,
      });
    }

    if (exception.commandHash !== validated.commandHash) {
      return sendResource(c, "validation_result", {
        valid: false,
        reason: "Command hash mismatch",
      });
    }

    if (exception.expiresAt < new Date()) {
      return sendResource(c, "validation_result", {
        valid: false,
        reason: "Expired",
      });
    }

    return sendResource(c, "validation_result", {
      valid: true,
      exception,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/pending/validate-hash - Validate by command hash directly
 *
 * Alternative endpoint that looks up by hash instead of short code.
 */
dcg.post("/pending/validate-hash", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ValidateRequestSchema.parse(body);

    const exception = await validateExceptionForExecution(
      validated.commandHash,
    );

    if (!exception) {
      return sendResource(c, "validation_result", {
        valid: false,
        reason: "No approved exception found for this command",
      });
    }

    return sendResource(c, "validation_result", {
      valid: true,
      exception,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Statistics Routes
// ============================================================================

/**
 * GET /dcg/stats - Get block statistics (legacy format)
 */
dcg.get("/stats", async (c) => {
  try {
    const stats = await getStats();
    return sendResource(c, "dcg_statistics", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /dcg/stats/full - Get comprehensive statistics with trends and time series
 */
dcg.get("/stats/full", async (c) => {
  try {
    const stats = await getFullStats();
    return sendResource(c, "dcg_full_statistics", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /dcg/stats/overview - Get overview statistics only
 */
dcg.get("/stats/overview", async (c) => {
  try {
    const stats = await getOverviewStats();
    return sendResource(c, "dcg_overview_statistics", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /dcg/stats/trends - Get trend statistics only
 */
dcg.get("/stats/trends", async (c) => {
  try {
    const stats = await getTrendStats();
    return sendResource(c, "dcg_trend_statistics", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// CLI Integration Routes
// ============================================================================

/**
 * POST /dcg/explain - Explain a command and why it might be blocked
 */
dcg.post("/explain", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ExplainRequestSchema.parse(body);

    const result = await explainCommand(validated.command);
    return sendResource(c, "explain_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/test - Test if a command would be blocked
 */
dcg.post("/test", async (c) => {
  try {
    const body = await c.req.json();
    const validated = TestRequestSchema.parse(body);

    const result = await testCommand(validated.command);
    return sendResource(c, "test_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/scan - Scan a file or content for dangerous commands
 */
dcg.post("/scan", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ScanRequestSchema.parse(body);

    let result: DCGScanResult;
    if (validated.filePath) {
      result = await scanFile(validated.filePath);
    } else if (validated.content) {
      result = await scanContent(validated.content, validated.filename);
    } else {
      return sendError(
        c,
        "INVALID_REQUEST",
        "Either filePath or content is required",
        400,
      );
    }

    return sendResource(c, "scan_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /dcg/cli/packs - List packs with full details (cached)
 */
dcg.get("/cli/packs", async (c) => {
  try {
    const packs = await getPacksCached();
    if (packs.length === 0) {
      return sendEmptyList(c);
    }
    return sendList(c, packs);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /dcg/cli/packs/:packId - Get detailed info about a specific pack
 */
dcg.get("/cli/packs/:packId", async (c) => {
  try {
    const packId = c.req.param("packId");
    const pack = await getPackInfo(packId);
    return sendResource(c, "pack_info", pack);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/cli/packs/:packId/enable - Enable a pack (with cache invalidation)
 */
dcg.post("/cli/packs/:packId/enable", async (c) => {
  try {
    const packId = c.req.param("packId");
    const success = await enablePack(packId);

    if (!success) {
      return sendNotFound(c, "pack", packId);
    }

    invalidatePacksCache();

    return sendResource(c, "pack_status", {
      packId,
      enabled: true,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/cli/packs/:packId/disable - Disable a pack (with cache invalidation)
 */
dcg.post("/cli/packs/:packId/disable", async (c) => {
  try {
    const packId = c.req.param("packId");
    const success = await disablePack(packId);

    if (!success) {
      return sendNotFound(c, "pack", packId);
    }

    invalidatePacksCache();

    return sendResource(c, "pack_status", {
      packId,
      enabled: false,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Agent Pre-Validation Routes
// ============================================================================

/**
 * POST /dcg/pre-validate - Pre-validate a command before agent execution
 */
dcg.post("/pre-validate", async (c) => {
  try {
    const body = await c.req.json();
    const validated = PreValidateRequestSchema.parse(body);

    const result = await preValidateCommand(
      validated.agentId,
      validated.command,
    );
    return sendResource(c, "pre_validation_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /dcg/validate-script - Validate an agent-generated script
 */
dcg.post("/validate-script", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ValidateScriptRequestSchema.parse(body);

    const result = await validateAgentScript(
      validated.agentId,
      validated.content,
      validated.scriptName,
    );
    return sendResource(c, "script_validation_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

export { dcg };
