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
  getStats,
  isDcgAvailable,
  listPacks,
  markFalsePositive,
  removeFromAllowlist,
  updateConfig,
} from "../services/dcg.service";
import {
  sendCreated,
  sendEmptyList,
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";

const dcg = new Hono();

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
  cursor: z.string().optional(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    const validationErrors = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return sendValidationError(c, validationErrors);
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
      cursor: c.req.query("cursor"),
    });

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: Parameters<typeof getBlockEvents>[0] = {};
    if (query.agentId !== undefined) options.agentId = query.agentId;
    if (query.severity !== undefined)
      options.severity = query.severity.split(",") as DCGSeverity[];
    if (query.pack !== undefined) options.pack = query.pack;
    if (query.limit !== undefined) options.limit = query.limit;
    if (query.cursor !== undefined) options.cursor = query.cursor;

    const result = await getBlockEvents(options);

    if (result.events.length === 0) {
      return sendEmptyList(c);
    }

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.pagination.hasMore,
    };
    if (result.pagination.cursor) {
      listOptions.nextCursor = result.pagination.cursor;
    }
    return sendList(c, result.events, listOptions);
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

    return sendResource(c, "block_event", event);
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
    return sendList(c, entries);
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

    return sendCreated(c, "allowlist_entry", entry, `/dcg/allowlist/${entry.ruleId}`);
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

    const result = {
      deleted: true,
      ruleId,
    };

    return sendResource(c, "deletion_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Statistics Routes
// ============================================================================

/**
 * GET /dcg/stats - Get block statistics
 */
dcg.get("/stats", async (c) => {
  try {
    const stats = await getStats();
    return sendResource(c, "dcg_statistics", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

export { dcg };
