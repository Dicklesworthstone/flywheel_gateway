/**
 * RU Fleet Service - Fleet Management for Repo Updater.
 *
 * Provides CRUD operations and statistics for fleet repositories.
 * Publishes real-time updates via WebSocket.
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { fleetRepos } from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import { getHub } from "../ws/hub";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export type RepoStatus =
  | "healthy"
  | "dirty"
  | "behind"
  | "ahead"
  | "diverged"
  | "unknown";

export interface FleetRepo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  sshUrl?: string | null;
  localPath?: string | null;
  isCloned: boolean;
  currentBranch?: string | null;
  defaultBranch?: string | null;
  lastCommit?: string | null;
  lastCommitDate?: Date | null;
  lastCommitAuthor?: string | null;
  status: RepoStatus;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  aheadBy: number;
  behindBy: number;
  description?: string | null;
  language?: string | null;
  stars?: number | null;
  isPrivate?: boolean | null;
  isArchived?: boolean | null;
  ruGroup?: string | null;
  ruConfig?: unknown;
  agentsmdPath?: string | null;
  lastScanDate?: Date | null;
  addedAt: Date;
  updatedAt?: Date | null;
  lastSyncAt?: Date | null;
}

export interface FleetStats {
  total: number;
  cloned: number;
  healthy: number;
  dirty: number;
  behind: number;
  ahead: number;
  diverged: number;
  unknown: number;
}

export interface AddRepoParams {
  owner: string;
  name: string;
  url: string;
  sshUrl?: string;
  group?: string;
  description?: string;
  language?: string;
  isPrivate?: boolean;
}

export interface UpdateRepoParams {
  localPath?: string;
  isCloned?: boolean;
  currentBranch?: string;
  defaultBranch?: string;
  lastCommit?: string;
  lastCommitDate?: Date;
  lastCommitAuthor?: string;
  status?: RepoStatus;
  hasUncommittedChanges?: boolean;
  hasUnpushedCommits?: boolean;
  aheadBy?: number;
  behindBy?: number;
  description?: string;
  language?: string;
  stars?: number;
  isPrivate?: boolean;
  isArchived?: boolean;
  ruGroup?: string;
  ruConfig?: unknown;
  agentsmdPath?: string;
  lastScanDate?: Date;
  lastSyncAt?: Date;
}

export interface ListReposOptions {
  status?: RepoStatus;
  group?: string;
  owner?: string;
  isCloned?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Helpers
// ============================================================================

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

const fleetChannel = { type: "system:fleet" as const };

// ============================================================================
// Fleet Repository CRUD
// ============================================================================

/**
 * Get all repos in fleet with optional filtering.
 */
export async function getFleetRepos(
  options?: ListReposOptions,
): Promise<{ repos: FleetRepo[]; total: number }> {
  const correlationId = getCorrelationId();
  const startTime = Date.now();

  // Build conditions array
  const conditions = [];
  if (options?.status) {
    conditions.push(eq(fleetRepos.status, options.status));
  }
  if (options?.group) {
    conditions.push(eq(fleetRepos.ruGroup, options.group));
  }
  if (options?.owner) {
    conditions.push(eq(fleetRepos.owner, options.owner));
  }
  if (options?.isCloned !== undefined) {
    conditions.push(eq(fleetRepos.isCloned, options.isCloned));
  }

  // Get total count
  const [totalResult] = await db
    .select({ count: count() })
    .from(fleetRepos)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Get repos with pagination
  const repos = await db
    .select()
    .from(fleetRepos)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(fleetRepos.fullName)
    .limit(options?.limit || 100)
    .offset(options?.offset || 0);

  logger.info(
    {
      correlationId,
      duration_ms: Date.now() - startTime,
      repoCount: repos.length,
      total: totalResult?.count,
    },
    "Fetched fleet repos",
  );

  return {
    repos: repos as FleetRepo[],
    total: totalResult?.count || 0,
  };
}

/**
 * Get a single repo by ID.
 */
export async function getFleetRepo(repoId: string): Promise<FleetRepo | null> {
  const correlationId = getCorrelationId();

  const repo = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.id, repoId))
    .get();

  if (!repo) {
    logger.debug({ correlationId, repoId }, "Fleet repo not found");
    return null;
  }

  return repo as FleetRepo;
}

/**
 * Get a repo by full name (owner/name).
 */
