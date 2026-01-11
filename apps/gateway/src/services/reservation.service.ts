/**
 * File Reservation Service.
 *
 * Provides file reservation management for multi-agent coordination.
 * Prevents file conflicts by allowing agents to reserve glob patterns
 * before editing files. Supports exclusive and shared modes with TTL-based
 * automatic expiration.
 *
 * Builds on the ReservationConflictEngine for conflict detection.
 */

import { getCorrelationId } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import { logger } from "./logger";
import {
  createReservationConflictEngine,
  type Reservation,
  type ReservationConflict,
} from "./reservation-conflicts";

// ============================================================================
// Constants
// ============================================================================

/** Default TTL in seconds (5 minutes) */
const DEFAULT_TTL_SECONDS = 300;

/** Maximum TTL in seconds (1 hour) */
const MAX_TTL_SECONDS = 3600;

/** Maximum number of renewals allowed */
const MAX_RENEWALS = 10;

/** Background cleanup interval in milliseconds */
const CLEANUP_INTERVAL_MS = 10_000;

/** Warning threshold before expiration (30 seconds) */
const EXPIRATION_WARNING_MS = 30_000;

// ============================================================================
// Types
// ============================================================================

export type ReservationMode = "exclusive" | "shared";
export type ConflictStatus = "open" | "resolved";

export interface FileReservation {
  id: string;
  projectId: string;
  agentId: string;
  patterns: string[];
  mode: ReservationMode;
  ttl: number;
  createdAt: Date;
  expiresAt: Date;
  renewCount: number;
  metadata: {
    reason?: string;
    taskId?: string;
  };
}

export interface ReservationConflictRecord {
  conflictId: string;
  projectId: string;
  type: "reservation_overlap";
  status: ConflictStatus;
  detectedAt: Date;
  resolvedAt?: Date;
  requesterId: string;
  existingReservationId: string;
  overlappingPattern: string;
  conflict: ReservationConflict;
  resolutionReason?: string;
  resolvedBy?: string;
}

export interface CreateReservationParams {
  projectId: string;
  agentId: string;
  patterns: string[];
  mode: ReservationMode;
  ttl?: number;
  reason?: string;
  taskId?: string;
}

export interface CreateReservationResult {
  reservation: FileReservation | null;
  conflicts: ReservationConflict[];
  granted: boolean;
}

export interface CheckReservationParams {
  projectId: string;
  agentId: string;
  filePath: string;
}

export interface CheckReservationResult {
  allowed: boolean;
  heldBy?: string;
  expiresAt?: Date;
  mode?: ReservationMode;
  reservationId?: string;
}

export interface ReleaseReservationParams {
  reservationId: string;
  agentId: string;
}

export interface ReleaseReservationResult {
  released: boolean;
  error?: string;
}

export interface RenewReservationParams {
  reservationId: string;
  agentId: string;
  additionalTtl?: number;
}

export interface RenewReservationResult {
  renewed: boolean;
  newExpiresAt?: Date;
  error?: string;
}

export interface ListReservationsParams {
  projectId: string;
  agentId?: string;
  filePath?: string;
}

export interface ListConflictsParams {
  projectId: string;
  status?: ConflictStatus;
  limit?: number;
}

export interface ResolveConflictParams {
  conflictId: string;
  resolvedBy?: string;
  reason?: string;
}

export interface ResolveConflictResult {
  resolved: boolean;
  conflict?: ReservationConflictRecord;
  error?: string;
}

// ============================================================================
// Storage
// ============================================================================

/** In-memory storage for reservations (keyed by reservation ID) */
const reservationStore: Map<string, FileReservation> = new Map();
const conflictStore: Map<string, ReservationConflictRecord> = new Map();

/** The conflict detection engine */
const conflictEngine = createReservationConflictEngine();

/** Cleanup interval handle */
let cleanupInterval: Timer | null = null;

/** Track which reservations have been warned about expiring (to avoid spam) */
const warnedExpiringReservations: Set<string> = new Set();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a cryptographically secure unique reservation ID.
 */
