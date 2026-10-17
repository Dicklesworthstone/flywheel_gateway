/**
 * Git Coordination Service.
 *
 * Provides centralized management of git operations across multiple agents
 * working in the same repository. Prevents merge conflicts, manages branch
 * assignments, and provides conflict prediction.
 *
 * Key capabilities:
 * - Branch assignment with exclusive ownership
 * - Conflict prediction before agents begin work
 * - Sync operation coordination
 * - Real-time status updates via WebSocket
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

/** Default TTL for branch assignments (30 minutes) */
const DEFAULT_ASSIGNMENT_TTL_MS = 30 * 60 * 1000;

/** Maximum TTL for branch assignments (4 hours) */
const MAX_ASSIGNMENT_TTL_MS = 4 * 60 * 60 * 1000;

/** Background cleanup interval (30 seconds) */
const CLEANUP_INTERVAL_MS = 30_000;

/** Warning threshold before assignment expires (2 minutes) */
const EXPIRATION_WARNING_MS = 2 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export type BranchAssignmentStatus = "active" | "stale" | "merged" | "expired";

export interface BranchAssignment {
  id: string;
  repositoryId: string;
  agentId: string;
  branchName: string;
  baseBranch: string;
  status: BranchAssignmentStatus;
  assignedAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  metadata: {
    taskId?: string;
    taskDescription?: string;
    reservedPatterns?: string[];
  };
}

export interface ConflictPrediction {
  id: string;
  repositoryId: string;
  branchA: string;
  branchB: string;
  hasConflicts: boolean;
  conflictingFiles: string[];
  severity: "none" | "low" | "medium" | "high";
  recommendation: string;
  predictedAt: Date;
  details: {
    commonAncestor?: string;
    changesInA: number;
    changesInB: number;
    overlappingFiles: string[];
  };
}

export interface MergeBaseInfo {
  branch: string;
  target: string;
  mergeBase: string;
  aheadBy: number;
  behindBy: number;
  diverged: boolean;
  lastChecked: Date;
}

export interface SyncOperation {
  type: "pull" | "push" | "fetch" | "rebase";
  branch: string;
  remote?: string;
  force?: boolean;
}

export interface SyncResult {
  success: boolean;
  operation: SyncOperation;
  fromCommit?: string;
  toCommit?: string;
  filesChanged?: number;
  error?: string;
  duration: number;
}

export interface GitGraphNode {
  sha: string;
  message: string;
  author: string;
  date: Date;
  parents: string[];
  branches: string[];
  isHead: boolean;
  isMerge: boolean;
}

export interface GitGraphData {
  nodes: GitGraphNode[];
  edges: Array<{ from: string; to: string }>;
  branches: Array<{
    name: string;
    sha: string;
    isDefault: boolean;
    assignedTo?: string;
  }>;
}

export interface AssignBranchParams {
  repositoryId: string;
  agentId: string;
  branchName: string;
  baseBranch?: string;
  ttlMs?: number;
  taskId?: string;
  taskDescription?: string;
  reservedPatterns?: string[];
}

export interface AssignBranchResult {
  assignment: BranchAssignment | null;
  granted: boolean;
  error?: string;
  existingAssignment?: BranchAssignment;
}

export interface ReleaseBranchParams {
  repositoryId: string;
  agentId: string;
  branchName?: string;
}

export interface ReleaseBranchResult {
  released: boolean;
  releasedAssignments: string[];
  error?: string;
}

export interface RenewAssignmentParams {
  assignmentId: string;
  agentId: string;
  additionalTtlMs?: number;
}

export interface RenewAssignmentResult {
  renewed: boolean;
  newExpiresAt?: Date;
  error?: string;
}

export interface PredictConflictsParams {
  repositoryId: string;
  branchA: string;
  branchB: string;
}

export interface GetOverlappingFilesParams {
  repositoryId: string;
  branches: string[];
}

export interface FileOverlapReport {
  repositoryId: string;
  branches: string[];
  overlappingFiles: Array<{
    path: string;
    modifiedIn: string[];
    risk: "low" | "medium" | "high";
  }>;
  generatedAt: Date;
}

// ============================================================================
// Storage
// ============================================================================

/** In-memory storage for branch assignments */
const assignmentStore: Map<string, BranchAssignment> = new Map();

/** In-memory storage for conflict predictions (cached) */
const predictionCache: Map<string, ConflictPrediction> = new Map();

/** In-memory storage for merge base info (cached) */
const mergeBaseCache: Map<string, MergeBaseInfo> = new Map();

/** Cleanup interval handle */
let cleanupInterval: Timer | null = null;

/** Track which assignments have been warned about expiring */
const warnedAssignments: Set<string> = new Set();

let gitTablesReady = false;
let gitHydrated = false;

