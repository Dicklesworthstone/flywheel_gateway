/**
 * Git Conflict Prediction Service.
 *
 * Provides predictive conflict detection by analyzing pending changes
 * across active branches. Uses file-level overlap detection and
 * semantic analysis hints.
 *
 * Key features:
 * - Pattern-based conflict detection
 * - Severity scoring based on overlap extent
 * - Resolution recommendations
 * - Historical pattern tracking
 */

import { getCorrelationId } from "../middleware/correlation";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export interface FileChange {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string; // For renames
  linesAdded: number;
  linesDeleted: number;
  isBinary: boolean;
}

export interface BranchChanges {
  branchName: string;
  baseBranch: string;
  commitCount: number;
  files: FileChange[];
  lastUpdated: Date;
}

export interface ConflictDetails {
  conflictId: string;
  file: string;
  branchA: string;
  branchB: string;
  changeTypeA: FileChange["changeType"];
  changeTypeB: FileChange["changeType"];
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  suggestedResolution: string;
}

export interface ConflictAnalysis {
  id: string;
  repositoryId: string;
  analyzedAt: Date;
  branchPairs: Array<{
    branchA: string;
    branchB: string;
    conflictCount: number;
    maxSeverity: ConflictDetails["severity"];
  }>;
  conflicts: ConflictDetails[];
  overallSeverity: ConflictDetails["severity"];
  recommendations: string[];
}

export interface ConflictPattern {
  id: string;
  pattern: string; // Glob pattern
  frequency: number;
  lastSeen: Date;
  typicalResolution?: string;
}

// ============================================================================
// Storage
// ============================================================================

/** Cached branch changes for conflict analysis */
const branchChangesCache: Map<string, BranchChanges> = new Map();

/** Historical conflict patterns */
const conflictPatterns: Map<string, ConflictPattern> = new Map();

/** Recent conflict analyses */
const analysisHistory: Map<string, ConflictAnalysis[]> = new Map();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique conflict ID.
 */
function generateConflictId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `gcf_${result}`;
}

/**
 * Generate a unique analysis ID.
 */
function generateAnalysisId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `gca_${result}`;
}

/**
 * Calculate severity based on change types and overlap.
 */
function calculateSeverity(
  changeA: FileChange,
  changeB: FileChange,
): ConflictDetails["severity"] {
  // Delete conflicts are critical
  if (changeA.changeType === "deleted" || changeB.changeType === "deleted") {
    if (
      changeA.changeType === "modified" ||
      changeB.changeType === "modified"
    ) {
      return "critical"; // One side deleted, other modified
    }
    return "high";
  }

  // Both modified - check extent
  if (changeA.changeType === "modified" && changeB.changeType === "modified") {
    const totalLinesA = changeA.linesAdded + changeA.linesDeleted;
    const totalLinesB = changeB.linesAdded + changeB.linesDeleted;
    const totalChanges = totalLinesA + totalLinesB;

    if (totalChanges > 100) return "high";
    if (totalChanges > 30) return "medium";
    return "low";
  }

  // Add/add conflict
  if (changeA.changeType === "added" && changeB.changeType === "added") {
    return "high"; // Same file added in both branches
  }

  // Binary file conflicts are high
  if (changeA.isBinary || changeB.isBinary) {
    return "high";
  }

  return "medium";
}

/**
 * Generate a resolution suggestion based on conflict type.
 */
function suggestResolution(
  changeA: FileChange,
  changeB: FileChange,
  branchA: string,
  branchB: string,
): string {
  if (changeA.changeType === "deleted" && changeB.changeType === "modified") {
    return `File deleted in ${branchA} but modified in ${branchB}. Decide whether to keep changes or accept deletion.`;
  }

  if (changeA.changeType === "modified" && changeB.changeType === "deleted") {
    return `File modified in ${branchA} but deleted in ${branchB}. Decide whether to keep changes or accept deletion.`;
  }

  if (changeA.changeType === "added" && changeB.changeType === "added") {
    return `Same file added in both branches. Review both versions and merge content manually.`;
  }

  if (changeA.changeType === "modified" && changeB.changeType === "modified") {
    const totalLinesA = changeA.linesAdded + changeA.linesDeleted;
    const totalLinesB = changeB.linesAdded + changeB.linesDeleted;

    if (totalLinesA > totalLinesB * 2) {
      return `${branchA} has significantly more changes. Consider reviewing ${branchA} changes first.`;
    }
    if (totalLinesB > totalLinesA * 2) {
      return `${branchB} has significantly more changes. Consider reviewing ${branchB} changes first.`;
    }

    return `Both branches have substantial modifications. Use a three-way merge tool to resolve conflicts.`;
  }

  if (changeA.isBinary || changeB.isBinary) {
    return `Binary file conflict. Choose one version or regenerate the file.`;
  }

  return `Standard merge conflict. Review both changes and resolve manually.`;
}

/**
 * Create cache key for branch changes.
 */
