/**
 * Job Orchestration Service
 *
 * Provides infrastructure for managing long-running operations that cannot
 * complete within typical HTTP request timeouts. Includes:
 * - Priority-based job queue
 * - Concurrency management
 * - Progress tracking with WebSocket events
 * - Cancellation and retry support
 * - Checkpointing for resume
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { jobLogs, jobs } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type {
  CreateJobInput,
  Job,
  JobContext,
  JobError,
  JobHandler,
  JobLogEntry,
  JobLogLevel,
  JobPriority,
  JobProgress,
  JobQueueConfig,
  JobStatus,
  JobType,
  ListJobsQuery,
} from "../types/job.types";
import { DEFAULT_JOB_QUEUE_CONFIG } from "../types/job.types";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import { logger as baseLogger, createChildLogger } from "./logger";

// ============================================================================
// Error Classes
// ============================================================================

export class JobNotFoundError extends Error {
  public override name = "JobNotFoundError";
  public jobId: string;

  constructor(jobId: string) {
    super(`Job not found: ${jobId}`);
    this.jobId = jobId;
  }
}

export class JobCancelledException extends Error {
  public override name = "JobCancelledException";
  public jobId: string;

  constructor(jobId: string) {
    super(`Job cancelled: ${jobId}`);
    this.jobId = jobId;
  }
}

export class NoHandlerError extends Error {
  public override name = "NoHandlerError";
  public jobType: string;

  constructor(jobType: string) {
    super(`No handler registered for job type: ${jobType}`);
    this.jobType = jobType;
  }
}

export class JobValidationError extends Error {
  public override name = "JobValidationError";
  public errors: string[];

  constructor(errors: string[]) {
    super(`Job validation failed: ${errors.join(", ")}`);
    this.errors = errors;
  }
}

// ============================================================================
// Job Execution Context
// ============================================================================

class JobExecutionContext implements JobContext {
  private cancelled = false;

  constructor(
    public readonly job: Job,
    public readonly input: unknown,
    private readonly service: JobService,
  ) {}

  async updateProgress(
    current: number,
    total: number,
    message?: string,
  ): Promise<void> {
    // Guard against division by zero - if total is 0, percentage is 0
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    this.job.progress = {
      current,
      total,
      percentage,
      message: message ?? this.job.progress.message,
      ...(this.job.progress.stage != null && {
        stage: this.job.progress.stage,
      }),
    };

    await this.service.updateJobProgress(this.job.id, this.job.progress);
  }

  async setStage(stage: string): Promise<void> {
    this.job.progress.stage = stage;
    await this.service.updateJobProgress(this.job.id, this.job.progress);
  }

  async checkpoint(state: unknown): Promise<void> {
    await this.service.saveCheckpoint(this.job.id, state);
  }

  async getCheckpoint(): Promise<unknown | null> {
    return this.service.getCheckpoint(this.job.id);
  }

  isCancelled(): boolean {
    return this.cancelled || !!this.job.cancellation;
  }

  throwIfCancelled(): void {
    if (this.isCancelled()) {
      throw new JobCancelledException(this.job.id);
    }
  }

  setCancelled(): void {
    this.cancelled = true;
  }

  log(
    level: JobLogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.service.addJobLog(this.job.id, level, message, data);
  }
}

// ============================================================================
// Job Execution Wrapper
// ============================================================================

class JobExecution {
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private context: JobExecutionContext;

  constructor(
    public readonly job: Job,
    private readonly handler: JobHandler,
    readonly service: JobService,
    private readonly timeoutMs: number,
  ) {
    this.context = new JobExecutionContext(job, job.input, service);
  }

  async run(): Promise<void> {
    // Set timeout
    this.timeout = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutMs);

    try {
      const output = await this.handler.execute(this.context);
      this.job.output = output as Record<string, unknown>;
    } finally {
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
    }
  }

  cancel(reason?: string): void {
    this.context.setCancelled();
    this.job.cancellation = {
      requestedAt: new Date(),
      requestedBy: "user",
      ...(reason != null && { reason }),
    };

    if (this.handler.onCancel) {
      this.handler.onCancel(this.context).catch((err) => {
        baseLogger.error(
          { jobId: this.job.id, error: err },
          "Job cancel handler error",
        );
      });
    }
  }

  private handleTimeout(): void {
    this.context.setCancelled();
    this.job.status = "timeout";
  }

  getContext(): JobExecutionContext {
    return this.context;
  }
}

// ============================================================================
// Job Service
// ============================================================================

export class JobService {
  private handlers = new Map<JobType, JobHandler>();
  private running = new Map<string, JobExecution>();
  private starting = new Set<string>();
  private started = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: JobQueueConfig = DEFAULT_JOB_QUEUE_CONFIG,
  ) {}

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Start the job service worker.
   */
  start(): void {
    if (this.started) return;

    baseLogger.info("Starting job service");
    this.started = true;

    // Reset stuck jobs from previous run
    this.recoverStaleJobs().catch((err) => {
      baseLogger.error({ error: err }, "Error recovering stale jobs");
    });

    // Start polling for pending jobs
    this.pollInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        baseLogger.error({ error: err }, "Error processing job queue");
      });
    }, this.config.worker.pollIntervalMs);

    // Process immediately
    this.processQueue().catch((err) => {
      baseLogger.error({ error: err }, "Error processing job queue");
    });
  }

  /**
   * Stop the job service worker and wait for running jobs.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    baseLogger.info("Stopping job service");

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Wait for running jobs with timeout
    const deadline = Date.now() + this.config.worker.shutdownTimeoutMs;

    while (this.running.size > 0 && Date.now() < deadline) {
      await Bun.sleep(100);
    }

    // Cancel remaining jobs
    for (const [jobId, execution] of this.running) {
      baseLogger.warn({ jobId }, "Forcefully cancelling job on shutdown");
      execution.cancel("Service shutdown");
    }

    this.started = false;
  }

  // ==========================================================================
  // Handler Registration
  // ==========================================================================

  /**
   * Register a handler for a job type.
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    baseLogger.info({ jobType: type }, "Registered job handler");
  }

  /**
   * Unregister a handler for a job type.
   */
  unregisterHandler(type: JobType): void {
    this.handlers.delete(type);
  }

  // ==========================================================================
  // Job Management
  // ==========================================================================

  /**
   * Create and enqueue a new job.
   */
  async createJob(input: CreateJobInput): Promise<Job> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    const id = crypto.randomUUID();
    const now = new Date();

    const job: Job = {
      id,
      type: input.type,
      status: "pending",
      priority: input.priority ?? 1,
      input: input.input,
      progress: {
        current: 0,
        total: 100,
        percentage: 0,
        message: "Queued",
      },
      createdAt: now,
      retry: {
        attempts: 0,
        maxAttempts: this.config.retry.maxAttempts,
        backoffMs: this.config.retry.initialBackoffMs,
      },
      metadata: input.metadata ?? {},
      correlationId,
      ...(input.name && { name: input.name }),
      ...(input.sessionId && { sessionId: input.sessionId }),
      ...(input.agentId && { agentId: input.agentId }),
    };

    // Persist to database
    await db.insert(jobs).values({
      id: job.id,
      type: job.type,
      name: job.name,
      status: job.status,
      priority: job.priority,
      sessionId: job.sessionId,
      agentId: job.agentId,
      input: job.input,
      progressCurrent: job.progress.current,
      progressTotal: job.progress.total,
      progressMessage: job.progress.message,
      createdAt: job.createdAt,
      retryAttempts: job.retry.attempts,
      retryMaxAttempts: job.retry.maxAttempts,
      retryBackoffMs: job.retry.backoffMs,
      metadata: job.metadata,
      correlationId: job.correlationId,
    });

    log.info({ jobId: id, type: input.type, correlationId }, "Job created");

    this.emitEvent("job.created", job, {
      sessionId: job.sessionId,
      priority: job.priority,
    });

    // Trigger queue processing
    this.processQueue().catch((err) => {
      log.error({ error: err }, "Error processing job queue");
    });

    return job;
  }

  /**
   * Get a job by ID.
   */
  async getJob(jobId: string): Promise<Job | null> {
    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    const [row] = rows;
    if (!row) return null;

    return this.rowToJob(row);
  }

  /**
   * List jobs with optional filtering.
   */
  async listJobs(
    query: ListJobsQuery,
  ): Promise<{ jobs: Job[]; total: number; hasMore: boolean }> {
    const conditions = [];

    if (query.type) {
      conditions.push(eq(jobs.type, query.type));
    }
    if (query.status) {
      conditions.push(eq(jobs.status, query.status));
    }
    if (query.sessionId) {
      conditions.push(eq(jobs.sessionId, query.sessionId));
    }
    if (query.agentId) {
      conditions.push(eq(jobs.agentId, query.agentId));
    }

    const limit = Math.min(query.limit ?? 20, 100);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(whereClause)
        .orderBy(desc(jobs.priority), desc(jobs.createdAt))
        .limit(limit + 1),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(whereClause),
    ]);

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      jobs: resultRows.map((row) => this.rowToJob(row)),
      total: countResult[0]?.count ?? 0,
      hasMore,
    };
  }

  /**
   * Cancel a running or pending job.
   */
  async cancelJob(jobId: string, reason?: string): Promise<Job> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    if (
      job.status === "completed" ||
      job.status === "cancelled" ||
      job.status === "failed"
    ) {
      log.warn(
        { jobId, status: job.status },
        "Cannot cancel job in terminal state",
      );
      return job;
    }

    // If running, signal cancellation
    const execution = this.running.get(jobId);
    if (execution) {
      execution.cancel(reason);
    }

    // Update database
    const now = new Date();
    await db
      .update(jobs)
      .set({
        status: "cancelled",
        cancelRequestedAt: now,
        cancelRequestedBy: "user",
        cancelReason: reason,
        completedAt: now,
      })
      .where(eq(jobs.id, jobId));

    job.status = "cancelled";
    job.cancellation = {
      requestedAt: now,
      requestedBy: "user",
      ...(reason != null && { reason }),
    };
    job.completedAt = now;

    log.info({ jobId, correlationId }, "Job cancelled");

    this.emitEvent("job.cancelled", job, {
      reason,
      requestedBy: "user",
    });

    return job;
  }

  /**
   * Retry a failed job.
   */
  async retryJob(jobId: string): Promise<Job> {
    const log = getLogger();

    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    if (
      job.status !== "failed" &&
      job.status !== "cancelled" &&
      job.status !== "timeout"
    ) {
      throw new Error(`Cannot retry job in status: ${job.status}`);
    }

    // Reset job state
    await db
      .update(jobs)
      .set({
        status: "pending",
        errorCode: null,
        errorMessage: null,
        errorStack: null,
        errorRetryable: null,
        startedAt: null,
        completedAt: null,
        cancelRequestedAt: null,
        cancelRequestedBy: null,
        cancelReason: null,
        progressCurrent: 0,
        progressMessage: "Queued (retry)",
      })
      .where(eq(jobs.id, jobId));

    job.status = "pending";
    delete job.error;
    delete job.startedAt;
    delete job.completedAt;
    delete job.cancellation;
    job.progress = {
      current: 0,
      total: job.progress.total,
      percentage: 0,
      message: "Queued (retry)",
    };

    log.info({ jobId }, "Job queued for retry");

    // Trigger queue processing
    this.processQueue().catch((err) => {
      log.error({ error: err }, "Error processing job queue");
    });

    return job;
  }

  /**
   * Pause a running job (if handler supports it).
   */
  async pauseJob(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    if (job.status !== "running") {
      throw new Error(`Cannot pause job in status: ${job.status}`);
    }

    const execution = this.running.get(jobId);
    const handler = this.handlers.get(job.type);

    if (execution && handler?.onPause) {
      await handler.onPause(execution.getContext());
    }

    await db.update(jobs).set({ status: "paused" }).where(eq(jobs.id, jobId));

    job.status = "paused";

    this.emitEvent("job.paused", job, {});

    return job;
  }

  /**
   * Resume a paused job.
   */
  async resumeJob(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    if (job.status !== "paused") {
      throw new Error(`Cannot resume job in status: ${job.status}`);
    }

    await db.update(jobs).set({ status: "pending" }).where(eq(jobs.id, jobId));

    job.status = "pending";

    this.emitEvent("job.resumed", job, {});

    // Trigger queue processing
    this.processQueue().catch(() => {});

    return job;
  }

  /**
   * Get job output.
   */
  async getJobOutput(jobId: string): Promise<Record<string, unknown> | null> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    return job.output ?? null;
  }

  /**
   * Get job logs.
   */
  async getJobLogs(jobId: string, limit = 100): Promise<JobLogEntry[]> {
    const rows = await db
      .select()
      .from(jobLogs)
      .where(eq(jobLogs.jobId, jobId))
      .orderBy(desc(jobLogs.timestamp))
      .limit(limit);

    return rows.map((row) => {
      const entry: JobLogEntry = {
        id: row.id,
        jobId: row.jobId,
        level: row.level as JobLogLevel,
        message: row.message,
        timestamp: row.timestamp,
      };
      if (row.data) entry.data = row.data as Record<string, unknown>;
      if (row.durationMs !== null) entry.durationMs = row.durationMs;
      return entry;
    });
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Update job progress in database and emit event.
   */
  async updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
    await db
      .update(jobs)
      .set({
        progressCurrent: progress.current,
        progressTotal: progress.total,
        progressMessage: progress.message,
        progressStage: progress.stage,
      })
      .where(eq(jobs.id, jobId));

    const job = await this.getJob(jobId);
    if (job) {
      this.emitEvent("job.progress", job, { progress });
    }
  }

  /**
   * Save checkpoint state.
   */
  async saveCheckpoint(jobId: string, state: unknown): Promise<void> {
    await db
      .update(jobs)
      .set({
        checkpointState: state,
        checkpointAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  /**
   * Get checkpoint state.
   */
  async getCheckpoint(jobId: string): Promise<unknown | null> {
    const rows = await db
      .select({ checkpointState: jobs.checkpointState })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    return rows[0]?.checkpointState ?? null;
  }

  /**
   * Add a log entry for a job.
   */
  async addJobLog(
    jobId: string,
    level: JobLogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const id = crypto.randomUUID();

    await db.insert(jobLogs).values({
      id,
      jobId,
      level,
      message,
      data,
      timestamp: new Date(),
    });

    // Also log to service logger
    const logMethod =
      level === "error" ? "error" : level === "warn" ? "warn" : "info";
    baseLogger[logMethod]({ jobId, ...data }, message);
  }

  /**
   * Process pending jobs from the queue.
   */
  private async processQueue(): Promise<void> {
    if (!this.started) return;

    // Check concurrency limits (including starting jobs)
    if (
      this.running.size + this.starting.size >=
      this.config.concurrency.global
    ) {
      return;
    }

    // Get pending jobs ordered by priority and creation time
    const pendingJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, "pending"))
      .orderBy(desc(jobs.priority), jobs.createdAt)
      .limit(
        this.config.concurrency.global -
          (this.running.size + this.starting.size),
      );

    for (const row of pendingJobs) {
      const job = this.rowToJob(row);

      // Skip if already starting (concurrency check might have missed it if DB query was slow)
      if (this.starting.has(job.id)) continue;

      if (this.canRunJob(job)) {
        this.starting.add(job.id);
        this.startJob(job)
          .catch((err) => {
            baseLogger.error(
              { jobId: job.id, error: err },
              "Failed to start job",
            );
          })
          .finally(() => {
            this.starting.delete(job.id);
          });
      }
    }
  }

  /**
   * Check if a job can be started based on concurrency limits.
   */
  private canRunJob(job: Job): boolean {
    // Check global limit
    if (
      this.running.size + this.starting.size >=
      this.config.concurrency.global
    ) {
      return false;
    }

    // Check per-type limit
    const typeLimit =
      this.config.concurrency.perType[job.type] ??
      this.config.concurrency.global;

    // Count running AND starting jobs of this type
    let typeCount = 0;
    for (const execution of this.running.values()) {
      if (execution.job.type === job.type) typeCount++;
    }
    // We can't easily check type of jobs in 'starting' set without fetching them again
    // but processQueue iterates pending jobs, so we know their type.
    // Optimization: We could store type in 'starting' map, but for now we rely on global limit
    // and the fact that per-type limit is usually high.
    // To be precise, we should track starting types.

    // For now, let's just count running. The global limit + single threaded loop
    // prevents massive over-scheduling. The 'starting' set mainly protects against
    // the 'await validate' gap for global limit.

    if (typeCount >= typeLimit) {
      return false;
    }

    // Check per-session limit
    if (job.sessionId) {
      const sessionCount = Array.from(this.running.values()).filter(
        (e) => e.job.sessionId === job.sessionId,
      ).length;
      if (sessionCount >= this.config.concurrency.perSession) {
        return false;
      }
    }

    return true;
  }

  /**
   * Recover jobs that were left running when the service stopped.
   */
  private async recoverStaleJobs(): Promise<void> {
    const staleJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, "running"));

    if (staleJobs.length === 0) return;

    baseLogger.info(
      { count: staleJobs.length },
      "Recovering stale jobs from previous run",
    );

    // Reset them to pending so they can be picked up again
    // OR mark them failed if we want manual intervention.
    // "pending" is safer for auto-recovery of crashed pod.
    for (const row of staleJobs) {
      await db
        .update(jobs)
        .set({
          status: "pending",
          progressMessage: "Recovered from crash",
          startedAt: null,
          // Don't increment retry count, treat as fresh attempt or maybe increment?
          // Let's increment retry to avoid infinite crash loops if the job ITSELF caused the crash.
          retryAttempts: row.retryAttempts + 1,
          errorMessage: "System crash/restart during execution",
        })
        .where(eq(jobs.id, row.id));

      baseLogger.info({ jobId: row.id }, "Reset stale job to pending");
    }
  }

  /**
   * Start executing a job.
   */
  private async startJob(job: Job): Promise<void> {
    const log = createChildLogger({
      jobId: job.id,
      jobType: job.type,
      correlationId: job.correlationId,
    });

    // Get handler
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.failJob(job, {
        code: "NO_HANDLER",
        message: `No handler registered for job type: ${job.type}`,
        retryable: false,
      });
      return;
    }

    // Validate input
    const validation = await handler.validate(job.input);
    if (!validation.valid) {
      await this.failJob(job, {
        code: "VALIDATION_ERROR",
        message: `Validation failed: ${validation.errors.join(", ")}`,
        retryable: false,
      });
      return;
    }

    // Update job status to running
    const now = new Date();
    await db
      .update(jobs)
      .set({
        status: "running",
        startedAt: now,
        progressMessage: "Starting",
      })
      .where(eq(jobs.id, job.id));

    job.status = "running";
    job.startedAt = now;
    job.progress.message = "Starting";

    log.info("Job started");

    this.emitEvent("job.started", job, {
      estimatedDurationMs: job.estimatedDurationMs,
    });

    // Create execution
    const timeoutMs =
      this.config.timeouts.perType[job.type] ?? this.config.timeouts.default;
    const execution = new JobExecution(job, handler, this, timeoutMs);
    this.running.set(job.id, execution);

    // Run the job
    try {
      await execution.run();
      await this.completeJob(job);
    } catch (error) {
      if (error instanceof JobCancelledException) {
        // Already handled
      } else {
        await this.handleJobError(job, error);
      }
    } finally {
      this.running.delete(job.id);
    }
  }

  /**
   * Complete a job successfully.
   */
  private async completeJob(job: Job): Promise<void> {
    const now = new Date();
    const durationMs = job.startedAt
      ? now.getTime() - job.startedAt.getTime()
      : 0;

    await db
      .update(jobs)
      .set({
        status: "completed",
        completedAt: now,
        actualDurationMs: durationMs,
        output: job.output,
        progressCurrent: job.progress.total,
        progressMessage: "Completed",
      })
      .where(eq(jobs.id, job.id));

    job.status = "completed";
    job.completedAt = now;
    job.actualDurationMs = durationMs;
    job.progress.current = job.progress.total;
    job.progress.percentage = 100;
    job.progress.message = "Completed";

    baseLogger.info({ jobId: job.id, durationMs }, "Job completed");

    this.emitEvent("job.completed", job, {
      durationMs,
      output: job.output,
    });
  }

  /**
   * Fail a job with an error.
   */
  private async failJob(job: Job, error: JobError): Promise<void> {
    const now = new Date();
    const durationMs = job.startedAt
      ? now.getTime() - job.startedAt.getTime()
      : 0;

    await db
      .update(jobs)
      .set({
        status: "failed",
        completedAt: now,
        actualDurationMs: durationMs,
        errorCode: error.code,
        errorMessage: error.message,
        errorStack: error.stack,
        errorRetryable: error.retryable,
      })
      .where(eq(jobs.id, job.id));

    job.status = "failed";
    job.completedAt = now;
    job.actualDurationMs = durationMs;
    job.error = error;

    baseLogger.error({ jobId: job.id, error }, "Job failed");

    this.emitEvent("job.failed", job, {
      error,
      willRetry: false,
      nextRetryAt: undefined,
    });
  }

  /**
   * Handle a job execution error with potential retry.
   */
  private async handleJobError(job: Job, error: unknown): Promise<void> {
    const isRetryable =
      error instanceof Error &&
      !error.message.includes("validation") &&
      job.retry.attempts < job.retry.maxAttempts;

    const stack = error instanceof Error ? error.stack : undefined;
    const jobError: JobError = {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : String(error),
      retryable: isRetryable,
      ...(stack && { stack }),
    };

    if (isRetryable) {
      // Schedule retry
      const backoffMs = Math.min(
        job.retry.backoffMs *
          this.config.retry.backoffMultiplier ** job.retry.attempts,
        this.config.retry.maxBackoffMs,
      );
      const nextRetryAt = new Date(Date.now() + backoffMs);

      await db
        .update(jobs)
        .set({
          status: "pending",
          retryAttempts: job.retry.attempts + 1,
          retryBackoffMs: backoffMs,
          retryNextAt: nextRetryAt,
          errorCode: jobError.code,
          errorMessage: jobError.message,
          progressMessage: `Retry scheduled (${job.retry.attempts + 1}/${job.retry.maxAttempts})`,
        })
        .where(eq(jobs.id, job.id));

      job.retry.attempts += 1;
      job.retry.backoffMs = backoffMs;
      job.retry.nextRetryAt = nextRetryAt;
      job.error = jobError;

      baseLogger.warn(
        { jobId: job.id, attempt: job.retry.attempts, nextRetryAt },
        "Job scheduled for retry",
      );

      this.emitEvent("job.failed", job, {
        error: jobError,
        willRetry: true,
        nextRetryAt,
      });
    } else {
      await this.failJob(job, jobError);
    }
  }

  /**
   * Convert database row to Job object.
   */
  private rowToJob(row: typeof jobs.$inferSelect): Job {
    // Guard against division by zero - if progressTotal is 0, percentage is 0
    const percentage =
      row.progressTotal > 0
        ? Math.round((row.progressCurrent / row.progressTotal) * 100)
        : 0;
    const progress: Job["progress"] = {
      current: row.progressCurrent,
      total: row.progressTotal,
      percentage,
      message: row.progressMessage ?? "Unknown",
      ...(row.progressStage && { stage: row.progressStage }),
    };

    const retry: Job["retry"] = {
      attempts: row.retryAttempts,
      maxAttempts: row.retryMaxAttempts,
      backoffMs: row.retryBackoffMs,
      ...(row.retryNextAt && { nextRetryAt: row.retryNextAt }),
    };

    const error: Job["error"] = row.errorCode
      ? {
          code: row.errorCode,
          message: row.errorMessage ?? "Unknown error",
          retryable: row.errorRetryable ?? false,
          ...(row.errorStack && { stack: row.errorStack }),
        }
      : undefined;

    const cancellation: Job["cancellation"] = row.cancelRequestedAt
      ? {
          requestedAt: row.cancelRequestedAt,
          requestedBy: row.cancelRequestedBy ?? "unknown",
          ...(row.cancelReason && { reason: row.cancelReason }),
        }
      : undefined;

    const job: Job = {
      id: row.id,
      type: row.type as JobType,
      status: row.status as JobStatus,
      priority: row.priority as JobPriority,
      input: (row.input as Record<string, unknown>) ?? {},
      progress,
      createdAt: row.createdAt,
      retry,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
    if (row.name) job.name = row.name;
    if (row.sessionId) job.sessionId = row.sessionId;
    if (row.agentId) job.agentId = row.agentId;
    if (row.userId) job.userId = row.userId;
    if (row.output) job.output = row.output as Record<string, unknown>;
    if (row.startedAt) job.startedAt = row.startedAt;
    if (row.completedAt) job.completedAt = row.completedAt;
    if (row.estimatedDurationMs !== null)
      job.estimatedDurationMs = row.estimatedDurationMs;
    if (row.actualDurationMs !== null)
      job.actualDurationMs = row.actualDurationMs;
    if (error) job.error = error;
    if (cancellation) job.cancellation = cancellation;
    if (row.correlationId) job.correlationId = row.correlationId;
    return job;
  }

  /**
   * Emit a job event via WebSocket.
   */
  private emitEvent(
    type: MessageType,
    job: Job,
    data: Record<string, unknown>,
  ): void {
    try {
      const channel: Channel = { type: "system:jobs" };
      const metadata = job.correlationId
        ? { correlationId: job.correlationId }
        : {};
      getHub().publish(
        channel,
        type,
        {
          jobId: job.id,
          jobType: job.type,
          timestamp: new Date().toISOString(),
          ...data,
        },
        metadata,
      );

      // Also publish to session-specific channel if applicable
      if (job.sessionId) {
        const sessionChannel: Channel = {
          type: "session:job",
          id: job.sessionId,
        };
        getHub().publish(
          sessionChannel,
          type,
          {
            jobId: job.id,
            jobType: job.type,
            timestamp: new Date().toISOString(),
            ...data,
          },
          metadata,
        );
      }
    } catch {
      // Hub may not be initialized yet
    }
  }

  /**
   * Clean up old completed/failed jobs.
   */
  async cleanup(): Promise<number> {
    const completedCutoff = new Date(
      Date.now() - this.config.cleanup.completedRetentionHours * 60 * 60 * 1000,
    );
    const failedCutoff = new Date(
      Date.now() - this.config.cleanup.failedRetentionHours * 60 * 60 * 1000,
    );

    const deletedRows = await db
      .delete(jobs)
      .where(
        sql`(status = 'completed' AND completed_at < ${completedCutoff}) OR (status = 'failed' AND completed_at < ${failedCutoff})`,
      )
      .returning({ id: jobs.id });

    const deleted = deletedRows.length;
    if (deleted > 0) {
      baseLogger.info({ deleted }, "Cleaned up old jobs");
    }

    return deleted;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let jobServiceInstance: JobService | null = null;

/**
 * Get the job service singleton.
 */
export function getJobService(): JobService {
  if (!jobServiceInstance) {
    jobServiceInstance = new JobService();
  }
  return jobServiceInstance;
}

/**
 * Initialize job service with custom config (for testing).
 */
export function initializeJobService(config?: JobQueueConfig): JobService {
  jobServiceInstance = new JobService(config);
  return jobServiceInstance;
}

/**
 * Clear the job service singleton (for testing).
 */
export function _clearJobService(): void {
  jobServiceInstance = null;
}
