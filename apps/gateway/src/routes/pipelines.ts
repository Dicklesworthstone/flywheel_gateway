/**
 * Pipelines Routes - REST API endpoints for pipeline management.
 *
 * Provides endpoints for:
 * - Creating and managing pipelines
 * - Running, pausing, resuming, and cancelling pipelines
 * - Viewing pipeline run history
 * - Submitting approvals for approval steps
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  type CreatePipelineInput,
  type PipelineStatus,
  serializePipeline,
  serializeRun,
  type UpdatePipelineInput,
} from "../models/pipeline";
import {
  cancelRun,
  createPipeline,
  deletePipeline,
  getPipeline,
  getRun,
  isSafePipelineContextKey,
  isSafePipelineContextPath,
  isSafeTransformExpression,
  listPipelines,
  listRuns,
  pauseRun,
  resumeRun,
  runPipeline,
  submitApproval,
  TRANSFORM_MAP_ALLOWED_IDENTIFIERS,
  TRANSFORM_REDUCE_ALLOWED_IDENTIFIERS,
  updatePipeline,
} from "../services/pipeline.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";
import type { AuthContext } from "../ws/hub";

const pipelines = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const StepConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_task"),
    config: z.object({
      prompt: z.string().min(1),
      workingDirectory: z.string().optional(),
      systemPrompt: z.string().optional(),
      timeout: z.number().positive().optional(),
      maxTokens: z.number().positive().optional(),
      waitForCompletion: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("conditional"),
    config: z.object({
      condition: z.string().min(1),
      thenSteps: z.array(z.string().min(1)).min(1),
      elseSteps: z.array(z.string().min(1)).optional(),
    }),
  }),
  z.object({
    type: z.literal("parallel"),
    config: z.object({
      steps: z.array(z.string().min(1)).min(1),
      failFast: z.boolean().optional(),
      maxConcurrency: z.number().positive().optional(),
    }),
  }),
  z.object({
    type: z.literal("approval"),
    config: z.object({
      approvers: z.array(z.string().min(1)).min(1),
      message: z.string().min(1),
      timeout: z.number().positive().optional(),
      onTimeout: z.enum(["approve", "reject", "fail"]).optional(),
      minApprovals: z.number().positive().optional(),
    }),
  }),
  z.object({
    type: z.literal("script"),
    config: z.object({
      script: z.string().min(1),
      isPath: z.boolean().optional(),
      workingDirectory: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      timeout: z.number().positive().optional(),
      shell: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("loop"),
    config: z.object({
      mode: z.enum(["for_each", "while", "until", "times"]),
      collection: z.string().optional(),
      condition: z.string().optional(),
      count: z.number().positive().optional(),
      maxIterations: z.number().positive(),
      parallel: z.boolean().optional(),
      parallelLimit: z.number().positive().optional(),
      itemVariable: z.string().min(1).refine(isSafePipelineContextKey, {
        message: "Unsafe itemVariable",
      }),
      indexVariable: z.string().min(1).refine(isSafePipelineContextKey, {
        message: "Unsafe indexVariable",
      }),
      steps: z.array(z.string().min(1)).min(1),
      outputVariable: z.string().min(1).refine(isSafePipelineContextKey, {
        message: "Unsafe outputVariable",
      }),
    }),
  }),
  z.object({
    type: z.literal("wait"),
    config: z.object({
      mode: z.enum(["duration", "until", "webhook"]),
      duration: z.number().positive().optional(),
      until: z.string().optional(),
      webhookToken: z.string().optional(),
      timeout: z.number().positive(),
    }),
  }),
  z.object({
    type: z.literal("transform"),
    config: z.object({
      operations: z
        .array(
          z.union([
            z.object({
              op: z.literal("set"),
              path: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe path",
              }),
              value: z.unknown(),
            }),
            z.object({
              op: z.literal("delete"),
              path: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe path",
              }),
            }),
            z.object({
              op: z.literal("merge"),
              source: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe source path",
              }),
              target: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe target path",
              }),
            }),
            z.object({
              op: z.literal("map"),
              source: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe source path",
              }),
              expression: z
                .string()
                .min(1)
                .max(512)
                .refine(
                  (expr) =>
                    isSafeTransformExpression(
                      expr,
                      TRANSFORM_MAP_ALLOWED_IDENTIFIERS,
                    ),
                  { message: "Invalid transform expression" },
                ),
              target: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe target path",
              }),
            }),
            z.object({
              op: z.literal("filter"),
              source: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe source path",
              }),
              condition: z
                .string()
                .min(1)
                .max(512)
                .refine(
                  (expr) =>
                    isSafeTransformExpression(
                      expr,
                      TRANSFORM_MAP_ALLOWED_IDENTIFIERS,
                    ),
                  { message: "Invalid transform condition" },
                ),
              target: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe target path",
              }),
            }),
            z.object({
              op: z.literal("reduce"),
              source: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe source path",
              }),
              expression: z
                .string()
                .min(1)
                .max(512)
                .refine(
                  (expr) =>
                    isSafeTransformExpression(
                      expr,
                      TRANSFORM_REDUCE_ALLOWED_IDENTIFIERS,
                    ),
                  { message: "Invalid transform expression" },
                ),
              initial: z.unknown(),
              target: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe target path",
              }),
            }),
            z.object({
              op: z.literal("extract"),
              source: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe source path",
              }),
              query: z.string().min(1),
              target: z.string().min(1).refine(isSafePipelineContextPath, {
                message: "Unsafe target path",
              }),
            }),
          ]),
        )
        .min(1),
      outputVariable: z.string().min(1).refine(isSafePipelineContextPath, {
        message: "Unsafe outputVariable",
      }),
    }),
  }),
  z.object({
    type: z.literal("webhook"),
    config: z.object({
      url: z.string().min(1),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
      auth: z
        .object({
          type: z.enum(["none", "basic", "bearer", "api_key"]),
          username: z.string().optional(),
          password: z.string().optional(),
          token: z.string().optional(),
          headerName: z.string().optional(),
          apiKey: z.string().optional(),
        })
        .optional(),
      validateStatus: z.array(z.number()).optional(),
      timeout: z.number().positive().optional(),
      outputVariable: z.string().min(1).refine(isSafePipelineContextKey, {
        message: "Unsafe outputVariable",
      }),
      extractFields: z.record(z.string(), z.string()).optional(),
    }),
  }),
  z.object({
    type: z.literal("sub_pipeline"),
    config: z.object({
      pipelineId: z.string().min(1),
      version: z.number().positive().optional(),
      inputs: z.record(z.string(), z.unknown()),
      waitForCompletion: z.boolean().optional(),
      timeout: z.number().positive().optional(),
      outputVariable: z.string().min(1).refine(isSafePipelineContextKey, {
        message: "Unsafe outputVariable",
      }),
    }),
  }),
]);

const TriggerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("manual"),
    config: z.object({
      description: z.string().optional(),
      requiredParams: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    type: z.literal("schedule"),
    config: z.object({
      cron: z.string().min(1),
      timezone: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("webhook"),
    config: z.object({
      secret: z.string().optional(),
      expectedHeaders: z.record(z.string(), z.string()).optional(),
      payloadMapping: z.record(z.string(), z.string()).optional(),
    }),
  }),
  z.object({
    type: z.literal("bead_event"),
    config: z.object({
      events: z
        .array(z.enum(["created", "updated", "closed", "assigned"]))
        .min(1),
      beadType: z.array(z.string()).optional(),
      beadPriority: z.array(z.number()).optional(),
      beadLabels: z.array(z.string()).optional(),
    }),
  }),
]);

const RetryPolicySchema = z.object({
  maxRetries: z.number().min(0).max(10),
  initialDelay: z.number().positive(),
  maxDelay: z.number().positive(),
  multiplier: z.number().positive().optional(),
  retryableErrors: z.array(z.string()).optional(),
});

const StepSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  type: z.enum([
    "agent_task",
    "conditional",
    "parallel",
    "approval",
    "script",
    "loop",
    "wait",
    "transform",
    "webhook",
    "sub_pipeline",
  ]),
  config: StepConfigSchema,
  dependsOn: z.array(z.string()).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  condition: z.string().optional(),
  continueOnFailure: z.boolean().optional(),
  timeout: z.number().positive().optional(),
});

const CreatePipelineSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  trigger: z.object({
    type: z.enum(["manual", "schedule", "webhook", "bead_event"]),
    config: TriggerConfigSchema,
    enabled: z.boolean().optional(),
  }),
  steps: z.array(StepSchema).min(1),
  contextDefaults: z.record(z.string(), z.unknown()).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  tags: z.array(z.string().max(50)).optional(),
  ownerId: z.string().optional(),
});

const UpdatePipelineSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  trigger: z
    .object({
      type: z.enum(["manual", "schedule", "webhook", "bead_event"]).optional(),
      config: TriggerConfigSchema.optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
  steps: z.array(StepSchema).min(1).optional(),
  contextDefaults: z.record(z.string(), z.unknown()).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  tags: z.array(z.string().max(50)).optional(),
});

const RunPipelineSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
});

const ApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(1000).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof Error && error.message.includes("not found")) {
    return sendNotFound(c, "pipeline", "unknown");
  }

  log.error({ error }, "[PIPELINE] Unexpected error in pipelines route");
  return sendInternalError(c);
}

function parseArrayQuery<T extends string>(
  value: string | undefined,
): T[] | undefined {
  return value ? (value.split(",") as T[]) : undefined;
}

function parseDateQuery(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function resolveOptionalUserId(c: Context): { userId?: string } | Response {
  const auth = c.get("auth") as AuthContext | undefined;
  const requested = c.req.query("user_id");

  if (!auth) {
    return requested ? { userId: requested } : {};
  }

  if (auth.isAdmin) {
    const adminUserId = requested ?? auth.userId;
    return adminUserId ? { userId: adminUserId } : {};
  }

  if (!auth.userId) {
    return sendError(
      c,
      "AUTH_INSUFFICIENT_SCOPE",
      "User identity required",
      403,
    );
  }

  if (requested && requested !== auth.userId) {
    return sendError(
      c,
      "AUTH_INSUFFICIENT_SCOPE",
      "Cannot act on behalf of another user",
      403,
    );
  }

  return { userId: auth.userId };
}

function resolveRequiredUserId(c: Context): string | Response {
  const resolved = resolveOptionalUserId(c);
  if (resolved instanceof Response) return resolved;
  if (!resolved.userId) {
    return sendError(c, "INVALID_REQUEST", "user_id is required", 400);
  }
  return resolved.userId;
}

async function parseOptionalJson(c: Context): Promise<unknown | Response> {
  try {
    const raw = await c.req.text();
    if (!raw.trim()) return {};
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return sendError(
        c,
        "INVALID_REQUEST",
        "Invalid JSON in request body",
        400,
      );
    }
    return sendInternalError(c);
  }
}

// ============================================================================
// Pipeline CRUD Routes
// ============================================================================

/**
 * GET /pipelines - List all pipelines
 *
 * Query parameters:
 * - tags: Filter by tags (comma-separated)
 * - enabled: Filter by enabled status (true/false)
 * - owner_id: Filter by owner
 * - search: Search by name/description
 * - limit: Max results (default: 50)
 * - cursor: Cursor for pagination
 */
