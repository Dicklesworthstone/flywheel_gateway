/**
 * Conflict Detection Service
 *
 * Proactively identifies potential conflicts before they cause problems:
 * - Reservation overlaps (file pattern conflicts)
 * - Git conflicts (merge conflicts, potential conflicts on different branches)
 * - Resource contention (competing for shared resources)
 *
 * Implements PLAN.md §12 Conflict Management requirements.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import {
  type ConflictCheckResult,
  type Reservation,
  type ReservationConflict,
  ReservationConflictEngine,
} from "./reservation-conflicts";

// ============================================================================
// Types
// ============================================================================

/**
 * Types of conflicts that can be detected.
 */
export type ConflictType =
  | "reservation_overlap"
  | "git_merge_conflict"
  | "git_potential_conflict"
  | "resource_contention"
  | "deadlock_detected";

/**
 * Severity levels for conflicts.
 */
export type ConflictSeverity = "info" | "warning" | "error" | "critical";

/**
 * A detected conflict.
 */
export interface Conflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  projectId: string;
  involvedAgents: string[];
  affectedResources: string[];
  detectedAt: Date;
  resolvedAt?: Date;
  resolution?: ConflictResolution;
  metadata: Record<string, unknown>;
}

/**
 * Resolution for a conflict.
 */
export interface ConflictResolution {
  type: "wait" | "manual" | "auto" | "override" | "abort";
  description: string;
  resolvedBy?: string;
  resolvedAt: Date;
}

/**
 * Recommended action for resolving a conflict.
 */
export interface RecommendedAction {
  id: string;
  label: string;
  description: string;
  type: "wait" | "negotiate" | "force" | "manual_resolve" | "abort" | "retry";
  /** For wait actions: when the situation may auto-resolve */
  expiresAt?: Date;
  /** Additional action-specific data */
  data?: Record<string, unknown>;
}

/**
 * Resource access record for contention detection.
 */
export interface ResourceAccess {
  resourceId: string;
  agentId: string;
  accessType: "read" | "write" | "exclusive";
  timestamp: Date;
}

/**
 * Alert configuration for conflicts.
 */
export interface ConflictAlertConfig {
  /** Minimum severity to trigger alerts */
  minSeverity: ConflictSeverity;
  /** Cooldown in ms between alerts for same conflict source */
  cooldownMs: number;
  /** Escalation timeout in ms */
  escalationTimeoutMs: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ALERT_CONFIG: ConflictAlertConfig = {
  minSeverity: "warning",
  cooldownMs: 60000, // 1 minute
  escalationTimeoutMs: 300000, // 5 minutes
};

const SEVERITY_ORDER: Record<ConflictSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

// ============================================================================
// State
// ============================================================================

/** Active conflicts by ID */
const activeConflicts = new Map<string, Conflict>();

/** Conflict history (most recent first) */
const conflictHistory: Conflict[] = [];
const MAX_HISTORY_SIZE = 500;

/** Recent resource accesses for contention detection */
const recentAccesses: ResourceAccess[] = [];
const MAX_ACCESSES = 1000;

/** Reservation conflict engine instance */
const reservationEngine = new ReservationConflictEngine();

/** Alert configuration */
let alertConfig = { ...DEFAULT_ALERT_CONFIG };

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate a cryptographically secure unique conflict ID.
 */
function generateConflictId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `cfl_${Date.now()}_${random}`;
}

/**
 * Create and register a new conflict.
 */
function createConflict(
  type: ConflictType,
  severity: ConflictSeverity,
  projectId: string,
  involvedAgents: string[],
  affectedResources: string[],
  metadata: Record<string, unknown> = {},
): Conflict {
  const log = getLogger();
  const correlationId = getCorrelationId();

  const conflict: Conflict = {
    id: generateConflictId(),
    type,
    severity,
    projectId,
    involvedAgents,
    affectedResources,
    detectedAt: new Date(),
    metadata,
  };

  // Store in active conflicts
  activeConflicts.set(conflict.id, conflict);

  // Add to history
  conflictHistory.unshift(conflict);
  if (conflictHistory.length > MAX_HISTORY_SIZE) {
    conflictHistory.pop();
  }

  log.info(
    {
      type: "conflict:detected",
      conflictId: conflict.id,
      conflictType: type,
      severity,
      projectId,
      involvedAgents,
      affectedResources: affectedResources.slice(0, 5),
      correlationId,
    },
    `[CONFLICT] Detected ${type} conflict`,
  );

  // Publish WebSocket event
  publishConflictEvent("conflict.detected", conflict);

  return conflict;
}

