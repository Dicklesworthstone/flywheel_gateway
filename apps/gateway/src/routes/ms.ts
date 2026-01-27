/**
 * Meta Skill (ms) Routes - REST API for knowledge management.
 *
 * Provides endpoints for:
 * - Semantic search across knowledge bases
 * - Managing knowledge entries
 * - System status and health
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import { getMsService } from "../services/ms.service";
import {
  sendCreated,
  sendError,
  sendInternalError,
  sendList,
  sendNoContent,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const ms = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const SearchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  knowledgeBase: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  threshold: z.number().min(0).max(1).optional(),
  semantic: z.boolean().optional(),
});

const AddEntrySchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(100000),
  source: z.string().max(1000).optional(),
  knowledgeBase: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  skipEmbedding: z.boolean().optional(),
});

const RebuildIndexSchema = z.object({
  knowledgeBase: z.string().optional(),
  force: z.boolean().optional(),
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

  log.error({ error }, "Unexpected error in ms route");
  return sendInternalError(c);
}

// ============================================================================
// Status and Health Routes
// ============================================================================

/**
 * GET /ms/status - Get ms system status
 */
ms.get("/status", async (c) => {
  try {
    const service = getMsService();
    const status = await service.getStatus();
    return sendResource(c, "ms_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ms/doctor - Run doctor check
 */
ms.get("/doctor", async (c) => {
  try {
    const service = getMsService();
    const doctor = await service.getDoctor();
    return sendResource(c, "ms_doctor", doctor);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ms/health - Quick health check
 */
ms.get("/health", async (c) => {
  try {
    const service = getMsService();
    const available = await service.isAvailable();
    const version = available ? await service.getVersion() : null;

    const health: { available: boolean; version?: string } = { available };
    if (version) health.version = version;

    return sendResource(c, "ms_health", health);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Knowledge Base Routes
// ============================================================================

/**
 * GET /ms/knowledge-bases - List all knowledge bases
 */
ms.get("/knowledge-bases", async (c) => {
  try {
    const service = getMsService();
    const knowledgeBases = await service.listKnowledgeBases();
    return sendList(c, knowledgeBases);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Search Routes
// ============================================================================

/**
 * POST /ms/search - Semantic search across knowledge bases
 */
ms.post("/search", async (c) => {
  try {
    const body = await c.req.json();
    const validated = SearchRequestSchema.parse(body);
    const log = getLogger();

    log.info(
      { query: validated.query.slice(0, 50), knowledgeBase: validated.knowledgeBase },
      "Running ms search",
    );

    const service = getMsService();

    // Build options conditionally
    const options: Parameters<typeof service.search>[1] = {};
    if (validated.knowledgeBase !== undefined)
      options.knowledgeBase = validated.knowledgeBase;
    if (validated.limit !== undefined) options.limit = validated.limit;
    if (validated.threshold !== undefined) options.threshold = validated.threshold;
    if (validated.semantic !== undefined) options.semantic = validated.semantic;

    const result = await service.search(validated.query, options);

    return sendResource(c, "ms_search_result", {
      query: result.query,
      results: result.results,
      total: result.total,
      took_ms: result.took_ms,
      semantic_enabled: result.semantic_enabled,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ms/search - Search via query params (convenience endpoint)
 */
ms.get("/search", async (c) => {
  try {
    const query = c.req.query("q");
    if (!query) {
      return sendValidationError(c, [
        { path: "q", message: "Query parameter 'q' is required" },
      ]);
    }

    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const knowledgeBase = c.req.query("kb");
    const thresholdParam = c.req.query("threshold");
    const threshold = thresholdParam ? parseFloat(thresholdParam) : undefined;

    const service = getMsService();

    const options: Parameters<typeof service.search>[1] = {};
    if (knowledgeBase !== undefined) options.knowledgeBase = knowledgeBase;
    if (limit !== undefined && !Number.isNaN(limit)) options.limit = limit;
    if (threshold !== undefined && !Number.isNaN(threshold))
      options.threshold = threshold;

    const result = await service.search(query, options);

    return sendResource(c, "ms_search_result", {
      query: result.query,
      results: result.results,
      total: result.total,
      took_ms: result.took_ms,
      semantic_enabled: result.semantic_enabled,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Entry Routes
// ============================================================================

/**
 * GET /ms/entries/:id - Get a knowledge entry by ID
 */
ms.get("/entries/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const knowledgeBase = c.req.query("kb");

    const service = getMsService();

    const options: Parameters<typeof service.getEntry>[1] = {};
    if (knowledgeBase !== undefined) options.knowledgeBase = knowledgeBase;

    const entry = await service.getEntry(id, options);
    return sendResource(c, "ms_entry", entry);
  } catch (error) {
    // Check if it's a not found error
    if (error instanceof Error && error.message.includes("not_found")) {
      return sendNotFound(c, "ms_entry", c.req.param("id"));
    }
    return handleError(error, c);
  }
});

/**
 * POST /ms/entries - Add a knowledge entry
 */
ms.post("/entries", async (c) => {
  try {
    const body = await c.req.json();
    const validated = AddEntrySchema.parse(body);
    const log = getLogger();

    log.info(
      { title: validated.title.slice(0, 50), knowledgeBase: validated.knowledgeBase },
      "Adding ms entry",
    );

    const service = getMsService();

    // Build entry conditionally
    const entry: Parameters<typeof service.addEntry>[0] = {
      title: validated.title,
      content: validated.content,
    };
    if (validated.source !== undefined) entry.source = validated.source;
    if (validated.knowledgeBase !== undefined)
      entry.knowledgeBase = validated.knowledgeBase;
    if (validated.metadata !== undefined) entry.metadata = validated.metadata;

    const options: Parameters<typeof service.addEntry>[1] = {};
    if (validated.skipEmbedding !== undefined)
      options.skipEmbedding = validated.skipEmbedding;

    const result = await service.addEntry(entry, options);

    return sendCreated(c, "ms_entry", result, `/ms/entries/${result.id}`);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /ms/entries/:id - Delete a knowledge entry
 */
ms.delete("/entries/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const knowledgeBase = c.req.query("kb");
    const log = getLogger();

    log.info({ id, knowledgeBase }, "Deleting ms entry");

    const service = getMsService();

    const options: Parameters<typeof service.deleteEntry>[1] = {};
    if (knowledgeBase !== undefined) options.knowledgeBase = knowledgeBase;

    const result = await service.deleteEntry(id, options);

    if (!result.deleted) {
      return sendNotFound(c, "ms_entry", id);
    }

    return sendNoContent(c);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not_found")) {
      return sendNotFound(c, "ms_entry", c.req.param("id"));
    }
    return handleError(error, c);
  }
});

// ============================================================================
// Index Routes
// ============================================================================

/**
 * POST /ms/index/rebuild - Rebuild search index
 */
ms.post("/index/rebuild", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = RebuildIndexSchema.parse(body);
    const log = getLogger();

    log.info(
      { knowledgeBase: validated.knowledgeBase, force: validated.force },
      "Rebuilding ms index",
    );

    const service = getMsService();

    const options: Parameters<typeof service.rebuildIndex>[0] = {};
    if (validated.knowledgeBase !== undefined)
      options.knowledgeBase = validated.knowledgeBase;
    if (validated.force !== undefined) options.force = validated.force;

    const result = await service.rebuildIndex(options);

    return sendResource(c, "ms_index_rebuild", result);
  } catch (error) {
    return handleError(error, c);
  }
});

export { ms };