function generateReservationId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `rsv_${result}`;
}

/**
 * Convert FileReservation to the Reservation type used by conflict engine.
 */
function toConflictReservation(res: FileReservation): Reservation {
  return {
    id: res.id,
    projectId: res.projectId,
    requesterId: res.agentId,
    patterns: res.patterns,
    exclusive: res.mode === "exclusive",
    createdAt: res.createdAt,
    expiresAt: res.expiresAt,
  };
}

/**
 * Publish a WebSocket event for reservation changes.
 */
function publishReservationEvent(
  workspaceId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "workspace:reservations", workspaceId };
  hub.publish(channel, eventType, payload, { workspaceId });
}

/**
 * Publish a WebSocket event for conflict detection.
 */
function publishConflictEvent(
  workspaceId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "workspace:conflicts", workspaceId };
  hub.publish(channel, eventType, payload, { workspaceId });
}

function recordConflict(
  conflict: ReservationConflict,
  requesterId: string,
): ReservationConflictRecord {
  const record: ReservationConflictRecord = {
    conflictId: conflict.conflictId,
    projectId: conflict.projectId,
    type: "reservation_overlap",
    status: "open",
    detectedAt: conflict.detectedAt,
    requesterId,
    existingReservationId: conflict.existingReservation.id,
    overlappingPattern: conflict.overlappingPattern,
    conflict,
  };
  conflictStore.set(record.conflictId, record);
  return record;
}

function resolveConflictsForReservation(
  projectId: string,
  reservationId: string,
  reason: string,
  resolvedBy?: string,
): number {
  let resolvedCount = 0;
  const now = new Date();

  for (const conflict of conflictStore.values()) {
    if (
      conflict.projectId !== projectId ||
      conflict.status !== "open" ||
      conflict.existingReservationId !== reservationId
    ) {
      continue;
    }

    conflict.status = "resolved";
    conflict.resolvedAt = now;
    conflict.resolutionReason = reason;
    if (resolvedBy !== undefined) {
      conflict.resolvedBy = resolvedBy;
    } else {
      delete conflict.resolvedBy;
    }
    resolvedCount++;

    publishConflictEvent(projectId, "conflict.resolved", {
      conflictId: conflict.conflictId,
      projectId,
      resolution: reason,
      resolvedAt: now.toISOString(),
    });
  }

  return resolvedCount;
}

/**
 * Convert a glob pattern to a regex for matching file paths.
 *
 * @param pattern - Glob pattern (supports *, **, ?)
 * @returns RegExp for matching
 */
