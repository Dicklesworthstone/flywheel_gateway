/**
 * Checkpoint Routes - REST API endpoints for checkpoint/restore operations.
 *
 * Provides session state persistence and recovery through checkpoints.
 * Supports manual and automatic checkpointing with delta-based storage.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  CheckpointError,
  createCheckpoint,
  deleteCheckpoint,
  exportCheckpoint,
  getAgentCheckpoints,
  getCheckpoint,
  importCheckpoint,
  pruneCheckpoints,
  restoreCheckpoint,
  verifyCheckpoint,
} from "../services/checkpoint";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";

const checkpoints = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateCheckpointSchema = z.object({
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  delta: z.boolean().optional(),
  conversationHistory: z.array(z.unknown()).optional(),
  toolState: z.record(z.string(), z.unknown()).optional(),
  tokenUsage: z
    .object({
      promptTokens: z.number().min(0),
      completionTokens: z.number().min(0),
      totalTokens: z.number().min(0),
    })
    .optional(),
});

const RestoreCheckpointSchema = z.object({
  verify: z.boolean().optional(),
  createNew: z.boolean().optional(),
});

const PruneCheckpointsSchema = z.object({
  keepCount: z.number().min(1).max(100).default(5),
});

const ImportCheckpointSchema = z.object({
  version: z.string(),
  exportedAt: z.string(),
  checkpoint: z.object({
    id: z.string(),
    agentId: z.string(),
    createdAt: z.string().or(z.date()),
    conversationHistory: z.array(z.unknown()),
    toolState: z.record(z.string(), z.unknown()),
    tokenUsage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    contextPack: z.unknown().optional(),
  }),
  hash: z.string(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof CheckpointError) {
    const statusMap: Record<string, 400 | 404 | 500> = {
      CHECKPOINT_NOT_FOUND: 404,
      PARENT_NOT_FOUND: 404,
      CHECKPOINT_INVALID: 400,
      IMPORT_HASH_MISMATCH: 400,
    };
    const status = statusMap[error.code] ?? 500;
    return sendError(c, error.code, error.message, status);
  }

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return sendError(c, "INVALID_REQUEST", "Invalid JSON in request body", 400);
  }

  log.error({ error }, "Unexpected error in checkpoint route");
  return sendInternalError(c);
}

// ============================================================================
// WebSocket Events
// ============================================================================

function publishCheckpointEvent(
  agentId: string,
  eventType:
    | "checkpoint.created"
    | "checkpoint.restored"
    | "checkpoint.deleted"
    | "checkpoint.pruned"
    | "checkpoint.imported",
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "agent:checkpoints", agentId };
  hub.publish(channel, eventType, payload, { agentId });
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /sessions/:sessionId/checkpoints - Create a checkpoint
 */
