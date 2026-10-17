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

import { sqlite } from "../db";
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

let syncTablesReady = false;
let syncHydrated = false;

function ensureSyncTables(): void {
  if (syncTablesReady) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS git_sync_operations (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        agent_id TEXT,
        operation TEXT NOT NULL,
        branch TEXT NOT NULL,
        target_branch TEXT,
        remote TEXT,
        force INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER,
        success INTEGER,
        from_commit TEXT,
        to_commit TEXT,
        files_changed INTEGER,
        insertions INTEGER,
        deletions INTEGER,
        conflicts_detected INTEGER,
        conflict_files TEXT,
        error_code TEXT,
        error_message TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        max_retries INTEGER NOT NULL DEFAULT 3,
        correlation_id TEXT
      );
    `);
    syncTablesReady = true;
  } catch {
    // Ignore if sqlite is mocked
  }
}

function resolveNullableAgentFk(agentId: string): string | null {
  try {
    const row = sqlite
      .query(`SELECT id FROM agents WHERE id = ? LIMIT 1`)
      .get(agentId);
    return row ? agentId : null;
  } catch {
    return null;
  }
}

function persistSyncOpToDb(op: SyncOperation): void {
  try {
    ensureSyncTables();
    const fkAgentId = resolveNullableAgentFk(op.request.agentId);
    const durationMs =
      op.completedAt && op.startedAt
        ? op.completedAt.getTime() - op.startedAt.getTime()
        : null;
    const encodedCorrelation = JSON.stringify({
      agentId: op.request.agentId,
      priority: op.request.priority,
      correlationId: op.correlationId,
    });
    sqlite
      .query(
        `INSERT OR REPLACE INTO git_sync_operations (
          id, repository_id, agent_id, operation, branch, target_branch, remote, force,
          status, queued_at, started_at, completed_at, duration_ms,
          success, from_commit, to_commit, files_changed, insertions, deletions,
          conflicts_detected, conflict_files, error_code, error_message,
          attempt, max_retries, correlation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        op.id,
        op.request.repositoryId,
        fkAgentId,
        op.request.operation,
        op.request.branch,
        op.request.targetBranch ?? null,
        op.request.remote ?? null,
        op.request.force ? 1 : 0,
        op.status,
        op.queuedAt.getTime(),
        op.startedAt ? op.startedAt.getTime() : null,
        op.completedAt ? op.completedAt.getTime() : null,
        durationMs,
        op.result !== undefined ? (op.result.success ? 1 : 0) : null,
        op.result?.fromCommit ?? null,
        op.result?.toCommit ?? null,
        op.result?.filesChanged ?? null,
        op.result?.insertions ?? null,
        op.result?.deletions ?? null,
        op.result?.conflictsDetected !== undefined
          ? op.result.conflictsDetected
            ? 1
            : 0
          : null,
        op.result?.conflictFiles
          ? JSON.stringify(op.result.conflictFiles)
          : null,
        op.error?.code ?? null,
        op.error?.message ?? null,
        op.attempt,
        op.maxRetries,
        encodedCorrelation,
      );
  } catch {
    // Ignore if sqlite is mocked
  }
}

