/**
 * CASS Routes - REST API endpoints for Cross-Agent Session Search.
 *
 * Provides search, view, and expand endpoints for querying agent session histories.
 */

import { CassClientError } from "@flywheel/flywheel-clients";
import type { GatewayError } from "@flywheel/shared/errors";
import {
  createGatewayError,
  serializeGatewayError,
  toGatewayError,
} from "@flywheel/shared/errors";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  expandSessionContext,
  getCassStatus,
  isCassAvailable,
  searchSessions,
  viewSessionLine,
} from "../services/cass.service";
import {
  sendError,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const cass = new Hono();

// ============================================================================
// Error Handling
// ============================================================================

function respondWithGatewayError(c: Context, error: GatewayError) {
  const timestamp = new Date().toISOString();
  const payload = serializeGatewayError(error);
  return sendError(
    c,
    payload.code,
    payload.message,
    payload.httpStatus as ContentfulStatusCode,
    {
      ...(payload.details && { details: payload.details }),
      timestamp,
    },
  );
}

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof CassClientError) {
    let gatewayError: GatewayError;

    // Build details object only if details exist
    const errorOptions: { details?: Record<string, unknown>; cause: Error } = {
      cause: error,
    };
    if (error.details) {
      errorOptions.details = error.details;
    }

    switch (error.kind) {
      case "unavailable":
        gatewayError = createGatewayError(
          "SYSTEM_UNAVAILABLE",
          "CASS is not available",
          errorOptions,
        );
        break;
      case "timeout":
        gatewayError = createGatewayError(
          "AGENT_TIMEOUT",
          "CASS request timed out",
          errorOptions,
        );
        break;
      case "command_failed":
        gatewayError = createGatewayError(
          "SYSTEM_INTERNAL_ERROR",
          "CASS command failed",
          errorOptions,
        );
        break;
      case "parse_error":
      case "validation_error":
        gatewayError = createGatewayError(
          "SYSTEM_INTERNAL_ERROR",
          `CASS ${error.kind.replace("_", " ")}`,
          errorOptions,
        );
        break;
      default:
        gatewayError = toGatewayError(error);
    }

    return respondWithGatewayError(c, gatewayError);
  }

  log.error({ error }, "Unexpected error in CASS route");
  return respondWithGatewayError(c, toGatewayError(error));
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Schema for boolean query parameters.
 * Note: z.coerce.boolean() uses Boolean() which treats any non-empty string as true,
 * so "false" would incorrectly become true. This transform handles "true"/"false" strings.
 */
const booleanQueryParam = z
  .string()
  .optional()
  .transform((val) => {
    if (val === "true" || val === "1") return true;
    if (val === "false" || val === "0") return false;
    return undefined;
  });

const SearchQuerySchema = z.object({
  q: z.string().min(1, "Query is required"),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  agent: z.string().optional(),
  workspace: z.string().optional(),
  days: z.coerce.number().int().positive().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  fields: z.enum(["minimal", "summary"]).or(z.string()).optional(),
  mode: z.enum(["lexical", "semantic", "hybrid"]).optional(),
  highlight: booleanQueryParam,
});

const ViewQuerySchema = z.object({
  line: z.coerce.number().int().positive(),
  context: z.coerce.number().int().nonnegative().optional(),
});

