/**
 * File Reservation Conflict Detection Engine.
 *
 * Detects and manages conflicts when multiple agents request overlapping
 * file reservations. Provides pattern matching and conflict resolution
 * strategies.
 */

/**
 * A file reservation record.
 */
export interface Reservation {
  id: string;
  projectId: string;
  requesterId: string;
  patterns: string[];
  exclusive: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * A detected conflict between reservations.
 */
export interface ReservationConflict {
  conflictId: string;
  projectId: string;
  /** The pattern that overlaps */
  overlappingPattern: string;
  /** The existing reservation that conflicts */
  existingReservation: Reservation;
  /** The patterns from the new request that conflict */
  requestedPatterns: string[];
  /** Suggested resolution strategies */
  resolutions: ConflictResolution[];
  detectedAt: Date;
}

/**
 * A resolution strategy for a conflict.
 */
export interface ConflictResolution {
  type: "wait" | "narrow" | "override" | "share";
  description: string;
  /** For 'wait': when the conflict will auto-resolve */
  expiresAt?: Date;
  /** For 'narrow': suggested pattern modifications */
  suggestedPatterns?: string[];
}

/**
 * Result of a conflict check.
 */
export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflicts: ReservationConflict[];
  canProceed: boolean;
}

/**
 * Convert a glob pattern to a regex for matching.
 *
 * @param pattern - Glob pattern (supports *, **, ?)
 * @returns RegExp for matching
 */