function globToRegex(pattern: string): RegExp {
  // Use placeholder to avoid ** replacement affecting later * replacement
  const GLOBSTAR_PLACEHOLDER = "\x00GLOBSTAR\x00";

  const regex = pattern
    // Normalize path separators
    .replace(/\/+/g, "/")
    // Remove trailing slash
    .replace(/\/$/, "")
    // Handle **/ at the start or middle - matches zero or more directories
    .replace(/\*\*\//g, GLOBSTAR_PLACEHOLDER + "/")
    // Handle /** at the end - matches zero or more path segments
    .replace(/\/\*\*/g, "/" + GLOBSTAR_PLACEHOLDER)
    // Handle remaining ** (in case it's standalone)
    .replace(/\*\*/g, GLOBSTAR_PLACEHOLDER)
    // Escape regex special chars (except glob chars)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // * matches anything except path separator
    .replace(/\*/g, "[^/]*")
    // ? matches single character except path separator
    .replace(/\?/g, "[^/]")
    // Now replace placeholder/ with (.*/)? - matches zero or more directories
    .replace(new RegExp(GLOBSTAR_PLACEHOLDER + "/", "g"), "(.*/)?")
    // Replace /placeholder with (/.*)? - matches zero or more path segments
    .replace(new RegExp("/" + GLOBSTAR_PLACEHOLDER, "g"), "(/.*)?")
    // Replace standalone placeholder with .* - matches anything
    .replace(new RegExp(GLOBSTAR_PLACEHOLDER, "g"), ".*");

  return new RegExp(`^${regex}$`);
}

/**
 * Check if a file path matches any pattern in the list.
 */
function fileMatchesPatterns(filePath: string, patterns: string[]): boolean {
  // Normalize the file path
  const normalizedPath = filePath.replace(/\/+/g, "/").replace(/^\//, "");

  for (const pattern of patterns) {
    try {
      const regex = globToRegex(pattern);
      if (regex.test(normalizedPath) || regex.test(filePath)) {
        return true;
      }
    } catch (err) {
      // Skip invalid patterns but log for debugging
      logger.debug({ pattern, error: err }, "Invalid glob pattern skipped");
    }
  }
  return false;
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Create a new file reservation.
 *
 * @param params - Reservation parameters
 * @returns Result with reservation or conflicts
 */
export async function createReservation(
  params: CreateReservationParams,
): Promise<CreateReservationResult> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    projectId: params.projectId,
    agentId: params.agentId,
  });

  // Validate patterns
  if (!params.patterns || params.patterns.length === 0) {
    log.warn("Reservation request with no patterns");
    return {
      reservation: null,
      conflicts: [],
      granted: false,
    };
  }

  // Validate and cap TTL
  let ttl = params.ttl ?? DEFAULT_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS) {
    log.debug(
      { requestedTtl: ttl, maxTtl: MAX_TTL_SECONDS },
      "TTL capped to maximum",
    );
    ttl = MAX_TTL_SECONDS;
  }
  if (ttl <= 0) {
    ttl = DEFAULT_TTL_SECONDS;
  }

  const exclusive = params.mode === "exclusive";

  // Check for conflicts
  const conflictResult = conflictEngine.checkConflicts(
    params.projectId,
    params.agentId,
    params.patterns,
    exclusive,
  );

  if (conflictResult.hasConflicts) {
    log.info(
      {
        conflictCount: conflictResult.conflicts.length,
        patterns: params.patterns,
        exclusive,
      },
      "Reservation request has conflicts",
    );

    // Publish conflict events
    for (const conflict of conflictResult.conflicts) {
      recordConflict(conflict, params.agentId);
      publishConflictEvent(params.projectId, "conflict.detected", {
        conflictId: conflict.conflictId,
        projectId: params.projectId,
        pattern: conflict.overlappingPattern,
        existingReservation: {
          reservationId: conflict.existingReservation.id,
          requesterId: conflict.existingReservation.requesterId,
          expiresAt: conflict.existingReservation.expiresAt.toISOString(),
        },
        requestingAgent: params.agentId,
        detectedAt: new Date().toISOString(),
      });
    }

    return {
      reservation: null,
      conflicts: conflictResult.conflicts,
      granted: false,
    };
  }

  // Create the reservation
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const reservation: FileReservation = {
    id: generateReservationId(),
    projectId: params.projectId,
    agentId: params.agentId,
    patterns: params.patterns,
    mode: params.mode,
    ttl,
    createdAt: now,
    expiresAt,
    renewCount: 0,
    metadata: {
      ...(params.reason !== undefined && { reason: params.reason }),
      ...(params.taskId !== undefined && { taskId: params.taskId }),
    },
  };

  // Store in both places
  reservationStore.set(reservation.id, reservation);
  conflictEngine.registerReservation(toConflictReservation(reservation));

  log.info(
    {
      reservationId: reservation.id,
      patterns: params.patterns,
      exclusive,
      ttl,
      expiresAt: expiresAt.toISOString(),
    },
    "Reservation created",
  );

  // Publish acquired event
  publishReservationEvent(params.projectId, "reservation.acquired", {
    reservationId: reservation.id,
    projectId: params.projectId,
    requesterId: params.agentId,
    patterns: params.patterns,
    exclusive,
    expiresAt: expiresAt.toISOString(),
    acquiredAt: now.toISOString(),
  });

  return {
    reservation,
    conflicts: [],
    granted: true,
  };
}

/**
 * Check if an agent can access a specific file.
 *
 * @param params - Check parameters
 * @returns Result indicating access permission
 */