const ExpandQuerySchema = z.object({
  line: z.coerce.number().int().positive(),
  context: z.coerce.number().int().nonnegative().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /cass/health - CASS health status
 *
 * Returns the health status of the CASS service.
 */
cass.get("/health", async (c) => {
  try {
    const status = await getCassStatus();
    const httpStatus = status.healthy ? 200 : 503;

    return sendResource(
      c,
      "cass_health",
      {
        available: status.available,
        healthy: status.healthy,
        latencyMs: status.latencyMs,
        ...(status.error && { error: status.error }),
        timestamp: new Date().toISOString(),
      },
      httpStatus,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /cass/available - Quick availability check
 *
 * Fast check to see if CASS is available (<50ms).
 */
cass.get("/available", async (c) => {
  try {
    const available = await isCassAvailable();
    return sendResource(c, "cass_available", { available });
  } catch (error) {
    return sendResource(c, "cass_available", { available: false });
  }
});

/**
 * GET /cass/search - Search across agent sessions
 *
 * Query parameters:
 * - q: Search query (required)
 * - limit: Max results (default: 10, max: 100)
 * - offset: Pagination offset
 * - agent: Filter by agent name
 * - workspace: Filter by workspace path
 * - days: Filter to last N days
 * - since: Filter since ISO date
 * - until: Filter until ISO date
 * - fields: Field set (minimal, summary, or custom)
 * - mode: Search mode (lexical, semantic, hybrid)
 * - highlight: Include match highlighting
 */
cass.get("/search", async (c) => {
  try {
    const query = c.req.query();
    const parsed = SearchQuerySchema.safeParse(query);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const { q, ...options } = parsed.data;

    // Build search options, only including defined values
    const searchOptions: Parameters<typeof searchSessions>[1] = {};
    if (options.limit !== undefined) searchOptions.limit = options.limit;
    if (options.offset !== undefined) searchOptions.offset = options.offset;
    if (options.agent !== undefined) searchOptions.agent = options.agent;
    if (options.workspace !== undefined) searchOptions.workspace = options.workspace;
    if (options.days !== undefined) searchOptions.days = options.days;
    if (options.since !== undefined) searchOptions.since = options.since;
    if (options.until !== undefined) searchOptions.until = options.until;
    if (options.fields !== undefined) searchOptions.fields = options.fields;
    if (options.mode !== undefined) searchOptions.mode = options.mode;
    if (options.highlight !== undefined) searchOptions.highlight = options.highlight;

    const result = await searchSessions(q, searchOptions);

    return sendResource(c, "cass_search_result", {
      query: result.query,
      hits: result.hits,
      count: result.count,
      totalMatches: result.total_matches,
      limit: result.limit,
      offset: result.offset,
      cursor: result.cursor,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /cass/view/:path - View session content at a specific line
 *
 * URL parameters:
 * - path: Session file path (URL-encoded)
 *
 * Query parameters:
 * - line: Line number (required)
 * - context: Context lines before/after (default: 5)
 */
cass.get("/view/*", async (c) => {
  try {
    // Extract wildcard path parameter
    const path = c.req.param("*");
    if (!path) {
      return sendError(c, "INVALID_REQUEST", "Path is required", 400);
    }

    const query = c.req.query();
    const parsed = ViewQuerySchema.safeParse(query);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    // Build view options, only including defined values
    const viewOptions: Parameters<typeof viewSessionLine>[1] = {
      line: parsed.data.line,
    };
    if (parsed.data.context !== undefined) {
      viewOptions.context = parsed.data.context;
    }

    const result = await viewSessionLine(decodeURIComponent(path), viewOptions);

    return sendResource(c, "cass_view_result", {
      path: result.path,
      lineNumber: result.line_number,
      content: result.content,
      contextBefore: result.context_before,
      contextAfter: result.context_after,
      role: result.role,
      agent: result.agent,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /cass/expand/:path - Expand messages around a specific line
 *
 * URL parameters:
 * - path: Session file path (URL-encoded)
 *
 * Query parameters:
 * - line: Line number (required)
 * - context: Number of messages before/after (default: 3)
 */
cass.get("/expand/*", async (c) => {
  try {
    // Extract wildcard path parameter
    const path = c.req.param("*");
    if (!path) {
      return sendError(c, "INVALID_REQUEST", "Path is required", 400);
    }

    const query = c.req.query();
    const parsed = ExpandQuerySchema.safeParse(query);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    // Build expand options, only including defined values
    const expandOptions: Parameters<typeof expandSessionContext>[1] = {
      line: parsed.data.line,
    };
    if (parsed.data.context !== undefined) {
      expandOptions.context = parsed.data.context;
    }

    const result = await expandSessionContext(
      decodeURIComponent(path),
      expandOptions,
    );

    return sendResource(c, "cass_expand_result", {
      path: result.path,
      targetLine: result.target_line,
      messages: result.messages.map((m) => ({
        lineNumber: m.line_number,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
      totalMessages: result.total_messages,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { cass };
