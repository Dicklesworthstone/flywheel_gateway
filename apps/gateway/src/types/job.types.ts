/**
 * Job Orchestration Types
 *
 * Defines types for long-running operations with progress tracking,
 * cancellation, checkpointing, and retry capabilities.
 */

// ============================================================================
// Enums
// ============================================================================

export type JobType =
  // Context operations
  | "context_build"
  | "context_compact"
  // Scan operations
  | "codebase_scan"
  | "dependency_scan"
  // Export operations
  | "session_export"
  | "bead_export"
  // Import operations
  | "codebase_import"
  | "memory_import"
  // Analysis operations
  | "semantic_index"
  | "embedding_generate"
  // Maintenance operations
  | "checkpoint_compact"
  | "cache_warm";

export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type JobPriority = 0 | 1 | 2 | 3; // 0=low, 1=normal, 2=high, 3=critical

export type JobLogLevel = "debug" | "info" | "warn" | "error";

// ============================================================================
// Core Types
// ============================================================================

export interface JobProgress {
  current: number;
  total: number;
  percentage: number;
  message: string;
  stage?: string;
}

export interface JobError {
  code: string;
  message: string;
  stack?: string;
  retryable: boolean;
}

export interface JobRetry {
  attempts: number;
  maxAttempts: number;
  backoffMs: number;
  nextRetryAt?: Date;
}

export interface JobCancellation {
  requestedAt: Date;
  requestedBy: string;
  reason?: string;
}

export interface Job {
  id: string;
  type: JobType;
  name?: string;
  status: JobStatus;
  priority: JobPriority;

  // Ownership
  sessionId?: string;
  agentId?: string;
  userId?: string;

  // Input/Output
  input: Record<string, unknown>;
  output?: Record<string, unknown>;

  // Progress tracking
  progress: JobProgress;

  // Timing
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedDurationMs?: number;
  actualDurationMs?: number;

  // Error handling
  error?: JobError;

  // Retry configuration
  retry: JobRetry;

  // Cancellation
  cancellation?: JobCancellation;

  // Metadata
  metadata: Record<string, unknown>;
  correlationId?: string;
}

export interface JobLogEntry {
  id: string;
  jobId: string;
  level: JobLogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
  durationMs?: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface JobQueueConfig {
  // Concurrency limits
  concurrency: {
    global: number;
    perType: Partial<Record<JobType, number>>;
    perSession: number;
  };

  // Timeouts (milliseconds)
  timeouts: {
    default: number;
    perType: Partial<Record<JobType, number>>;
  };

  // Retry configuration
  retry: {
    maxAttempts: number;
    backoffMultiplier: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
  };

  // Cleanup
  cleanup: {
    completedRetentionHours: number;
    failedRetentionHours: number;
  };

  // Worker configuration
  worker: {
    pollIntervalMs: number;
    shutdownTimeoutMs: number;
  };
}

// ============================================================================
// Handler Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface JobContext<TInput = unknown> {
  job: Job;
  input: TInput;

  // Progress reporting
  updateProgress(
    current: number,
    total: number,
    message?: string,
  ): Promise<void>;
  setStage(stage: string): Promise<void>;

  // Checkpointing for resume
  checkpoint(state: unknown): Promise<void>;
  getCheckpoint(): Promise<unknown | null>;

  // Cancellation checking
  isCancelled(): boolean;
  throwIfCancelled(): void;

  // Logging
  log(level: JobLogLevel, message: string, data?: Record<string, unknown>): void;
}

export interface JobHandler<TInput = unknown, TOutput = unknown> {
  // Validate input before execution
  validate(input: TInput): Promise<ValidationResult>;

  // Execute the job
  execute(context: JobContext<TInput>): Promise<TOutput>;

  // Optional: Handle cancellation cleanup
  onCancel?(context: JobContext<TInput>): Promise<void>;

  // Optional: Handle pause
  onPause?(context: JobContext<TInput>): Promise<void>;

  // Optional: Handle resume
  onResume?(context: JobContext<TInput>): Promise<void>;
}

// ============================================================================
// API Types
// ============================================================================

export interface CreateJobInput {
  type: JobType;
  name?: string;
  input: Record<string, unknown>;
  priority?: JobPriority;
  sessionId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface ListJobsQuery {
  type?: JobType;
  status?: JobStatus;
  sessionId?: string;
  agentId?: string;
  limit?: number;
  cursor?: string;
}

export interface CancelJobInput {
  reason?: string;
}

// ============================================================================
// Event Types
// ============================================================================

export type JobEventType =
  | "job.created"
  | "job.started"
  | "job.progress"
  | "job.completed"
  | "job.failed"
  | "job.cancelled"
  | "job.paused"
  | "job.resumed"
  | "job.timeout";

export interface JobEvent {
  type: JobEventType;
  jobId: string;
  jobType: JobType;
  timestamp: Date;
  correlationId?: string;
  data: Record<string, unknown>;
}

export interface JobCreatedEvent extends JobEvent {
  type: "job.created";
  data: {
    sessionId?: string;
    priority: JobPriority;
  };
}

export interface JobStartedEvent extends JobEvent {
  type: "job.started";
  data: {
    estimatedDurationMs?: number;
  };
}

export interface JobProgressEvent extends JobEvent {
  type: "job.progress";
  data: {
    progress: JobProgress;
  };
}

export interface JobCompletedEvent extends JobEvent {
  type: "job.completed";
  data: {
    durationMs: number;
    output?: Record<string, unknown>;
  };
}

export interface JobFailedEvent extends JobEvent {
  type: "job.failed";
  data: {
    error: JobError;
    willRetry: boolean;
    nextRetryAt?: Date;
  };
}

export interface JobCancelledEvent extends JobEvent {
  type: "job.cancelled";
  data: {
    reason?: string;
    requestedBy: string;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_JOB_QUEUE_CONFIG: JobQueueConfig = {
  concurrency: {
    global: 5,
    perType: {
      context_build: 2,
      codebase_scan: 2,
      semantic_index: 1,
      embedding_generate: 1,
    },
    perSession: 3,
  },
  timeouts: {
    default: 5 * 60 * 1000, // 5 minutes
    perType: {
      context_build: 10 * 60 * 1000, // 10 minutes
      codebase_scan: 15 * 60 * 1000, // 15 minutes
      semantic_index: 30 * 60 * 1000, // 30 minutes
      embedding_generate: 30 * 60 * 1000, // 30 minutes
    },
  },
  retry: {
    maxAttempts: 3,
    backoffMultiplier: 2,
    initialBackoffMs: 1000,
    maxBackoffMs: 60000,
  },
  cleanup: {
    completedRetentionHours: 24,
    failedRetentionHours: 72,
  },
  worker: {
    pollIntervalMs: 1000,
    shutdownTimeoutMs: 30000,
  },
};