function branchCacheKey(repositoryId: string, branchName: string): string {
  return `${repositoryId}:${branchName}`;
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Register file changes for a branch (used by agents to report their changes).
 */
export async function registerBranchChanges(
  repositoryId: string,
  changes: BranchChanges,
): Promise<void> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId,
    branchName: changes.branchName,
  });

  const key = branchCacheKey(repositoryId, changes.branchName);
  branchChangesCache.set(key, changes);

  log.info(
    {
      fileCount: changes.files.length,
      commitCount: changes.commitCount,
    },
    "Branch changes registered",
  );
}

/**
 * Get registered changes for a branch.
 */
export async function getBranchChanges(
  repositoryId: string,
  branchName: string,
): Promise<BranchChanges | null> {
  const key = branchCacheKey(repositoryId, branchName);
  return branchChangesCache.get(key) ?? null;
}

/**
 * Analyze conflicts across all active branches in a repository.
 */
export async function analyzeRepositoryConflicts(
  repositoryId: string,
  branches?: string[],
): Promise<ConflictAnalysis> {
  const correlationId = getCorrelationId();
  const log = logger.child({
    correlationId,
    repositoryId,
  });

  const now = new Date();

  // Get all branch changes for this repository
  const allBranchChanges: BranchChanges[] = [];
  for (const [key, changes] of branchChangesCache) {
    if (key.startsWith(`${repositoryId}:`)) {
      if (!branches || branches.includes(changes.branchName)) {
        allBranchChanges.push(changes);
      }
    }
  }

  const conflicts: ConflictDetails[] = [];
  const branchPairs: ConflictAnalysis["branchPairs"] = [];

  // Compare each pair of branches
  for (let i = 0; i < allBranchChanges.length; i++) {
    for (let j = i + 1; j < allBranchChanges.length; j++) {
      const changesA = allBranchChanges[i]!;
      const changesB = allBranchChanges[j]!;

      const pairConflicts = detectPairConflicts(
        changesA,
        changesB,
        repositoryId,
      );

      if (pairConflicts.length > 0) {
        conflicts.push(...pairConflicts);

        branchPairs.push({
          branchA: changesA.branchName,
          branchB: changesB.branchName,
          conflictCount: pairConflicts.length,
          maxSeverity: pairConflicts.reduce(
            (max, c) => {
              const severityOrder = ["low", "medium", "high", "critical"];
              return severityOrder.indexOf(c.severity) >
                severityOrder.indexOf(max)
                ? c.severity
                : max;
            },
            "low" as ConflictDetails["severity"],
          ),
        });
      }
    }
  }

  // Calculate overall severity
  let overallSeverity: ConflictDetails["severity"] = "low";
  if (conflicts.some((c) => c.severity === "critical")) {
    overallSeverity = "critical";
  } else if (conflicts.some((c) => c.severity === "high")) {
    overallSeverity = "high";
  } else if (conflicts.some((c) => c.severity === "medium")) {
    overallSeverity = "medium";
  }

  // Generate recommendations
  const recommendations: string[] = [];
  if (conflicts.length === 0) {
    recommendations.push("No conflicts detected. Branches can be merged safely.");
  } else {
    if (overallSeverity === "critical") {
      recommendations.push(
        "Critical conflicts detected. Immediate coordination required.",
      );
    }
    if (conflicts.some((c) => c.changeTypeA === "deleted" || c.changeTypeB === "deleted")) {
      recommendations.push(
        "Some files are deleted in one branch but modified in another. Coordinate with the other agent.",
      );
    }
    if (conflicts.length > 5) {
      recommendations.push(
        "Many overlapping files. Consider using smaller, focused branches.",
      );
    }
  }

  const analysis: ConflictAnalysis = {
    id: generateAnalysisId(),
    repositoryId,
    analyzedAt: now,
    branchPairs,
    conflicts,
    overallSeverity,
    recommendations,
  };

  // Store in history
  const history = analysisHistory.get(repositoryId) ?? [];
  history.unshift(analysis);
  if (history.length > 10) {
    history.pop();
  }
  analysisHistory.set(repositoryId, history);

  log.info(
    {
      analysisId: analysis.id,
      conflictCount: conflicts.length,
      overallSeverity,
      branchCount: allBranchChanges.length,
    },
    "Repository conflict analysis completed",
  );

  return analysis;
}

/**
 * Detect conflicts between two specific branches.
 */
function detectPairConflicts(
  changesA: BranchChanges,
  changesB: BranchChanges,
  repositoryId: string,
): ConflictDetails[] {
  const conflicts: ConflictDetails[] = [];

  // Build file map for branch B
  const fileMapB = new Map<string, FileChange>();
  for (const file of changesB.files) {
    fileMapB.set(file.path, file);
    if (file.oldPath) {
      fileMapB.set(file.oldPath, file);
    }
  }

  // Check each file in A against B
  for (const fileA of changesA.files) {
    const pathsToCheck = [fileA.path];
    if (fileA.oldPath) {
      pathsToCheck.push(fileA.oldPath);
    }

    for (const path of pathsToCheck) {
      const fileB = fileMapB.get(path);
      if (fileB) {
        // Found overlap - create conflict
        const severity = calculateSeverity(fileA, fileB);
        const suggestedResolution = suggestResolution(
          fileA,
          fileB,
          changesA.branchName,
          changesB.branchName,
        );

        conflicts.push({
          conflictId: generateConflictId(),
          file: path,
          branchA: changesA.branchName,
          branchB: changesB.branchName,
          changeTypeA: fileA.changeType,
          changeTypeB: fileB.changeType,
          severity,
          description: `File "${path}" modified in both branches`,
          suggestedResolution,
        });

        // Track pattern
        trackConflictPattern(path);
      }
    }
  }

  return conflicts;
}

