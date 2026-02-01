/**
 * Context Routes - REST API endpoints for context pack building and health monitoring.
 */

import { Hono, type Context as HonoContext } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  buildContextPack,
  previewContextPack,
  renderContextPack,
} from "../services/context.service";
import {
  ContextHealthError,
  getContextHealthService,
  RotationError,
  SummarizationError,
} from "../services/context-health.service";
import type { ContextPackRequest } from "../types/context.types";
import type { RotationConfig } from "../types/context-health.types";
import {
  sendCreated,
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const context = new Hono();
context.use("*", requireAdminMiddleware());

// ============================================================================
// Utilities
// ============================================================================

/**
 * Remove undefined values from an object (for exactOptionalPropertyTypes compatibility).
 */
function removeUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const BudgetStrategySchema = z.object({
  fixed: z
    .object({
      system: z.number().min(0).optional(),
      reserved: z.number().min(0).optional(),
    })
    .optional(),
  proportional: z
    .object({
      triage: z.number().min(0).max(1).optional(),
      memory: z.number().min(0).max(1).optional(),
      search: z.number().min(0).max(1).optional(),
      history: z.number().min(0).max(1).optional(),
    })
    .optional(),
  minimums: z
    .object({
      triage: z.number().min(0).optional(),
      memory: z.number().min(0).optional(),
      search: z.number().min(0).optional(),
      history: z.number().min(0).optional(),
    })
    .optional(),
  priority: z
    .array(z.enum(["triage", "memory", "search", "history"]))
    .length(4)
    .optional(),
});

const ContextBuildRequestSchema = z.object({
  maxTokens: z.number().min(1000).max(500000).optional(),
  strategy: BudgetStrategySchema.optional(),
  taskContext: z.string().optional(),
  searchQuery: z.string().optional(),
  model: z.string().optional(),
  triageOptions: z
    .object({
      maxBeads: z.number().min(1).max(100).optional(),
      minScore: z.number().min(0).max(1).optional(),
    })
    .optional(),
  searchOptions: z
    .object({
      maxResults: z.number().min(1).max(50).optional(),
      minScore: z.number().min(0).max(1).optional(),
    })
    .optional(),
  historyOptions: z
    .object({
      maxEntries: z.number().min(1).max(100).optional(),
      maxAgeMs: z.number().min(0).optional(),
      includeSystem: z.boolean().optional(),
    })
    .optional(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleContextError(error: unknown, c: HonoContext) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  log.error({ error }, "Unexpected error in context route");
  return sendInternalError(c);
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /sessions/:sessionId/context/build - Build a context pack
 */
context.post("/:sessionId/context/build", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = ContextBuildRequestSchema.parse(body);

    const request = {
      sessionId,
      ...removeUndefined(validated),
    } as ContextPackRequest;

    const pack = await buildContextPack(request);

    return sendCreated(
      c,
      "context_pack",
      {
        id: pack.id,
        sessionId: pack.sessionId,
        createdAt: pack.createdAt.toISOString(),
        budget: pack.budget,
        sections: {
          triage: {
            beadCount: pack.sections.triage.beads.length,
            totalTokens: pack.sections.triage.totalTokens,
            truncated: pack.sections.triage.truncated,
          },
          memory: {
            ruleCount: pack.sections.memory.rules.length,
            totalTokens: pack.sections.memory.totalTokens,
            categories: pack.sections.memory.categories,
          },
          search: {
            resultCount: pack.sections.search.results.length,
            totalTokens: pack.sections.search.totalTokens,
            query: pack.sections.search.query,
          },
          history: {
            entryCount: pack.sections.history.entries.length,
            totalTokens: pack.sections.history.totalTokens,
          },
          system: {
            totalTokens: pack.sections.system.totalTokens,
          },
        },
        metadata: pack.metadata,
      },
      `/sessions/${sessionId}/context/${pack.id}`,
    );
  } catch (error) {
    return handleContextError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/context/preview - Preview context pack (dry run)
 */
context.post("/:sessionId/context/preview", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = ContextBuildRequestSchema.parse(body);

    const request = {
      sessionId,
      ...removeUndefined(validated),
    } as ContextPackRequest;

    const preview = await previewContextPack(request);

    return sendResource(c, "context_preview", {
      sessionId,
      preview,
    });
  } catch (error) {
    return handleContextError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/context/render - Build and render to prompt
 */
context.post("/:sessionId/context/render", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = ContextBuildRequestSchema.parse(body);

    const request = {
      sessionId,
      ...removeUndefined(validated),
    } as ContextPackRequest;

    const pack = await buildContextPack(request);
    const rendered = renderContextPack(pack);

    return sendResource(c, "context_render", {
      packId: pack.id,
      rendered,
      tokensUsed: pack.budget.used,
      tokensRemaining: pack.budget.remaining,
      buildTimeMs: pack.metadata.buildTimeMs,
    });
  } catch (error) {
    return handleContextError(error, c);
  }
});

// ============================================================================
// Health Monitoring Routes
// ============================================================================

const CompactRequestSchema = z.object({
  strategy: z.enum(["summarize", "prune", "both"]).optional(),
  targetReduction: z.number().min(0).max(1).optional(),
});

const RotateRequestSchema = z.object({
  reason: z.enum(["context_overflow", "manual", "scheduled"]).optional(),
  config: z
    .object({
      triggers: z
        .object({
          contextPercentage: z.number().min(50).max(100).optional(),
        })
        .optional(),
      transfer: z
        .object({
          includeFullSummary: z.boolean().optional(),
          includeRecentMessages: z.number().min(0).max(100).optional(),
          includeActiveBeads: z.boolean().optional(),
          includeMemoryRules: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * GET /sessions/:sessionId/context/health - Get context health status
 */
context.get("/:sessionId/context/health", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const healthService = getContextHealthService();

    // Try to get cached health first, or do a fresh check
    let health = healthService.getCachedHealth(sessionId);
    if (!health) {
      health = await healthService.checkHealth(sessionId);
    }

    return sendResource(c, "context_health", {
      sessionId: health.sessionId,
      status: health.status,
      currentTokens: health.currentTokens,
      maxTokens: health.maxTokens,
      percentUsed: health.percentUsed,
      projectedOverflowInMessages: health.projectedOverflowInMessages,
      estimatedTimeToWarning: health.estimatedTimeToWarning,
      lastCompaction: health.lastCompaction?.toISOString() ?? null,
      lastRotation: health.lastRotation?.toISOString() ?? null,
      recommendations: health.recommendations,
      checkedAt: health.checkedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof ContextHealthError) {
      return sendNotFound(c, "session", c.req.param("sessionId"));
    }
    return handleContextError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/context/compact - Trigger manual compaction
 */
context.post("/:sessionId/context/compact", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = CompactRequestSchema.parse(body);

    const healthService = getContextHealthService();
    const result = await healthService.compact(sessionId, {
      ...(validated.strategy && { strategy: validated.strategy }),
      ...(validated.targetReduction !== undefined && {
        targetReduction: validated.targetReduction,
      }),
    });

    return sendResource(c, "compaction_result", {
      sessionId,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      reduction: result.reduction,
      reductionPercent: result.reductionPercent,
      summarizedSections: result.summarizedSections,
      preservedSections: result.preservedSections,
      appliedAt: result.appliedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof SummarizationError) {
      return sendNotFound(c, "session", c.req.param("sessionId"));
    }
    return handleContextError(error, c);
  }
});

/**
 * POST /sessions/:sessionId/context/rotate - Trigger manual rotation
 */
context.post("/:sessionId/context/rotate", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const validated = RotateRequestSchema.parse(body);

    const healthService = getContextHealthService();
    const result = await healthService.rotate(sessionId, {
      ...(validated.reason && { reason: validated.reason }),
      ...(validated.config && {
        config: validated.config as Partial<RotationConfig>,
      }),
    });

    return sendCreated(
      c,
      "rotation_result",
      {
        sourceSessionId: sessionId,
        newSessionId: result.newSessionId,
        checkpointId: result.checkpointId,
        reason: result.reason,
        transfer: {
          sourceTokens: result.transfer.sourceTokens,
          transferTokens: result.transfer.transferTokens,
          compressionRatio: result.transfer.compressionRatio,
        },
        rotatedAt: result.rotatedAt.toISOString(),
      },
      `/sessions/${result.newSessionId}`,
    );
  } catch (error) {
    if (error instanceof RotationError) {
      if (error.message.includes("not found")) {
        return sendNotFound(c, "session", c.req.param("sessionId"));
      }
      if (error.message.includes("already rotated")) {
        return sendError(
          c,
          "SESSION_ALREADY_ROTATED",
          "Session has already been rotated to a new session",
          409,
          { severity: "terminal" },
        );
      }
    }
    return handleContextError(error, c);
  }
});

/**
 * GET /sessions/:sessionId/context/history - Get token history
 */
context.get("/:sessionId/context/history", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const sinceParam = c.req.query("since");
    const limitParam = c.req.query("limit");

    const sinceDate = sinceParam ? new Date(sinceParam) : undefined;
    const since =
      sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined;
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 100;
    const limit = Number.isNaN(parsedLimit) ? 100 : parsedLimit;

    const healthService = getContextHealthService();
    const history = healthService.getHistory(sessionId, {
      limit,
      ...(since && { since }),
    });

    return sendList(
      c,
      history.map((entry) => ({
        timestamp: entry.timestamp.toISOString(),
        tokens: entry.tokens,
        delta: entry.delta,
        event: entry.event,
      })),
      { total: history.length },
    );
  } catch (error) {
    return handleContextError(error, c);
  }
});

export { context };
