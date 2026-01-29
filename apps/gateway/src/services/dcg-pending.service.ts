/**
 * DCG Pending Exceptions Service - Allow-once workflow for bypassing false positives.
 *
 * Enables users to approve blocked commands for single execution using a short code,
 * without permanently allowlisting dangerous patterns.
 */

import { createHash } from "node:crypto";
import {
  createCursor,
  DEFAULT_PAGINATION,
  decodeCursor,
} from "@flywheel/shared/api/pagination";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { dcgPendingExceptions } from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import { redactCommand } from "../utils/redaction";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export type PendingExceptionStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "executed";

export type DCGPendingSeverity = "critical" | "high" | "medium" | "low";

export interface PendingException {
  id: string;
  shortCode: string;
  command: string;
  commandHash: string;
  pack: string;
  ruleId: string;
  reason: string;
  severity: DCGPendingSeverity;
  agentId?: string;
  blockEventId?: string;
  status: PendingExceptionStatus;
  approvedBy?: string;
  approvedAt?: Date;
  deniedBy?: string;
  deniedAt?: Date;
  denyReason?: string;
  executedAt?: Date;
  executionResult?: "success" | "failed";
  createdAt: Date;
  expiresAt: Date;
}

export interface CreatePendingExceptionParams {
  command: string;
  pack: string;
  ruleId: string;
  reason: string;
  severity: DCGPendingSeverity;
  agentId?: string;
  blockEventId?: string;
  ttlSeconds?: number;
}

export interface ListPendingExceptionsParams {
  status?: PendingExceptionStatus;
  agentId?: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

export interface ListPendingExceptionsResult {
  exceptions: PendingException[];
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

/**
 * Generate a cryptographically secure random ID.
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `${prefix}_${result}`;
}

/**
 * Generate a short 6-character code for user-friendly approval.
 */
function generateShortCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return result;
}

/**
 * Compute SHA-256 hash of a command for verification.
 */
function hashCommand(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

/**
 * Convert database row to PendingException interface.
 */
function rowToException(
  row: typeof dcgPendingExceptions.$inferSelect,
): PendingException {
  const exception: PendingException = {
    id: row.id,
    shortCode: row.shortCode,
    command: row.command,
    commandHash: row.commandHash,
    pack: row.pack,
    ruleId: row.ruleId,
    reason: row.reason,
    severity: row.severity as DCGPendingSeverity,
    status: row.status as PendingExceptionStatus,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };

  if (row.agentId) exception.agentId = row.agentId;
  if (row.blockEventId) exception.blockEventId = row.blockEventId;
  if (row.approvedBy) exception.approvedBy = row.approvedBy;
  if (row.approvedAt) exception.approvedAt = row.approvedAt;
  if (row.deniedBy) exception.deniedBy = row.deniedBy;
  if (row.deniedAt) exception.deniedAt = row.deniedAt;
  if (row.denyReason) exception.denyReason = row.denyReason;
  if (row.executedAt) exception.executedAt = row.executedAt;
  if (row.executionResult)
    exception.executionResult = row.executionResult as "success" | "failed";

  return exception;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new pending exception from a block event.
 */
export async function createPendingException(
  params: CreatePendingExceptionParams,
): Promise<PendingException> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId });
  const startTime = Date.now();

  const id = generateId("dcg_pend");
  const shortCode = generateShortCode();
  const commandHash = hashCommand(params.command);
  const now = new Date();
  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const values: typeof dcgPendingExceptions.$inferInsert = {
    id,
    shortCode,
    command: params.command,
    commandHash,
    pack: params.pack,
    ruleId: params.ruleId,
    reason: params.reason,
    severity: params.severity,
    status: "pending",
    createdAt: now,
    expiresAt,
  };

  if (params.agentId !== undefined) values.agentId = params.agentId;
  if (params.blockEventId !== undefined)
    values.blockEventId = params.blockEventId;

  await db.insert(dcgPendingExceptions).values(values);

  const exception: PendingException = {
    id,
    shortCode,
    command: params.command,
    commandHash,
    pack: params.pack,
    ruleId: params.ruleId,
    reason: params.reason,
    severity: params.severity,
    status: "pending",
    createdAt: now,
    expiresAt,
  };

  if (params.agentId) exception.agentId = params.agentId;
  if (params.blockEventId) exception.blockEventId = params.blockEventId;