pipelines.get("/", (c) => {
  try {
    const enabledParam = c.req.query("enabled");
    const tagsParam = parseArrayQuery(c.req.query("tags"));
    const ownerIdParam = c.req.query("owner_id");
    const searchParam = c.req.query("search");
    const cursorParam = c.req.query("cursor");

    const filter: Parameters<typeof listPipelines>[0] = {
      limit: safeParseInt(c.req.query("limit"), 50),
    };
    if (tagsParam) filter.tags = tagsParam;
    if (enabledParam) filter.enabled = enabledParam === "true";
    if (ownerIdParam) filter.ownerId = ownerIdParam;
    if (searchParam) filter.search = searchParam;
    if (cursorParam) filter.cursor = cursorParam;

    const result = listPipelines(filter);

    const serializedPipelines = result.pipelines.map(serializePipeline);

    return sendList(c, serializedPipelines, {
      hasMore: result.hasMore,
      total: result.total,
      ...(result.nextCursor && { nextCursor: result.nextCursor }),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /pipelines - Create a new pipeline
 */
pipelines.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreatePipelineSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const pipeline = createPipeline(parsed.data as CreatePipelineInput);

    return sendResource(c, "pipeline", serializePipeline(pipeline), 201);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /pipelines/:id - Get a specific pipeline
 */
pipelines.get("/:id", (c) => {
  try {
    const id = c.req.param("id");
    const pipeline = getPipeline(id);

    if (!pipeline) {
      return sendNotFound(c, "pipeline", id);
    }

    return sendResource(c, "pipeline", serializePipeline(pipeline));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PUT /pipelines/:id - Update a pipeline
 */
pipelines.put("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = UpdatePipelineSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const pipeline = updatePipeline(id, parsed.data as UpdatePipelineInput);

    if (!pipeline) {
      return sendNotFound(c, "pipeline", id);
    }

    return sendResource(c, "pipeline", serializePipeline(pipeline));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /pipelines/:id - Delete a pipeline
 */
pipelines.delete("/:id", (c) => {
  try {
    const id = c.req.param("id");
    const deleted = deletePipeline(id);

    if (!deleted) {
      return sendNotFound(c, "pipeline", id);
    }

    return sendResource(c, "delete_result", { id, deleted: true });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Pipeline Execution Routes
// ============================================================================

/**
 * POST /pipelines/:id/run - Start a pipeline run
 */
pipelines.post("/:id/run", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await parseOptionalJson(c);
    if (body instanceof Response) return body;
    const parsed = RunPipelineSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const resolvedUser = resolveOptionalUserId(c);
    if (resolvedUser instanceof Response) return resolvedUser;
    const userId = resolvedUser.userId;

    const options: Parameters<typeof runPipeline>[1] = {
      triggeredBy: userId ? { type: "user", id: userId } : { type: "api" },
    };
    if (parsed.data.params) {
      options.params = parsed.data.params;
    }

    const run = await runPipeline(id, options);

    return sendResource(c, "pipeline_run", serializeRun(run), 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return sendNotFound(c, "pipeline", c.req.param("id"));
    }
    if (error instanceof Error && error.message.includes("disabled")) {
      return sendError(c, "PIPELINE_DISABLED", error.message, 400);
    }
    return handleError(error, c);
  }
});

/**
 * POST /pipelines/:id/pause - Pause a running pipeline
 */
pipelines.post("/:id/pause", (c) => {
  try {
    const runId = c.req.query("run_id");

    if (!runId) {
      return sendError(c, "INVALID_REQUEST", "run_id is required", 400);
    }

    const run = pauseRun(runId);

    if (!run) {
      return sendError(
        c,
        "INVALID_STATE",
        "Run is not in running state or not found",
        400,
      );
    }

    return sendResource(c, "pipeline_run", serializeRun(run));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /pipelines/:id/resume - Resume a paused pipeline
 */
pipelines.post("/:id/resume", async (c) => {
  try {
    const runId = c.req.query("run_id");

    if (!runId) {
      return sendError(c, "INVALID_REQUEST", "run_id is required", 400);
    }

    const run = await resumeRun(runId);

    if (!run) {
      return sendError(
        c,
        "INVALID_STATE",
        "Run is not in paused state or not found",
        400,
      );
    }

    return sendResource(c, "pipeline_run", serializeRun(run));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /pipelines/:id/cancel - Cancel a running or paused pipeline
 */
pipelines.post("/:id/cancel", (c) => {
  try {
    const runId = c.req.query("run_id");

    if (!runId) {
      return sendError(c, "INVALID_REQUEST", "run_id is required", 400);
    }

    const run = cancelRun(runId);

    if (!run) {
      return sendError(
        c,
        "INVALID_STATE",
        "Run is not in running or paused state or not found",
        400,
      );
    }

    return sendResource(c, "pipeline_run", serializeRun(run));
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Pipeline Run History Routes
// ============================================================================

/**
 * GET /pipelines/:id/runs - Get run history for a pipeline
 *
 * Query parameters:
 * - status: Filter by status (comma-separated)
 * - since: Filter by start date (ISO 8601)
 * - until: Filter by end date (ISO 8601)
 * - limit: Max results (default: 50)
 * - cursor: Cursor for pagination
 */
pipelines.get("/:id/runs", (c) => {
  try {
    const id = c.req.param("id");

    // Verify pipeline exists
    const pipeline = getPipeline(id);
    if (!pipeline) {
      return sendNotFound(c, "pipeline", id);
    }

    const result = listRuns(id, {
      status: parseArrayQuery<PipelineStatus>(c.req.query("status")),
      since: parseDateQuery(c.req.query("since")),
      until: parseDateQuery(c.req.query("until")),
      limit: safeParseInt(c.req.query("limit"), 50),
      cursor: c.req.query("cursor"),
    });

    const serializedRuns = result.runs.map(serializeRun);

    return sendList(c, serializedRuns, {
      hasMore: result.hasMore,
      total: result.total,
      ...(result.nextCursor && { nextCursor: result.nextCursor }),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /pipelines/:id/runs/:runId - Get a specific run
 */
pipelines.get("/:id/runs/:runId", (c) => {
  try {
    const pipelineId = c.req.param("id");
    const runId = c.req.param("runId");

    // Verify pipeline exists
    const pipeline = getPipeline(pipelineId);
    if (!pipeline) {
      return sendNotFound(c, "pipeline", pipelineId);
    }

    const run = getRun(runId);
    if (!run || run.pipelineId !== pipelineId) {
      return sendNotFound(c, "pipeline_run", runId);
    }

    // Include step details in the response
    return sendResource(c, "pipeline_run", {
      ...serializeRun(run),
      steps: pipeline.steps.map((step) => ({
        id: step.id,
        name: step.name,
        type: step.type,
        status: step.status,
        result: step.result,
        ...(step.startedAt && { startedAt: step.startedAt.toISOString() }),
        ...(step.completedAt && {
          completedAt: step.completedAt.toISOString(),
        }),
      })),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Approval Routes
// ============================================================================

/**
 * POST /pipelines/:id/runs/:runId/approve - Submit an approval decision
 */
pipelines.post("/:id/runs/:runId/approve", async (c) => {
  try {
    const pipelineId = c.req.param("id");
    const runId = c.req.param("runId");
    const stepId = c.req.query("step_id");

    if (!stepId) {
      return sendError(c, "INVALID_REQUEST", "step_id is required", 400);
    }

    const userId = resolveRequiredUserId(c);
    if (userId instanceof Response) return userId;

    const body = await c.req.json();
    const parsed = ApprovalSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    // Verify pipeline and run exist
    const pipeline = getPipeline(pipelineId);
    if (!pipeline) {
      return sendNotFound(c, "pipeline", pipelineId);
    }

    const run = getRun(runId);
    if (!run || run.pipelineId !== pipelineId) {
      return sendNotFound(c, "pipeline_run", runId);
    }

    // Submit the approval
    const success = submitApproval(runId, stepId, {
      userId,
      decision: parsed.data.decision,
      comment: parsed.data.comment,
      timestamp: new Date(),
    });

    if (!success) {
      return sendError(
        c,
        "APPROVAL_NOT_PENDING",
        "No pending approval found for this step",
        400,
      );
    }

    return sendResource(c, "approval_result", {
      runId,
      stepId,
      decision: parsed.data.decision,
      submittedBy: userId,
      submittedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { pipelines };