function ensureGitTables(): void {
  if (gitTablesReady) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS branch_assignments (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        repository_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        base_branch TEXT NOT NULL DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'active',
        assigned_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        task_id TEXT,
        task_description TEXT,
        reserved_patterns TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS conflict_predictions (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        branch_a TEXT NOT NULL,
        branch_b TEXT NOT NULL,
        has_conflicts INTEGER NOT NULL DEFAULT 0,
        conflicting_files TEXT,
        severity TEXT NOT NULL DEFAULT 'none',
        recommendation TEXT,
        common_ancestor TEXT,
        changes_in_a INTEGER NOT NULL DEFAULT 0,
        changes_in_b INTEGER NOT NULL DEFAULT 0,
        overlapping_files TEXT,
        predicted_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    gitTablesReady = true;
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

function persistAssignmentToDb(assignment: BranchAssignment): void {
  try {
    ensureGitTables();
    const fkAgentId = resolveNullableAgentFk(assignment.agentId);
    const reservedPayload = JSON.stringify({
      agentId: assignment.agentId,
      patterns: assignment.metadata.reservedPatterns ?? undefined,
    });
    sqlite
      .query(
        `DELETE FROM branch_assignments WHERE repository_id = ? AND branch_name = ? AND id != ?`,
      )
      .run(assignment.repositoryId, assignment.branchName, assignment.id);
    sqlite
      .query(
        `INSERT OR REPLACE INTO branch_assignments (
          id, agent_id, repository_id, branch_name, base_branch, status,
          assigned_at, expires_at, last_activity_at, task_id, task_description,
          reserved_patterns, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assignment.id,
        fkAgentId,
        assignment.repositoryId,
        assignment.branchName,
        assignment.baseBranch,
        assignment.status,
        assignment.assignedAt.getTime(),
        assignment.expiresAt.getTime(),
        assignment.lastActivityAt.getTime(),
        assignment.metadata.taskId ?? null,
        assignment.metadata.taskDescription ?? null,
        reservedPayload,
        assignment.assignedAt.getTime(),
        assignment.lastActivityAt.getTime(),
      );
  } catch {
    // Ignore if sqlite is mocked
  }
}

function deleteAssignmentFromDb(assignmentId: string): void {
  try {
    ensureGitTables();
    sqlite
      .query(`DELETE FROM branch_assignments WHERE id = ?`)
      .run(assignmentId);
  } catch {
    // Ignore if sqlite is mocked
  }
}

function persistPredictionToDb(prediction: ConflictPrediction): void {
  try {
    ensureGitTables();
    const expiresAtMs = prediction.predictedAt.getTime() + 5 * 60 * 1000;
    sqlite
      .query(
        `INSERT OR REPLACE INTO conflict_predictions (
          id, repository_id, branch_a, branch_b, has_conflicts, conflicting_files,
          severity, recommendation, common_ancestor, changes_in_a, changes_in_b,
          overlapping_files, predicted_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        prediction.id,
        prediction.repositoryId,
        prediction.branchA,
        prediction.branchB,
        prediction.hasConflicts ? 1 : 0,
        JSON.stringify(prediction.conflictingFiles),
        prediction.severity,
        prediction.recommendation,
        prediction.details.commonAncestor ?? null,
        prediction.details.changesInA,
        prediction.details.changesInB,
        JSON.stringify(prediction.details.overlappingFiles),
        prediction.predictedAt.getTime(),
        expiresAtMs,
      );
  } catch {
    // Ignore if sqlite is mocked
  }
}

function hydrateGitDataFromDb(): void {
  if (gitHydrated) return;
  gitHydrated = true;
  try {
    ensureGitTables();
    const assignmentRows = sqlite
      .query(`SELECT * FROM branch_assignments`)
      .all() as Array<Record<string, unknown>>;

    for (const row of assignmentRows) {
      const id = String(row["id"]);
      if (assignmentStore.has(id)) continue;
      let agentId =
        typeof row["agent_id"] === "string" ? row["agent_id"] : "unknown";
      let reservedPatterns: string[] | undefined;
      if (typeof row["reserved_patterns"] === "string") {
        try {
          const parsed = JSON.parse(row["reserved_patterns"]);
          if (Array.isArray(parsed)) {
            reservedPatterns = parsed;
          } else if (parsed && typeof parsed === "object") {
            if (typeof parsed.agentId === "string") agentId = parsed.agentId;
            if (Array.isArray(parsed.patterns))
              reservedPatterns = parsed.patterns;
          }
        } catch {
          // Ignore parse error
        }
      }
      const assignment: BranchAssignment = {
        id,
        repositoryId: String(row["repository_id"]),
        agentId,
        branchName: String(row["branch_name"]),
        baseBranch: String(row["base_branch"] ?? "main"),
        status: String(row["status"] ?? "active") as BranchAssignmentStatus,
        assignedAt: new Date(Number(row["assigned_at"])),
        expiresAt: new Date(Number(row["expires_at"])),
        lastActivityAt: new Date(Number(row["last_activity_at"])),
        metadata: {
          ...(typeof row["task_id"] === "string" && {
            taskId: row["task_id"],
          }),
          ...(typeof row["task_description"] === "string" && {
            taskDescription: row["task_description"],
          }),
          ...(reservedPatterns !== undefined && { reservedPatterns }),
        },
      };
      assignmentStore.set(id, assignment);
    }

    const predictionRows = sqlite
      .query(`SELECT * FROM conflict_predictions`)
      .all() as Array<Record<string, unknown>>;

    for (const row of predictionRows) {
      const repositoryId = String(row["repository_id"]);
      const branchA = String(row["branch_a"]);
      const branchB = String(row["branch_b"]);
      const key = predictionCacheKey(repositoryId, branchA, branchB);
      if (predictionCache.has(key)) continue;
      let conflictingFiles: string[] = [];
      let overlappingFiles: string[] = [];
      try {
        if (typeof row["conflicting_files"] === "string") {
          conflictingFiles = JSON.parse(row["conflicting_files"]);
        }
      } catch {}
      try {
        if (typeof row["overlapping_files"] === "string") {
          overlappingFiles = JSON.parse(row["overlapping_files"]);
        }
      } catch {}
      const prediction: ConflictPrediction = {
        id: String(row["id"]),
        repositoryId,
        branchA,
        branchB,
        hasConflicts: Boolean(row["has_conflicts"]),
        conflictingFiles,
        severity: String(
          row["severity"] ?? "none",
        ) as ConflictPrediction["severity"],
        recommendation: String(row["recommendation"] ?? ""),
        predictedAt: new Date(Number(row["predicted_at"])),
        details: {
          ...(typeof row["common_ancestor"] === "string" && {
            commonAncestor: row["common_ancestor"],
          }),
          changesInA: Number(row["changes_in_a"] ?? 0),
          changesInB: Number(row["changes_in_b"] ?? 0),
          overlappingFiles,
        },
      };
      predictionCache.set(key, prediction);
    }
  } catch {
    // Ignore if sqlite is mocked
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique assignment ID.
 */
function generateAssignmentId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 12; i++) {
    const byte = randomBytes[i] ?? 0;
    result += chars.charAt(byte % chars.length);
  }
  return `gba_${result}`;
}

/**
 * Generate a unique prediction ID.
 */
function generatePredictionId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 8; i++) {
    const byte = randomBytes[i] ?? 0;
    result += chars.charAt(byte % chars.length);
  }
  return `gcp_${result}`;
}

/**
 * Create a cache key for conflict predictions.
 */
function predictionCacheKey(
  repositoryId: string,
  branchA: string,
  branchB: string,
): string {
  const sorted = [branchA, branchB].sort();
  return `${repositoryId}:${sorted[0]}:${sorted[1]}`;
}

/**
 * Create a cache key for merge base info.
 */
function mergeBaseCacheKey(
  repositoryId: string,
  branch: string,
  target: string,
): string {
  return `${repositoryId}:${branch}:${target}`;
}

/**
 * Publish a WebSocket event for git coordination changes.
 */
function publishGitEvent(
  repositoryId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "workspace:git", workspaceId: repositoryId };
  hub.publish(channel, eventType, payload, { workspaceId: repositoryId });
}

// ============================================================================
// Branch Assignment Operations
// ============================================================================

/**
 * Assign a branch to an agent with exclusive ownership.
 */
export async function assignBranch(
  params: AssignBranchParams,
): Promise<AssignBranchResult> {
  hydrateGitDataFromDb();
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId: params.repositoryId,
    agentId: params.agentId,
    branchName: params.branchName,
  });

  // Validate branch name
  if (!params.branchName || params.branchName.trim() === "") {
    return {
      assignment: null,
      granted: false,
      error: "Branch name is required",
    };
  }

  // Check if branch is already assigned
  const existingAssignment = Array.from(assignmentStore.values()).find(
    (a) =>
      a.repositoryId === params.repositoryId &&
      a.branchName === params.branchName &&
      a.status === "active" &&
      a.expiresAt > new Date(),
  );

  if (existingAssignment) {
    // If same agent, return existing assignment
    if (existingAssignment.agentId === params.agentId) {
      log.debug("Agent already owns this branch assignment");
      return {
        assignment: existingAssignment,
        granted: true,
      };
    }

    // Branch is held by another agent
    log.info(
      { existingAgentId: existingAssignment.agentId },
      "Branch already assigned to another agent",
    );
    return {
      assignment: null,
      granted: false,
      error: `Branch is already assigned to agent ${existingAssignment.agentId}`,
      existingAssignment,
    };
  }

  // Calculate TTL
  let ttlMs = params.ttlMs ?? DEFAULT_ASSIGNMENT_TTL_MS;
  if (ttlMs > MAX_ASSIGNMENT_TTL_MS) {
    log.debug({ requestedTtl: ttlMs }, "TTL capped to maximum");
    ttlMs = MAX_ASSIGNMENT_TTL_MS;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const assignment: BranchAssignment = {
    id: generateAssignmentId(),
    repositoryId: params.repositoryId,
    agentId: params.agentId,
    branchName: params.branchName,
    baseBranch: params.baseBranch ?? "main",
    status: "active",
    assignedAt: now,
    expiresAt,
    lastActivityAt: now,
    metadata: {
      ...(params.taskId !== undefined && { taskId: params.taskId }),
      ...(params.taskDescription !== undefined && {
        taskDescription: params.taskDescription,
      }),
      ...(params.reservedPatterns !== undefined && {
        reservedPatterns: params.reservedPatterns,
      }),
    },
  };

  assignmentStore.set(assignment.id, assignment);
  persistAssignmentToDb(assignment);

  log.info(
    {
      assignmentId: assignment.id,
      expiresAt: expiresAt.toISOString(),
    },
    "Branch assigned to agent",
  );

  // Publish assignment event
  publishGitEvent(params.repositoryId, "git.branch.assigned", {
    assignmentId: assignment.id,
    repositoryId: params.repositoryId,
    agentId: params.agentId,
    branchName: params.branchName,
    baseBranch: assignment.baseBranch,
    assignedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return {
    assignment,
    granted: true,
  };
}

/**
 * Release branch assignment(s) for an agent.
 */
export async function releaseBranch(
  params: ReleaseBranchParams,
): Promise<ReleaseBranchResult> {
  hydrateGitDataFromDb();
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId: params.repositoryId,
    agentId: params.agentId,
    branchName: params.branchName,
  });

  const releasedAssignments: string[] = [];

  for (const [id, assignment] of assignmentStore) {
    if (
      assignment.repositoryId === params.repositoryId &&
      assignment.agentId === params.agentId &&
      assignment.status === "active"
    ) {
      // If specific branch requested, only release that one
      if (params.branchName && assignment.branchName !== params.branchName) {
        continue;
      }

      assignmentStore.delete(id);
      deleteAssignmentFromDb(id);
      warnedAssignments.delete(id);
      releasedAssignments.push(id);

      log.info(
        { assignmentId: id, branchName: assignment.branchName },
        "Branch assignment released",
      );

      // Publish release event
      publishGitEvent(params.repositoryId, "git.branch.released", {
        assignmentId: id,
        repositoryId: params.repositoryId,
        agentId: params.agentId,
        branchName: assignment.branchName,
        releasedAt: new Date().toISOString(),
      });
    }
  }

  if (releasedAssignments.length === 0 && params.branchName) {
    return {
      released: false,
      releasedAssignments: [],
      error: "No matching assignment found",
    };
  }

  return {
    released: releasedAssignments.length > 0,
    releasedAssignments,
  };
}

