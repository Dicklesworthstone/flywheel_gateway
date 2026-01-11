/**
 * DCG Routes - REST API endpoints for Destructive Command Guard.
 *
 * Provides endpoints for DCG configuration, block history, allowlist management,
 * and statistics.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
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
  const correlationId = getCorrelationId();

  if (error instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Validation failed",
          correlationId,
          timestamp: new Date().toISOString(),
          details: error.issues,
        },
      },
      400,
    );
  }

  if (error instanceof Error && error.message.includes("Unknown packs")) {
    return c.json(
      {
        error: {
          code: "INVALID_PACK",
          message: error.message,
          correlationId,
          timestamp: new Date().toISOString(),
        },
      },
      400,
    );
  }

  log.error({ error }, "Unexpected error in DCG route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
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

    return c.json({
      available,
      version,
      message: available
        ? `DCG ${version ?? "unknown version"} is available`
        : "DCG is not installed. Install from https://github.com/Dicklesworthstone/dcg",
      correlationId: getCorrelationId(),
    });
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
    return c.json({
      config,
      correlationId: getCorrelationId(),
    });
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
    if (validated.enabledPacks !== undefined) updates.enabledPacks = validated.enabledPacks;
    if (validated.disabledPacks !== undefined) updates.disabledPacks = validated.disabledPacks;

    const config = await updateConfig(updates);

    return c.json({
      config,
      correlationId: getCorrelationId(),
    });
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
    return c.json({
      packs,
      correlationId: getCorrelationId(),
    });
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
      return c.json(
        {
          error: {
            code: "PACK_NOT_FOUND",
            message: `Unknown pack: ${pack}`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      pack,
      enabled: true,
      correlationId: getCorrelationId(),
    });
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
      return c.json(
        {
          error: {
            code: "PACK_NOT_FOUND",
            message: `Unknown pack: ${pack}`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      pack,
      enabled: false,
      correlationId: getCorrelationId(),
    });
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
    if (query.severity !== undefined) options.severity = query.severity.split(",") as DCGSeverity[];
    if (query.pack !== undefined) options.pack = query.pack;
    if (query.limit !== undefined) options.limit = query.limit;
    if (query.cursor !== undefined) options.cursor = query.cursor;

    const result = await getBlockEvents(options);

    return c.json({
      blocks: result.events,
      pagination: result.pagination,
      correlationId: getCorrelationId(),
    });
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
      return c.json(
        {
          error: {
            code: "BLOCK_NOT_FOUND",
            message: `Block event ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      block: event,
      markedFalsePositive: true,
      correlationId: getCorrelationId(),
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
    return c.json({
      allowlist: entries,
      correlationId: getCorrelationId(),
    });
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
    if (validated.expiresAt) entryInput.expiresAt = new Date(validated.expiresAt);

    const entry = await addToAllowlist(entryInput);

    return c.json(
      {
        entry,
        correlationId: getCorrelationId(),
      },
      201,
    );
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
      return c.json(
        {
          error: {
            code: "ALLOWLIST_NOT_FOUND",
            message: `Allowlist entry ${ruleId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      deleted: true,
      ruleId,
      correlationId: getCorrelationId(),
    });
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
    return c.json({
      stats,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { dcg };