  // Publish WebSocket event
  const channel: Channel = { type: "system:dcg" };
  getHub().publish(
    channel,
    "dcg.pending_created",
    {
      shortCode,
      command: redactCommand(params.command),
      pack: params.pack,
      severity: params.severity,
      expiresAt: expiresAt.toISOString(),
    },
    { correlationId },
  );

  log.info(
    {
      duration_ms: Date.now() - startTime,
      shortCode,
      ruleId: params.ruleId,
      expiresAt: expiresAt.toISOString(),
    },
    "Created pending exception",
  );

  return exception;
}

/**
 * Get a pending exception by short code.
 */
export async function getPendingException(
  shortCode: string,
): Promise<PendingException | null> {
  const row = await db
    .select()
    .from(dcgPendingExceptions)
    .where(eq(dcgPendingExceptions.shortCode, shortCode))
    .get();

  if (!row) return null;
  return rowToException(row);
}

/**
 * Get a pending exception by ID.
 */
export async function getPendingExceptionById(
  id: string,
): Promise<PendingException | null> {
  const row = await db
    .select()
    .from(dcgPendingExceptions)
    .where(eq(dcgPendingExceptions.id, id))
    .get();

  if (!row) return null;
  return rowToException(row);
}

/**
 * List pending exceptions with optional filters and cursor-based pagination.
 */
export async function listPendingExceptions(
  params: ListPendingExceptionsParams = {},
): Promise<ListPendingExceptionsResult> {
  const limit = params.limit ?? DEFAULT_PAGINATION.limit;
  const conditions = [];

  // Add filter conditions
  if (params.status) {
    conditions.push(eq(dcgPendingExceptions.status, params.status));
  }
  if (params.agentId) {
    conditions.push(eq(dcgPendingExceptions.agentId, params.agentId));
  }

  // Handle cursor-based pagination
  if (params.startingAfter) {
    const decoded = decodeCursor(params.startingAfter);
    if (decoded) {
      // Get the cursor item's createdAt for pagination
      const cursorRow = await db
        .select({ createdAt: dcgPendingExceptions.createdAt })
        .from(dcgPendingExceptions)
        .where(eq(dcgPendingExceptions.id, decoded.id))
        .get();
      if (cursorRow) {
        conditions.push(
          lt(dcgPendingExceptions.createdAt, cursorRow.createdAt),
        );
      }
    }
  } else if (params.endingBefore) {
    const decoded = decodeCursor(params.endingBefore);
    if (decoded) {
      const cursorRow = await db
        .select({ createdAt: dcgPendingExceptions.createdAt })
        .from(dcgPendingExceptions)
        .where(eq(dcgPendingExceptions.id, decoded.id))
        .get();
      if (cursorRow) {
        conditions.push(
          gt(dcgPendingExceptions.createdAt, cursorRow.createdAt),
        );
      }
    }
  }

  // Build and execute query
  let query = db
    .select()
    .from(dcgPendingExceptions)
    .orderBy(desc(dcgPendingExceptions.createdAt))
    .limit(limit + 1); // Fetch one extra to determine hasMore

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query;
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const exceptions = resultRows.map(rowToException);

  const result: ListPendingExceptionsResult = {
    exceptions,
    hasMore,
  };

  // Add cursors if there are results
  if (exceptions.length > 0) {
    const lastItem = exceptions[exceptions.length - 1]!;
    const firstItem = exceptions[0]!;

    if (hasMore) {
      result.nextCursor = createCursor(lastItem.id);
    }
    if (params.startingAfter) {
      result.prevCursor = createCursor(firstItem.id);
    }
  }

  return result;
}

/**
 * Approve a pending exception.
 */
export async function approvePendingException(
  shortCode: string,
  approvedBy: string,
): Promise<PendingException> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, shortCode });

  const exception = await getPendingException(shortCode);
  if (!exception) {
    throw new PendingExceptionNotFoundError(shortCode);
  }

  if (exception.status !== "pending") {
    throw new PendingExceptionConflictError(
      `Exception already ${exception.status}`,
    );
  }

  if (exception.expiresAt < new Date()) {
    throw new PendingExceptionExpiredError(exception.expiresAt);
  }

  const now = new Date();
  await db
    .update(dcgPendingExceptions)
    .set({
      status: "approved",
      approvedBy,
      approvedAt: now,
    })
    .where(eq(dcgPendingExceptions.id, exception.id));

  // Publish WebSocket event
  const channel: Channel = { type: "system:dcg" };
  getHub().publish(
    channel,
    "dcg.pending_approved",
    { shortCode, approvedBy },
    { correlationId },
  );

  log.info({ approvedBy }, "Approved pending exception");

  return {
    ...exception,
    status: "approved",
    approvedBy,
    approvedAt: now,
  };
}

