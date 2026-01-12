/**
 * Job Routes - REST API endpoints for job orchestration.
 *
 * Provides endpoints for:
 * - Creating and managing long-running jobs
 * - Querying job status and progress
 * - Canceling, pausing, and resuming jobs
 * - Retrieving job output and logs
 */

import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  getJobService,
  JobNotFoundError,
  JobValidationError,
} from "../services/job.service";
import type { JobType, JobPriority, JobStatus } from "../types/job.types";
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

const jobs = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateJobSchema = z.object({
  type: z.enum([
    "context_build",
    "context_compact",
    "codebase_scan",
    "dependency_scan",
    "session_export",
    "bead_export",
    "codebase_import",
    "memory_import",
    "semantic_index",
    "embedding_generate",
    "checkpoint_compact",
    "cache_warm",
  ]),
  name: z.string().min(1).max(255).optional(),
  input: z.record(z.unknown()),
  priority: z.number().min(0).max(3).optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const CancelJobSchema = z.object({
  reason: z.string().max(1000).optional(),
});

const ListJobsQuerySchema = z.object({
  type: z
    .enum([
      "context_build",
      "context_compact",
      "codebase_scan",
      "dependency_scan",
      "session_export",
      "bead_export",
      "codebase_import",
      "memory_import",
      "semantic_index",
      "embedding_generate",
      "checkpoint_compact",
      "cache_warm",
    ])
    .optional(),
  status: z
    .enum(["pending", "running", "paused", "completed", "failed", "cancelled", "timeout"])
    .optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function jobToResponse(job: ReturnType<typeof getJobService>["createJob"] extends (input: unknown) => Promise<infer R> ? R : never) {
  return {
    id: job.id,
    type: job.type,
    name: job.name,
    status: job.status,
    priority: job.priority,
    sessionId: job.sessionId,
    agentId: job.agentId,
    progress: job.progress,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    estimatedDurationMs: job.estimatedDurationMs,
    actualDurationMs: job.actualDurationMs,
    error: job.error,
    retry: {
      attempts: job.retry.attempts,
      maxAttempts: job.retry.maxAttempts,
    },
    cancellation: job.cancellation
      ? {
          requestedAt: job.cancellation.requestedAt.toISOString(),
          requestedBy: job.cancellation.requestedBy,
          reason: job.cancellation.reason,
        }
      : undefined,
    metadata: job.metadata,
    correlationId: job.correlationId,
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /jobs - Create a new job.
 */
jobs.post("/", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const parsed = CreateJobSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const jobService = getJobService();
    const job = await jobService.createJob({
      type: parsed.data.type as JobType,
      name: parsed.data.name,
      input: parsed.data.input,
      priority: parsed.data.priority as JobPriority | undefined,
      sessionId: parsed.data.sessionId,
      agentId: parsed.data.agentId,
      metadata: parsed.data.metadata,
    });

    log.info({ jobId: job.id, type: job.type }, "Job created");

    return sendCreated(c, "job", jobToResponse(job), `/jobs/${job.id}`);
  } catch (error) {
    if (error instanceof JobValidationError) {
      return sendValidationError(
        c,
        error.errors.map((e) => ({ path: "input", message: e })),
      );
    }
    log.error({ error }, "Failed to create job");
    return sendInternalError(c);
  }
});

/**
 * GET /jobs - List jobs with optional filtering.
 */
jobs.get("/", async (c) => {
  const log = getLogger();

  try {
    const query = ListJobsQuerySchema.safeParse(Object.fromEntries(
      new URL(c.req.url).searchParams,
    ));

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const jobService = getJobService();
    const result = await jobService.listJobs({
      type: query.data.type as JobType | undefined,
      status: query.data.status as JobStatus | undefined,
      sessionId: query.data.sessionId,
      agentId: query.data.agentId,
      limit: query.data.limit,
      cursor: query.data.cursor,
    });

    return sendList(
      c,
      result.jobs.map(jobToResponse),
      {
        hasMore: result.hasMore,
        total: result.total,
      },
    );
  } catch (error) {
    log.error({ error }, "Failed to list jobs");
    return sendInternalError(c);
  }
});

/**
 * GET /jobs/:id - Get a specific job.
 */
jobs.get("/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const jobService = getJobService();
    const job = await jobService.getJob(id);

    if (!job) {
      return sendNotFound(c, "job", id);
    }

    return sendResource(c, "job", jobToResponse(job));
  } catch (error) {
    log.error({ error, jobId: id }, "Failed to get job");
    return sendInternalError(c);
  }
});

/**
 * POST /jobs/:id/cancel - Cancel a job.
 */
jobs.post("/:id/cancel", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    let reason: string | undefined;

    // Handle both empty body and JSON body
    const contentType = c.req.header("content-type");
    if (contentType?.includes("application/json")) {
      const body = await c.req.json().catch(() => ({}));
      const parsed = CancelJobSchema.safeParse(body);
      if (parsed.success) {
        reason = parsed.data.reason;
      }
    }

    const jobService = getJobService();
    const job = await jobService.cancelJob(id, reason);

    log.info({ jobId: id }, "Job cancelled");

    return sendResource(c, "job", jobToResponse(job));
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return sendNotFound(c, "job", id);
    }
    log.error({ error, jobId: id }, "Failed to cancel job");
    return sendInternalError(c);
  }
});

