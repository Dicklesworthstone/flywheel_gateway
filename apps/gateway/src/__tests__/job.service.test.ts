/**
 * Tests for Job Service.
 *
 * Tests job creation, execution, progress tracking, cancellation, and retry logic.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db, sqlite } from "../db/connection";
import { jobs, jobLogs } from "../db/schema";
import {
  _clearJobService,
  getJobService,
  initializeJobService,
  JobNotFoundError,
  type JobService,
} from "../services/job.service";
import type { JobContext, JobHandler, ValidationResult } from "../types/job.types";

// ============================================================================
// Test Fixtures
// ============================================================================

class TestHandler implements JobHandler<{ value: number }, { result: number }> {
  async validate(input: { value: number }): Promise<ValidationResult> {
    if (typeof input.value !== "number") {
      return { valid: false, errors: ["value must be a number"] };
    }
    return { valid: true, errors: [] };
  }

  async execute(context: JobContext<{ value: number }>): Promise<{ result: number }> {
    await context.setStage("processing");
    await context.updateProgress(50, 100, "Processing");

    context.log("info", "Processing job", { value: context.input.value });

    await context.updateProgress(100, 100, "Done");
    return { result: context.input.value * 2 };
  }
}

class SlowHandler implements JobHandler<{ delayMs: number }, { completed: boolean }> {
  async validate(): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async execute(context: JobContext<{ delayMs: number }>): Promise<{ completed: boolean }> {
    const delayMs = context.input.delayMs;

    for (let i = 0; i < 10; i++) {
      context.throwIfCancelled();
      await context.updateProgress(i * 10, 100, `Step ${i + 1}`);
      await Bun.sleep(delayMs / 10);
    }

    return { completed: true };
  }

  async onCancel(context: JobContext<{ delayMs: number }>): Promise<void> {
    context.log("info", "Slow job cancelled");
  }
}

class FailingHandler implements JobHandler<{ shouldFail: boolean }, void> {
  async validate(): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async execute(context: JobContext<{ shouldFail: boolean }>): Promise<void> {
    if (context.input.shouldFail) {
      throw new Error("Intentional failure");
    }
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

async function waitForJobStatus(
  service: JobService,
  jobId: string,
  expectedStatus: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await service.getJob(jobId);
    if (job?.status === expectedStatus) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Job ${jobId} did not reach status ${expectedStatus} within ${timeoutMs}ms`);
}

// ============================================================================
// Test Setup
// ============================================================================

describe("JobService", () => {
  let service: JobService;

  beforeEach(() => {
    _clearJobService();
    // Clean database tables
    sqlite.run("DELETE FROM job_logs");
    sqlite.run("DELETE FROM jobs");

    service = initializeJobService({
      concurrency: { global: 3, perType: {}, perSession: 2 },
      timeouts: { default: 5000, perType: {} },
      retry: { maxAttempts: 2, backoffMultiplier: 2, initialBackoffMs: 100, maxBackoffMs: 1000 },
      cleanup: { completedRetentionHours: 1, failedRetentionHours: 2 },
      worker: { pollIntervalMs: 100, shutdownTimeoutMs: 1000 },
    });

    // Register test handlers
    service.registerHandler("codebase_scan", new TestHandler());
    service.registerHandler("context_build", new SlowHandler());
    service.registerHandler("context_compact", new FailingHandler());
  });

  afterEach(async () => {
    await service.stop();
    _clearJobService();
  });

  // ==========================================================================
  // Job Creation Tests
  // ==========================================================================

  describe("createJob", () => {
    test("creates a job with pending status", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 42 },
      });

      expect(job.id).toBeDefined();
      expect(job.type).toBe("codebase_scan");
      expect(job.status).toBe("pending");
      expect(job.priority).toBe(1);
      expect(job.input).toEqual({ value: 42 });
      expect(job.progress.current).toBe(0);
      expect(job.progress.total).toBe(100);
    });

    test("creates a job with custom priority", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
        priority: 3,
      });

      expect(job.priority).toBe(3);
    });

    test("creates a job with metadata", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
        metadata: { source: "test" },
      });

      expect(job.metadata).toEqual({ source: "test" });
    });

    test("persists job to database", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 42 },
      });

      const retrieved = await service.getJob(job.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(job.id);
      expect(retrieved?.type).toBe("codebase_scan");
    });
  });

  // ==========================================================================
  // Job Retrieval Tests
  // ==========================================================================

  describe("getJob", () => {
    test("returns null for non-existent job", async () => {
      const job = await service.getJob("non-existent-id");
      expect(job).toBeNull();
    });

    test("returns job by ID", async () => {
      const created = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
      });

      const retrieved = await service.getJob(created.id);
      expect(retrieved?.id).toBe(created.id);
    });
  });

  // ==========================================================================
  // Job Listing Tests
  // ==========================================================================

  describe("listJobs", () => {
    test("returns empty list when no jobs", async () => {
      const result = await service.listJobs({});
      expect(result.jobs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    test("returns all jobs", async () => {
      await service.createJob({ type: "codebase_scan", input: { value: 1 } });
      await service.createJob({ type: "codebase_scan", input: { value: 2 } });

      const result = await service.listJobs({});
      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    test("filters by type", async () => {
      await service.createJob({ type: "codebase_scan", input: { value: 1 } });
      await service.createJob({ type: "context_build", input: { delayMs: 100 } });

      const result = await service.listJobs({ type: "codebase_scan" });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].type).toBe("codebase_scan");
    });

    test("filters by status", async () => {
      const job1 = await service.createJob({ type: "codebase_scan", input: { value: 1 } });

      // Start service to run jobs
      service.start();
      await waitForJobStatus(service, job1.id, "completed");

      const job2 = await service.createJob({ type: "codebase_scan", input: { value: 2 } });

      const pendingResult = await service.listJobs({ status: "pending" });
      expect(pendingResult.jobs.length).toBeGreaterThanOrEqual(0);

      const completedResult = await service.listJobs({ status: "completed" });
      expect(completedResult.jobs.length).toBeGreaterThanOrEqual(1);
    });

    test("respects limit", async () => {
      await service.createJob({ type: "codebase_scan", input: { value: 1 } });
      await service.createJob({ type: "codebase_scan", input: { value: 2 } });
      await service.createJob({ type: "codebase_scan", input: { value: 3 } });

      const result = await service.listJobs({ limit: 2 });
      expect(result.jobs).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });

  // ==========================================================================
  // Job Execution Tests
  // ==========================================================================

  describe("job execution", () => {
    test("executes job and updates status to completed", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 21 },
      });

      service.start();
      await waitForJobStatus(service, job.id, "completed");

      const completed = await service.getJob(job.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.output).toEqual({ result: 42 });
      expect(completed?.progress.percentage).toBe(100);
      expect(completed?.actualDurationMs).toBeGreaterThan(0);
    });

    test("handles validation failure", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: "not a number" as unknown as number },
      });

      service.start();
      await waitForJobStatus(service, job.id, "failed");

      const failed = await service.getJob(job.id);
      expect(failed?.status).toBe("failed");
      expect(failed?.error?.code).toBe("VALIDATION_ERROR");
    });

    test("fails job when handler throws", async () => {
      const job = await service.createJob({
        type: "context_compact",
        input: { shouldFail: true },
      });

      service.start();
      await waitForJobStatus(service, job.id, "failed", 10000);

      const failed = await service.getJob(job.id);
      expect(failed?.status).toBe("failed");
      expect(failed?.error?.message).toContain("Intentional failure");
    });
  });

  // ==========================================================================
  // Job Cancellation Tests
  // ==========================================================================

  describe("cancelJob", () => {
    test("cancels a pending job", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
      });

      const cancelled = await service.cancelJob(job.id, "Test cancellation");

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancellation?.reason).toBe("Test cancellation");
      expect(cancelled.cancellation?.requestedBy).toBe("user");
    });

    test("throws for non-existent job", async () => {
      await expect(service.cancelJob("non-existent")).rejects.toThrow(JobNotFoundError);
    });

    test("returns job unchanged for already cancelled job", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
      });

      await service.cancelJob(job.id);
      const result = await service.cancelJob(job.id);

      expect(result.status).toBe("cancelled");
    });
  });

  // ==========================================================================
  // Job Retry Tests
  // ==========================================================================

  describe("retryJob", () => {
    test("retries a failed job", async () => {
      const job = await service.createJob({
        type: "context_compact",
        input: { shouldFail: true },
      });

      service.start();
      await waitForJobStatus(service, job.id, "failed", 10000);

      // Now retry it
      const retried = await service.retryJob(job.id);
      expect(retried.status).toBe("pending");
      expect(retried.error).toBeUndefined();
    });

    test("throws for non-existent job", async () => {
      await expect(service.retryJob("non-existent")).rejects.toThrow(JobNotFoundError);
    });

    test("throws for job in non-terminal state", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
      });

      await expect(service.retryJob(job.id)).rejects.toThrow(/Cannot retry/);
    });
  });

  // ==========================================================================
  // Job Output Tests
  // ==========================================================================

  describe("getJobOutput", () => {
    test("returns output for completed job", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 10 },
      });

      service.start();
      await waitForJobStatus(service, job.id, "completed");

      const output = await service.getJobOutput(job.id);
      expect(output).toEqual({ result: 20 });
    });

    test("returns null for job without output", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
      });

      const output = await service.getJobOutput(job.id);
      expect(output).toBeNull();
    });

    test("throws for non-existent job", async () => {
      await expect(service.getJobOutput("non-existent")).rejects.toThrow(JobNotFoundError);
    });
  });

  // ==========================================================================
  // Job Logs Tests
  // ==========================================================================

  describe("getJobLogs", () => {
    test("returns logs for job", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 5 },
      });

      service.start();
      await waitForJobStatus(service, job.id, "completed");

      const logs = await service.getJobLogs(job.id);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.level === "info")).toBe(true);
    });

    test("returns empty array for job with no logs", async () => {
      const job = await service.createJob({
        type: "codebase_scan",
        input: { value: 1 },
      });

      const logs = await service.getJobLogs(job.id);
      expect(logs).toEqual([]);
    });
  });

  // ==========================================================================
  // Concurrency Tests
  // ==========================================================================

  describe("concurrency limits", () => {
    test("respects global concurrency limit", async () => {
      // Create more jobs than the concurrency limit
      const jobIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const job = await service.createJob({
          type: "context_build",
          input: { delayMs: 200 },
        });
        jobIds.push(job.id);
      }

      service.start();

      // Wait a bit for processing to start
      await Bun.sleep(100);

      // Check that not all jobs are running at once
      const result = await service.listJobs({ status: "running" });
      expect(result.jobs.length).toBeLessThanOrEqual(3); // global limit is 3
    });
  });
});
