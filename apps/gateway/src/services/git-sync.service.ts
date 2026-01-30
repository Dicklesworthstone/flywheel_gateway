/**
 * Git Sync Operations Service.
 *
 * Coordinates pull, push, fetch, and rebase operations across multiple agents.
 * Provides retry logic, conflict detection during sync, and atomic multi-branch
 * operations.
 *
 * Key features:
 * - Operation queuing and sequencing
 * - Transient failure handling with exponential backoff
 * - Push operation coordination with conflict checks
 * - Audit logging for all git operations
 */

import { getCorrelationId } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import { logger } from "./logger";

// ============================================================================
// Constants
// ============================================================================

/** Maximum retries for transient failures */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_RETRY_DELAY_MS = 1000;

/** Maximum concurrent sync operations per repository */
const MAX_CONCURRENT_OPS = 3;

/** Operation timeout (ms) */
const _OPERATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

export type SyncOperationType = "pull" | "push" | "fetch" | "rebase" | "merge";
export type SyncOperationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export interface SyncOperationRequest {
  repositoryId: string;
  agentId: string;
  operation: SyncOperationType;
  branch: string;
  targetBranch?: string; // For merge/rebase
  remote?: string;
  force?: boolean;
  priority?: number; // Higher = more priority
}

export interface SyncOperation {
  id: string;
  request: SyncOperationRequest;
  status: SyncOperationStatus;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  attempt: number;
  maxRetries: number;
  result?: SyncOperationResult;
  error?: SyncError;
  correlationId?: string;
}

export interface SyncOperationResult {
  success: boolean;
  fromCommit?: string;
  toCommit?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  conflictsDetected?: boolean;
  conflictFiles?: string[];
  mergeCommit?: string;
}

export interface SyncError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface SyncQueueStats {
  repositoryId: string;
  queuedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  averageWaitTime?: number;
  averageDuration?: number;
}

// ============================================================================
// Storage
// ============================================================================

/** Operation queues by repository */
const operationQueues: Map<string, SyncOperation[]> = new Map();

/** Currently running operations by repository */
const runningOperations: Map<string, Set<string>> = new Map();

/** Completed operations history (for audit) */
const operationHistory: Map<string, SyncOperation[]> = new Map();

/** Operation lookup by ID */
const operationById: Map<string, SyncOperation> = new Map();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique operation ID.
 */
function generateOperationId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `gso_${result}`;
}

/**
 * Publish a WebSocket event for sync operations.
 */
function publishSyncEvent(
  repositoryId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "workspace:git", workspaceId: repositoryId };
  hub.publish(channel, eventType, payload, { workspaceId: repositoryId });
}

/**
 * Calculate retry delay with exponential backoff.
 */
function calculateRetryDelay(attempt: number): number {
  const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
  // Add jitter (0-25%)
  const jitter = delay * 0.25 * Math.random();
  return Math.min(delay + jitter, 30000); // Cap at 30s
}

/**
 * Determine if an error is retryable.
 */
function isRetryableError(error: SyncError): boolean {
  const retryableCodes = [
    "NETWORK_ERROR",
    "TIMEOUT",
    "REMOTE_UNAVAILABLE",
    "LOCK_FAILED",
    "RATE_LIMITED",
  ];
  return retryableCodes.includes(error.code) || error.retryable;
}

/**
 * Parse git error output into a structured error.
 */
function parseGitError(errorOutput: string): SyncError {
  // Check for common patterns
  if (
    errorOutput.includes("Connection refused") ||
    errorOutput.includes("Could not resolve")
  ) {
    return {
      code: "NETWORK_ERROR",
      message: "Unable to connect to remote repository",
      retryable: true,
    };
  }

  if (
    errorOutput.includes("CONFLICT") ||
    errorOutput.includes("Automatic merge failed")
  ) {
    return {
      code: "MERGE_CONFLICT",
      message: "Merge conflicts detected",
      retryable: false,
    };
  }

  if (
    errorOutput.includes("rejected") &&
    errorOutput.includes("non-fast-forward")
  ) {
    return {
      code: "NON_FAST_FORWARD",
      message: "Push rejected: remote has changes not in local branch",
      retryable: false,
    };
  }

  if (
    errorOutput.includes("Permission denied") ||
    errorOutput.includes("Authentication failed")
  ) {
    return {
      code: "AUTH_ERROR",
      message: "Authentication failed",
      retryable: false,
    };
  }

  if (errorOutput.includes("lock")) {
    return {
      code: "LOCK_FAILED",
      message: "Repository is locked by another process",
      retryable: true,
    };
  }

  return {
    code: "GIT_ERROR",
    message: errorOutput.substring(0, 200),
    retryable: false,
  };
}

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Queue a sync operation.
 */
