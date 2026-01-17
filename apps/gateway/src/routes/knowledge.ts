/**
 * Knowledge Routes - REST API endpoints for Meta Skill (ms) knowledge management.
 *
 * Provides search, retrieval, and management endpoints for querying knowledge bases
 * with hybrid semantic search capabilities.
 */

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
  addEntry,
  deleteEntry,
  getDoctor,
  getEntry,
  getMsService,
  getStatus,
  isMsAvailable,
  listKnowledgeBases,
  rebuildIndex,
  search,
} from "../services/ms.service";
import {
  sendError,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const knowledge = new Hono();

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

  // Handle ms-specific errors
  if (error instanceof Error) {
    const message = error.message;
    let gatewayError: GatewayError;

    if (message.includes("ms") && message.includes("failed")) {
      gatewayError = createGatewayError(
        "SYSTEM_INTERNAL_ERROR",
        message,
        { cause: error },
      );
    } else if (message.includes("not available") || message.includes("unavailable")) {
      gatewayError = createGatewayError(
        "SYSTEM_UNAVAILABLE",
        "Knowledge service (ms) is not available",
        { cause: error },
      );
    } else if (message.includes("timed out")) {
      gatewayError = createGatewayError(
        "AGENT_TIMEOUT",
        "Knowledge service request timed out",
        { cause: error },
      );
    } else {
      gatewayError = toGatewayError(error);
    }

    return respondWithGatewayError(c, gatewayError);
  }

  log.error({ error }, "Unexpected error in knowledge route");
  return respondWithGatewayError(c, toGatewayError(error));
}

// ============================================================================
// Validation Schemas
// ============================================================================

const SearchQuerySchema = z.object({
  q: z.string().min(1, "Query is required"),
  kb: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  threshold: z.coerce.number().min(0).max(1).optional(),
  semantic: z
    .string()
    .optional()
    .transform((val) => {
      if (val === "true" || val === "1") return true;
      if (val === "false" || val === "0") return false;
      return undefined;
    }),
});

const GetEntryParamsSchema = z.object({
  id: z.string().min(1, "Entry ID is required"),
});

const GetEntryQuerySchema = z.object({
  kb: z.string().optional(),
});

const AddEntryBodySchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  source: z.string().optional(),
  knowledgeBase: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  skipEmbedding: z.boolean().optional(),
});

const DeleteEntryParamsSchema = z.object({
  id: z.string().min(1, "Entry ID is required"),
});

const DeleteEntryQuerySchema = z.object({
  kb: z.string().optional(),
});

