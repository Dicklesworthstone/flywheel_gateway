/**
 * Parity Check Script for Command Registry
 *
 * This script validates that the command registry maintains consistency
 * across REST, WebSocket, tRPC, and OpenAPI interfaces.
 *
 * Run with: bun run parity-check
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Validation errors found
 */

import type { z } from "zod";
import { validateRegistry } from "./registry";
import type { CommandRegistry, RegisteredCommand } from "./types";

/**
 * Parity check result for a single command.
 */
export interface ParityCheckResult {
  command: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Overall parity check report.
 */
export interface ParityCheckReport {
  timestamp: string;
  totalCommands: number;
  passed: number;
  failed: number;
  warnings: number;
  results: ParityCheckResult[];
  summary: string;
}

/**
 * Check if a Zod schema has a specific field.
 * This uses duck-typing to work with Zod 4+.
 */
function schemaHasField(schema: z.ZodType, fieldName: string): boolean {
  // Get the internal definition
  const def = (schema as { _def?: unknown })._def as
    | Record<string, unknown>
    | undefined;
  if (!def) return false;

  // Handle wrapped types (effects, optional, nullable) by unwrapping
  let currentDef = def;
  while (currentDef) {
    // Check for inner schema (effects, optional, nullable)
    const innerSchema = currentDef["schema"] as z.ZodType | undefined;
    const innerType = currentDef["innerType"] as z.ZodType | undefined;

    if (innerSchema) {
      const innerDef = (innerSchema as { _def?: unknown })._def as
        | Record<string, unknown>
        | undefined;
      if (innerDef) {
        currentDef = innerDef;
        continue;
      }
    }

    if (innerType) {
      const innerDef = (innerType as { _def?: unknown })._def as
        | Record<string, unknown>
        | undefined;
      if (innerDef) {
        currentDef = innerDef;
        continue;
      }
    }

    break;
  }

  // Check for object shape
  const shape = currentDef?.["shape"] as Record<string, unknown> | undefined;
  if (shape && typeof shape === "object") {
    return fieldName in shape;
  }

  return false;
}

/**
 * Run parity checks on a single command.
 */
export function checkCommandParity(cmd: RegisteredCommand): ParityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Rule 1: Every command must have REST binding (enforced at define time, but double-check)
  const hasValidRest = cmd.rest && cmd.rest.method && cmd.rest.path;
  if (!hasValidRest) {
    errors.push("Missing REST binding (method and path required)");
    // Return early - other checks depend on valid REST binding
    return {
      command: cmd.name,
      passed: false,
      errors,
      warnings,
    };
  }

  // Rule 2: Every command must have AI hints (enforced at define time, but double-check)
  if (!cmd.aiHints) {
    errors.push("Missing AI hints");
  } else {
    if (!cmd.aiHints.whenToUse || cmd.aiHints.whenToUse.trim().length === 0) {
      errors.push("AI hints: whenToUse is empty");
    }
    if (!cmd.aiHints.examples || cmd.aiHints.examples.length === 0) {
      errors.push("AI hints: at least one example required");
    }
  }

  // Rule 3: DELETE commands must not be marked as safe (enforced at define time, but double-check)
  if (cmd.rest.method === "DELETE" && cmd.metadata.safe) {
    errors.push("DELETE commands cannot be marked as safe");
  }

  // Rule 4: Long-running commands should return a jobId
  if (cmd.metadata.longRunning) {
    const hasJobId = schemaHasField(cmd.outputSchema, "jobId");
    if (!hasJobId) {
      errors.push("Long-running command must return a jobId field");
    }
  }

  // Rule 5: Audit flag should be set for mutating operations
  if (
    (cmd.rest.method === "POST" ||
      cmd.rest.method === "PUT" ||
      cmd.rest.method === "PATCH" ||
      cmd.rest.method === "DELETE") &&
    !cmd.metadata.audit
  ) {
    warnings.push("Mutating operation should have audit: true");
  }