export async function queueSyncOperation(
  request: SyncOperationRequest,
): Promise<SyncOperation> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId: request.repositoryId,
    agentId: request.agentId,
    operation: request.operation,
    branch: request.branch,
  });

  const operation: SyncOperation = {
    id: generateOperationId(),
    request,
    status: "queued",
    queuedAt: new Date(),
    attempt: 0,
    maxRetries: MAX_RETRIES,
    correlationId,
  };

  // Add to queue
  const queue = operationQueues.get(request.repositoryId) ?? [];
  queue.push(operation);

  // Sort by priority (higher first)
  queue.sort((a, b) => (b.request.priority ?? 0) - (a.request.priority ?? 0));

  operationQueues.set(request.repositoryId, queue);
  operationById.set(operation.id, operation);

  log.info(
    {
      operationId: operation.id,
      queuePosition: queue.indexOf(operation) + 1,
      queueLength: queue.length,
    },
    "Sync operation queued",
  );

  // Publish queued event
  publishSyncEvent(request.repositoryId, "git.sync.queued", {
    operationId: operation.id,
    repositoryId: request.repositoryId,
    agentId: request.agentId,
    operation: request.operation,
    branch: request.branch,
    queuedAt: operation.queuedAt.toISOString(),
  });

  // Try to process queue
  processQueue(request.repositoryId);

  return operation;
}

/**
 * Process the operation queue for a repository.
 */
function processQueue(repositoryId: string): void {
  const queue = operationQueues.get(repositoryId) ?? [];
  const running = runningOperations.get(repositoryId) ?? new Set();

  // Check if we can start more operations
  while (running.size < MAX_CONCURRENT_OPS && queue.length > 0) {
    const operation = queue.find((op) => op.status === "queued");
    if (!operation) break;

    // Move to running
    operation.status = "running";
    operation.startedAt = new Date();
    operation.attempt++;
    running.add(operation.id);
    runningOperations.set(repositoryId, running);

    logger.debug(
      {
        operationId: operation.id,
        attempt: operation.attempt,
      },
      "Starting sync operation",
    );

    // Publish started event
    publishSyncEvent(repositoryId, "git.sync.started", {
      operationId: operation.id,
      repositoryId,
      agentId: operation.request.agentId,
      operation: operation.request.operation,
      branch: operation.request.branch,
      attempt: operation.attempt,
      startedAt: operation.startedAt.toISOString(),
    });
  }
}

/**
 * Complete a sync operation (called by agent after executing).
 */