export async function checkReservation(
  params: CheckReservationParams,
): Promise<CheckReservationResult> {
  const now = new Date();

  // Get all active reservations for the project
  const projectReservations = Array.from(reservationStore.values()).filter(
    (r) => r.projectId === params.projectId && r.expiresAt > now,
  );

  for (const reservation of projectReservations) {
    // Check if the file matches any pattern in this reservation
    if (fileMatchesPatterns(params.filePath, reservation.patterns)) {
      // If this is the agent's own reservation, they can access
      if (reservation.agentId === params.agentId) {
        return {
          allowed: true,
          heldBy: reservation.agentId,
          expiresAt: reservation.expiresAt,
          mode: reservation.mode,
          reservationId: reservation.id,
        };
      }

      // If the reservation is exclusive, deny access
      if (reservation.mode === "exclusive") {
        return {
          allowed: false,
          heldBy: reservation.agentId,
          expiresAt: reservation.expiresAt,
          mode: reservation.mode,
          reservationId: reservation.id,
        };
      }

      // Shared mode - allow read access but indicate holder
      return {
        allowed: true,
        heldBy: reservation.agentId,
        expiresAt: reservation.expiresAt,
        mode: reservation.mode,
        reservationId: reservation.id,
      };
    }
  }

  // No reservation covers this file - access allowed
  return {
    allowed: true,
  };
}

/**
 * Release a reservation.
 *
 * @param params - Release parameters
 * @returns Result indicating success
 */
export async function releaseReservation(
  params: ReleaseReservationParams,
): Promise<ReleaseReservationResult> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    reservationId: params.reservationId,
    agentId: params.agentId,
  });

  const reservation = reservationStore.get(params.reservationId);

  if (!reservation) {
    log.warn("Attempt to release non-existent reservation");
    return {
      released: false,
      error: "Reservation not found",
    };
  }

  if (reservation.agentId !== params.agentId) {
    log.warn(
      { holderId: reservation.agentId },
      "Attempt to release reservation by non-holder",
    );
    return {
      released: false,
      error: "Agent does not hold this reservation",
    };
  }

  // Remove from both stores
  reservationStore.delete(params.reservationId);
  warnedExpiringReservations.delete(params.reservationId);
  conflictEngine.removeReservation(reservation.projectId, params.reservationId);
  resolveConflictsForReservation(
    reservation.projectId,
    params.reservationId,
    "reservation_released",
    params.agentId,
  );

  log.info(
    { projectId: reservation.projectId, patterns: reservation.patterns },
    "Reservation released",
  );

  // Publish released event
  publishReservationEvent(reservation.projectId, "reservation.released", {
    reservationId: params.reservationId,
    projectId: reservation.projectId,
    requesterId: params.agentId,
    patterns: reservation.patterns,
    releasedAt: new Date().toISOString(),
  });

  return {
    released: true,
  };
}

/**
 * Renew a reservation to extend its TTL.
 *
 * @param params - Renew parameters
 * @returns Result with new expiration
 */