/**
 * Publish a conflict event via WebSocket.
 */
function publishConflictEvent(
  eventType:
    | "conflict.detected"
    | "conflict.updated"
    | "conflict.resolved"
    | "conflict.escalated",
  conflict: Conflict,
): void {
  const hub = getHub();
  const channel: Channel = {
    type: "workspace:conflicts",
    workspaceId: conflict.projectId,
  };

  const recommendedActions = getRecommendedActions(conflict);

  hub.publish(
    channel,
    eventType,
    {
      id: conflict.id,
      type: conflict.type,
      severity: conflict.severity,
      projectId: conflict.projectId,
      involvedAgents: conflict.involvedAgents,
      affectedResources: conflict.affectedResources,
      detectedAt: conflict.detectedAt.toISOString(),
      resolvedAt: conflict.resolvedAt?.toISOString(),
      resolution: conflict.resolution,
      recommendedActions,
    },
    { workspaceId: conflict.projectId },
  );
}

// ============================================================================
// Reservation Conflict Detection
// ============================================================================

/**
 * Register a file reservation for conflict tracking.
 */
export function registerReservation(reservation: Reservation): void {
  reservationEngine.registerReservation(reservation);
}

/**
 * Remove a file reservation.
 */
export function removeReservation(
  projectId: string,
  reservationId: string,
): boolean {
  return reservationEngine.removeReservation(projectId, reservationId);
}

/**
 * Check for reservation conflicts before creating a new reservation.
 *
 * @param projectId - Project to check
 * @param requesterId - Agent requesting the reservation
 * @param patterns - Glob patterns being requested
 * @param exclusive - Whether exclusive access is needed
 * @returns Conflict check result with any detected conflicts
 */
export function checkReservationConflicts(
  projectId: string,
  requesterId: string,
  patterns: string[],
  exclusive: boolean,
): { hasConflicts: boolean; canProceed: boolean; conflicts: Conflict[] } {
  const result = reservationEngine.checkConflicts(
    projectId,
    requesterId,
    patterns,
    exclusive,
  );

  // Convert reservation conflicts to full conflicts
  const fullConflicts = result.conflicts.map((rc) =>
    createConflict(
      "reservation_overlap",
      "warning",
      projectId,
      [requesterId, rc.existingReservation.requesterId],
      rc.requestedPatterns,
      {
        overlappingPattern: rc.overlappingPattern,
        existingReservationId: rc.existingReservation.id,
        existingPatterns: rc.existingReservation.patterns,
        resolutions: rc.resolutions,
      },
    ),
  );

  return {
    hasConflicts: result.hasConflicts,
    canProceed: result.canProceed,
    conflicts: fullConflicts,
  };
}

// ============================================================================
// Git Conflict Detection
// ============================================================================

/**
 * Detect git conflicts in a project directory.
 * This is a lightweight detection that checks git status.
 *
 * @param projectId - Project identifier
 * @param workingDirectory - Git repository path
 * @returns Array of detected git conflicts
 */
