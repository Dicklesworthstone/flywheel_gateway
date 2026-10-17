/**
 * Agent Output Search and Tagging Routes (bd-39chi)
 *
 * Endpoints:
 * - GET /search/outputs - Full-text search across agent outputs with highlights & cursor pagination
 * - POST /search/outputs - Index an agent output chunk
 * - GET /search/health - Index health metrics (size, rebuild time, last update)
 * - POST /search/rebuild - Rebuild search index
 * - POST /search/sessions/:sessionId/tags - Add tags to a session (with spam protection)
 * - GET /search/tags - List all tags and usage counts
 * - POST /search/saved - Create a pinned/shared saved search
 * - GET /search/saved - List saved searches visible to user/role
 */

import { Hono } from "hono";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  AddTagsSchema,
  addSessionTags,
  createSavedSearch,
  getOutputSearchIndexHealth,
  IndexOutputChunkSchema,
  indexAgentOutput,
  listAllOutputTags,
  listSavedSearches,
  rebuildOutputSearchIndex,
  SavedSearchInputSchema,
  searchAgentOutputs,
} from "../services/output-search.service";
import {
  sendCreated,
  sendError,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const outputSearch = new Hono();
outputSearch.use("*", requireAdminMiddleware());

outputSearch.get("/outputs", (c) => {
  const q = c.req.query("q");
  const agentId = c.req.query("agentId");
  const sessionId = c.req.query("sessionId");
  const tag = c.req.query("tag");
  const toolCallType = c.req.query("toolCallType");
  const errorOnly = c.req.query("errorOnly") === "true";
  const from = c.req.query("from");
  const to = c.req.query("to");
  const cursorParam = c.req.query("cursor");
  const limitParam = c.req.query("limit");

  const cursor = cursorParam ? Number.parseInt(cursorParam, 10) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 25;

  const result = searchAgentOutputs({
    ...(q && { q }),
    ...(agentId && { agentId }),
    ...(sessionId && { sessionId }),
    ...(tag && { tag }),
    ...(toolCallType && { toolCallType }),
    ...(errorOnly && { errorOnly }),
    ...(from && { from }),
    ...(to && { to }),
    ...(cursor !== undefined && Number.isFinite(cursor) && { cursor }),
    ...(Number.isFinite(limit) && { limit }),
  });

  return sendList(c, result.hits, {
    total: result.totalCount,
    hasMore: result.hasMore,
    ...(result.nextCursor && { nextCursor: result.nextCursor }),
  });
});

outputSearch.post("/outputs", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = IndexOutputChunkSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const indexed = indexAgentOutput(parsed.data);
  return sendCreated(
    c,
    "indexed_output",
    indexed,
    `/search/outputs?q=${encodeURIComponent(indexed.id)}`,
  );
});

outputSearch.get("/health", (c) => {
  return sendResource(
    c,
    "output_search_index_health",
    getOutputSearchIndexHealth(),
  );
});

outputSearch.post("/rebuild", (c) => {
  const res = rebuildOutputSearchIndex();
  return sendResource(c, "output_search_index_rebuild", res);
});

outputSearch.post("/sessions/:sessionId/tags", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json().catch(() => null);
  const parsed = AddTagsSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  try {
    const tags = addSessionTags(sessionId, parsed.data.tags);
    return sendResource(c, "session_tags", { sessionId, tags });
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Failed to add tags",
      400,
    );
  }
});

outputSearch.get("/tags", (c) => {
  const tags = listAllOutputTags();
  return sendList(c, tags, { total: tags.length });
});

outputSearch.post("/saved", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SavedSearchInputSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const saved = createSavedSearch(parsed.data);
  return sendCreated(c, "saved_search", saved, `/search/saved`);
});

outputSearch.get("/saved", (c) => {
  const userId = c.req.query("userId") ?? "anonymous";
  const userRole = c.req.query("role") ?? "viewer";
  const items = listSavedSearches({ userId, userRole });
  return sendList(c, items, { total: items.length });
});

export { outputSearch };