export async function renewReservation(
  params: RenewReservationParams,
): Promise<RenewReservationResult> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    reservationId: params.reservationId,
    agentId: params.agentId,
  });

  const reservation = reservationStore.get(params.reservationId);

  if (!reservation) {
    log.warn("Attempt to renew non-existent reservation");
    return {
      renewed: false,
      error: "Reservation not found",
    };
  }

  if (reservation.agentId !== params.agentId) {
    log.warn(
      { holderId: reservation.agentId },
      "Attempt to renew reservation by non-holder",
    );
    return {
      renewed: false,
      error: "Agent does not hold this reservation",
    };
  }

  if (reservation.renewCount >= MAX_RENEWALS) {
    log.warn(
      { renewCount: reservation.renewCount, maxRenewals: MAX_RENEWALS },
      "Reservation renewal limit reached",
    );
    return {
      renewed: false,
      error: `Maximum renewals (${MAX_RENEWALS}) reached`,
    };
  }

  // Calculate new expiration time
  // Extend from max(now, current expiry) to prevent shortening
  const now = new Date();
  const baseTime = reservation.expiresAt > now ? reservation.expiresAt : now;
  const additionalTtl = params.additionalTtl ?? reservation.ttl;
  const cappedTtl = Math.min(additionalTtl, MAX_TTL_SECONDS);
  const newExpiresAt = new Date(baseTime.getTime() + cappedTtl * 1000);

  // Update reservation
  reservation.expiresAt = newExpiresAt;
  reservation.renewCount++;

  // Reset warning flag so we warn again when next expiration approaches
  warnedExpiringReservations.delete(reservation.id);

  // Update in conflict engine (re-register with new expiration)
  conflictEngine.removeReservation(reservation.projectId, reservation.id);
  conflictEngine.registerReservation(toConflictReservation(reservation));

  log.info(
    {
      renewCount: reservation.renewCount,
      previousExpiry: baseTime.toISOString(),
      newExpiry: newExpiresAt.toISOString(),
    },
    "Reservation renewed",
  );

  // Publish renewal event (use acquired event with updated info)
  publishReservationEvent(reservation.projectId, "reservation.renewed", {
    reservationId: reservation.id,
    projectId: reservation.projectId,
    requesterId: reservation.agentId,
    renewCount: reservation.renewCount,
    newExpiresAt: newExpiresAt.toISOString(),
    renewedAt: now.toISOString(),
  });

  return {
    renewed: true,
    newExpiresAt,
  };
}

/**
 * List reservations for a project with optional filters.
 *
 * @param params - List parameters
 * @returns List of matching reservations
 */
export async function listReservations(
  params: ListReservationsParams,
): Promise<FileReservation[]> {
  const now = new Date();

  let reservations = Array.from(reservationStore.values()).filter(
    (r) => r.projectId === params.projectId && r.expiresAt > now,
  );

  // Filter by agent if specified
  if (params.agentId) {
    reservations = reservations.filter((r) => r.agentId === params.agentId);
  }

  // Filter by file path if specified
  if (params.filePath) {
    reservations = reservations.filter((r) =>
      fileMatchesPatterns(params.filePath!, r.patterns),
    );
  }

  // Sort by creation time (newest first)
  reservations.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return reservations;
}

/**
 * List conflicts for a project with optional status filter.
 */
export async function listConflicts(
  params: ListConflictsParams,
): Promise<ReservationConflictRecord[]> {
  const limit = Math.min(params.limit ?? 100, 1000);
  const conflicts = Array.from(conflictStore.values()).filter((conflict) => {
    if (conflict.projectId !== params.projectId) return false;
    if (params.status && conflict.status !== params.status) return false;
    return true;
  });

  conflicts.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  return conflicts.slice(0, limit);
}

/**
 * Resolve a conflict by ID.
 */
export async function resolveConflict(
  params: ResolveConflictParams,
): Promise<ResolveConflictResult> {
  const conflict = conflictStore.get(params.conflictId);
  if (!conflict) {
    return { resolved: false, error: "Conflict not found" };
  }

  if (conflict.status === "resolved") {
    return { resolved: true, conflict };
  }

  const now = new Date();
  conflict.status = "resolved";
  conflict.resolvedAt = now;
  conflict.resolutionReason = params.reason ?? "manual";
  if (params.resolvedBy !== undefined) {
    conflict.resolvedBy = params.resolvedBy;
  } else {
    delete conflict.resolvedBy;
  }

  publishConflictEvent(conflict.projectId, "conflict.resolved", {
    conflictId: conflict.conflictId,
    projectId: conflict.projectId,
    resolution: conflict.resolutionReason,
    resolvedAt: now.toISOString(),
  });

  return { resolved: true, conflict };
}

/**
 * Get a single reservation by ID.
 *
 * @param reservationId - The reservation ID
 * @returns The reservation or null if not found
 */
export async function getReservation(
  reservationId: string,
): Promise<FileReservation | null> {
  const reservation = reservationStore.get(reservationId);
  if (!reservation) {
    return null;
  }

  // Check if expired
  if (reservation.expiresAt <= new Date()) {
    return null;
  }

  return reservation;
}