export async function detectGitConflicts(
  projectId: string,
  workingDirectory: string,
): Promise<Conflict[]> {
  const log = getLogger();
  const conflicts: Conflict[] = [];

  try {
    // Check for actual merge conflicts using git status
    const proc = Bun.spawn(
      ["git", "-C", workingDirectory, "status", "--porcelain=v2"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      log.warn(
        { projectId, workingDirectory },
        "[CONFLICT] Git status command failed",
      );
      return conflicts;
    }

    // Parse git status output for unmerged files (indicator "u")
    const lines = stdout.split("\n");
    const conflictedFiles: string[] = [];

    for (const line of lines) {
      // In porcelain v2, unmerged entries start with "u"
      // Format: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      // Fields are space-separated, with path as the last field (index 10+)
      // Note: path may contain spaces, so we join all parts from index 10 onwards
      if (line.startsWith("u ")) {
        const parts = line.split(" ");
        // Path starts at index 10 and may contain spaces
        const filePath = parts.slice(10).join(" ");
        if (filePath) {
          conflictedFiles.push(filePath);
        }
      }
    }

    if (conflictedFiles.length > 0) {
      conflicts.push(
        createConflict(
          "git_merge_conflict",
          "critical",
          projectId,
          [], // No specific agents - this is a git-level conflict
          conflictedFiles,
          {
            workingDirectory,
            conflictCount: conflictedFiles.length,
          },
        ),
      );
    }
  } catch (error) {
    log.error(
      { error, projectId, workingDirectory },
      "[CONFLICT] Error detecting git conflicts",
    );
  }

  return conflicts;
}

/**
 * Check for potential conflicts between branches.
 * Files modified on multiple branches may conflict when merged.
 *
 * @param projectId - Project identifier
 * @param workingDirectory - Git repository path
 * @param baseBranch - Base branch to compare against
 * @param compareBranch - Branch to compare
 * @returns Array of potential conflict objects
 */
export async function detectPotentialGitConflicts(
  projectId: string,
  workingDirectory: string,
  baseBranch: string,
  compareBranch: string,
): Promise<Conflict[]> {
  const log = getLogger();
  const conflicts: Conflict[] = [];

  try {
    // Get files modified in compare branch since diverging from base
    const proc = Bun.spawn(
      [
        "git",
        "-C",
        workingDirectory,
        "diff",
        "--name-only",
        `${baseBranch}...${compareBranch}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      log.warn(
        { projectId, baseBranch, compareBranch },
        "[CONFLICT] Git diff command failed",
      );
      return conflicts;
    }

    const modifiedFiles = stdout.trim().split("\n").filter(Boolean);

    if (modifiedFiles.length > 0) {
      // Check if base branch also has modifications to these files
      const baseProc = Bun.spawn(
        [
          "git",
          "-C",
          workingDirectory,
          "diff",
          "--name-only",
          `${compareBranch}...${baseBranch}`,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const baseStdout = await new Response(baseProc.stdout).text();
      const baseExitCode = await baseProc.exited;

      if (baseExitCode === 0) {
        const baseModifiedFiles = new Set(
          baseStdout.trim().split("\n").filter(Boolean),
        );

        // Find files modified in both branches
        const commonFiles = modifiedFiles.filter((f) =>
          baseModifiedFiles.has(f),
        );

        if (commonFiles.length > 0) {
          conflicts.push(
            createConflict(
              "git_potential_conflict",
              "warning",
              projectId,
              [],
              commonFiles,
              {
                baseBranch,
                compareBranch,
                workingDirectory,
                potentialConflictCount: commonFiles.length,
              },
            ),
          );
        }
      }
    }
  } catch (error) {
    log.error(
      { error, projectId, baseBranch, compareBranch },
      "[CONFLICT] Error detecting potential git conflicts",
    );
  }

  return conflicts;
}

// ============================================================================
// Resource Contention Detection
// ============================================================================

/**
 * Record a resource access for contention detection.
 *
 * @param access - Resource access to record
 */
export function recordResourceAccess(access: ResourceAccess): void {
  recentAccesses.push(access);

  // Trim old accesses
  while (recentAccesses.length > MAX_ACCESSES) {
    recentAccesses.shift();
  }
}

/**
 * Detect resource contention within a time window.
 *
 * @param projectId - Project to check
 * @param windowMs - Time window in milliseconds (default 5 seconds)
 * @returns Array of detected contention conflicts
 */
export function detectResourceContention(
  projectId: string,
  windowMs = 5000,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const now = Date.now();
  const cutoff = now - windowMs;

  // Filter to recent accesses for this project
  const recent = recentAccesses.filter(
    (a) =>
      a.timestamp.getTime() >= cutoff &&
      a.resourceId.startsWith(projectId + ":"),
  );

  // Group by resource
  const byResource = new Map<string, ResourceAccess[]>();
  for (const access of recent) {
    const existing = byResource.get(access.resourceId) || [];
    existing.push(access);
    byResource.set(access.resourceId, existing);
  }

  // Check for contention
  for (const [resourceId, accesses] of byResource) {
    if (hasContention(accesses)) {
      const uniqueAgents = [...new Set(accesses.map((a) => a.agentId))];
      conflicts.push(
        createConflict(
          "resource_contention",
          "warning",
          projectId,
          uniqueAgents,
          [resourceId],
          {
            accessCount: accesses.length,
            windowMs,
            accessTypes: [...new Set(accesses.map((a) => a.accessType))],
          },
        ),
      );
    }
  }

  return conflicts;
}

/**
 * Check if a set of accesses represents contention.
 */
function hasContention(accesses: ResourceAccess[]): boolean {
  if (accesses.length < 2) return false;

  const uniqueAgents = new Set(accesses.map((a) => a.agentId));
  // Single agent can't contend with itself
  if (uniqueAgents.size < 2) return false;

  // Check for multiple exclusive accesses from different agents
  const exclusiveAccesses = accesses.filter(
    (a) => a.accessType === "exclusive",
  );
  if (exclusiveAccesses.length >= 2) return true;

  // Check for multiple write accesses from different agents
  const writeAccesses = accesses.filter((a) => a.accessType === "write");
  const writeAgents = new Set(writeAccesses.map((a) => a.agentId));
  if (writeAgents.size >= 2) return true;

  // Check for write + any other access from different agent
  if (writeAccesses.length > 0 && accesses.length > writeAccesses.length) {
    return true;
  }

  // Check for exclusive access with any other access from different agent
  if (
    exclusiveAccesses.length > 0 &&
    accesses.length > exclusiveAccesses.length
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// Conflict Management
// ============================================================================

/**
 * Get all active conflicts.
 *
 * @param filter - Optional filter criteria
 */
export function getActiveConflicts(filter?: {
  type?: ConflictType[];
  severity?: ConflictSeverity[];
  projectId?: string;
  agentId?: string;
}): Conflict[] {
  let conflicts = Array.from(activeConflicts.values());

  if (filter?.type?.length) {
    conflicts = conflicts.filter((c) => filter.type!.includes(c.type));
  }
  if (filter?.severity?.length) {
    conflicts = conflicts.filter((c) => filter.severity!.includes(c.severity));
  }
  if (filter?.projectId) {
    conflicts = conflicts.filter((c) => c.projectId === filter.projectId);
  }
  if (filter?.agentId) {
    conflicts = conflicts.filter((c) =>
      c.involvedAgents.includes(filter.agentId!),
    );
  }

  // Sort by severity (most severe first), then by time
  conflicts.sort((a, b) => {
    const severityDiff =
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.detectedAt.getTime() - a.detectedAt.getTime();
  });

  return conflicts;
}

/**
 * Get a specific conflict by ID.
 */
export function getConflict(conflictId: string): Conflict | undefined {
  return (
    activeConflicts.get(conflictId) ||
    conflictHistory.find((c) => c.id === conflictId)
  );
}

/**
 * Get conflict history.
 *
 * @param limit - Maximum number of conflicts to return
 * @param offset - Number of conflicts to skip
 */
export function getConflictHistory(
  limit = 50,
  offset = 0,
): { conflicts: Conflict[]; total: number; hasMore: boolean } {
  const total = conflictHistory.length;
  const conflicts = conflictHistory.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return { conflicts, total, hasMore };
}

/**
 * Resolve a conflict.
 *
 * @param conflictId - Conflict to resolve
 * @param resolution - Resolution details
 */
export function resolveConflict(
  conflictId: string,
  resolution: Omit<ConflictResolution, "resolvedAt">,
): Conflict | undefined {
  const conflict = activeConflicts.get(conflictId);
  if (!conflict) return undefined;

  conflict.resolution = {
    ...resolution,
    resolvedAt: new Date(),
  };
  conflict.resolvedAt = conflict.resolution.resolvedAt;

  // Remove from active, keep in history
  activeConflicts.delete(conflictId);

  const log = getLogger();
  log.info(
    {
      type: "conflict:resolved",
      conflictId,
      resolution: resolution.type,
      resolvedBy: resolution.resolvedBy,
    },
    `[CONFLICT] Resolved conflict ${conflictId}`,
  );

  publishConflictEvent("conflict.resolved", conflict);

  return conflict;
}

/**
 * Get recommended actions for resolving a conflict.
 */
export function getRecommendedActions(conflict: Conflict): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  switch (conflict.type) {
    case "reservation_overlap": {
      const resolutions = conflict.metadata["resolutions"] as
        | Array<{ type: string; description: string; expiresAt?: Date }>
        | undefined;

      if (resolutions) {
        for (const res of resolutions) {
          if (res.type === "wait" && res.expiresAt) {
            actions.push({
              id: "wait",
              label: "Wait",
              description: res.description,
              type: "wait",
              expiresAt: new Date(res.expiresAt),
            });
          } else if (res.type === "narrow") {
            actions.push({
              id: "negotiate",
              label: "Narrow Patterns",
              description: res.description,
              type: "negotiate",
            });
          } else if (res.type === "share") {
            actions.push({
              id: "share",
              label: "Share Access",
              description: res.description,
              type: "negotiate",
            });
          }
        }
      }

      actions.push({
        id: "force",
        label: "Override (Admin)",
        description: "Force override existing reservation (requires admin)",
        type: "force",
      });
      break;
    }

    case "git_merge_conflict":
      actions.push(
        {
          id: "manual_resolve",
          label: "Resolve Manually",
          description: "Human intervention required to resolve merge conflicts",
          type: "manual_resolve",
        },
        {
          id: "abort_merge",
          label: "Abort Merge",
          description: "Abort the merge and retry later",
          type: "abort",
        },
      );
      break;

    case "git_potential_conflict":
      actions.push(
        {
          id: "review",
          label: "Review Changes",
          description: "Review the changes in both branches before merging",
          type: "manual_resolve",
        },
        {
          id: "rebase",
          label: "Rebase First",
          description:
            "Rebase your branch on the target to catch conflicts early",
          type: "manual_resolve",
        },
      );
      break;

    case "resource_contention":
      actions.push(
        {
          id: "retry",
          label: "Retry with Backoff",
          description: "Retry the operation with exponential backoff",
          type: "retry",
        },
        {
          id: "queue",
          label: "Queue Request",
          description: "Queue the request for later processing",
          type: "wait",
        },
      );
      break;

    case "deadlock_detected":
      actions.push(
        {
          id: "break_deadlock",
          label: "Break Deadlock",
          description:
            "Release one of the held resources to break the deadlock",
          type: "abort",
        },
        {
          id: "investigate",
          label: "Investigate",
          description: "Manual investigation needed to understand the deadlock",
          type: "manual_resolve",
        },
      );
      break;
  }

  return actions;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get conflict detection statistics.
 */
export function getConflictStats(): {
  activeCount: number;
  byType: Record<ConflictType, number>;
  bySeverity: Record<ConflictSeverity, number>;
  last24h: number;
  resolved24h: number;
} {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const byType: Record<ConflictType, number> = {
    reservation_overlap: 0,
    git_merge_conflict: 0,
    git_potential_conflict: 0,
    resource_contention: 0,
    deadlock_detected: 0,
  };

  const bySeverity: Record<ConflictSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };

  let last24h = 0;
  let resolved24h = 0;

  // Count active conflicts (for byType, bySeverity, and last24h)
  for (const conflict of activeConflicts.values()) {
    byType[conflict.type]++;
    bySeverity[conflict.severity]++;
    if (conflict.detectedAt.getTime() >= dayAgo) {
      last24h++;
    }
  }

  // Count historical conflicts (resolved ones not in active)
  for (const conflict of conflictHistory) {
    // Count resolved conflicts in last 24h
    if (conflict.resolvedAt && conflict.resolvedAt.getTime() >= dayAgo) {
      resolved24h++;
    }
    // Count detected conflicts in last 24h that are no longer active
    if (
      conflict.detectedAt.getTime() >= dayAgo &&
      !activeConflicts.has(conflict.id)
    ) {
      last24h++;
    }
  }

  return {
    activeCount: activeConflicts.size,
    byType,
    bySeverity,
    last24h,
    resolved24h,
  };
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Update alert configuration.
 */
export function updateAlertConfig(
  config: Partial<ConflictAlertConfig>,
): ConflictAlertConfig {
  alertConfig = { ...alertConfig, ...config };
  return alertConfig;
}

/**
 * Get current alert configuration.
 */
export function getAlertConfig(): ConflictAlertConfig {
  return { ...alertConfig };
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear all conflict state (for testing).
 */
export function clearConflictState(): void {
  activeConflicts.clear();
  conflictHistory.length = 0;
  recentAccesses.length = 0;
  reservationEngine.clear();
}