/**
 * Renew a branch assignment to extend its TTL.
 */
export async function renewAssignment(
  params: RenewAssignmentParams,
): Promise<RenewAssignmentResult> {
  hydrateGitDataFromDb();
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    assignmentId: params.assignmentId,
    agentId: params.agentId,
  });

  const assignment = assignmentStore.get(params.assignmentId);

  if (!assignment) {
    return {
      renewed: false,
      error: "Assignment not found",
    };
  }

  if (assignment.agentId !== params.agentId) {
    log.warn(
      { holderId: assignment.agentId },
      "Attempt to renew assignment by non-holder",
    );
    return {
      renewed: false,
      error: "Agent does not hold this assignment",
    };
  }

  if (assignment.status !== "active") {
    return {
      renewed: false,
      error: `Cannot renew assignment with status: ${assignment.status}`,
    };
  }

  // Calculate new expiration
  const now = new Date();
  const baseTime = assignment.expiresAt > now ? assignment.expiresAt : now;
  const additionalTtlMs = params.additionalTtlMs ?? DEFAULT_ASSIGNMENT_TTL_MS;
  const cappedTtl = Math.min(additionalTtlMs, MAX_ASSIGNMENT_TTL_MS);
  const newExpiresAt = new Date(baseTime.getTime() + cappedTtl);

  assignment.expiresAt = newExpiresAt;
  assignment.lastActivityAt = now;
  persistAssignmentToDb(assignment);
  warnedAssignments.delete(assignment.id);

  log.info(
    {
      previousExpiry: baseTime.toISOString(),
      newExpiry: newExpiresAt.toISOString(),
    },
    "Assignment renewed",
  );

  // Publish renewal event
  publishGitEvent(assignment.repositoryId, "git.branch.renewed", {
    assignmentId: assignment.id,
    repositoryId: assignment.repositoryId,
    agentId: assignment.agentId,
    branchName: assignment.branchName,
    newExpiresAt: newExpiresAt.toISOString(),
    renewedAt: now.toISOString(),
  });

  return {
    renewed: true,
    newExpiresAt,
  };
}

