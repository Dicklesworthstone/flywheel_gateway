/**
 * RU Sync Service - Fleet Synchronization Operations.
 *
 * Handles clone, pull, fetch, and push operations for fleet repositories.
 * Spawns RU CLI processes and tracks results in the database.
 */

import { type Subprocess, spawn } from "bun";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { fleetRepos, fleetSyncOps } from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import { logger } from "./logger";
import {
  publishSyncCancelled,
  publishSyncCompleted,
  publishSyncProgress,
  publishSyncStarted,
} from "./ru-events";
import {
  type FleetRepo,
  type RepoStatus,
  type UpdateRepoParams,
  updateFleetRepo,
} from "./ru-fleet.service";

// ============================================================================
// Types
// ============================================================================

export type SyncOperation = "clone" | "pull" | "fetch" | "push";
export type SyncStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface SyncOptions {
  /** Number of parallel sync operations (default: 4) */
  parallelism?: number;
  /** Don't actually sync, just report what would happen */
  dryRun?: boolean;
  /** Force sync even if repo appears up-to-date */
  force?: boolean;
  /** Filter which repos to sync */
  filter?: {
    repos?: string[];
    group?: string;
    owner?: string;
  };
}

export interface SyncOpRecord {
  id: string;
  repoId: string | null;
  repoFullName: string;
  operation: SyncOperation;
  status: SyncStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  fromCommit: string | null;
  toCommit: string | null;
  commitCount: number | null;
  filesChanged: number | null;
  error: string | null;
  errorCode: string | null;
  retryCount: number;
  triggeredBy: string | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface SyncProgress {
  sessionId: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  current?: string;
}

export interface SyncResult {
  sessionId: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  durationMs: number;
  operations: SyncOpRecord[];
}

// ============================================================================
// State
// ============================================================================

// Active sync processes by repo ID
const activeSyncs = new Map<string, Subprocess>();

// Active sync sessions
const activeSessions = new Map<
  string,
  {
    aborted: boolean;
    startTime: number;
    repos: FleetRepo[];
  }
>();

// ============================================================================
// Helpers
// ============================================================================

const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Safely read a stream up to a limit, draining excess to avoid pipe blocking.
 */
async function readStreamSafe(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let totalBytes = 0;
  const drainLimit = maxBytes * 5;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;

      if (content.length < maxBytes) {
        content += decoder.decode(value, { stream: true });
      }

      if (totalBytes > drainLimit) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // Ignore errors
  } finally {
    reader.releaseLock();
  }

  // Flush decoder
  if (content.length < maxBytes) {
    content += decoder.decode();
  }

  if (content.length > maxBytes) {
    content = `${content.slice(0, maxBytes)}\n[TRUNCATED]`;
  }

  return content;
}

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
  return `${prefix}${result}`;
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Start a fleet sync operation.
 */
export async function startFleetSync(
  triggeredBy: string,
  options?: SyncOptions,
): Promise<{ sessionId: string }> {
  const correlationId = getCorrelationId();
  const sessionId = generateId("sync_");
  const startTime = Date.now();

  logger.info(
    { correlationId, sessionId, triggeredBy, options },
    "Starting fleet sync",
  );

  // Get target repos
  let repos: FleetRepo[];
  if (options?.filter?.repos) {
    const result = await db
      .select()
      .from(fleetRepos)
      .where(inArray(fleetRepos.id, options.filter.repos));
    repos = result as FleetRepo[];
  } else if (options?.filter?.group) {
    const result = await db
      .select()
      .from(fleetRepos)
      .where(eq(fleetRepos.ruGroup, options.filter.group));
    repos = result as FleetRepo[];
  } else if (options?.filter?.owner) {
    const result = await db
      .select()
      .from(fleetRepos)
      .where(eq(fleetRepos.owner, options.filter.owner));
    repos = result as FleetRepo[];
  } else {
    const result = await db.select().from(fleetRepos);
    repos = result as FleetRepo[];
  }

  if (repos.length === 0) {
    logger.info({ correlationId, sessionId }, "No repos to sync");
    return { sessionId };
  }

  // Create sync operation records
  const now = new Date();
  const operations = repos.map((repo) => ({
    id: generateId("syncop_"),
    repoId: repo.id,
    repoFullName: repo.fullName,
    operation: (repo.isCloned ? "pull" : "clone") as SyncOperation,
    status: "pending" as SyncStatus,
    triggeredBy,
    correlationId: sessionId,
    retryCount: 0,
    createdAt: now,
  }));

  await db.insert(fleetSyncOps).values(operations);

  // Track session
  activeSessions.set(sessionId, {
    aborted: false,
    startTime,
    repos,
  });

  // Publish start event
  publishSyncStarted({
    sessionId,
    repoCount: repos.length,
    triggeredBy,
  });

  // Start sync process (non-blocking)
  runSyncProcess(sessionId, repos, options).catch((error) => {
    logger.error({ correlationId, sessionId, error }, "Sync process failed");
  });

  return { sessionId };
}

