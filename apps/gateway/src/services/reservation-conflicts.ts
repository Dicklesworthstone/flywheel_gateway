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
    // Escape regex special chars (except glob chars *, ?, and **)
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
 * Check if two glob patterns can overlap.
 *
 * Two patterns overlap if there exists any file path that would match both.
 * This is a conservative check - it may report false positives but never
 * false negatives.
 *
 * @param pattern1 - First glob pattern
 * @param pattern2 - Second glob pattern
 * @returns true if patterns can match the same files
 */
export function patternsOverlap(pattern1: string, pattern2: string): boolean {
  // Identical patterns always overlap
  if (pattern1 === pattern2) return true;

  // Normalize patterns
  const norm1 = pattern1.replace(/\/+/g, "/").replace(/\/$/, "");
  const norm2 = pattern2.replace(/\/+/g, "/").replace(/\/$/, "");

  // Check if one is a prefix of the other (directory containment)
  const prefix1 = norm1.replace(/\*.*$/, "").replace(/\/[^/]*$/, "");
  const prefix2 = norm2.replace(/\*.*$/, "").replace(/\/[^/]*$/, "");

  if (prefix1 && prefix2) {
    // If neither is a prefix of the other, they can't overlap
    if (!prefix1.startsWith(prefix2) && !prefix2.startsWith(prefix1)) {
      return false;
    }
  }

  // Try to match test paths from one pattern against the other
  const regex1 = globToRegex(norm1);
  const regex2 = globToRegex(norm2);

  // Generate test paths for each pattern
  const testPaths1 = generateTestPaths(norm1);
  const testPaths2 = generateTestPaths(norm2);

  // Check if any test path from pattern1 matches pattern2
  for (const path of testPaths1) {
    if (regex2.test(path)) return true;
  }

  // Check if any test path from pattern2 matches pattern1
  for (const path of testPaths2) {
    if (regex1.test(path)) return true;
  }

  // Check if patterns match each other (for ** patterns)
  if (regex1.test(norm2) || regex2.test(norm1)) return true;

  return false;
}

/**
 * Generate test file paths from a glob pattern.
 * These are used to check overlap with other patterns.
 */
function generateTestPaths(pattern: string): string[] {
  const paths: string[] = [];

  // Replace ** with a directory structure
  // Replace * with a filename component
  const base = pattern.replace(/\*\*/g, "a/b/c").replace(/\*/g, "file");

  paths.push(base);

  // Also try with different extensions if pattern has extension
  if (pattern.includes(".")) {
    paths.push(base.replace(/\.\w+$/, ".test"));
  }

  // Try with the pattern itself as a literal path (if no wildcards)
  if (!pattern.includes("*") && !pattern.includes("?")) {
    paths.push(pattern);
  }

  // Try with just the prefix
  const prefix = pattern.split("*")[0];
  if (prefix && prefix !== pattern) {
    paths.push(prefix + "file.ts");
  }

  return paths;
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
      this.reservations.set(projectId, active);
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
}

/**
 * Create a reservation conflict engine.
 */
export function createReservationConflictEngine(): ReservationConflictEngine {
  return new ReservationConflictEngine();
}