/**
 * Get all branch assignments for a repository.
 */
export async function getBranchAssignments(
  repositoryId: string,
  options?: { includeExpired?: boolean; agentId?: string },
): Promise<BranchAssignment[]> {
  hydrateGitDataFromDb();
  const now = new Date();
  const assignments = Array.from(assignmentStore.values()).filter((a) => {
    if (a.repositoryId !== repositoryId) return false;
    if (options?.agentId && a.agentId !== options.agentId) return false;
    if (!options?.includeExpired && a.expiresAt <= now) return false;
    return true;
  });

  // Sort by assigned time (newest first)
  assignments.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());

  return assignments;
}

/**
 * Get a specific branch assignment by ID.
 */
export async function getAssignment(
  assignmentId: string,
): Promise<BranchAssignment | null> {
  hydrateGitDataFromDb();
  return assignmentStore.get(assignmentId) ?? null;
}

/**
 * Update assignment status (e.g., mark as merged or stale).
 */
export async function updateAssignmentStatus(
  assignmentId: string,
  status: BranchAssignmentStatus,
  agentId?: string,
): Promise<boolean> {
  hydrateGitDataFromDb();
  const assignment = assignmentStore.get(assignmentId);
  if (!assignment) return false;

  // If agentId provided, verify ownership
  if (agentId && assignment.agentId !== agentId) return false;

  const previousStatus = assignment.status;
  assignment.status = status;
  assignment.lastActivityAt = new Date();
  persistAssignmentToDb(assignment);

  logger.info(
    {
      assignmentId,
      previousStatus,
      newStatus: status,
    },
    "Assignment status updated",
  );

  // Publish status change event
  publishGitEvent(assignment.repositoryId, "git.branch.status_changed", {
    assignmentId,
    repositoryId: assignment.repositoryId,
    branchName: assignment.branchName,
    previousStatus,
    newStatus: status,
    updatedAt: new Date().toISOString(),
  });

  return true;
}