/**
 * Track a conflict pattern for historical analysis.
 */
function trackConflictPattern(filePath: string): void {
  // Extract pattern from path (e.g., src/**/*.ts from src/services/foo.ts)
  const parts = filePath.split("/");
  const extension = filePath.includes(".") ? filePath.split(".").pop() : null;

  let pattern: string;
  if (parts.length > 2 && extension) {
    pattern = `${parts.slice(0, 2).join("/")}/**/*.${extension}`;
  } else if (extension) {
    pattern = `**/*.${extension}`;
  } else {
    pattern = filePath;
  }

  const existing = conflictPatterns.get(pattern);
  if (existing) {
    existing.frequency++;
    existing.lastSeen = new Date();
  } else {
    conflictPatterns.set(pattern, {
      id: `gcp_${pattern.replace(/[^a-z0-9]/gi, "_")}`,
      pattern,
      frequency: 1,
      lastSeen: new Date(),
    });
  }
}

/**
 * Get common conflict patterns for a repository.
 */
export async function getConflictPatterns(
  repositoryId: string,
): Promise<ConflictPattern[]> {
  const patterns = Array.from(conflictPatterns.values());

  // Sort by frequency
  patterns.sort((a, b) => b.frequency - a.frequency);

  return patterns.slice(0, 20);
}

/**
 * Get recent conflict analysis history.
 */
export async function getAnalysisHistory(
  repositoryId: string,
  limit = 10,
): Promise<ConflictAnalysis[]> {
  const history = analysisHistory.get(repositoryId) ?? [];
  return history.slice(0, limit);
}

/**
 * Clear branch changes cache for a repository.
 */
export async function clearBranchChanges(
  repositoryId: string,
  branchName?: string,
): Promise<number> {
  let cleared = 0;

  if (branchName) {
    const key = branchCacheKey(repositoryId, branchName);
    if (branchChangesCache.delete(key)) {
      cleared++;
    }
  } else {
    for (const key of branchChangesCache.keys()) {
      if (key.startsWith(`${repositoryId}:`)) {
        branchChangesCache.delete(key);
        cleared++;
      }
    }
  }

  return cleared;
}

// ============================================================================
// Quick Conflict Check
// ============================================================================

/**
 * Quick check if two files would conflict based on paths only.
 */
export function wouldFilesConflict(
  pathsA: string[],
  pathsB: string[],
): { hasConflict: boolean; overlapping: string[] } {
  const setB = new Set(pathsB);
  const overlapping = pathsA.filter((p) => setB.has(p));

  return {
    hasConflict: overlapping.length > 0,
    overlapping,
  };
}

/**
 * Check if a file path matches common conflict-prone patterns.
 */
export function isConflictProneFile(filePath: string): {
  isProne: boolean;
  reason?: string;
} {
  const pronePatterns = [
    { pattern: /package-lock\.json$/, reason: "Lock file - auto-generated, often conflicts" },
    { pattern: /yarn\.lock$/, reason: "Lock file - auto-generated, often conflicts" },
    { pattern: /bun\.lockb$/, reason: "Lock file - binary, requires regeneration" },
    { pattern: /\.min\.(js|css)$/, reason: "Minified file - regenerate from source" },
    { pattern: /\.bundle\.(js|css)$/, reason: "Bundle file - regenerate from source" },
    { pattern: /schema\.ts$/, reason: "Schema file - coordinate changes carefully" },
    { pattern: /index\.ts$/, reason: "Barrel file - often edited by multiple features" },
    { pattern: /route[rs]?\.(ts|tsx)$/, reason: "Route file - often edited by multiple features" },
  ];

  for (const { pattern, reason } of pronePatterns) {
    if (pattern.test(filePath)) {
      return { isProne: true, reason };
    }
  }

  return { isProne: false };
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get conflict prediction statistics.
 */
export function getConflictStats(): {
  cachedBranchChanges: number;
  trackedPatterns: number;
  analysisHistorySize: number;
  topConflictPatterns: Array<{ pattern: string; frequency: number }>;
} {
  const topPatterns = Array.from(conflictPatterns.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5)
    .map((p) => ({ pattern: p.pattern, frequency: p.frequency }));

  let totalHistorySize = 0;
  for (const history of analysisHistory.values()) {
    totalHistorySize += history.length;
  }

  return {
    cachedBranchChanges: branchChangesCache.size,
    trackedPatterns: conflictPatterns.size,
    analysisHistorySize: totalHistorySize,
    topConflictPatterns: topPatterns,
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all conflict data. Only for testing.
 */
export function _clearAllConflictData(): void {
  branchChangesCache.clear();
  conflictPatterns.clear();
  analysisHistory.clear();
}
