/**
 * Tool Health Diagnostics Service
 *
 * Provides dependency-aware health diagnostics that explain root causes
 * when tools are unavailable. Uses the ACFS manifest's `depends` field
 * to compute causal chains (e.g., "ntm unavailable because tmux is missing").
 */

import type { ToolDefinition } from "@flywheel/shared";
import {
  getUnavailabilityLabel,
  type ToolUnavailabilityReason,
} from "@flywheel/shared/errors";
import type { DetectedCLI } from "./agent-detection.service";

// ============================================================================
// Types
// ============================================================================

export interface ToolDiagnostic {
  /** Tool identifier */
  toolId: string;
  /** Tool display name */
  displayName: string;
  /** Whether the tool is available */
  available: boolean;
  /** Unavailability reason (if not available) */
  reason?: ToolUnavailabilityReason;
  /** Human-readable reason label */
  reasonLabel?: string;
  /** Root cause chain: sequence of tool IDs leading to the failure */
  rootCausePath?: string[];
  /** Root cause explanation (human-readable) */
  rootCauseExplanation?: string;
  /** Direct dependencies of this tool */
  dependsOn: string[];
  /** Tools that depend on this tool */
  dependedBy: string[];
}

export interface HealthDiagnostics {
  /** Individual tool diagnostics */
  tools: ToolDiagnostic[];
  /** Tools with dependency-caused failures */
  cascadeFailures: Array<{
    affectedTool: string;
    rootCause: string;
    path: string[];
  }>;
  /** Overall summary */
  summary: {
    totalTools: number;
    availableTools: number;
    unavailableTools: number;
    cascadeFailureCount: number;
    rootCauseTools: string[];
  };
}

// ============================================================================
// Dependency Graph
// ============================================================================

/**
 * Build a dependency graph from tool definitions.
 */
function buildDependencyGraph(tools: ToolDefinition[]): {
  dependsOn: Map<string, string[]>;
  dependedBy: Map<string, string[]>;
} {
  const dependsOn = new Map<string, string[]>();
  const dependedBy = new Map<string, string[]>();

  // Initialize all tools
  for (const tool of tools) {
    dependsOn.set(tool.id, tool.depends ?? []);
    if (!dependedBy.has(tool.id)) {
      dependedBy.set(tool.id, []);
    }
  }

  // Build reverse mapping
  for (const tool of tools) {
    for (const dep of tool.depends ?? []) {
      const existing = dependedBy.get(dep) ?? [];
      existing.push(tool.id);
      dependedBy.set(dep, existing);
    }
  }

  return { dependsOn, dependedBy };
}

/**
 * Find the root cause chain for a tool's unavailability.
 * Walks the dependency graph to find the deepest unavailable dependency.
 */
function findRootCausePath(
  toolId: string,
  availabilityMap: Map<string, boolean>,
  dependsOn: Map<string, string[]>,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(toolId)) return [toolId]; // cycle guard
  visited.add(toolId);

  const deps = dependsOn.get(toolId) ?? [];
  for (const dep of deps) {
    if (availabilityMap.get(dep) === false) {
      const deeper = findRootCausePath(
        dep,
        availabilityMap,
        dependsOn,
        visited,
      );
      return [...deeper, toolId];
    }
  }

  return [toolId];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute dependency-aware health diagnostics.
 *
 * @param toolDefs Tool definitions from the registry (with `depends` field)
 * @param detectedCLIs Detection results from agent-detection service
 */
export function computeHealthDiagnostics(
  toolDefs: ToolDefinition[],
  detectedCLIs: DetectedCLI[],
): HealthDiagnostics {
  const { dependsOn, dependedBy } = buildDependencyGraph(toolDefs);

  // Build availability map from detection results
  const availabilityMap = new Map<string, boolean>();
  const detectionMap = new Map<string, DetectedCLI>();

  for (const cli of detectedCLIs) {
    // Map by name and by full ID
    detectionMap.set(cli.name, cli);
    availabilityMap.set(cli.name, cli.available);
  }

  // Also map by tool ID for dependency lookups
  for (const def of toolDefs) {
    const cli = detectionMap.get(def.name);
    if (cli) {
      availabilityMap.set(def.id, cli.available);
      detectionMap.set(def.id, cli);
    }
  }

  const diagnostics: ToolDiagnostic[] = [];
  const cascadeFailures: HealthDiagnostics["cascadeFailures"] = [];

  for (const def of toolDefs) {
    const cli = detectionMap.get(def.name);
    const available = cli?.available ?? false;
    const reason = cli?.unavailabilityReason as
      | ToolUnavailabilityReason
      | undefined;

    const diagnostic: ToolDiagnostic = {
      toolId: def.id,
      displayName: def.displayName ?? def.name,
      available,
      dependsOn: dependsOn.get(def.id) ?? [],
      dependedBy: dependedBy.get(def.id) ?? [],
    };

    if (!available) {
      diagnostic.reason = reason ?? "unknown";
      diagnostic.reasonLabel = reason
        ? getUnavailabilityLabel(reason)
        : "Unknown Error";

      // Check if the failure is caused by a missing dependency
      const deps = dependsOn.get(def.id) ?? [];
      const unavailableDeps = deps.filter(
        (dep) => availabilityMap.get(dep) === false,
      );

      if (unavailableDeps.length > 0) {
        // Find deepest root cause
        const rootPath = findRootCausePath(def.id, availabilityMap, dependsOn);

        diagnostic.rootCausePath = rootPath;

        const rootToolId = rootPath[0]!;
        const rootDef = toolDefs.find((t) => t.id === rootToolId);
        const rootName = rootDef?.displayName ?? rootDef?.name ?? rootToolId;

        diagnostic.rootCauseExplanation = `${def.displayName ?? def.name} is unavailable because ${rootName} is missing`;

        cascadeFailures.push({
          affectedTool: def.id,
          rootCause: rootToolId,
          path: rootPath,
        });
      }
    }

    diagnostics.push(diagnostic);
  }

  // Identify unique root cause tools
  const rootCauseTools = [...new Set(cascadeFailures.map((f) => f.rootCause))];

  const availableCount = diagnostics.filter((d) => d.available).length;

  return {
    tools: diagnostics,
    cascadeFailures,
    summary: {
      totalTools: diagnostics.length,
      availableTools: availableCount,
      unavailableTools: diagnostics.length - availableCount,
      cascadeFailureCount: cascadeFailures.length,
      rootCauseTools,
    },
  };
}