// ============================================================================
// Conflict Prediction Operations
// ============================================================================

/**
 * Predict conflicts between two branches.
 *
 * This is a simulated prediction - in production, this would call
 * git diff-tree or similar to analyze actual file changes.
 */
export async function predictConflicts(
  params: PredictConflictsParams,
): Promise<ConflictPrediction> {
  hydrateGitDataFromDb();
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId: params.repositoryId,
    branchA: params.branchA,
    branchB: params.branchB,
  });

  // Check cache first
  const cacheKey = predictionCacheKey(
    params.repositoryId,
    params.branchA,
    params.branchB,
  );
  const cached = predictionCache.get(cacheKey);

  // Cache valid for 5 minutes
  if (cached && Date.now() - cached.predictedAt.getTime() < 5 * 60 * 1000) {
    log.debug("Returning cached conflict prediction");
    return cached;
  }

  // Simulate conflict analysis
  // In production, this would:
  // 1. Get merge-base between branches
  // 2. Get file diffs from merge-base to each branch
  // 3. Find overlapping files
  // 4. Analyze semantic conflicts

  const now = new Date();
  const prediction: ConflictPrediction = {
    id: generatePredictionId(),
    repositoryId: params.repositoryId,
    branchA: params.branchA,
    branchB: params.branchB,
    hasConflicts: false,
    conflictingFiles: [],
    severity: "none",
    recommendation: "Branches can be merged cleanly",
    predictedAt: now,
    details: {
      changesInA: 0,
      changesInB: 0,
      overlappingFiles: [],
    },
  };

  // Check if branches have overlapping file reservations
  const assignmentA = Array.from(assignmentStore.values()).find(
    (a) =>
      a.repositoryId === params.repositoryId &&
      a.branchName === params.branchA &&
      a.status === "active",
  );

  const assignmentB = Array.from(assignmentStore.values()).find(
    (a) =>
      a.repositoryId === params.repositoryId &&
      a.branchName === params.branchB &&
      a.status === "active",
  );

  if (
    assignmentA?.metadata.reservedPatterns &&
    assignmentB?.metadata.reservedPatterns
  ) {
    // Simple overlap check - in production would use glob matching
    const patternsA = new Set(assignmentA.metadata.reservedPatterns);
    const patternsB = new Set(assignmentB.metadata.reservedPatterns);
    const overlapping = [...patternsA].filter((p) => patternsB.has(p));

    if (overlapping.length > 0) {
      prediction.hasConflicts = true;
      prediction.conflictingFiles = overlapping;
      prediction.details.overlappingFiles = overlapping;

      if (overlapping.length > 5) {
        prediction.severity = "high";
        prediction.recommendation =
          "Significant overlap detected. Coordinate with other agent before merging.";
      } else if (overlapping.length > 2) {
        prediction.severity = "medium";
        prediction.recommendation =
          "Some overlap detected. Review changes carefully before merging.";
      } else {
        prediction.severity = "low";
        prediction.recommendation =
          "Minor overlap detected. Should merge cleanly with careful review.";
      }
    }
  }

  // Update cache and persist to SQLite
  predictionCache.set(cacheKey, prediction);
  persistPredictionToDb(prediction);

  log.info(
    {
      predictionId: prediction.id,
      hasConflicts: prediction.hasConflicts,
      severity: prediction.severity,
      conflictCount: prediction.conflictingFiles.length,
    },
    "Conflict prediction completed",
  );

  return prediction;
}