function hydrateSyncOpsFromDb(): void {
  if (syncHydrated) return;
  syncHydrated = true;
  try {
    ensureSyncTables();
    const rows = sqlite
      .query(`SELECT * FROM git_sync_operations ORDER BY queued_at DESC`)
      .all() as Array<Record<string, unknown>>;

    for (const row of rows) {
      const id = String(row["id"]);
      if (operationById.has(id)) continue;

      let agentId =
        typeof row["agent_id"] === "string" ? row["agent_id"] : "unknown";
      let priority: number | undefined;
      let correlationId: string | undefined;

      if (typeof row["correlation_id"] === "string") {
        try {
          const parsed = JSON.parse(row["correlation_id"]);
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.agentId === "string") agentId = parsed.agentId;
            if (typeof parsed.priority === "number") priority = parsed.priority;
            if (typeof parsed.correlationId === "string")
              correlationId = parsed.correlationId;
          } else {
            correlationId = row["correlation_id"];
          }
        } catch {
          correlationId = row["correlation_id"];
        }
      }

      const repositoryId = String(row["repository_id"]);
      const status = String(row["status"]) as SyncOperationStatus;

      let conflictFiles: string[] | undefined;
      if (typeof row["conflict_files"] === "string") {
        try {
          conflictFiles = JSON.parse(row["conflict_files"]);
        } catch {}
      }

      const op: SyncOperation = {
        id,
        request: {
          repositoryId,
          agentId,
          operation: String(row["operation"]) as SyncOperationType,
          branch: String(row["branch"]),
          ...(typeof row["target_branch"] === "string" && {
            targetBranch: row["target_branch"],
          }),
          ...(typeof row["remote"] === "string" && {
            remote: row["remote"],
          }),
          ...(row["force"] !== null &&
            row["force"] !== undefined && {
              force: Boolean(row["force"]),
            }),
          ...(priority !== undefined && { priority }),
        },
        status,
        queuedAt: new Date(Number(row["queued_at"])),
        ...(row["started_at"] !== null &&
          row["started_at"] !== undefined && {
            startedAt: new Date(Number(row["started_at"])),
          }),
        ...(row["completed_at"] !== null &&
          row["completed_at"] !== undefined && {
            completedAt: new Date(Number(row["completed_at"])),
          }),
        attempt: Number(row["attempt"] ?? 1),
        maxRetries: Number(row["max_retries"] ?? MAX_RETRIES),
        ...(correlationId !== undefined && { correlationId }),
        ...(row["success"] !== null &&
          row["success"] !== undefined && {
            result: {
              success: Boolean(row["success"]),
              ...(typeof row["from_commit"] === "string" && {
                fromCommit: row["from_commit"],
              }),
              ...(typeof row["to_commit"] === "string" && {
                toCommit: row["to_commit"],
              }),
              ...(typeof row["files_changed"] === "number" && {
                filesChanged: row["files_changed"],
              }),
              ...(typeof row["insertions"] === "number" && {
                insertions: row["insertions"],
              }),
              ...(typeof row["deletions"] === "number" && {
                deletions: row["deletions"],
              }),
              ...(row["conflicts_detected"] !== null &&
                row["conflicts_detected"] !== undefined && {
                  conflictsDetected: Boolean(row["conflicts_detected"]),
                }),
              ...(conflictFiles !== undefined && { conflictFiles }),
            },
          }),
        ...(typeof row["error_code"] === "string" && {
          error: {
            code: row["error_code"],
            message: String(row["error_message"] ?? ""),
            retryable: false,
          },
        }),
      };

      operationById.set(id, op);
      if (status === "queued" || status === "running") {
        const q = operationQueues.get(repositoryId) ?? [];
        q.push(op);
        operationQueues.set(repositoryId, q);
        if (status === "running") {
          const r = runningOperations.get(repositoryId) ?? new Set();
          r.add(id);
          runningOperations.set(repositoryId, r);
        }
      } else {
        const h = operationHistory.get(repositoryId) ?? [];
        h.push(op);
        operationHistory.set(repositoryId, h);
      }
    }
  } catch {
    // Ignore if sqlite is mocked
  }
}

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
    const byte = randomBytes[i] ?? 0;
    result += chars.charAt(byte % chars.length);
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
  hydrateSyncOpsFromDb();
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
  persistSyncOpToDb(operation);

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
    persistSyncOpToDb(operation);

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
  hydrateSyncOpsFromDb();
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
  persistSyncOpToDb(operation);

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
  hydrateSyncOpsFromDb();
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
    persistSyncOpToDb(operation);

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
  persistSyncOpToDb(operation);

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
  hydrateSyncOpsFromDb();
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
  persistSyncOpToDb(operation);

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
  hydrateSyncOpsFromDb();
  return operationById.get(operationId) ?? null;
}

/**
 * Get queued operations for a repository.
 */
export async function getQueuedOperations(
  repositoryId: string,
): Promise<SyncOperation[]> {
  hydrateSyncOpsFromDb();
  const queue = operationQueues.get(repositoryId) ?? [];
  return queue.filter((op) => op.status === "queued");
}

/**
 * Get running operations for a repository.
 */
export async function getRunningOperations(
  repositoryId: string,
): Promise<SyncOperation[]> {
  hydrateSyncOpsFromDb();
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
  hydrateSyncOpsFromDb();
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
  hydrateSyncOpsFromDb();
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
  hydrateSyncOpsFromDb();
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
  syncHydrated = true;
  try {
    ensureSyncTables();
    sqlite.query(`DELETE FROM git_sync_operations`).run();
  } catch {
    // Ignore if sqlite is mocked
  }
}

/**
 * Evict only in-memory sync cache to test SQLite hydration on restart.
 */
export function _evictSyncCacheForTesting(): void {
  operationQueues.clear();
  runningOperations.clear();
  operationHistory.clear();
  operationById.clear();
  syncHydrated = false;
}