export async function completeSyncOperation(
  operationId: string,
  result: SyncOperationResult,
): Promise<void> {
  const operation = operationById.get(operationId);
  if (!operation) {
    logger.warn({ operationId }, "Attempt to complete unknown operation");
    return;
  }

  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    operationId,
    repositoryId: operation.request.repositoryId,
  });

  operation.status = "completed";
  operation.completedAt = new Date();
  operation.result = result;

  // Remove from running
  const running = runningOperations.get(operation.request.repositoryId);
  if (running) {
    running.delete(operationId);
  }

  // Remove from queue
  const queue = operationQueues.get(operation.request.repositoryId);
  if (queue) {
    const index = queue.findIndex((op) => op.id === operationId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  // Add to history
  const history = operationHistory.get(operation.request.repositoryId) ?? [];
  history.unshift(operation);
  if (history.length > 100) {
    const removed = history.pop();
    if (removed) {
      operationById.delete(removed.id);
    }
  }
  operationHistory.set(operation.request.repositoryId, history);

  const duration =
    operation.completedAt.getTime() -
    (operation.startedAt?.getTime() ?? operation.queuedAt.getTime());

  log.info(
    {
      success: result.success,
      filesChanged: result.filesChanged,
      duration,
      conflictsDetected: result.conflictsDetected,
    },
    "Sync operation completed",
  );

  // Publish completed event
  publishSyncEvent(operation.request.repositoryId, "git.sync.completed", {
    operationId,
    repositoryId: operation.request.repositoryId,
    agentId: operation.request.agentId,
    operation: operation.request.operation,
    branch: operation.request.branch,
    success: result.success,
    filesChanged: result.filesChanged,
    conflictsDetected: result.conflictsDetected,
    duration,
    completedAt: operation.completedAt.toISOString(),
  });

  // Process more from queue
  processQueue(operation.request.repositoryId);
}

/**
 * Fail a sync operation with an error.
 */
export async function failSyncOperation(
  operationId: string,
  errorOutput: string,
): Promise<{ willRetry: boolean; nextAttemptAt?: Date }> {
  const operation = operationById.get(operationId);
  if (!operation) {
    logger.warn({ operationId }, "Attempt to fail unknown operation");
    return { willRetry: false };
  }

  const error = parseGitError(errorOutput);
  operation.error = error;

  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    operationId,
    repositoryId: operation.request.repositoryId,
    errorCode: error.code,
  });

  // Check if we should retry
  const canRetry =
    isRetryableError(error) && operation.attempt < operation.maxRetries;

  if (canRetry) {
    const delay = calculateRetryDelay(operation.attempt);
    const nextAttemptAt = new Date(Date.now() + delay);

    operation.status = "queued"; // Back to queued for retry
    operation.error = error;

    log.warn(
      {
        attempt: operation.attempt,
        maxRetries: operation.maxRetries,
        nextAttemptAt: nextAttemptAt.toISOString(),
        delay,
      },
      "Sync operation failed, will retry",
    );

    // Remove from running
    const running = runningOperations.get(operation.request.repositoryId);
    if (running) {
      running.delete(operationId);
    }

    // Publish retry event
    publishSyncEvent(operation.request.repositoryId, "git.sync.retrying", {
      operationId,
      repositoryId: operation.request.repositoryId,
      agentId: operation.request.agentId,
      operation: operation.request.operation,
      branch: operation.request.branch,
      attempt: operation.attempt,
      errorCode: error.code,
      nextAttemptAt: nextAttemptAt.toISOString(),
    });

    // Schedule retry
    const retryTimeout = setTimeout(() => {
      processQueue(operation.request.repositoryId);
    }, delay);

    // Ensure the timeout doesn't prevent process exit
    if (retryTimeout.unref) {
      retryTimeout.unref();
    }

    return { willRetry: true, nextAttemptAt };
  }

  // No more retries - mark as failed
  operation.status = "failed";
  operation.completedAt = new Date();

  // Remove from running
  const running = runningOperations.get(operation.request.repositoryId);
  if (running) {
    running.delete(operationId);
  }

  // Remove from queue
  const queue = operationQueues.get(operation.request.repositoryId);
  if (queue) {
    const index = queue.findIndex((op) => op.id === operationId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  // Add to history
  const history = operationHistory.get(operation.request.repositoryId) ?? [];
  history.unshift(operation);
  if (history.length > 100) {
    const removed = history.pop();
    if (removed) {
      operationById.delete(removed.id);
    }
  }
  operationHistory.set(operation.request.repositoryId, history);

  log.error(
    {
      errorMessage: error.message,
      attempt: operation.attempt,
    },
    "Sync operation failed permanently",
  );

  // Publish failed event
  publishSyncEvent(operation.request.repositoryId, "git.sync.failed", {
    operationId,
    repositoryId: operation.request.repositoryId,
    agentId: operation.request.agentId,
    operation: operation.request.operation,
    branch: operation.request.branch,
    errorCode: error.code,
    errorMessage: error.message,
    attempts: operation.attempt,
    failedAt: operation.completedAt.toISOString(),
  });

  // Process more from queue
  processQueue(operation.request.repositoryId);

  return { willRetry: false };
}

/**
 * Cancel a queued or running sync operation.
 */
export async function cancelSyncOperation(
  operationId: string,
  agentId: string,
): Promise<boolean> {
  const operation = operationById.get(operationId);
  if (!operation) {
    return false;
  }

  // Verify ownership
  if (operation.request.agentId !== agentId) {
    logger.warn(
      {
        operationId,
        requestingAgent: agentId,
        ownerAgent: operation.request.agentId,
      },
      "Unauthorized cancel attempt",
    );
    return false;
  }

  if (operation.status === "completed" || operation.status === "failed") {
    return false; // Already done
  }

  operation.status = "cancelled";
  operation.completedAt = new Date();

  // Remove from running
  const running = runningOperations.get(operation.request.repositoryId);
  if (running) {
    running.delete(operationId);
  }

  // Remove from queue
  const queue = operationQueues.get(operation.request.repositoryId);
  if (queue) {
    const index = queue.findIndex((op) => op.id === operationId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  logger.info(
    {
      operationId,
      repositoryId: operation.request.repositoryId,
    },
    "Sync operation cancelled",
  );

  // Publish cancelled event
  publishSyncEvent(operation.request.repositoryId, "git.sync.cancelled", {
    operationId,
    repositoryId: operation.request.repositoryId,
    agentId: operation.request.agentId,
    operation: operation.request.operation,
    branch: operation.request.branch,
    cancelledAt: operation.completedAt.toISOString(),
  });

  // Process more from queue
  processQueue(operation.request.repositoryId);

  return true;
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get an operation by ID.
 */
export async function getOperation(
  operationId: string,
): Promise<SyncOperation | null> {
  return operationById.get(operationId) ?? null;
}

/**
 * Get queued operations for a repository.
 */
export async function getQueuedOperations(
  repositoryId: string,
): Promise<SyncOperation[]> {
  const queue = operationQueues.get(repositoryId) ?? [];
  return queue.filter((op) => op.status === "queued");
}

/**
 * Get running operations for a repository.
 */
export async function getRunningOperations(
  repositoryId: string,
): Promise<SyncOperation[]> {
  const queue = operationQueues.get(repositoryId) ?? [];
  return queue.filter((op) => op.status === "running");
}

/**
 * Get operation history for a repository.
 */
export async function getOperationHistory(
  repositoryId: string,
  options?: {
    agentId?: string;
    operation?: SyncOperationType;
    status?: SyncOperationStatus;
    limit?: number;
  },
): Promise<SyncOperation[]> {
  let history = operationHistory.get(repositoryId) ?? [];

  if (options?.agentId) {
    history = history.filter((op) => op.request.agentId === options.agentId);
  }

  if (options?.operation) {
    history = history.filter(
      (op) => op.request.operation === options.operation,
    );
  }

  if (options?.status) {
    history = history.filter((op) => op.status === options.status);
  }

  const limit = options?.limit ?? 50;
  return history.slice(0, limit);
}

/**
 * Get queue statistics for a repository.
 */
export async function getQueueStats(
  repositoryId: string,
): Promise<SyncQueueStats> {
  const queue = operationQueues.get(repositoryId) ?? [];
  const history = operationHistory.get(repositoryId) ?? [];

  const queuedCount = queue.filter((op) => op.status === "queued").length;
  const runningCount = queue.filter((op) => op.status === "running").length;
  const completedCount = history.filter(
    (op) => op.status === "completed",
  ).length;
  const failedCount = history.filter((op) => op.status === "failed").length;

  // Calculate average times
  const completedWithTimes = history.filter(
    (op) => op.status === "completed" && op.startedAt && op.completedAt,
  );

  let averageWaitTime: number | undefined;
  let averageDuration: number | undefined;

  if (completedWithTimes.length > 0) {
    const waitTimes = completedWithTimes.map(
      (op) => (op.startedAt?.getTime() ?? 0) - op.queuedAt.getTime(),
    );
    averageWaitTime = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;

    const durations = completedWithTimes.map(
      (op) => (op.completedAt?.getTime() ?? 0) - (op.startedAt?.getTime() ?? 0),
    );
    averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  return {
    repositoryId,
    queuedCount,
    runningCount,
    completedCount,
    failedCount,
    ...(averageWaitTime !== undefined && { averageWaitTime }),
    ...(averageDuration !== undefined && { averageDuration }),
  };
}

// ============================================================================
// Global Statistics
// ============================================================================

/**
 * Get global sync service statistics.
 */
export function getSyncStats(): {
  totalQueued: number;
  totalRunning: number;
  repositoriesWithOperations: number;
  operationsInMemory: number;
} {
  let totalQueued = 0;
  let totalRunning = 0;

  for (const queue of operationQueues.values()) {
    totalQueued += queue.filter((op) => op.status === "queued").length;
    totalRunning += queue.filter((op) => op.status === "running").length;
  }

  return {
    totalQueued,
    totalRunning,
    repositoriesWithOperations: operationQueues.size,
    operationsInMemory: operationById.size,
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all sync data. Only for testing.
 */
export function _clearAllSyncData(): void {
  operationQueues.clear();
  runningOperations.clear();
  operationHistory.clear();
  operationById.clear();
}