/**
 * Get files that are being modified across multiple branches.
 */
export async function getOverlappingFiles(
  params: GetOverlappingFilesParams,
): Promise<FileOverlapReport> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId: params.repositoryId,
    branchCount: params.branches.length,
  });

  const branchPatterns: Map<string, Set<string>> = new Map();

  // Collect reserved patterns for each branch
  for (const branch of params.branches) {
    const assignment = Array.from(assignmentStore.values()).find(
      (a) =>
        a.repositoryId === params.repositoryId &&
        a.branchName === branch &&
        a.status === "active",
    );

    if (assignment?.metadata.reservedPatterns) {
      branchPatterns.set(branch, new Set(assignment.metadata.reservedPatterns));
    }
  }

  // Find overlapping patterns
  const patternBranches: Map<string, string[]> = new Map();

  for (const [branch, patterns] of branchPatterns) {
    for (const pattern of patterns) {
      const existing = patternBranches.get(pattern) ?? [];
      existing.push(branch);
      patternBranches.set(pattern, existing);
    }
  }

  // Build overlap report
  const overlappingFiles: FileOverlapReport["overlappingFiles"] = [];

  for (const [pattern, branches] of patternBranches) {
    if (branches.length > 1) {
      overlappingFiles.push({
        path: pattern,
        modifiedIn: branches,
        risk: branches.length > 2 ? "high" : "medium",
      });
    }
  }

  const report: FileOverlapReport = {
    repositoryId: params.repositoryId,
    branches: params.branches,
    overlappingFiles,
    generatedAt: new Date(),
  };

  log.info(
    { overlappingCount: overlappingFiles.length },
    "Overlapping files report generated",
  );

  return report;
}

/**
 * Get merge base information between a branch and target.
 */
export async function getMergeBase(
  repositoryId: string,
  branch: string,
  target: string,
): Promise<MergeBaseInfo> {
  const cacheKey = mergeBaseCacheKey(repositoryId, branch, target);
  const cached = mergeBaseCache.get(cacheKey);

  // Cache valid for 1 minute
  if (cached && Date.now() - cached.lastChecked.getTime() < 60 * 1000) {
    return cached;
  }

  // Simulated merge base info
  // In production, would run: git merge-base <branch> <target>
  const info: MergeBaseInfo = {
    branch,
    target,
    mergeBase: "simulated-merge-base-sha",
    aheadBy: 0,
    behindBy: 0,
    diverged: false,
    lastChecked: new Date(),
  };

  mergeBaseCache.set(cacheKey, info);
  return info;
}

// ============================================================================
// Git Graph Operations
// ============================================================================

/**
 * Get git graph data for visualization.
 *
 * In production, this would parse actual git log output.
 */
