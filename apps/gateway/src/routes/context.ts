/**
 * Context Routes - REST API endpoints for context pack building.
 */

import { Hono, type Context as HonoContext } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  buildContextPack,
  previewContextPack,
  renderContextPack,
} from "../services/context.service";
import type {
  BudgetStrategy,
  ContextPackRequest,
} from "../types/context.types";

const context = new Hono();

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

  log.error({ error, correlationId }, "Unexpected error in context route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
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

    return c.json(
      {
        pack: {
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
        correlationId: getCorrelationId(),
      },
      201,
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

    return c.json({
      preview,
      sessionId,
      correlationId: getCorrelationId(),
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

    return c.json({
      packId: pack.id,
      rendered,
      tokensUsed: pack.budget.used,
      tokensRemaining: pack.budget.remaining,
      buildTimeMs: pack.metadata.buildTimeMs,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleContextError(error, c);
  }
});

export { context };
