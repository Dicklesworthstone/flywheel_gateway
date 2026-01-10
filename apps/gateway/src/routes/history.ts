/**
 * History Routes - REST API endpoints for history tracking.
 *
 * Provides endpoints for querying, searching, and managing agent history.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  queryHistory,
  searchHistory,
  getHistoryEntry,
  toggleStar,
  getHistoryStats,
  exportHistory,
  pruneHistory,
  extractFromOutput,
  incrementReplayCount,
  type ExtractionType,
} from "../services/history.service";

const history = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const QueryParamsSchema = z.object({
  agentId: z.string().optional(),
  outcome: z.string().optional(),
  starred: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  tags: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const ExportSchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  agentId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const PruneSchema = z.object({
  olderThanDays: z.number().min(1).max(365),
});

const ExtractSchema = z.object({
  type: z.enum(["code_blocks", "json", "file_paths", "urls", "errors", "custom"]),
  output: z.string(),
  language: z.string().optional(),
  customPattern: z.string().optional(),
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
      400
    );
  }

  log.error({ error }, "Unexpected error in history route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500
  );
}

// ============================================================================
// List and Query Routes
// ============================================================================

/**
 * GET /history - List history entries with filters
 */
history.get("/", async (c) => {
  try {
    const params = QueryParamsSchema.parse({
      agentId: c.req.query("agentId"),
      outcome: c.req.query("outcome"),
      starred: c.req.query("starred"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      search: c.req.query("search"),
      tags: c.req.query("tags"),
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    });

    const result = await queryHistory({
      agentId: params.agentId,
      outcome: params.outcome?.split(",") as any[],
      starred: params.starred === "true" ? true : params.starred === "false" ? false : undefined,
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
      search: params.search,
      tags: params.tags?.split(","),
      limit: params.limit,
      cursor: params.cursor,
    });

    return c.json({
      entries: result.entries,
      pagination: result.pagination,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /history/search - Full-text search history
 */
history.get("/search", async (c) => {
  try {
    const query = c.req.query("q");
    const agentId = c.req.query("agentId");
    const limitParam = c.req.query("limit");

    if (!query) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Query parameter 'q' is required",
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        400
      );
    }

    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const entries = await searchHistory(query, { agentId, limit });

    return c.json({
      entries,
      query,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /history/stats - Get usage statistics
 */
history.get("/stats", async (c) => {
  try {
    const agentId = c.req.query("agentId");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");

    const stats = await getHistoryStats({
      agentId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return c.json({
      stats,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /history/:id - Get entry details
 */
history.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const entry = await getHistoryEntry(id);

    if (!entry) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `History entry ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404
      );
    }

    return c.json({
      entry,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Actions
// ============================================================================

/**
 * POST /history/:id/star - Star/unstar entry
 */
history.post("/:id/star", async (c) => {
  try {
    const id = c.req.param("id");
    const entry = await toggleStar(id);

    if (!entry) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `History entry ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404
      );
    }

    return c.json({
      entry,
      starred: entry.starred,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /history/:id/replay - Replay prompt to agent
 */
history.post("/:id/replay", async (c) => {
  try {
    const id = c.req.param("id");
    const entry = await getHistoryEntry(id);

    if (!entry) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `History entry ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404
      );
    }

    // Increment replay count
    await incrementReplayCount(id);

    // Return the prompt for replay
    // The actual replay (sending to agent) would be done by the client
    return c.json({
      prompt: entry.prompt,
      originalAgentId: entry.agentId,
      originalTimestamp: entry.timestamp.toISOString(),
      replayCount: entry.replayCount + 1,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /history/export - Export history
 */
history.post("/export", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ExportSchema.parse(body);

    const content = await exportHistory({
      format: validated.format,
      agentId: validated.agentId,
      startDate: validated.startDate ? new Date(validated.startDate) : undefined,
      endDate: validated.endDate ? new Date(validated.endDate) : undefined,
    });

    const contentType = validated.format === "json" ? "application/json" : "text/csv";
    const filename = `history-export-${Date.now()}.${validated.format}`;

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /history/prune - Prune old entries
 */
history.delete("/prune", async (c) => {
  try {
    const body = await c.req.json();
    const validated = PruneSchema.parse(body);

    const olderThan = new Date();
    olderThan.setDate(olderThan.getDate() - validated.olderThanDays);

    const deletedCount = await pruneHistory(olderThan);

    return c.json({
      deletedCount,
      olderThan: olderThan.toISOString(),
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Output Extraction
// ============================================================================

/**
 * POST /history/extract - Extract structured content from output
 */
history.post("/extract", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ExtractSchema.parse(body);

    const result = extractFromOutput(validated.output, validated.type as ExtractionType, {
      language: validated.language,
      customPattern: validated.customPattern,
    });

    return c.json({
      ...result,
      type: validated.type,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { history };
