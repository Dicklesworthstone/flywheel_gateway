/**
 * Job Routes - REST API endpoints for job orchestration.
 *
 * Provides endpoints for:
 * - Creating and managing long-running jobs
 * - Querying job status and progress
 * - Canceling, pausing, and resuming jobs
 * - Retrieving job output and logs
 */

import { parseListQuery } from "@flywheel/shared/api/pagination";
import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  getJobService,
  JobNotFoundError,
  JobValidationError,
} from "../services/job.service";
import type { Job, JobPriority, JobStatus, JobType } from "../types/job.types";
import { getLinkContext, jobLinks, jobListLinks } from "../utils/links";
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
  input: z.record(z.string(), z.unknown()),
  priority: z.number().min(0).max(3).optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    .enum([
      "pending",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
      "timeout",
    ])
    .optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function jobToResponse(job: Job) {
  const {
    id,
    type,
    name,
    status,
    priority,
    sessionId,
    agentId,
    progress,
    createdAt,
    startedAt,
    completedAt,
    estimatedDurationMs,
    actualDurationMs,
    error,
    retry,
    cancellation,
    metadata,
    correlationId,
  } = job;

  const cancellationResponse = cancellation
    ? {
        requestedAt: cancellation.requestedAt.toISOString(),
        requestedBy: cancellation.requestedBy,
        reason: cancellation.reason,
      }
    : undefined;

  return {
    id,
    type,
    name,
    status,
    priority,
    sessionId,
    agentId,
    progress,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString(),
    completedAt: completedAt?.toISOString(),
    estimatedDurationMs,
    actualDurationMs,
    error,
    retry: {
      attempts: retry.attempts,
      maxAttempts: retry.maxAttempts,
    },
    cancellation: cancellationResponse,
    metadata,
    correlationId,
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
      input: parsed.data.input,
      ...(parsed.data.name && { name: parsed.data.name }),
      ...(parsed.data.priority !== undefined && {
        priority: parsed.data.priority as JobPriority,
      }),
      ...(parsed.data.sessionId && { sessionId: parsed.data.sessionId }),
      ...(parsed.data.agentId && { agentId: parsed.data.agentId }),
      ...(parsed.data.metadata && { metadata: parsed.data.metadata }),
    });

    log.info({ jobId: job.id, type: job.type }, "Job created");

    const ctx = getLinkContext(c);
    return sendCreated(
      c,
      "job",
      {
        ...jobToResponse(job),
        links: jobLinks({ id: job.id }, ctx),
      },
      `/jobs/${job.id}`,
    );
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
    const query = ListJobsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const listQuery = parseListQuery(
      {
        limit: c.req.query("limit"),
        cursor: c.req.query("cursor"),
      },
      { defaultLimit: 20, maxLimit: 100 },
    );

    const jobService = getJobService();
    const result = await jobService.listJobs({
      limit: listQuery.limit,
      ...(query.data.type && { type: query.data.type as JobType }),
      ...(query.data.status && { status: query.data.status as JobStatus }),
      ...(query.data.sessionId && { sessionId: query.data.sessionId }),
      ...(query.data.agentId && { agentId: query.data.agentId }),
      ...(listQuery.cursor && { cursor: listQuery.cursor }),
    });

    const ctx = getLinkContext(c);
    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.hasMore,
      total: result.total,
    };
    if (result.nextCursor) listOptions.nextCursor = result.nextCursor;

    return sendList(
      c,
      result.jobs.map((job) => ({
        ...jobToResponse(job),
        links: jobListLinks({ id: job.id }, ctx),
      })),
      listOptions,
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

    const ctx = getLinkContext(c);
    return sendResource(c, "job", jobToResponse(job), 200, {
      links: jobLinks({ id: job.id }, ctx),
    });
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

    const ctx = getLinkContext(c);
    return sendResource(c, "job", jobToResponse(job), 200, {
      links: jobLinks({ id: job.id }, ctx),
    });
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

    const ctx = getLinkContext(c);
    return sendResource(c, "job", jobToResponse(job), 200, {
      links: jobLinks({ id: job.id }, ctx),
    });
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

    const ctx = getLinkContext(c);
    return sendResource(c, "job", jobToResponse(job), 200, {
      links: jobLinks({ id: job.id }, ctx),
    });
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

    const ctx = getLinkContext(c);
    return sendResource(c, "job", jobToResponse(job), 200, {
      links: jobLinks({ id: job.id }, ctx),
    });
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

    const ctx = getLinkContext(c);
    return sendResource(c, "job_output", { jobId: id, output }, 200, {
      links: { job: `${ctx.baseUrl}/jobs/${id}` },
    });
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