/**
 * Deny a pending exception.
 */
export async function denyPendingException(
  shortCode: string,
  deniedBy: string,
  reason?: string,
): Promise<PendingException> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, shortCode });

  const exception = await getPendingException(shortCode);
  if (!exception) {
    throw new PendingExceptionNotFoundError(shortCode);
  }

  if (exception.status !== "pending") {
    throw new PendingExceptionConflictError(
      `Exception already ${exception.status}`,
    );
  }

  const now = new Date();
  const updates: Partial<typeof dcgPendingExceptions.$inferInsert> = {
    status: "denied",
    deniedBy,
    deniedAt: now,
  };
  if (reason !== undefined) updates.denyReason = reason;

  await db
    .update(dcgPendingExceptions)
    .set(updates)
    .where(eq(dcgPendingExceptions.id, exception.id));

  // Publish WebSocket event
  const channel: Channel = { type: "system:dcg" };
  getHub().publish(
    channel,
    "dcg.pending_denied",
    { shortCode, deniedBy, reason },
    { correlationId },
  );

  log.info({ deniedBy, reason }, "Denied pending exception");

  const result: PendingException = {
    ...exception,
    status: "denied",
    deniedBy,
    deniedAt: now,
  };
  if (reason !== undefined) {
    result.denyReason = reason;
  }

  return result;
}

/**
 * Validate if a command hash has an approved exception for execution.
 * Returns the exception if valid, null otherwise.
 */
export async function validateExceptionForExecution(
  commandHash: string,
): Promise<PendingException | null> {
  const now = new Date();

  const row = await db
    .select()
    .from(dcgPendingExceptions)
    .where(
      and(
        eq(dcgPendingExceptions.commandHash, commandHash),
        eq(dcgPendingExceptions.status, "approved"),
        gt(dcgPendingExceptions.expiresAt, now),
      ),
    )
    .get();

  if (!row) return null;
  return rowToException(row);
}

/**
 * Mark an exception as executed after the command runs.
 */
export async function markExceptionExecuted(
  id: string,
  result: "success" | "failed",
): Promise<void> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, exceptionId: id });

  await db
    .update(dcgPendingExceptions)
    .set({
      status: "executed",
      executedAt: new Date(),
      executionResult: result,
    })
    .where(eq(dcgPendingExceptions.id, id));

  log.info({ result }, "Marked pending exception as executed");
}

/**
 * Clean up expired pending exceptions.
 * Returns the count of exceptions that were marked as expired.
 */
export async function cleanupExpiredExceptions(): Promise<number> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId });
  const now = new Date();

  const result = await db
    .update(dcgPendingExceptions)
    .set({ status: "expired" })
    .where(
      and(
        eq(dcgPendingExceptions.status, "pending"),
        lt(dcgPendingExceptions.expiresAt, now),
      ),
    )
    .returning();

  const expiredCount = result.length;

  if (expiredCount > 0) {
    log.info({ expiredCount }, "Cleaned up expired pending exceptions");
  }

  return expiredCount;
}

// ============================================================================
// Cleanup Job
// ============================================================================

const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic cleanup job for expired pending exceptions.
 * Safe to call multiple times - will only start one job.
 */
export function startDCGCleanupJob(): void {
  if (cleanupInterval) {
    return; // Already running
  }

  cleanupInterval = setInterval(() => {
    cleanupExpiredExceptions().catch((err) => {
      logger.error({ error: err }, "Error in DCG pending cleanup job");
    });
  }, CLEANUP_INTERVAL_MS);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS },
    "DCG pending exceptions cleanup job started",
  );
}

/**
 * Stop the cleanup job (for tests).
 */
export function stopDCGCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class PendingExceptionNotFoundError extends Error {
  constructor(shortCode: string) {
    super(`Pending exception not found: ${shortCode}`);
    this.name = "PendingExceptionNotFoundError";
  }
}

export class PendingExceptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingExceptionConflictError";
  }
}

export class PendingExceptionExpiredError extends Error {
  public expiredAt: Date;

  constructor(expiredAt: Date) {
    super(`Exception expired at ${expiredAt.toISOString()}`);
    this.name = "PendingExceptionExpiredError";
    this.expiredAt = expiredAt;
  }
}

// ============================================================================
// Test Helpers (exported for test cleanup)
// ============================================================================

export async function _clearAllPendingExceptions(): Promise<void> {
  await db.delete(dcgPendingExceptions);
}