export async function getFleetRepoByFullName(
  fullName: string,
): Promise<FleetRepo | null> {
  const repo = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.fullName, fullName))
    .get();

  return repo ? (repo as FleetRepo) : null;
}

/**
 * Get fleet statistics.
 */
export async function getFleetStats(): Promise<FleetStats> {
  const correlationId = getCorrelationId();
  const startTime = Date.now();

  const [stats] = await db
    .select({
      total: count(),
      cloned: sql<number>`SUM(CASE WHEN ${fleetRepos.isCloned} THEN 1 ELSE 0 END)`,
      healthy: sql<number>`SUM(CASE WHEN ${fleetRepos.status} = 'healthy' THEN 1 ELSE 0 END)`,
      dirty: sql<number>`SUM(CASE WHEN ${fleetRepos.status} = 'dirty' THEN 1 ELSE 0 END)`,
      behind: sql<number>`SUM(CASE WHEN ${fleetRepos.status} = 'behind' THEN 1 ELSE 0 END)`,
      ahead: sql<number>`SUM(CASE WHEN ${fleetRepos.status} = 'ahead' THEN 1 ELSE 0 END)`,
      diverged: sql<number>`SUM(CASE WHEN ${fleetRepos.status} = 'diverged' THEN 1 ELSE 0 END)`,
      unknown: sql<number>`SUM(CASE WHEN ${fleetRepos.status} = 'unknown' THEN 1 ELSE 0 END)`,
    })
    .from(fleetRepos);

  const result: FleetStats = {
    total: stats?.total || 0,
    cloned: Number(stats?.cloned) || 0,
    healthy: Number(stats?.healthy) || 0,
    dirty: Number(stats?.dirty) || 0,
    behind: Number(stats?.behind) || 0,
    ahead: Number(stats?.ahead) || 0,
    diverged: Number(stats?.diverged) || 0,
    unknown: Number(stats?.unknown) || 0,
  };

  logger.debug(
    {
      correlationId,
      duration_ms: Date.now() - startTime,
      stats: result,
    },
    "Calculated fleet stats",
  );

  return result;
}

/**
 * Add a repository to the fleet.
 */
export async function addRepoToFleet(
  params: AddRepoParams,
): Promise<FleetRepo> {
  const correlationId = getCorrelationId();
  const startTime = Date.now();

  const now = new Date();
  const repo = {
    id: generateId("repo_"),
    owner: params.owner,
    name: params.name,
    fullName: `${params.owner}/${params.name}`,
    url: params.url,
    sshUrl: params.sshUrl,
    ruGroup: params.group,
    description: params.description,
    language: params.language,
    isPrivate: params.isPrivate,
    status: "unknown" as RepoStatus,
    isCloned: false,
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    aheadBy: 0,
    behindBy: 0,
    addedAt: now,
  };

  await db.insert(fleetRepos).values(repo);

  // Publish event
  getHub().publish(fleetChannel, "fleet.repo_added", repo, {
    correlationId,
  });

  logger.info(
    {
      correlationId,
      duration_ms: Date.now() - startTime,
      repoId: repo.id,
      fullName: repo.fullName,
    },
    "Added repo to fleet",
  );

  return repo as FleetRepo;
}

/**
 * Remove a repository from the fleet.
 */
export async function removeRepoFromFleet(repoId: string): Promise<void> {
  const correlationId = getCorrelationId();

  const repo = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.id, repoId))
    .get();

  if (!repo) {
    throw new Error(`Fleet repo not found: ${repoId}`);
  }

  await db.delete(fleetRepos).where(eq(fleetRepos.id, repoId));

  // Publish event
  getHub().publish(
    fleetChannel,
    "fleet.repo_removed",
    { repoId, fullName: repo.fullName },
    { correlationId },
  );

  logger.info(
    { correlationId, repoId, fullName: repo.fullName },
    "Removed repo from fleet",
  );
}

/**
 * Update a repository in the fleet.
 */