export function globToRegex(pattern: string): RegExp {
  // Use placeholder to avoid ** replacement affecting later * replacement
  const GLOBSTAR_PLACEHOLDER = "\x00GLOBSTAR\x00";

  const regex = pattern
    // Normalize path separators
    .replace(/\/+/g, "/")
    // Remove trailing slash
    .replace(/\/$/, "")
    // Handle **/ at the start or middle - matches zero or more directories
    .replace(/\*\*\//g, `${GLOBSTAR_PLACEHOLDER}/`)
    // Handle /** at the end - matches zero or more path segments
    .replace(/\/\*\*/g, `/${GLOBSTAR_PLACEHOLDER}`)
    // Handle remaining ** (in case it's standalone)
    .replace(/\*\*/g, GLOBSTAR_PLACEHOLDER)
    // Escape regex special chars (except glob chars *, ?, and **)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // * matches anything except path separator
    .replace(/\*/g, "[^/]*")
    // ? matches single character except path separator
    .replace(/\?/g, "[^/]")
    // Now replace placeholder/ with (.*/)? - matches zero or more directories
    .replace(new RegExp(`${GLOBSTAR_PLACEHOLDER}/`, "g"), "(.*/)?")
    // Replace /placeholder with (/.*)? - matches zero or more path segments
    .replace(new RegExp(`/${GLOBSTAR_PLACEHOLDER}`, "g"), "(/.*)?")
    // Replace standalone placeholder with .* - matches anything
    .replace(new RegExp(GLOBSTAR_PLACEHOLDER, "g"), ".*");

  return new RegExp(`^${regex}$`);
}

/**
 * Check if two glob patterns can overlap.
 *
 * Two patterns overlap if there exists any file path that would match both.
 * This implementation uses a recursive segment matching approach to handle
 * wildcards (*, ?) and recursive globs (**) more robustly than simple
 * test path generation.
 *
 * @param pattern1 - First glob pattern
 * @param pattern2 - Second glob pattern
 * @returns true if patterns can match the same files
 */
export function patternsOverlap(pattern1: string, pattern2: string): boolean {
  // Identical patterns always overlap
  if (pattern1 === pattern2) return true;

  // Normalize patterns: remove duplicate slashes and trailing slashes
  const p1 = pattern1.replace(/\/+/g, "/").replace(/\/$/, "");
  const p2 = pattern2.replace(/\/+/g, "/").replace(/\/$/, "");

  const segs1 = p1.split("/");
  const segs2 = p2.split("/");

  return checkOverlap(segs1, segs2);
}

function checkOverlap(segs1: string[], segs2: string[]): boolean {
  // Base case: both empty -> match
  if (segs1.length === 0 && segs2.length === 0) return true;

  // Base case: one empty
  if (segs1.length === 0) {
    // If the remaining segments in segs2 are all "**", they can match empty
    return segs2.every((s) => s === "**");
  }
  if (segs2.length === 0) {
    return segs1.every((s) => s === "**");
  }

  const s1 = segs1[0]!;
  const s2 = segs2[0]!;

  // Handle recursive glob **
  if (s1 === "**") {
    // Option 1: ** consumes nothing (match remaining segs1 against current segs2)
    if (checkOverlap(segs1.slice(1), segs2)) return true;
    // Option 2: ** consumes current s2 (match current segs1 against remaining segs2)
    // We keep "**" in segs1 to allow it to consume more
    if (checkOverlap(segs1, segs2.slice(1))) return true;
    return false;
  }

  if (s2 === "**") {
    // Symmetric to above
    if (checkOverlap(segs1, segs2.slice(1))) return true;
    if (checkOverlap(segs1.slice(1), segs2)) return true;
    return false;
  }

  // Both are standard segments (literals or single-segment wildcards)
  if (segmentsOverlap(s1, s2)) {
    return checkOverlap(segs1.slice(1), segs2.slice(1));
  }

  return false;
}

function segmentsOverlap(s1: string, s2: string): boolean {
  if (s1 === s2) return true;
  if (s1 === "*" || s2 === "*") return true;

  const s1HasWildcard = s1.includes("*") || s1.includes("?");
  const s2HasWildcard = s2.includes("*") || s2.includes("?");

  if (!s1HasWildcard && !s2HasWildcard) {
    return s1 === s2;
  }

  if (!s1HasWildcard) {
    // s1 is literal, s2 is glob
    return globToRegex(s2).test(s1);
  }

  if (!s2HasWildcard) {
    // s2 is literal, s1 is glob
    return globToRegex(s1).test(s2);
  }

  // Both have wildcards. Check prefix/suffix compatibility.
  // This filters out impossible overlaps like *.ts vs *.js
  const p1 = getPrefix(s1);
  const suff1 = getSuffix(s1);
  const p2 = getPrefix(s2);
  const suff2 = getSuffix(s2);

  const prefixMatch = p1.startsWith(p2) || p2.startsWith(p1);
  const suffixMatch = suff1.endsWith(suff2) || suff2.endsWith(suff1);

  return prefixMatch && suffixMatch;
}

function getPrefix(s: string): string {
  const match = s.match(/^([^*?]*)/);
  return match?.[1] ?? "";
}

function getSuffix(s: string): string {
  const match = s.match(/([^*?]*)$/);
  return match?.[1] ?? "";
}

/**
 * Conflict detection engine for file reservations.
 */
export class ReservationConflictEngine {
  /** Active reservations by project */
  private reservations: Map<string, Reservation[]> = new Map();

  /**
   * Register a new reservation.
   *
   * @param reservation - The reservation to register
   */
  registerReservation(reservation: Reservation): void {
    const projectReservations =
      this.reservations.get(reservation.projectId) || [];
    projectReservations.push(reservation);
    this.reservations.set(reservation.projectId, projectReservations);
  }

  /**
   * Remove a reservation.
   *
   * @param projectId - Project containing the reservation
   * @param reservationId - ID of the reservation to remove
   * @returns true if reservation was found and removed
   */
  removeReservation(projectId: string, reservationId: string): boolean {
    const projectReservations = this.reservations.get(projectId);
    if (!projectReservations) return false;

    const index = projectReservations.findIndex((r) => r.id === reservationId);
    if (index === -1) return false;

    projectReservations.splice(index, 1);

    // Clean up empty project entries to prevent memory leak
    if (projectReservations.length === 0) {
      this.reservations.delete(projectId);
    }

    return true;
  }

  /**
   * Get all active reservations for a project.
   *
   * @param projectId - Project ID
   * @returns List of active reservations (expired ones filtered out)
   */
  getActiveReservations(projectId: string): Reservation[] {
    const projectReservations = this.reservations.get(projectId) || [];
    const now = new Date();

    // Filter out expired reservations and clean up
    const active = projectReservations.filter((r) => r.expiresAt > now);
    if (active.length !== projectReservations.length) {
      if (active.length === 0) {
        // Remove empty project entries to prevent memory leak
        this.reservations.delete(projectId);
      } else {
        this.reservations.set(projectId, active);
      }
    }

    return active;
  }

  /**
   * Check for conflicts before creating a new reservation.
   *
   * @param projectId - Project to check
   * @param requesterId - Agent requesting the reservation
   * @param patterns - Patterns being requested
   * @param exclusive - Whether exclusive access is needed
   * @returns Conflict check result
   */
  checkConflicts(
    projectId: string,
    requesterId: string,
    patterns: string[],
    exclusive: boolean,
  ): ConflictCheckResult {
    const activeReservations = this.getActiveReservations(projectId);
    const conflicts: ReservationConflict[] = [];

    for (const existing of activeReservations) {
      // Skip if same requester (can extend own reservations)
      if (existing.requesterId === requesterId) continue;

      // Skip if neither reservation is exclusive (shared access OK)
      if (!exclusive && !existing.exclusive) continue;

      // Check for pattern overlaps
      for (const newPattern of patterns) {
        for (const existingPattern of existing.patterns) {
          if (patternsOverlap(newPattern, existingPattern)) {
            const conflict = this.createConflict(
              projectId,
              existing,
              patterns.filter((p) => patternsOverlap(p, existingPattern)),
              existingPattern,
              exclusive,
            );
            conflicts.push(conflict);
            break; // One conflict per existing reservation is enough
          }
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      canProceed: conflicts.length === 0,
    };
  }

  /**
   * Create a conflict record with resolution suggestions.
   */
  private createConflict(
    projectId: string,
    existing: Reservation,
    requestedPatterns: string[],
    overlappingPattern: string,
    requestedExclusive: boolean,
  ): ReservationConflict {
    const resolutions: ConflictResolution[] = [];

    // Suggest waiting if reservation expires soon (but not already expired)
    const now = new Date();
    const msUntilExpiry = existing.expiresAt.getTime() - now.getTime();
    if (msUntilExpiry > 0 && msUntilExpiry < 300000) {
      // Between 0 and 5 minutes
      resolutions.push({
        type: "wait",
        description: `Wait ${Math.ceil(msUntilExpiry / 1000)}s for existing reservation to expire`,
        expiresAt: existing.expiresAt,
      });
    }

    // Suggest narrowing patterns if possible
    const narrowed = this.suggestNarrowerPatterns(
      requestedPatterns,
      existing.patterns,
    );
    if (narrowed.length > 0) {
      resolutions.push({
        type: "narrow",
        description: "Use more specific patterns to avoid overlap",
        suggestedPatterns: narrowed,
      });
    }

    // Suggest shared access only when the existing reservation is non-exclusive
    // and the requester can opt out of exclusivity.
    if (!existing.exclusive && requestedExclusive) {
      resolutions.push({
        type: "share",
        description: "Request non-exclusive access (read-only operations)",
      });
    }

    return {
      conflictId: crypto.randomUUID(),
      projectId,
      overlappingPattern,
      existingReservation: existing,
      requestedPatterns,
      resolutions,
      detectedAt: new Date(),
    };
  }

  /**
   * Suggest narrower patterns that don't overlap with existing ones.
   */
  private suggestNarrowerPatterns(
    requested: string[],
    existing: string[],
  ): string[] {
    const suggestions: string[] = [];

    for (const pattern of requested) {
      // If pattern uses **, suggest more specific paths
      if (pattern.includes("**")) {
        // Suggest removing ** and being more specific
        const withoutGlobstar = pattern.replace(/\*\*\/?/g, "");
        if (
          withoutGlobstar &&
          !existing.some((e) => patternsOverlap(withoutGlobstar, e))
        ) {
          suggestions.push(withoutGlobstar);
        }
      }

      // If pattern uses *, suggest specific files
      if (pattern.includes("*") && !pattern.includes("**")) {
        // Can't auto-suggest without knowing actual files
        // This would need file system access
      }
    }

    return suggestions;
  }

  /**
   * Get statistics about current reservations.
   */
  getStats(): {
    projectCount: number;
    totalReservations: number;
    activeReservations: number;
  } {
    let total = 0;
    let active = 0;
    const now = new Date();

    for (const [, reservations] of this.reservations) {
      total += reservations.length;
      active += reservations.filter((r) => r.expiresAt > now).length;
    }

    return {
      projectCount: this.reservations.size,
      totalReservations: total,
      activeReservations: active,
    };
  }

  /**
   * Clear all reservations (for testing).
   */
  clear(): void {
    this.reservations.clear();
  }
}

/**
 * Create a reservation conflict engine.
 */
export function createReservationConflictEngine(): ReservationConflictEngine {
  return new ReservationConflictEngine();
}