export async function getGitGraph(
  repositoryId: string,
  options?: {
    maxCommits?: number;
    branches?: string[];
  },
): Promise<GitGraphData> {
  const _maxCommits = options?.maxCommits ?? 50;
  const filterBranches = options?.branches;

  // Get active branch assignments
  const assignments = await getBranchAssignments(repositoryId);

  // Build branch info
  const branches: GitGraphData["branches"] = [];
  const assignedBranches = new Map<string, string>();

  for (const assignment of assignments) {
    assignedBranches.set(assignment.branchName, assignment.agentId);
  }

  // Add default branch
  const mainAssignedTo = assignedBranches.get("main");
  branches.push({
    name: "main",
    sha: "simulated-main-sha",
    isDefault: true,
    ...(mainAssignedTo && { assignedTo: mainAssignedTo }),
  });

  // Add assigned branches
  for (const assignment of assignments) {
    if (assignment.branchName !== "main") {
      branches.push({
        name: assignment.branchName,
        sha: `simulated-${assignment.branchName}-sha`,
        isDefault: false,
        assignedTo: assignment.agentId,
      });
    }
  }

  // Filter if specific branches requested
  const filteredBranches = filterBranches
    ? branches.filter((b) => filterBranches.includes(b.name))
    : branches;

  // Simulated graph data
  // In production, would parse: git log --graph --all --oneline
  const graphData: GitGraphData = {
    nodes: [
      {
        sha: "simulated-head-sha",
        message: "Latest commit",
        author: "agent",
        date: new Date(),
        parents: ["simulated-parent-sha"],
        branches: ["main"],
        isHead: true,
        isMerge: false,
      },
    ],
    edges: [],
    branches: filteredBranches,
  };

  return graphData;
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Coordinate a sync operation for a branch.
 *
 * This validates the operation and coordinates with the assignment system.
 * Actual git operations would be executed by the agent.
 */
export async function coordinateSync(
  repositoryId: string,
  agentId: string,
  operation: SyncOperation,
): Promise<{
  approved: boolean;
  error?: string;
  warnings: string[];
  recommendations: string[];
}> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId,
    agentId,
    operation: operation.type,
    branch: operation.branch,
  });

  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Check if agent has assignment for this branch
  const assignment = Array.from(assignmentStore.values()).find(
    (a) =>
      a.repositoryId === repositoryId &&
      a.branchName === operation.branch &&
      a.agentId === agentId &&
      a.status === "active",
  );

  if (!assignment) {
    // For push operations, require assignment
    if (operation.type === "push") {
      return {
        approved: false,
        error: "Agent does not have branch assignment for push operations",
        warnings,
        recommendations: ["Request branch assignment before pushing"],
      };
    }

    // For pull/fetch, allow but recommend getting assignment
    recommendations.push(
      "Consider requesting branch assignment for coordinated work",
    );
  }

  // Check for force operations
  if (operation.force) {
    warnings.push(
      "Force operations can cause data loss. Ensure other agents are not affected.",
    );

    // Check if other agents have work on related branches
    const otherAssignments = Array.from(assignmentStore.values()).filter(
      (a) =>
        a.repositoryId === repositoryId &&
        a.agentId !== agentId &&
        a.status === "active",
    );

    if (otherAssignments.length > 0) {
      warnings.push(
        `${otherAssignments.length} other agent(s) have active branch assignments`,
      );
    }
  }

  // Check for potential conflicts on push
  if (operation.type === "push" && assignment) {
    const baseBranch = assignment.baseBranch;
    const prediction = await predictConflicts({
      repositoryId,
      branchA: operation.branch,
      branchB: baseBranch,
    });

    if (prediction.hasConflicts) {
      warnings.push(
        `Potential conflicts detected with ${baseBranch}: ${prediction.conflictingFiles.length} file(s)`,
      );
      recommendations.push(prediction.recommendation);
    }
  }

  log.info(
    {
      approved: true,
      warningCount: warnings.length,
    },
    "Sync operation coordination completed",
  );

  // Publish sync event
  publishGitEvent(repositoryId, "git.sync.coordinated", {
    repositoryId,
    agentId,
    operation: operation.type,
    branch: operation.branch,
    approved: true,
    warnings,
    coordinatedAt: new Date().toISOString(),
  });

  return {
    approved: true,
    warnings,
    recommendations,
  };
}

/**
 * Record the result of a sync operation.
 */
export async function recordSyncResult(
  repositoryId: string,
  agentId: string,
  result: SyncResult,
): Promise<void> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId,
    agentId,
    operation: result.operation.type,
    success: result.success,
  });

  // Update assignment activity
  const assignment = Array.from(assignmentStore.values()).find(
    (a) =>
      a.repositoryId === repositoryId &&
      a.branchName === result.operation.branch &&
      a.agentId === agentId &&
      a.status === "active",
  );

  if (assignment) {
    assignment.lastActivityAt = new Date();
  }

  log.info(
    {
      fromCommit: result.fromCommit,
      toCommit: result.toCommit,
      filesChanged: result.filesChanged,
      duration: result.duration,
      error: result.error,
    },
    "Sync result recorded",
  );

  // Publish sync result event
  publishGitEvent(repositoryId, "git.sync.completed", {
    repositoryId,
    agentId,
    operation: result.operation.type,
    branch: result.operation.branch,
    success: result.success,
    fromCommit: result.fromCommit,
    toCommit: result.toCommit,
    filesChanged: result.filesChanged,
    duration: result.duration,
    error: result.error,
    completedAt: new Date().toISOString(),
  });

  // Clear related caches
  if (result.success && result.operation.type === "push") {
    const branch = result.operation.branch;
    // Use delimiter-aware matching to avoid "main" matching "maintain-feature"
    const branchPattern = new RegExp(
      `(^|:)${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(:|$)`,
    );

    // Invalidate conflict predictions involving this branch
    for (const key of predictionCache.keys()) {
      if (branchPattern.test(key)) {
        predictionCache.delete(key);
      }
    }

    // Invalidate merge base cache
    for (const key of mergeBaseCache.keys()) {
      if (branchPattern.test(key)) {
        mergeBaseCache.delete(key);
      }
    }
  }
}