export async function updateFleetRepo(
  repoId: string,
  updates: UpdateRepoParams,
): Promise<FleetRepo> {
  const correlationId = getCorrelationId();
  const startTime = Date.now();

  // Check repo exists
  const existing = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.id, repoId))
    .get();

  if (!existing) {
    throw new Error(`Fleet repo not found: ${repoId}`);
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  // Map params to schema fields (using bracket notation for index signature access)
  if (updates.localPath !== undefined) updateData["localPath"] = updates.localPath;
  if (updates.isCloned !== undefined) updateData["isCloned"] = updates.isCloned;
  if (updates.currentBranch !== undefined)
    updateData["currentBranch"] = updates.currentBranch;
  if (updates.defaultBranch !== undefined)
    updateData["defaultBranch"] = updates.defaultBranch;
  if (updates.lastCommit !== undefined)
    updateData["lastCommit"] = updates.lastCommit;
  if (updates.lastCommitDate !== undefined)
    updateData["lastCommitDate"] = updates.lastCommitDate;
  if (updates.lastCommitAuthor !== undefined)
    updateData["lastCommitAuthor"] = updates.lastCommitAuthor;
  if (updates.status !== undefined) updateData["status"] = updates.status;
  if (updates.hasUncommittedChanges !== undefined)
    updateData["hasUncommittedChanges"] = updates.hasUncommittedChanges;
  if (updates.hasUnpushedCommits !== undefined)
    updateData["hasUnpushedCommits"] = updates.hasUnpushedCommits;
  if (updates.aheadBy !== undefined) updateData["aheadBy"] = updates.aheadBy;
  if (updates.behindBy !== undefined) updateData["behindBy"] = updates.behindBy;
  if (updates.description !== undefined)
    updateData["description"] = updates.description;
  if (updates.language !== undefined) updateData["language"] = updates.language;
  if (updates.stars !== undefined) updateData["stars"] = updates.stars;
  if (updates.isPrivate !== undefined) updateData["isPrivate"] = updates.isPrivate;
  if (updates.isArchived !== undefined)
    updateData["isArchived"] = updates.isArchived;
  if (updates.ruGroup !== undefined) updateData["ruGroup"] = updates.ruGroup;
  if (updates.ruConfig !== undefined) updateData["ruConfig"] = updates.ruConfig;
  if (updates.agentsmdPath !== undefined)
    updateData["agentsmdPath"] = updates.agentsmdPath;
  if (updates.lastScanDate !== undefined)
    updateData["lastScanDate"] = updates.lastScanDate;
  if (updates.lastSyncAt !== undefined)
    updateData["lastSyncAt"] = updates.lastSyncAt;

  await db.update(fleetRepos).set(updateData).where(eq(fleetRepos.id, repoId));

  // Fetch updated repo
  const updated = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.id, repoId))
    .get();

  // Publish event
  getHub().publish(
    fleetChannel,
    "fleet.repo_updated",
    { repoId, updates, repo: updated },
    { correlationId },
  );

  logger.info(
    {
      correlationId,
      duration_ms: Date.now() - startTime,
      repoId,
      updates: Object.keys(updates),
    },
    "Updated fleet repo",
  );

  return updated as FleetRepo;
}

/**
 * Get repos by group.
 */
export async function getReposByGroup(group: string): Promise<FleetRepo[]> {
  const repos = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.ruGroup, group))
    .orderBy(fleetRepos.fullName);

  return repos as FleetRepo[];
}

/**
 * Get all unique groups.
 */
export async function getFleetGroups(): Promise<string[]> {
  const result = await db
    .selectDistinct({ group: fleetRepos.ruGroup })
    .from(fleetRepos)
    .where(sql`${fleetRepos.ruGroup} IS NOT NULL`);

  return result.map((r) => r.group).filter((g): g is string => g !== null);
}

/**
 * Get repos that need syncing (not cloned or behind).
 */
export async function getReposNeedingSync(): Promise<FleetRepo[]> {
  const repos = await db
    .select()
    .from(fleetRepos)
    .where(
      sql`${fleetRepos.isCloned} = 0 OR ${fleetRepos.status} IN ('behind', 'diverged', 'unknown')`,
    )
    .orderBy(fleetRepos.fullName);

  return repos as FleetRepo[];
}

/**
 * Get repos with uncommitted changes.
 */
export async function getReposWithUncommittedChanges(): Promise<FleetRepo[]> {
  const repos = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.hasUncommittedChanges, true))
    .orderBy(fleetRepos.fullName);

  return repos as FleetRepo[];
}

/**
 * Get repos with unpushed commits.
 */
export async function getReposWithUnpushedCommits(): Promise<FleetRepo[]> {
  const repos = await db
    .select()
    .from(fleetRepos)
    .where(eq(fleetRepos.hasUnpushedCommits, true))
    .orderBy(fleetRepos.fullName);

  return repos as FleetRepo[];
}