/**
 * Run the actual sync process.
 */
async function runSyncProcess(
  sessionId: string,
  repos: FleetRepo[],
  options?: SyncOptions,
): Promise<void> {
  const correlationId = getCorrelationId();
  const parallelism = options?.parallelism || 4;
  const session = activeSessions.get(sessionId);

  if (!session) {
    logger.warn({ correlationId, sessionId }, "Session not found");
    return;
  }

  let completed = 0;
  let failed = 0;
  let cancelled = 0;

  // Process repos in batches
  for (let i = 0; i < repos.length; i += parallelism) {
    // Check if session was cancelled
    if (session.aborted) {
      cancelled = repos.length - completed - failed;
      break;
    }

    const batch = repos.slice(i, i + parallelism);

    await Promise.all(
      batch.map(async (repo) => {
        if (session.aborted) {
          cancelled++;
          return;
        }

        const opStartTime = Date.now();

        try {
          // Update status to running
          await db
            .update(fleetSyncOps)
            .set({ status: "running", startedAt: new Date() })
            .where(
              and(
                eq(fleetSyncOps.repoId, repo.id),
                eq(fleetSyncOps.correlationId, sessionId),
              ),
            );

          publishSyncProgress({
            sessionId,
            repoId: repo.id,
            fullName: repo.fullName,
            status: "running",
            completed,
            failed,
            total: repos.length,
          });

          // Determine operation
          const operation: SyncOperation = repo.isCloned ? "pull" : "clone";

          // Build RU command
          const args = ["ru", "sync", "--json", repo.fullName];
          if (options?.dryRun) args.push("--dry-run");
          if (options?.force) args.push("--force");

          // Spawn RU process
          const proc = spawn(args, { stdout: "pipe", stderr: "pipe" });
          activeSyncs.set(repo.id, proc);

          const stdout = await readStreamSafe(proc.stdout, MAX_LOG_BYTES);
          const stderr = await readStreamSafe(proc.stderr, MAX_LOG_BYTES);
          const exitCode = await proc.exited;

          activeSyncs.delete(repo.id);

          const duration = Date.now() - opStartTime;

          if (exitCode === 0) {
            // Success - parse result
            let result: {
              commit?: string;
              commits?: number;
              files?: number;
            } = {};
            try {
              result = JSON.parse(stdout);
            } catch {
              // Ignore parse errors
            }

            await db
              .update(fleetSyncOps)
              .set({
                status: "success",
                completedAt: new Date(),
                durationMs: duration,
                toCommit: result.commit,
                commitCount: result.commits,
                filesChanged: result.files,
              })
              .where(
                and(
                  eq(fleetSyncOps.repoId, repo.id),
                  eq(fleetSyncOps.correlationId, sessionId),
                ),
              );

            // Update repo status - build params conditionally for exactOptionalPropertyTypes
            const updateParams: UpdateRepoParams = {
              isCloned: true,
              status: "healthy" as RepoStatus,
              lastSyncAt: new Date(),
            };
            if (result.commit) updateParams.lastCommit = result.commit;
            await updateFleetRepo(repo.id, updateParams);

            completed++;
          } else {
            // Failed
            await db
              .update(fleetSyncOps)
              .set({
                status: "failed",
                completedAt: new Date(),
                durationMs: duration,
                error: stderr || stdout || "Unknown error",
                errorCode: `EXIT_${exitCode}`,
              })
              .where(
                and(
                  eq(fleetSyncOps.repoId, repo.id),
                  eq(fleetSyncOps.correlationId, sessionId),
                ),
              );

            failed++;
          }

          // Publish progress
          publishSyncProgress({
            sessionId,
            repoId: repo.id,
            fullName: repo.fullName,
            status: exitCode === 0 ? "success" : "failed",
            completed,
            failed,
            total: repos.length,
            duration,
          });

          logger.info(
            {
              correlationId,
              sessionId,
              repoId: repo.id,
              operation,
              success: exitCode === 0,
              duration_ms: duration,
            },
            "Sync operation completed",
          );
        } catch (error) {
          failed++;
          logger.error(
            { correlationId, sessionId, repoId: repo.id, error },
            "Sync operation failed",
          );
        }
      }),
    );
  }

  // Session complete
  activeSessions.delete(sessionId);

  const totalDuration = Date.now() - session.startTime;

  // Publish completion
  publishSyncCompleted({
    sessionId,
    completed,
    failed,
    cancelled,
    total: repos.length,
    durationMs: totalDuration,
  });

  logger.info(
    {
      correlationId,
      sessionId,
      completed,
      failed,
      cancelled,
      total: repos.length,
      duration_ms: totalDuration,
    },
    "Fleet sync completed",
  );
}

