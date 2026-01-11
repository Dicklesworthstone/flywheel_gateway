/**
 * History Routes - REST API endpoints for history tracking.
 *
 * Provides endpoints for querying, searching, and managing agent history.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type ExportOptions,
  type ExtractionType,
  exportHistory,
  extractFromOutput,
  getHistoryEntry,
  getHistoryStats,
  type HistoryOutcome,
  type HistoryQueryOptions,
  incrementReplayCount,
  pruneHistory,
  queryHistory,
  searchHistory,
  toggleStar,
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
  type: z.enum([
    "code_blocks",
    "json",
    "file_paths",
    "urls",
    "errors",
    "custom",
  ]),
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
      400,
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
    500,
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

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: HistoryQueryOptions = {};
    if (params.agentId !== undefined) options.agentId = params.agentId;
    if (params.outcome !== undefined)
      options.outcome = params.outcome.split(",") as HistoryOutcome[];
    if (params.starred === "true") options.starred = true;
    else if (params.starred === "false") options.starred = false;
    if (params.startDate !== undefined)
      options.startDate = new Date(params.startDate);
    if (params.endDate !== undefined)
      options.endDate = new Date(params.endDate);
    if (params.search !== undefined) options.search = params.search;
    if (params.tags !== undefined) options.tags = params.tags.split(",");
    if (params.limit !== undefined) options.limit = params.limit;
    if (params.cursor !== undefined) options.cursor = params.cursor;

    const result = await queryHistory(options);

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
        400,
      );
    }

    // Build options conditionally (for exactOptionalPropertyTypes)
    const searchOptions: Parameters<typeof searchHistory>[1] = {};
    if (agentId !== undefined) searchOptions.agentId = agentId;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!Number.isNaN(parsed)) searchOptions.limit = parsed;
    }

    const entries = await searchHistory(query, searchOptions);

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

    // Build options conditionally (for exactOptionalPropertyTypes)
    const statsOptions: Parameters<typeof getHistoryStats>[0] = {};
    if (agentId !== undefined) statsOptions.agentId = agentId;
    if (startDate) statsOptions.startDate = new Date(startDate);
    if (endDate) statsOptions.endDate = new Date(endDate);

    const stats = await getHistoryStats(statsOptions);

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
        404,
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
        404,
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
        404,
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

    // Build options conditionally (for exactOptionalPropertyTypes)
    const exportOptions: ExportOptions = {
      format: validated.format,
    };
    if (validated.agentId !== undefined)
      exportOptions.agentId = validated.agentId;
    if (validated.startDate)
      exportOptions.startDate = new Date(validated.startDate);
    if (validated.endDate) exportOptions.endDate = new Date(validated.endDate);

    const content = await exportHistory(exportOptions);

    const contentType =
      validated.format === "json" ? "application/json" : "text/csv";
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

    // Build options conditionally (for exactOptionalPropertyTypes)
    const extractOptions: Parameters<typeof extractFromOutput>[2] = {};
    if (validated.language !== undefined)
      extractOptions.language = validated.language;
    if (validated.customPattern !== undefined)
      extractOptions.customPattern = validated.customPattern;

    const result = extractFromOutput(
      validated.output,
      validated.type as ExtractionType,
      extractOptions,
    );

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