/**
 * POST /jobs/:id/retry - Retry a failed job.
 */
jobs.post("/:id/retry", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const jobService = getJobService();
    const job = await jobService.retryJob(id);

    log.info({ jobId: id }, "Job queued for retry");

    return sendResource(c, "job", jobToResponse(job));
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return sendNotFound(c, "job", id);
    }
    if (error instanceof Error && error.message.includes("Cannot retry")) {
      return sendError(c, "INVALID_STATE", error.message, 409, {
        severity: "recoverable",
        hint: "Only failed, cancelled, or timed out jobs can be retried.",
      });
    }
    log.error({ error, jobId: id }, "Failed to retry job");
    return sendInternalError(c);
  }
});

/**
 * POST /jobs/:id/pause - Pause a running job.
 */
jobs.post("/:id/pause", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const jobService = getJobService();
    const job = await jobService.pauseJob(id);

    log.info({ jobId: id }, "Job paused");

    return sendResource(c, "job", jobToResponse(job));
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return sendNotFound(c, "job", id);
    }
    if (error instanceof Error && error.message.includes("Cannot pause")) {
      return sendError(c, "INVALID_STATE", error.message, 409, {
        severity: "recoverable",
        hint: "Only running jobs can be paused.",
      });
    }
    log.error({ error, jobId: id }, "Failed to pause job");
    return sendInternalError(c);
  }
});

/**
 * POST /jobs/:id/resume - Resume a paused job.
 */
jobs.post("/:id/resume", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const jobService = getJobService();
    const job = await jobService.resumeJob(id);

    log.info({ jobId: id }, "Job resumed");

    return sendResource(c, "job", jobToResponse(job));
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return sendNotFound(c, "job", id);
    }
    if (error instanceof Error && error.message.includes("Cannot resume")) {
      return sendError(c, "INVALID_STATE", error.message, 409, {
        severity: "recoverable",
        hint: "Only paused jobs can be resumed.",
      });
    }
    log.error({ error, jobId: id }, "Failed to resume job");
    return sendInternalError(c);
  }
});

/**
 * GET /jobs/:id/output - Get job output.
 */
jobs.get("/:id/output", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const jobService = getJobService();
    const output = await jobService.getJobOutput(id);

    if (output === null) {
      const job = await jobService.getJob(id);
      if (!job) {
        return sendNotFound(c, "job", id);
      }
      // Job exists but has no output yet
      return sendError(c, "NO_OUTPUT", "Job has not produced output yet", 404, {
        severity: "recoverable",
        hint: "Wait for the job to complete or check job status.",
      });
    }

    return sendResource(c, "job_output", { jobId: id, output });
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return sendNotFound(c, "job", id);
    }
    log.error({ error, jobId: id }, "Failed to get job output");
    return sendInternalError(c);
  }
});

/**
 * GET /jobs/:id/logs - Get job logs.
 */
jobs.get("/:id/logs", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const limit = Math.min(
      parseInt(c.req.query("limit") ?? "100", 10) || 100,
      1000,
    );

    const jobService = getJobService();

    // Verify job exists
    const job = await jobService.getJob(id);
    if (!job) {
      return sendNotFound(c, "job", id);
    }

    const logs = await jobService.getJobLogs(id, limit);

    return sendList(
      c,
      logs.map((entry) => ({
        id: entry.id,
        level: entry.level,
        message: entry.message,
        data: entry.data,
        timestamp: entry.timestamp.toISOString(),
        durationMs: entry.durationMs,
      })),
    );
  } catch (error) {
    log.error({ error, jobId: id }, "Failed to get job logs");
    return sendInternalError(c);
  }
});

export default jobs;
