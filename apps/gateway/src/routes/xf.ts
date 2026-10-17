/**
 * XF (X Find) Routes - REST API for X/Twitter archive search.
 *
 * Provides endpoints for:
 * - Archive statistics
 * - Semantic search across tweets, likes, DMs, Grok conversations
 * - System status and health
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import { getXfService } from "../services/xf.service";
import {
  sendError,
  sendInternalError,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const xf = new Hono();
xf.use("*", requireAdminMiddleware());

// ============================================================================
// Validation Schemas
// ============================================================================

const SearchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  types: z.array(z.enum(["tweet", "like", "dm", "grok", "all"])).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  db: z.string().max(500).optional(),
  index: z.string().max(500).optional(),
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

  log.error({ error }, "Unexpected error in xf route");
  return sendInternalError(c);
}

// ============================================================================
// Status and Health Routes
// ============================================================================

/**
 * GET /xf/status - Get xf system status
 */
xf.get("/status", async (c) => {
  try {
    const db = c.req.query("db");
    const index = c.req.query("index");

    const service = getXfService();

    const options: Parameters<typeof service.getStatus>[0] = {};
    if (db !== undefined) options.db = db;
    if (index !== undefined) options.index = index;

    const status = await service.getStatus(options);
    return sendResource(c, "xf_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /xf/health - Quick health check
 */
xf.get("/health", async (c) => {
  try {
    const service = getXfService();
    const available = await service.isAvailable();
    const version = available ? await service.getVersion() : null;

    const health: { available: boolean; version?: string } = { available };
    if (version) health.version = version;

    return sendResource(c, "xf_health", health);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Stats Routes
// ============================================================================

/**
 * GET /xf/stats - Get archive statistics
 */
xf.get("/stats", async (c) => {
  try {
    const db = c.req.query("db");
    const index = c.req.query("index");

    const service = getXfService();

    const options: Parameters<typeof service.getStats>[0] = {};
    if (db !== undefined) options.db = db;
    if (index !== undefined) options.index = index;

    const stats = await service.getStats(options);
    return sendResource(c, "xf_stats", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Search Routes
// ============================================================================

/**
 * POST /xf/search - Search the archive
 */
xf.post("/search", async (c) => {
  try {
    const body = await c.req.json();
    const validated = SearchRequestSchema.parse(body);
    const log = getLogger();

    log.info(
      { query: validated.query.slice(0, 50), types: validated.types },
      "Running xf search",
    );

    const service = getXfService();

    // Build options conditionally
    const options: Parameters<typeof service.search>[1] = {};
    if (validated.types !== undefined) options.types = validated.types;
    if (validated.limit !== undefined) options.limit = validated.limit;
    if (validated.db !== undefined) options.db = validated.db;
    if (validated.index !== undefined) options.index = validated.index;

    const result = await service.search(validated.query, options);

    return sendResource(c, "xf_search_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /xf/search - Search via query params (convenience endpoint)
 */
xf.get("/search", async (c) => {
  try {
    const query = c.req.query("q");
    if (!query) {
      return sendValidationError(c, [
        { path: "q", message: "Query parameter 'q' is required" },
      ]);
    }

    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const typesParam = c.req.query("types");
    const validTypes = new Set(["tweet", "like", "dm", "grok", "all"]);
    const types = typesParam
      ? (typesParam
          .split(",")
          .filter((t): t is "tweet" | "like" | "dm" | "grok" | "all" =>
            validTypes.has(t),
          ) as ("tweet" | "like" | "dm" | "grok" | "all")[])
      : undefined;
    const db = c.req.query("db");
    const index = c.req.query("index");

    const service = getXfService();

    const options: Parameters<typeof service.search>[1] = {};
    if (types !== undefined) options.types = types;
    if (limit !== undefined && !Number.isNaN(limit)) options.limit = limit;
    if (db !== undefined) options.db = db;
    if (index !== undefined) options.index = index;

    const result = await service.search(query, options);

    return sendResource(c, "xf_search_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

export { xf };