const RebuildIndexBodySchema = z.object({
  knowledgeBase: z.string().optional(),
  force: z.boolean().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /knowledge/health - Knowledge service health status
 *
 * Returns the health status of the ms service.
 */
knowledge.get("/health", async (c) => {
  try {
    const doctor = await getDoctor();
    const httpStatus = doctor.status === "healthy" ? 200 : 503;

    return sendResource(
      c,
      "knowledge_health",
      {
        status: doctor.status,
        checks: doctor.checks,
        embeddingService: doctor.embedding_service,
        storage: doctor.storage,
        timestamp: new Date().toISOString(),
      },
      httpStatus,
    );
  } catch (error) {
    // If doctor fails, try basic availability check
    const available = await isMsAvailable();
    return sendResource(
      c,
      "knowledge_health",
      {
        status: available ? "unknown" : "unavailable",
        available,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      available ? 200 : 503,
    );
  }
});

/**
 * GET /knowledge/available - Quick availability check
 *
 * Fast check to see if ms is available (<50ms).
 */
knowledge.get("/available", async (c) => {
  try {
    const available = await isMsAvailable();
    return sendResource(c, "knowledge_available", { available });
  } catch (_error) {
    return sendResource(c, "knowledge_available", { available: false });
  }
});

/**
 * GET /knowledge/status - Full system status
 *
 * Returns comprehensive status information.
 */
knowledge.get("/status", async (c) => {
  try {
    const status = await getStatus();
    return sendResource(c, "knowledge_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /knowledge/bases - List all knowledge bases
 *
 * Returns list of configured knowledge bases.
 */
knowledge.get("/bases", async (c) => {
  try {
    const bases = await listKnowledgeBases();
    return sendResource(c, "knowledge_bases", {
      knowledgeBases: bases,
      count: bases.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /knowledge/search - Semantic search across knowledge bases
 *
 * Query parameters:
 * - q: Search query (required)
 * - kb: Knowledge base to search (optional, searches all if omitted)
 * - limit: Max results (default: 10, max: 100)
 * - threshold: Minimum similarity threshold (0-1)
 * - semantic: Enable/disable semantic search (default: true)
 */
knowledge.get("/search", async (c) => {
  try {
    const query = c.req.query();
    const parsed = SearchQuerySchema.safeParse(query);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const { q, kb, limit, threshold, semantic } = parsed.data;

    const searchOptions: Parameters<typeof search>[1] = {};
    if (kb !== undefined) searchOptions.knowledgeBase = kb;
    if (limit !== undefined) searchOptions.limit = limit;
    if (threshold !== undefined) searchOptions.threshold = threshold;
    if (semantic !== undefined) searchOptions.semantic = semantic;

    const result = await search(q, searchOptions);

    return sendResource(c, "knowledge_search_result", {
      query: result.query,
      results: result.results,
      total: result.total,
      tookMs: result.took_ms,
      semanticEnabled: result.semantic_enabled,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /knowledge/entries/:id - Get a specific knowledge entry
 *
 * URL parameters:
 * - id: Entry ID (required)
 *
 * Query parameters:
 * - kb: Knowledge base (optional)
 */
knowledge.get("/entries/:id", async (c) => {
  try {
    const paramsParsed = GetEntryParamsSchema.safeParse({
      id: c.req.param("id"),
    });
    if (!paramsParsed.success) {
      return sendValidationError(c, transformZodError(paramsParsed.error));
    }

    const queryParsed = GetEntryQuerySchema.safeParse(c.req.query());
    if (!queryParsed.success) {
      return sendValidationError(c, transformZodError(queryParsed.error));
    }

    const options: Parameters<typeof getEntry>[1] = {};
    if (queryParsed.data.kb !== undefined) {
      options.knowledgeBase = queryParsed.data.kb;
    }

    const entry = await getEntry(paramsParsed.data.id, options);

    return sendResource(c, "knowledge_entry", {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      source: entry.source,
      knowledgeBase: entry.knowledge_base,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      metadata: entry.metadata,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /knowledge/entries - Add a new knowledge entry
 *
 * Body:
 * - title: Entry title (required)
 * - content: Entry content (required)
 * - source: Source reference (optional)
 * - knowledgeBase: Target knowledge base (optional)
 * - metadata: Additional metadata (optional)
 * - skipEmbedding: Skip embedding generation (optional)
 */
knowledge.post("/entries", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = AddEntryBodySchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const { skipEmbedding, title, content, source, knowledgeBase, metadata } = parsed.data;

    // Build entry data object, only including defined values
    const entryData: Parameters<typeof addEntry>[0] = { title, content };
    if (source !== undefined) entryData.source = source;
    if (knowledgeBase !== undefined) entryData.knowledgeBase = knowledgeBase;
    if (metadata !== undefined) entryData.metadata = metadata;

    // Build options object
    const addOptions: Parameters<typeof addEntry>[1] = {};
    if (skipEmbedding !== undefined) addOptions.skipEmbedding = skipEmbedding;

    const entry = await addEntry(entryData, addOptions);

    return sendResource(
      c,
      "knowledge_entry",
      {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        source: entry.source,
        knowledgeBase: entry.knowledge_base,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        metadata: entry.metadata,
      },
      201,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /knowledge/entries/:id - Delete a knowledge entry
 *
 * URL parameters:
 * - id: Entry ID (required)
 *
 * Query parameters:
 * - kb: Knowledge base (optional)
 */
knowledge.delete("/entries/:id", async (c) => {
  try {
    const paramsParsed = DeleteEntryParamsSchema.safeParse({
      id: c.req.param("id"),
    });
    if (!paramsParsed.success) {
      return sendValidationError(c, transformZodError(paramsParsed.error));
    }

    const queryParsed = DeleteEntryQuerySchema.safeParse(c.req.query());
    if (!queryParsed.success) {
      return sendValidationError(c, transformZodError(queryParsed.error));
    }

    const options: Parameters<typeof deleteEntry>[1] = {};
    if (queryParsed.data.kb !== undefined) {
      options.knowledgeBase = queryParsed.data.kb;
    }

    const result = await deleteEntry(paramsParsed.data.id, options);

    return sendResource(c, "knowledge_delete_result", {
      deleted: result.deleted,
      id: result.id,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /knowledge/index/rebuild - Rebuild the search index
 *
 * Body:
 * - knowledgeBase: Target knowledge base (optional, rebuilds all if omitted)
 * - force: Force full rebuild (optional)
 */
knowledge.post("/index/rebuild", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = RebuildIndexBodySchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    // Build options object, only including defined values
    const rebuildOptions: Parameters<typeof rebuildIndex>[0] = {};
    if (parsed.data.knowledgeBase !== undefined) {
      rebuildOptions.knowledgeBase = parsed.data.knowledgeBase;
    }
    if (parsed.data.force !== undefined) {
      rebuildOptions.force = parsed.data.force;
    }

    const result = await rebuildIndex(rebuildOptions);

    return sendResource(c, "knowledge_index_result", {
      success: result.success,
      indexed: result.indexed,
      tookMs: result.took_ms,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { knowledge };