/**
 * Cancel a running sync session.
 */
export async function cancelSync(sessionId: string): Promise<void> {
  const correlationId = getCorrelationId();
  const session = activeSessions.get(sessionId);

  if (!session) {
    logger.warn(
      { correlationId, sessionId },
      "Session not found or already completed",
    );
    return;
  }

  // Mark session as aborted
  session.aborted = true;

  // Kill active processes
  for (const [repoId, proc] of activeSyncs) {
    proc.kill();
    activeSyncs.delete(repoId);
  }

  // Update pending operations to cancelled
  await db
    .update(fleetSyncOps)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(fleetSyncOps.correlationId, sessionId),
        inArray(fleetSyncOps.status, ["pending", "running"]),
      ),
    );

  // Publish cancellation
  publishSyncCancelled(sessionId);

  logger.info({ correlationId, sessionId }, "Sync session cancelled");
}

/**
 * Get sync operation history.
 */
export async function getSyncHistory(options?: {
  repoId?: string;
  sessionId?: string;
  status?: SyncStatus;
  limit?: number;
  offset?: number;
}): Promise<{ operations: SyncOpRecord[]; total: number }> {
  const correlationId = getCorrelationId();

  // Build conditions
  const conditions = [];
  if (options?.repoId) {
    conditions.push(eq(fleetSyncOps.repoId, options.repoId));
  }
  if (options?.sessionId) {
    conditions.push(eq(fleetSyncOps.correlationId, options.sessionId));
  }
  if (options?.status) {
    conditions.push(eq(fleetSyncOps.status, options.status));
  }

  // Get total count
  const [totalResult] = await db
    .select({ count: count() })
    .from(fleetSyncOps)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Get operations
  const operations = await db
    .select()
    .from(fleetSyncOps)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(fleetSyncOps.createdAt))
    .limit(options?.limit || 50)
    .offset(options?.offset || 0);

  logger.debug(
    {
      correlationId,
      count: operations.length,
      total: totalResult?.count,
    },
    "Fetched sync history",
  );

  return {
    operations: operations as SyncOpRecord[],
    total: totalResult?.count || 0,
  };
}

/**
 * Get a specific sync operation.
 */
export async function getSyncOperation(
  opId: string,
): Promise<SyncOpRecord | null> {
  const op = await db
    .select()
    .from(fleetSyncOps)
    .where(eq(fleetSyncOps.id, opId))
    .get();

  return op ? (op as SyncOpRecord) : null;
}

/**
 * Get active sync sessions.
 */
export function getActiveSyncSessions(): Array<{
  sessionId: string;
  startTime: number;
  repoCount: number;
}> {
  const sessions: Array<{
    sessionId: string;
    startTime: number;
    repoCount: number;
  }> = [];

  for (const [sessionId, session] of activeSessions) {
    sessions.push({
      sessionId,
      startTime: session.startTime,
      repoCount: session.repos.length,
    });
  }

  return sessions;
}

/**
 * Check if a sync session is active.
 */
export function isSyncSessionActive(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/**
 * Sync a single repository.
 */
export async function syncSingleRepo(
  repoId: string,
  triggeredBy: string,
  options?: { force?: boolean; dryRun?: boolean },
): Promise<{ sessionId: string }> {
  return startFleetSync(triggeredBy, {
    ...options,
    filter: { repos: [repoId] },
  });
}

/**
 * Get sync stats for a time period.
 */
export async function getSyncStats(since?: Date): Promise<{
  total: number;
  success: number;
  failed: number;
  avgDurationMs: number;
}> {
  const conditions = since
    ? [sql`${fleetSyncOps.createdAt} >= ${since.getTime()}`]
    : [];

  const [stats] = await db
    .select({
      total: count(),
      success: sql<number>`SUM(CASE WHEN ${fleetSyncOps.status} = 'success' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${fleetSyncOps.status} = 'failed' THEN 1 ELSE 0 END)`,
      avgDurationMs: sql<number>`AVG(${fleetSyncOps.durationMs})`,
    })
    .from(fleetSyncOps)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return {
    total: stats?.total || 0,
    success: Number(stats?.success) || 0,
    failed: Number(stats?.failed) || 0,
    avgDurationMs: Number(stats?.avgDurationMs) || 0,
  };
}
