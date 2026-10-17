/**
 * Install Plan + Remediation Guidance (bd-2gkx.8)
 *
 * Computes a manifest-driven install plan diff (installed vs missing vs
 * optional) with actionable remediation steps for each missing tool.
 */

import type { ToolDefinition } from "@flywheel/shared/types/tool-registry.types";

// ============================================================================
// Types
// ============================================================================

export type ToolInstallStatus =
  | "installed"
  | "missing"
  | "optional_missing"
  | "error";

export interface ToolPlanEntry {
  id: string;
  name: string;
  displayName: string;
  phase: number;
  status: ToolInstallStatus;
  required: boolean;
  /** Install command if available */
  installCommand?: string;
  /** Docs/manual install URL */
  docsUrl?: string;
  /** Remediation steps */
  remediation: string[];
  /** Detected version (if installed) */
  version?: string;
}

export interface InstallPlan {
  /** All tools in phase order */
  entries: ToolPlanEntry[];
  /** Count of installed tools */
  installed: number;
  /** Count of required tools that are missing */
  missingRequired: number;
  /** Count of optional tools that are missing */
  missingOptional: number;
  /** Overall readiness status */
  ready: boolean;
  /** Phase-ordered install commands for missing required tools */
  installScript: string[];
  /** Timestamp */
  computedAt: string;
}

export interface DetectedToolState {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

// ============================================================================
// Categorization Helpers
// ============================================================================

function isRequired(tool: ToolDefinition): boolean {
  if (tool.tags?.some((t) => t === "critical" || t === "required")) return true;
  if (tool.optional === true) return false;
  if (tool.enabledByDefault === true) return true;
  return true;
}

function getInstallCommand(tool: ToolDefinition): string | undefined {
  if (tool.verifiedInstaller) {
    const args = tool.verifiedInstaller.args?.join(" ") ?? "";
    return `${tool.verifiedInstaller.runner} ${args}`.trim() || undefined;
  }
  if (tool.install?.[0]) {
    const spec = tool.install[0];
    const args = spec.args?.join(" ") ?? "";
    return `${spec.command} ${args}`.trim() || undefined;
  }
  return undefined;
}

// ============================================================================
// Remediation
// ============================================================================

function buildRemediation(
  tool: ToolDefinition,
  installCmd: string | undefined,
): string[] {
  const steps: string[] = [];

  if (installCmd) {
    steps.push(`Install: \`${installCmd}\``);
  }

  if (tool.verifiedInstaller?.fallback_url) {
    steps.push(`Manual: ${tool.verifiedInstaller.fallback_url}`);
  } else if (tool.install?.[0]?.url) {
    steps.push(`Manual: ${tool.install[0].url}`);
  }

  if (tool.docsUrl) {
    steps.push(`Docs: ${tool.docsUrl}`);
  }

  if (tool.verify?.command) {
    steps.push(`Verify: \`${tool.verify.command.join(" ")}\``);
  }

  if (tool.install?.[0]?.requiresSudo) {
    steps.push("Note: requires sudo");
  }

  if (tool.install?.[0]?.mode === "interactive") {
    steps.push("Note: interactive install (may need tmux)");
  }

  if (steps.length === 0) {
    steps.push("Check project documentation for installation instructions");
  }

  return steps;
}

// ============================================================================
// Plan Computation
// ============================================================================

/**
 * Compute an install plan from registry tools and detected state.
 */
export function computeInstallPlan(
  tools: ToolDefinition[],
  detected: DetectedToolState[],
): InstallPlan {
  const detectedMap = new Map(detected.map((d) => [d.name, d]));
  const entries: ToolPlanEntry[] = [];
  let installed = 0;
  let missingRequired = 0;
  let missingOptional = 0;
  const installScript: string[] = [];

  // Sort by phase
  const sorted = [...tools].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999));

  for (const tool of sorted) {
    const state = detectedMap.get(tool.name);
    const required = isRequired(tool);
    const installCmd = getInstallCommand(tool);

    let status: ToolInstallStatus;
    if (state?.available) {
      status = "installed";
      installed++;
    } else if (state?.error) {
      status = "error";
      if (required) missingRequired++;
    } else if (required) {
      status = "missing";
      missingRequired++;
    } else {
      status = "optional_missing";
      missingOptional++;
    }

    const remediation =
      status === "installed" ? [] : buildRemediation(tool, installCmd);

    entries.push({
      id: tool.id,
      name: tool.name,
      displayName: tool.displayName ?? tool.name,
      phase: tool.phase ?? 999,
      status,
      required,
      ...(installCmd && { installCommand: installCmd }),
      ...(tool.docsUrl && { docsUrl: tool.docsUrl }),
      remediation,
      ...(state?.version && { version: state.version }),
    });

    // Build install script for missing required tools
    if (status === "missing" && required && installCmd) {
      installScript.push(
        `# ${tool.displayName ?? tool.name} (phase ${tool.phase ?? "?"})`,
      );
      installScript.push(installCmd);
    }
  }

  return {
    entries,
    installed,
    missingRequired,
    missingOptional,
    ready: missingRequired === 0,
    installScript,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Format install plan as a copyable shell script.
 */
export function formatInstallScript(plan: InstallPlan): string {
  if (plan.installScript.length === 0) {
    return "# All required tools are installed!";
  }

  const lines = [
    "#!/usr/bin/env bash",
    "# Flywheel Gateway - Install Missing Required Tools",
    `# Generated: ${plan.computedAt}`,
    `# Missing: ${plan.missingRequired} required tool(s)`,
    "",
    "set -euo pipefail",
    "",
    ...plan.installScript,
    "",
    "echo 'Installation complete. Run the gateway to verify.'",
  ];

  return lines.join("\n");
}