// ============================================================================
// Background Cleanup
// ============================================================================

/**
 * Clean up expired reservations.
 * Called periodically by the background job.
 */
async function cleanupExpiredReservations(): Promise<number> {
  const now = new Date();
  const warningThreshold = new Date(now.getTime() + EXPIRATION_WARNING_MS);
  let cleanedCount = 0;

  for (const [id, reservation] of reservationStore) {
    if (reservation.expiresAt <= now) {
      // Expired - remove it
      reservationStore.delete(id);
      conflictEngine.removeReservation(reservation.projectId, id);
      cleanedCount++;

      logger.debug(
        {
          reservationId: id,
          projectId: reservation.projectId,
          agentId: reservation.agentId,
        },
        "Expired reservation cleaned up",
      );

      // Publish expiration event
      publishReservationEvent(reservation.projectId, "reservation.expired", {
        reservationId: id,
        projectId: reservation.projectId,
        requesterId: reservation.agentId,
        patterns: reservation.patterns,
        expiredAt: now.toISOString(),
      });

      resolveConflictsForReservation(
        reservation.projectId,
        id,
        "reservation_expired",
      );

      // Remove from warned set
      warnedExpiringReservations.delete(id);
    } else if (
      reservation.expiresAt <= warningThreshold &&
      !warnedExpiringReservations.has(id)
    ) {
      // About to expire - publish warning
      publishReservationEvent(reservation.projectId, "reservation.expiring", {
        reservationId: id,
        projectId: reservation.projectId,
        requesterId: reservation.agentId,
        expiresAt: reservation.expiresAt.toISOString(),
        expiresInMs: reservation.expiresAt.getTime() - now.getTime(),
      });
      warnedExpiringReservations.add(id);
    }
  }

  if (cleanedCount > 0) {
    logger.info({ cleanedCount }, "Reservation cleanup completed");
  }

  return cleanedCount;
}

/**
 * Start the background cleanup job.
 */
export function startCleanupJob(): void {
  if (cleanupInterval) {
    return; // Already running
  }

  cleanupInterval = setInterval(() => {
    cleanupExpiredReservations().catch((err) => {
      logger.error({ error: err }, "Error in reservation cleanup job");
    });
  }, CLEANUP_INTERVAL_MS);

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS },
    "Reservation cleanup job started",
  );
}

/**
 * Stop the background cleanup job.
 */
export function stopCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Reservation cleanup job stopped");
  }
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get reservation statistics.
 */
export function getReservationStats(): {
  totalActive: number;
  byProject: Record<string, number>;
  byMode: Record<ReservationMode, number>;
  averageRenewCount: number;
} {
  const now = new Date();
  const active = Array.from(reservationStore.values()).filter(
    (r) => r.expiresAt > now,
  );

  const byProject: Record<string, number> = {};
  const byMode: Record<ReservationMode, number> = { exclusive: 0, shared: 0 };
  let totalRenewCount = 0;

  for (const reservation of active) {
    byProject[reservation.projectId] =
      (byProject[reservation.projectId] ?? 0) + 1;
    byMode[reservation.mode]++;
    totalRenewCount += reservation.renewCount;
  }

  return {
    totalActive: active.length,
    byProject,
    byMode,
    averageRenewCount: active.length > 0 ? totalRenewCount / active.length : 0,
  };
}

// ============================================================================
// Testing Utilities (only for tests)
// ============================================================================

/**
 * Clear all reservations. Only for testing.
 */
export function _clearAllReservations(): void {
  // Remove all reservations from conflict engine first
  for (const [id, reservation] of reservationStore) {
    conflictEngine.removeReservation(reservation.projectId, id);
  }
  reservationStore.clear();
  warnedExpiringReservations.clear();
  conflictStore.clear();
}

/**
 * Get the raw reservation store. Only for testing.
 */
export function _getReservationStore(): Map<string, FileReservation> {
  return reservationStore;
}