checkpoints.post("/:sessionId/checkpoints", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = CreateCheckpointSchema.parse(body);

    // Build state object from request or use defaults
    const state = {
      conversationHistory: validated.conversationHistory ?? [],
      toolState: validated.toolState ?? {},
      tokenUsage: validated.tokenUsage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };

    const options: { description?: string; tags?: string[]; delta?: boolean } =
      {};
    if (validated.description !== undefined)
      options.description = validated.description;
    if (validated.tags !== undefined) options.tags = validated.tags;
    if (validated.delta !== undefined) options.delta = validated.delta;

    const metadata = await createCheckpoint(sessionId, state, options);

    // Publish WebSocket event
    publishCheckpointEvent(sessionId, "checkpoint.created", {
      checkpointId: metadata.id,
      sessionId,
      type: validated.delta ? "delta" : "full",
      createdAt: metadata.createdAt.toISOString(),
    });

    const baseUrl = new URL(c.req.url).origin;

    const checkpointData = {
      id: metadata.id,
      sessionId: metadata.agentId,
      createdAt: metadata.createdAt.toISOString(),
      tokenUsage: metadata.tokenUsage,
      description: metadata.description,
      tags: metadata.tags,
    };

    return sendResource(c, "checkpoint", checkpointData, 201, {
      links: {
        self: `${baseUrl}/sessions/${sessionId}/checkpoints/${metadata.id}`,
        restore: `${baseUrl}/sessions/${sessionId}/checkpoints/${metadata.id}/restore`,
        export: `${baseUrl}/sessions/${sessionId}/checkpoints/${metadata.id}/export`,
        delete: `${baseUrl}/sessions/${sessionId}/checkpoints/${metadata.id}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /sessions/:sessionId/checkpoints - List checkpoints
 */
checkpoints.get("/:sessionId/checkpoints", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const limitParam = c.req.query("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 50;
    const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(parsedLimit, 100);

    const allCheckpoints = await getAgentCheckpoints(sessionId);

    // Apply limit
    const checkpointList = allCheckpoints.slice(0, limit);
    const hasMore = allCheckpoints.length > limit;

    const baseUrl = new URL(c.req.url).origin;

    // Add links to each checkpoint
    const checkpointsWithLinks = checkpointList.map((chk) => ({
      id: chk.id,
      sessionId: chk.agentId,
      createdAt: chk.createdAt.toISOString(),
      tokenUsage: chk.tokenUsage,
      description: chk.description,
      tags: chk.tags,
      links: {
        self: `${baseUrl}/sessions/${sessionId}/checkpoints/${chk.id}`,
      },
    }));

    return sendList(c, checkpointsWithLinks, {
      hasMore,
      total: allCheckpoints.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /sessions/:sessionId/checkpoints/:checkpointId - Get checkpoint details
 */
checkpoints.get("/:sessionId/checkpoints/:checkpointId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const checkpointId = c.req.param("checkpointId");

    const checkpoint = await getCheckpoint(checkpointId);

    if (!checkpoint) {
      return sendNotFound(c, "checkpoint", checkpointId);
    }

    // Verify it belongs to this session
    if (checkpoint.agentId !== sessionId) {
      return sendNotFound(c, "checkpoint", checkpointId);
    }

    // Verify checkpoint
    const verification = await verifyCheckpoint(checkpointId);

    const baseUrl = new URL(c.req.url).origin;

    const checkpointData = {
      id: checkpoint.id,
      sessionId: checkpoint.agentId,
      createdAt:
        checkpoint.createdAt instanceof Date
          ? checkpoint.createdAt.toISOString()
          : checkpoint.createdAt,
      tokenUsage: checkpoint.tokenUsage,
      description: checkpoint.description,
      tags: checkpoint.tags,
      conversationHistoryCount: Array.isArray(checkpoint.conversationHistory)
        ? checkpoint.conversationHistory.length
        : 0,
      hasToolState:
        checkpoint.toolState !== null &&
        typeof checkpoint.toolState === "object" &&
        Object.keys(checkpoint.toolState).length > 0,
      hasContextPack:
        checkpoint.contextPack !== undefined &&
        checkpoint.contextPack !== null,
      verification: {
        valid: verification.valid,
        errors: verification.errors,
        warnings: verification.warnings,
      },
    };

    return sendResource(c, "checkpoint", checkpointData, 200, {
      links: {
        self: `${baseUrl}/sessions/${sessionId}/checkpoints/${checkpointId}`,
        restore: `${baseUrl}/sessions/${sessionId}/checkpoints/${checkpointId}/restore`,
        export: `${baseUrl}/sessions/${sessionId}/checkpoints/${checkpointId}/export`,
        delete: `${baseUrl}/sessions/${sessionId}/checkpoints/${checkpointId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/checkpoints/:checkpointId/restore - Restore from checkpoint
 */
checkpoints.post("/:sessionId/checkpoints/:checkpointId/restore", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const checkpointId = c.req.param("checkpointId");

    // Verify the checkpoint belongs to this session before restoring
    const checkpoint = await getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.agentId !== sessionId) {
      return sendNotFound(c, "checkpoint", checkpointId);
    }

    const body = await c.req.json().catch(() => ({}));
    const validated = RestoreCheckpointSchema.parse(body);

    const startTime = Date.now();

    const options: { verify?: boolean; createNew?: boolean } = {};
    if (validated.verify !== undefined) options.verify = validated.verify;
    if (validated.createNew !== undefined)
      options.createNew = validated.createNew;

    const restored = await restoreCheckpoint(checkpointId, options);

    const restorationTimeMs = Date.now() - startTime;

    // Publish WebSocket event
    publishCheckpointEvent(sessionId, "checkpoint.restored", {
      checkpointId,
      sessionId,
      restorationTimeMs,
    });

    const restorationData = {
      checkpointId: restored.id,
      sessionId: restored.agentId,
      createdAt:
        restored.createdAt instanceof Date
          ? restored.createdAt.toISOString()
          : restored.createdAt,
      messageCount: Array.isArray(restored.conversationHistory)
        ? restored.conversationHistory.length
        : 0,
      tokenUsage: restored.tokenUsage,
      restorationTimeMs,
    };

    return sendResource(c, "checkpoint_restoration", restorationData);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /sessions/:sessionId/checkpoints/:checkpointId/export - Export checkpoint
 */
checkpoints.get("/:sessionId/checkpoints/:checkpointId/export", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const checkpointId = c.req.param("checkpointId");

    // First verify the checkpoint belongs to this session
    const checkpoint = await getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.agentId !== sessionId) {
      return sendNotFound(c, "checkpoint", checkpointId);
    }

    const exported = await exportCheckpoint(checkpointId);

    return sendResource(c, "checkpoint_export", exported);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/checkpoints/import - Import checkpoint
 */
checkpoints.post("/:sessionId/checkpoints/import", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json();
    const validated = ImportCheckpointSchema.parse(body);

    // Convert to the expected format with Date objects
    // Explicitly handle optional fields to match exactOptionalPropertyTypes
    const exportedData = {
      version: validated.version,
      exportedAt: validated.exportedAt,
      checkpoint: {
        id: validated.checkpoint.id,
        agentId: validated.checkpoint.agentId,
        createdAt: new Date(validated.checkpoint.createdAt),
        conversationHistory: validated.checkpoint.conversationHistory,
        toolState: validated.checkpoint.toolState,
        tokenUsage: validated.checkpoint.tokenUsage,
        description: validated.checkpoint.description ?? undefined,
        tags: validated.checkpoint.tags ?? undefined,
        contextPack: validated.checkpoint.contextPack ?? undefined,
      },
      hash: validated.hash,
    };

    // Import to this session (override agentId)
    const imported = await importCheckpoint(
      exportedData as Parameters<typeof importCheckpoint>[0],
      sessionId,
    );

    // Publish WebSocket event
    publishCheckpointEvent(sessionId, "checkpoint.imported", {
      checkpointId: imported.id,
      sessionId,
      originalId: validated.checkpoint.id,
    });

    const baseUrl = new URL(c.req.url).origin;

    const checkpointData = {
      id: imported.id,
      sessionId: imported.agentId,
      createdAt: imported.createdAt.toISOString(),
      tokenUsage: imported.tokenUsage,
      description: imported.description,
      tags: imported.tags,
      originalId: validated.checkpoint.id,
    };

    return sendResource(c, "checkpoint", checkpointData, 201, {
      links: {
        self: `${baseUrl}/sessions/${sessionId}/checkpoints/${imported.id}`,
        restore: `${baseUrl}/sessions/${sessionId}/checkpoints/${imported.id}/restore`,
        export: `${baseUrl}/sessions/${sessionId}/checkpoints/${imported.id}/export`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /sessions/:sessionId/checkpoints/:checkpointId - Delete checkpoint
 */
checkpoints.delete("/:sessionId/checkpoints/:checkpointId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const checkpointId = c.req.param("checkpointId");

    // First verify the checkpoint belongs to this session
    const checkpoint = await getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.agentId !== sessionId) {
      return sendNotFound(c, "checkpoint", checkpointId);
    }

    await deleteCheckpoint(checkpointId);

    // Publish WebSocket event
    publishCheckpointEvent(sessionId, "checkpoint.deleted", {
      checkpointId,
      sessionId,
    });

    const deletionData = {
      deleted: true,
      checkpointId,
      sessionId,
    };

    return sendResource(c, "checkpoint_deletion", deletionData);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/checkpoints/prune - Prune old checkpoints
 */
checkpoints.post("/:sessionId/checkpoints/prune", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = PruneCheckpointsSchema.parse(body);

    const deletedCount = await pruneCheckpoints(sessionId, validated.keepCount);

    // Publish WebSocket event
    publishCheckpointEvent(sessionId, "checkpoint.pruned", {
      sessionId,
      deletedCount,
      keepCount: validated.keepCount,
    });

    const pruneResult = {
      pruned: true,
      deletedCount,
      keepCount: validated.keepCount,
      sessionId,
    };

    return sendResource(c, "checkpoint_prune_result", pruneResult);
  } catch (error) {
    return handleError(error, c);
  }
});

export { checkpoints };