// ============================================================================
// Background Cleanup
// ============================================================================

/**
 * Clean up expired assignments and warn about expiring ones.
 */
async function cleanupExpiredAssignments(): Promise<number> {
  const now = new Date();
  const warningThreshold = new Date(now.getTime() + EXPIRATION_WARNING_MS);
  let cleanedCount = 0;

  for (const [id, assignment] of assignmentStore) {
    if (assignment.expiresAt <= now && assignment.status === "active") {
      // Expired - mark as expired
      assignment.status = "expired";
      cleanedCount++;

      logger.debug(
        {
          assignmentId: id,
          repositoryId: assignment.repositoryId,
          agentId: assignment.agentId,
          branchName: assignment.branchName,
        },
        "Branch assignment expired",
      );

      // Publish expiration event
      publishGitEvent(assignment.repositoryId, "git.branch.expired", {
        assignmentId: id,
        repositoryId: assignment.repositoryId,
        agentId: assignment.agentId,
        branchName: assignment.branchName,
        expiredAt: now.toISOString(),
      });

      warnedAssignments.delete(id);
    } else if (
      assignment.status === "active" &&
      assignment.expiresAt <= warningThreshold &&
      !warnedAssignments.has(id)
    ) {
      // About to expire - publish warning
      publishGitEvent(assignment.repositoryId, "git.branch.expiring", {
        assignmentId: id,
        repositoryId: assignment.repositoryId,
        agentId: assignment.agentId,
        branchName: assignment.branchName,
        expiresAt: assignment.expiresAt.toISOString(),
        expiresInMs: assignment.expiresAt.getTime() - now.getTime(),
      });
      warnedAssignments.add(id);
    }
  }

  // Clean old expired assignments (older than 1 hour)
  const oldThreshold = new Date(now.getTime() - 60 * 60 * 1000);
  for (const [id, assignment] of assignmentStore) {
    if (
      assignment.status === "expired" &&
      assignment.expiresAt < oldThreshold
    ) {
      assignmentStore.delete(id);
    }
  }

  if (cleanedCount > 0) {
    logger.info({ cleanedCount }, "Assignment cleanup completed");
  }

  return cleanedCount;
}

/**
 * Start the background cleanup job.
 */
export function startGitCleanupJob(): void {
  if (cleanupInterval) {
    return;
  }

  cleanupInterval = setInterval(() => {
    cleanupExpiredAssignments().catch((err) => {
      logger.error({ error: err }, "Error in git assignment cleanup job");
    });
  }, CLEANUP_INTERVAL_MS);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS },
    "Git assignment cleanup job started",
  );
}

/**
 * Stop the background cleanup job.
 */
export function stopGitCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Git assignment cleanup job stopped");
  }
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get git coordination statistics.
 */
export function getGitStats(): {
  totalActiveAssignments: number;
  byRepository: Record<string, number>;
  byStatus: Record<BranchAssignmentStatus, number>;
  predictionCacheSize: number;
  mergeBaseCacheSize: number;
} {
  hydrateGitDataFromDb();
  const now = new Date();
  const activeAssignments = Array.from(assignmentStore.values()).filter(
    (a) => a.status === "active" && a.expiresAt > now,
  );

  const byRepository: Record<string, number> = {};
  const byStatus: Record<BranchAssignmentStatus, number> = {
    active: 0,
    stale: 0,
    merged: 0,
    expired: 0,
  };

  for (const assignment of assignmentStore.values()) {
    byRepository[assignment.repositoryId] =
      (byRepository[assignment.repositoryId] ?? 0) + 1;
    byStatus[assignment.status]++;
  }

  return {
    totalActiveAssignments: activeAssignments.length,
    byRepository,
    byStatus,
    predictionCacheSize: predictionCache.size,
    mergeBaseCacheSize: mergeBaseCache.size,
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all git coordination data. Only for testing.
 */
export function _clearAllGitData(): void {
  assignmentStore.clear();
  predictionCache.clear();
  mergeBaseCache.clear();
  warnedAssignments.clear();
  gitHydrated = true;
  try {
    ensureGitTables();
    sqlite.query(`DELETE FROM branch_assignments`).run();
    sqlite.query(`DELETE FROM conflict_predictions`).run();
  } catch {
    // Ignore if sqlite is mocked
  }
}

/**
 * Evict only in-memory git cache to test SQLite hydration on restart.
 */
export function _evictGitCacheForTesting(): void {
  assignmentStore.clear();
  predictionCache.clear();
  mergeBaseCache.clear();
  warnedAssignments.clear();
  gitHydrated = false;
}

/**
 * Get the raw assignment store. Only for testing.
 */
export function _getAssignmentStore(): Map<string, BranchAssignment> {
  return assignmentStore;
}