  // Rule 6: Commands with path params must have those params in input schema
  for (const param of cmd.pathParams) {
    const hasParam = schemaHasField(cmd.inputSchema, param);
    if (!hasParam) {
      errors.push(`Path parameter ":${param}" not found in input schema`);
    }
  }

  // Rule 7: Streaming endpoints should have ws binding for real-time events
  if (cmd.rest.streaming && !cmd.ws) {
    warnings.push(
      "Streaming endpoint should have WebSocket binding for real-time events",
    );
  }

  // Rule 8: Commands with permissions should not be empty
  if (cmd.metadata.permissions.length === 0) {
    warnings.push("No permissions defined - consider adding access control");
  }

  return {
    command: cmd.name,
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Run parity checks on the entire registry.
 */
export function runParityCheck(registry: CommandRegistry): ParityCheckReport {
  const results: ParityCheckResult[] = [];
  let warnings = 0;
  let hasRegistryError = false;

  // First, run built-in registry validation
  const registryValidation = validateRegistry(registry);
  if (!registryValidation.valid) {
    hasRegistryError = true;
    // Convert registry validation issues to a pseudo-command result
    results.push({
      command: "__registry__",
      passed: false,
      errors: registryValidation.issues,
      warnings: [],
    });
  }

  // Check each command
  for (const cmd of registry.all()) {
    const result = checkCommandParity(cmd);
    results.push(result);
    if (result.warnings.length > 0) {
      warnings += result.warnings.length;
    }
  }

  // Count only actual command results (exclude __registry__ pseudo-result)
  const commandResults = results.filter((r) => r.command !== "__registry__");
  const passed = commandResults.filter((r) => r.passed).length;
  const failed = commandResults.filter((r) => !r.passed).length;

  let summary: string;
  if (failed === 0 && !hasRegistryError) {
    summary = `✅ All ${passed} commands passed parity checks`;
    if (warnings > 0) {
      summary += ` (${warnings} warnings)`;
    }
  } else if (hasRegistryError && failed === 0) {
    summary = `❌ Registry validation failed (${registryValidation.issues.length} issues)`;
  } else if (hasRegistryError) {
    summary = `❌ ${failed} command(s) failed + registry validation errors`;
  } else {
    summary = `❌ ${failed} of ${registry.size} commands failed parity checks`;
  }

  return {
    timestamp: new Date().toISOString(),
    totalCommands: registry.size,
    passed,
    failed,
    warnings,
    results,
    summary,
  };
}

/**
 * Format parity check report for console output.
 */
export function formatReport(report: ParityCheckReport): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("                    PARITY CHECK REPORT                     ");
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Commands checked: ${report.totalCommands}`);
  lines.push(`Passed: ${report.passed}`);
  lines.push(`Failed: ${report.failed}`);
  lines.push(`Warnings: ${report.warnings}`);
  lines.push("");

  // Show failed commands
  const failed = report.results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("                        ERRORS                            ");
    lines.push("───────────────────────────────────────────────────────────");
    for (const result of failed) {
      lines.push("");
      lines.push(`  ❌ ${result.command}`);
      for (const error of result.errors) {
        lines.push(`     • ${error}`);
      }
    }
    lines.push("");
  }

  // Show warnings
  const withWarnings = report.results.filter((r) => r.warnings.length > 0);
  if (withWarnings.length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("                       WARNINGS                           ");
    lines.push("───────────────────────────────────────────────────────────");
    for (const result of withWarnings) {
      lines.push("");
      lines.push(`  ⚠️  ${result.command}`);
      for (const warning of result.warnings) {
        lines.push(`     • ${warning}`);
      }
    }
    lines.push("");
  }

  lines.push("───────────────────────────────────────────────────────────");
  lines.push(`                    ${report.summary}`);
  lines.push("───────────────────────────────────────────────────────────");

  return lines.join("\n");
}

/**
 * Format parity check report as JSON for CI.
 */
export function formatReportJSON(report: ParityCheckReport): string {
  return JSON.stringify(report, null, 2);
}
