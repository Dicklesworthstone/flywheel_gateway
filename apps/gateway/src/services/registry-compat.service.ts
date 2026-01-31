/**
 * Registry Compatibility Layer (bd-2n73.16)
 *
 * Tracks and reports deprecation warnings when old hardcoded tool
 * metadata is used instead of manifest-driven data. Provides a
 * compatibility check endpoint for clients migrating to the new
 * manifest-driven tool registry.
 */

import type { ToolDefinition } from "@flywheel/shared/types/tool-registry.types";

// ============================================================================
// Types
// ============================================================================

export interface DeprecationWarning {
  tool: string;
  field: string;
  oldSource: "hardcoded" | "install_array";
  newSource: "manifest" | "verified_installer";
  message: string;
}

export interface CompatibilityReport {
  /** Whether all tools use manifest-driven data */
  fullyMigrated: boolean;
  /** Number of tools using manifest data */
  manifestDriven: number;
  /** Number of tools falling back to hardcoded data */
  hardcodedFallback: number;
  /** Total tools */
  total: number;
  /** Active deprecation warnings */
  warnings: DeprecationWarning[];
  /** Registry source (manifest vs fallback) */
  registrySource: string;
  /** Timestamp */
  checkedAt: string;
}

export interface FieldMigrationStatus {
  field: string;
  manifestValue: string | undefined;
  fallbackValue: string | undefined;
  source: "manifest" | "fallback" | "none";
}

// ============================================================================
// Deprecation Tracking
// ============================================================================

const deprecationLog: DeprecationWarning[] = [];

/**
 * Record a deprecation when fallback data is used instead of manifest data.
 */
export function recordDeprecation(warning: DeprecationWarning): void {
  // Deduplicate by tool+field
  const exists = deprecationLog.some(
    (w) => w.tool === warning.tool && w.field === warning.field,
  );
  if (!exists) {
    // Cap at 500 entries to prevent unbounded growth in long-running processes
    if (deprecationLog.length >= 500) {
      deprecationLog.shift();
    }
    deprecationLog.push(warning);
  }
}

/**
 * Get all recorded deprecation warnings.
 */
export function getDeprecations(): readonly DeprecationWarning[] {
  return deprecationLog;
}

/**
 * Clear all deprecation warnings (for testing).
 */
export function clearDeprecations(): void {
  deprecationLog.length = 0;
}

// ============================================================================
// Field Migration Analysis
// ============================================================================

/**
 * Check which fields for a tool come from manifest vs hardcoded fallback.
 */
export function analyzeToolMigration(
  tool: ToolDefinition,
  fallback: Record<string, unknown> | undefined,
): FieldMigrationStatus[] {
  const fields = [
    "displayName",
    "description",
    "installCommand",
    "installUrl",
    "docsUrl",
  ] as const;

  return fields.map((field) => {
    const manifestValue = getToolField(tool, field);
    const fallbackValue = fallback?.[field] as string | undefined;

    let source: "manifest" | "fallback" | "none";
    if (manifestValue) {
      source = "manifest";
    } else if (fallbackValue) {
      source = "fallback";
    } else {
      source = "none";
    }

    return {
      field,
      manifestValue,
      fallbackValue,
      source,
    };
  });
}

function getToolField(tool: ToolDefinition, field: string): string | undefined {
  switch (field) {
    case "displayName":
      return tool.displayName;
    case "description":
      return tool.description;
    case "installCommand":
      if (tool.verifiedInstaller) {
        const args = tool.verifiedInstaller.args?.join(" ") ?? "";
        return `${tool.verifiedInstaller.runner} ${args}`.trim();
      }
      if (tool.install?.[0]) {
        return tool.install[0].command;
      }
      return undefined;
    case "installUrl":
      return tool.verifiedInstaller?.fallback_url ?? tool.install?.[0]?.url;
    case "docsUrl":
      return tool.docsUrl;
    default:
      return undefined;
  }
}

// ============================================================================
// Installer Migration
// ============================================================================

/**
 * Check if a tool uses the new verifiedInstaller vs old install array.
 */
export function getInstallerSource(
  tool: ToolDefinition,
): "verified_installer" | "install_array" | "hardcoded" | "none" {
  if (tool.verifiedInstaller) return "verified_installer";
  if (tool.install && tool.install.length > 0) return "install_array";
  return "none";
}

/**
 * Record deprecation warnings for tools using old install patterns.
 */
export function checkInstallerDeprecation(tool: ToolDefinition): void {
  const source = getInstallerSource(tool);
  if (source === "install_array") {
    recordDeprecation({
      tool: tool.name,
      field: "install",
      oldSource: "install_array",
      newSource: "verified_installer",
      message: `Tool "${tool.name}" uses install[] array; migrate to verifiedInstaller for managed updates`,
    });
  }
}

// ============================================================================
// Compatibility Report
// ============================================================================

/**
 * Generate a compatibility report for the current tool registry.
 */
export function buildCompatibilityReport(
  tools: ToolDefinition[],
  registrySource: string,
  hardcodedTools: Record<string, unknown>,
): CompatibilityReport {
  // Reset warnings so this report reflects current registry state only.
  clearDeprecations();
  let manifestDriven = 0;
  let hardcodedFallback = 0;

  for (const tool of tools) {
    const fallback = hardcodedTools[tool.name] as
      | Record<string, unknown>
      | undefined;
    const fields = analyzeToolMigration(tool, fallback);
    const usedFallback = fields.some((f) => f.source === "fallback");

    if (usedFallback) {
      hardcodedFallback++;
    } else {
      manifestDriven++;
    }

    // Check installer deprecation
    checkInstallerDeprecation(tool);
  }

  return {
    fullyMigrated: hardcodedFallback === 0 && registrySource === "manifest",
    manifestDriven,
    hardcodedFallback,
    total: tools.length,
    warnings: [...deprecationLog],
    registrySource,
    checkedAt: new Date().toISOString(),
  };
}
