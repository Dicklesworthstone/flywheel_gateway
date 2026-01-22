/**
 * UBS (Ultimate Bug Scanner) Client
 *
 * Provides typed access to the ubs CLI for automated code analysis.
 * UBS detects issues, vulnerabilities, and improvement opportunities.
 * Exit code 0 = clean, >0 = findings that may need attention.
 *
 * Gateway workflow: run `ubs <changed-files>` before commits/PRs.
 */

import {
  CliClientError,
  type CliErrorDetails,
  type CliErrorKind,
} from "@flywheel/shared";
import { z } from "zod";
import {
  CliCommandError,
  createBunCliRunner as createSharedBunCliRunner,
} from "../cli-runner";

// ============================================================================
// Command Runner Interface
// ============================================================================

export interface UBSCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface UBSCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<UBSCommandResult>;
}

export interface UBSClientOptions {
  runner: UBSCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 60000 for scans) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class UBSClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "UBSClientError";
  }
}

// ============================================================================
// Severity and Category Types
// ============================================================================

export const SeverityLevelSchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const FindingCategorySchema = z.enum([
  "security",
  "quality",
  "performance",
  "style",
  "complexity",
  "maintainability",
  "error",
]);

export const FindingStatusSchema = z.enum([
  "open",
  "dismissed",
  "fixed",
  "converted", // Converted to bead
]);

export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;
export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

// ============================================================================
// Zod Schemas
// ============================================================================

// Individual finding from scan
const UBSFindingSchema = z.object({
  id: z.string().optional(),
  rule: z.string(),
  category: z.string(),
  severity: SeverityLevelSchema,
  title: z.string(),
  message: z.string(),
  file: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  endLine: z.number().optional(),
  endColumn: z.number().optional(),
  codeSnippet: z.string().optional(),
  suggestedFix: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ruleUrl: z.string().optional(),
  status: FindingStatusSchema.optional().default("open"),
  convertedBeadId: z.string().optional(),
});

// Summary statistics
const UBSSummarySchema = z.object({
  total: z.number(),
  bySeverity: z.object({
    critical: z.number().default(0),
    high: z.number().default(0),
    medium: z.number().default(0),
    low: z.number().default(0),
    info: z.number().default(0),
  }),
  byCategory: z.record(z.string(), z.number()).optional(),
  filesScanned: z.number().optional(),
  duration: z.number().optional(), // milliseconds
});

// Scan result response
const UBSScanResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number(),
  findings: z.array(UBSFindingSchema),
  summary: UBSSummarySchema,
  scanId: z.string().optional(),
  scannedPaths: z.array(z.string()).optional(),
  timestamp: z.string().optional(),
});

// Health/version response
const UBSHealthSchema = z.object({
  available: z.boolean(),
  version: z.string().optional(),
  path: z.string().optional(),
});

// ============================================================================
// Exported Types
// ============================================================================

export type UBSFinding = z.infer<typeof UBSFindingSchema>;
export type UBSSummary = z.infer<typeof UBSSummarySchema>;
export type UBSScanResult = z.infer<typeof UBSScanResultSchema>;
export type UBSHealth = z.infer<typeof UBSHealthSchema>;

// ============================================================================
// Options Types
// ============================================================================

export interface UBSScanOptions {
  /** Filter scan by file type (e.g., 'typescript', 'javascript', 'python') */
  only?: string;
  /** Exclude paths from scan (glob patterns) */
  exclude?: string[];
  /** Minimum severity to report */
  minSeverity?: SeverityLevel;
  /** Enable CI mode (stricter, fails on warnings) */
  ci?: boolean;
  /** Fail on warnings (not just errors) */
  failOnWarning?: boolean;
  /** Custom ruleset to use */
  ruleset?: string;
  /** Output format (default: json for parsing) */
  format?: "json" | "text";
  /** Request/correlation ID for logging */
  correlationId?: string;
  /** Timeout override for this scan */
  timeout?: number;
}

export interface UBSDismissOptions {
  /** Reason for dismissal */
  reason: "false_positive" | "wont_fix" | "not_applicable" | "other";
  /** Additional comment */
  comment?: string;
}

// ============================================================================
// Bead Creation Types (Finding → Bead transformation)
// ============================================================================

export interface BeadFromFindingOptions {
  /** Override title */
  title?: string;
  /** Additional labels */
  extraLabels?: string[];
  /** Priority override (default: derived from severity) */
  priority?: 0 | 1 | 2 | 3 | 4;
  /** Parent bead ID for dependency linking */
  parentBeadId?: string;
  /** Custom body template */
  bodyTemplate?: string;
}

export interface BeadCreate {
  title: string;
  body: string;
  labels: string[];
  priority: number;
  type: "bug" | "task";
  metadata?: {
    findingId?: string;
    scanId?: string;
    rule?: string;
    file?: string;
    line?: number;
  };
}

// ============================================================================
// Client Interface
// ============================================================================

export interface UBSClient {
  /** Check if UBS is installed and available */
  isAvailable: () => Promise<boolean>;

  /** Get UBS health/version info */
  health: () => Promise<UBSHealth>;

  /** Scan specific files */
  scan: (files: string[], options?: UBSScanOptions) => Promise<UBSScanResult>;

  /** Scan staged files (git diff --cached) */
  scanStaged: (options?: UBSScanOptions) => Promise<UBSScanResult>;

  /** Scan a directory */
  scanDir: (dir: string, options?: UBSScanOptions) => Promise<UBSScanResult>;

  /** Transform a finding into a bead creation request */
  findingToBead: (
    finding: UBSFinding,
    options?: BeadFromFindingOptions,
  ) => BeadCreate;

  /** Transform multiple findings into bead creation requests */
  findingsToBeads: (
    findings: UBSFinding[],
    options?: BeadFromFindingOptions,
  ) => BeadCreate[];

  /** Get severity priority mapping */
  severityToPriority: (severity: SeverityLevel) => number;
}

// ============================================================================
// Implementation Helpers
// ============================================================================

async function runUBSCommand(
  runner: UBSCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<UBSCommandResult> {
  const result = await runner.run("ubs", args, options);
  // UBS exit code > 0 means findings, not necessarily failure
  // We return the result and let caller decide
  return result;
}

function parseJson<T>(
  stdout: string,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UBSClientError("parse_error", `Failed to parse UBS ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new UBSClientError(
      "validation_error",
      `Invalid UBS ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildScanArgs(files: string[], options?: UBSScanOptions): string[] {
  const args = [...files];

  if (options?.only) {
    args.push("--only", options.only);
  }
  if (options?.exclude) {
    for (const pattern of options.exclude) {
      args.push("--exclude", pattern);
    }
  }
  if (options?.minSeverity) {
    args.push("--min-severity", options.minSeverity);
  }
  if (options?.ci) {
    args.push("--ci");
  }
  if (options?.failOnWarning) {
    args.push("--fail-on-warning");
  }
  if (options?.ruleset) {
    args.push("--ruleset", options.ruleset);
  }
  // Always use JSON format for parsing
  args.push("--json");

  return args;
}

/**
 * Parse UBS text output into structured findings.
 * UBS output format:
 * ⚠️  Category (N errors)
 *     file.ts:42:5 – Issue description
 *     💡 Suggested fix
 */
function parseUBSTextOutput(stdout: string, exitCode: number): UBSScanResult {
  const findings: UBSFinding[] = [];
  const lines = stdout.split("\n");

  let currentCategory = "unknown";
  let currentFile = "";
  let currentLine: number | undefined;
  let currentColumn: number | undefined;
  let currentMessage = "";
  let currentSuggestion: string | undefined;
  let currentSeverity: SeverityLevel = "medium";

  for (const line of lines) {
    // Category line with severity emoji: ⚠️ Category (N errors)
    // Match: emoji, category name, count
    const categoryMatch = line.match(/^(.)\s*(.+?)\s*\((\d+)\s*\w+\)/);
    if (categoryMatch) {
      const emoji = categoryMatch[1] ?? "";
      currentCategory = (categoryMatch[2] ?? "").trim();
      // Map emoji to severity
      if (emoji === "❌" || emoji === "X") {
        currentSeverity = "critical";
      } else if (emoji === "⚠" || emoji.includes("warning")) {
        currentSeverity = "high";
      } else if (emoji === "⚡") {
        currentSeverity = "medium";
      } else if (emoji === "💡") {
        currentSeverity = "low";
      } else if (emoji === "ℹ" || emoji === "i") {
        currentSeverity = "info";
      }
      continue;
    }

    // Finding line: file.ts:42:5 – Issue description
    const findingMatch = line.match(/^\s+(.+?):(\d+):(\d+)\s*[-–]\s*(.+)$/);
    if (findingMatch) {
      // Save previous finding if exists
      if (currentFile && currentMessage) {
        findings.push({
          rule: "ubs-rule",
          category: currentCategory,
          severity: currentSeverity,
          title: currentMessage.slice(0, 80),
          message: currentMessage,
          file: currentFile,
          line: currentLine,
          column: currentColumn,
          suggestedFix: currentSuggestion,
          status: "open",
        });
      }

      currentFile = findingMatch[1] ?? "";
      currentLine = parseInt(findingMatch[2] ?? "0", 10);
      currentColumn = parseInt(findingMatch[3] ?? "0", 10);
      currentMessage = findingMatch[4] ?? "";
      currentSuggestion = undefined;
      continue;
    }

    // Suggestion line: 💡 Suggested fix
    const suggestionMatch = line.match(/^\s*💡\s*(.+)$/);
    if (suggestionMatch) {
      currentSuggestion = suggestionMatch[1];
    }
  }

  // Don't forget last finding
  if (currentFile && currentMessage) {
    findings.push({
      rule: "ubs-rule",
      category: currentCategory,
      severity: currentSeverity,
      title: currentMessage.slice(0, 80),
      message: currentMessage,
      file: currentFile,
      line: currentLine,
      column: currentColumn,
      suggestedFix: currentSuggestion,
      status: "open",
    });
  }

  // Build summary
  const summary: UBSSummary = {
    total: findings.length,
    bySeverity: {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
    byCategory: findings.reduce(
      (acc, f) => {
        acc[f.category] = (acc[f.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };

  return {
    success: exitCode === 0,
    exitCode,
    findings,
    summary,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Client Factory
// ============================================================================

export function createUBSClient(options: UBSClientOptions): UBSClient {
  const baseCwd = options.cwd;
  const defaultTimeout = options.timeout ?? 60000;

  const buildRunOptions = (
    timeout?: number,
  ): { cwd?: string; timeout: number } => {
    const opts: { cwd?: string; timeout: number } = {
      timeout: timeout ?? defaultTimeout,
    };
    if (baseCwd !== undefined) opts.cwd = baseCwd;
    return opts;
  };

  const severityToPriority = (severity: SeverityLevel): number => {
    switch (severity) {
      case "critical":
        return 0; // P0 - Critical
      case "high":
        return 1; // P1 - High
      case "medium":
        return 2; // P2 - Medium
      case "low":
        return 3; // P3 - Low
      case "info":
        return 4; // P4 - Backlog
      default:
        return 2;
    }
  };

  const findingToBead = (
    finding: UBSFinding,
    beadOpts?: BeadFromFindingOptions,
  ): BeadCreate => {
    const title =
      beadOpts?.title ??
      `Fix ${finding.severity} ${finding.category}: ${finding.title}`;

    const body =
      beadOpts?.bodyTemplate ??
      `## Finding Details
- **Rule**: ${finding.rule}
- **Category**: ${finding.category}
- **Severity**: ${finding.severity}
- **File**: ${finding.file}${finding.line ? `:${finding.line}` : ""}${finding.column ? `:${finding.column}` : ""}

## Description
${finding.message}

${finding.suggestedFix ? `## Suggested Fix\n${finding.suggestedFix}\n` : ""}
${finding.codeSnippet ? `## Code Context\n\`\`\`\n${finding.codeSnippet}\n\`\`\`\n` : ""}
---
*Auto-generated from UBS scan finding*`;

    const labels = [
      "scanner",
      finding.category,
      finding.severity,
      ...(finding.tags || []),
      ...(beadOpts?.extraLabels || []),
    ];

    const priority = beadOpts?.priority ?? severityToPriority(finding.severity);

    // Critical/high security issues are bugs, others are tasks
    const type: "bug" | "task" =
      finding.category === "security" &&
      (finding.severity === "critical" || finding.severity === "high")
        ? "bug"
        : "task";

    return {
      title,
      body,
      labels,
      priority,
      type,
      metadata: {
        ...(finding.id != null && { findingId: finding.id }),
        rule: finding.rule,
        file: finding.file,
        ...(finding.line != null && { line: finding.line }),
      },
    };
  };

  return {
    isAvailable: async () => {
      try {
        const runOpts = buildRunOptions(5000);
        const result = await options.runner.run("ubs", ["--version"], runOpts);
        return result.exitCode === 0;
      } catch {
        return false;
      }
    },

    health: async () => {
      try {
        const runOpts = buildRunOptions(5000);
        const result = await options.runner.run("ubs", ["--version"], runOpts);

        if (result.exitCode === 0) {
          const versionMatch = result.stdout.match(/ubs\s+v?([\d.]+)/i);
          return {
            available: true,
            version: versionMatch ? versionMatch[1] : result.stdout.trim(),
            path: "ubs", // Could use `which ubs` to get full path
          };
        }

        return {
          available: false,
          version: undefined,
        };
      } catch {
        return {
          available: false,
          version: undefined,
        };
      }
    },

    scan: async (files, scanOpts) => {
      if (files.length === 0) {
        return {
          success: true,
          exitCode: 0,
          findings: [],
          summary: {
            total: 0,
            bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          },
          scannedPaths: [],
          timestamp: new Date().toISOString(),
        };
      }

      const args = buildScanArgs(files, scanOpts);
      const runOpts = buildRunOptions(scanOpts?.timeout);

      const result = await runUBSCommand(options.runner, args, runOpts);

      // Try to parse as JSON first
      try {
        const parsed = parseJson(result.stdout, UBSScanResultSchema, "scan");
        return {
          ...parsed,
          scannedPaths: files,
        };
      } catch {
        // Fall back to text parsing
        const textResult = parseUBSTextOutput(result.stdout, result.exitCode);
        return {
          ...textResult,
          scannedPaths: files,
        };
      }
    },

    scanStaged: async (scanOpts) => {
      // Get staged files from git
      const runOpts = buildRunOptions(10000);

      try {
        const gitResult = await options.runner.run(
          "git",
          ["diff", "--name-only", "--cached"],
          runOpts,
        );

        if (gitResult.exitCode !== 0) {
          throw new UBSClientError(
            "command_failed",
            "Failed to get staged files",
            {
              stderr: gitResult.stderr,
            },
          );
        }

        const files = gitResult.stdout
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.length > 0);

        if (files.length === 0) {
          return {
            success: true,
            exitCode: 0,
            findings: [],
            summary: {
              total: 0,
              bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
            },
            scannedPaths: [],
            timestamp: new Date().toISOString(),
          };
        }

        const args = buildScanArgs(files, scanOpts);
        const scanRunOpts = buildRunOptions(scanOpts?.timeout);

        const result = await runUBSCommand(options.runner, args, scanRunOpts);

        try {
          const parsed = parseJson(result.stdout, UBSScanResultSchema, "scan");
          return {
            ...parsed,
            scannedPaths: files,
          };
        } catch {
          const textResult = parseUBSTextOutput(result.stdout, result.exitCode);
          return {
            ...textResult,
            scannedPaths: files,
          };
        }
      } catch (error) {
        if (error instanceof UBSClientError) throw error;
        throw new UBSClientError(
          "command_failed",
          "Failed to scan staged files",
          {
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },

    scanDir: async (dir, scanOpts) => {
      const args = buildScanArgs([dir], scanOpts);
      const runOpts = buildRunOptions(scanOpts?.timeout);

      const result = await runUBSCommand(options.runner, args, runOpts);

      try {
        const parsed = parseJson(result.stdout, UBSScanResultSchema, "scan");
        return {
          ...parsed,
          scannedPaths: [dir],
        };
      } catch {
        const textResult = parseUBSTextOutput(result.stdout, result.exitCode);
        return {
          ...textResult,
          scannedPaths: [dir],
        };
      }
    },

    findingToBead,

    findingsToBeads: (findings, beadOpts) => {
      return findings.map((finding) => findingToBead(finding, beadOpts));
    },

    severityToPriority,
  };
}

// ============================================================================
// Default Command Runner (Bun subprocess)
// ============================================================================

/**
 * Create a command runner that uses Bun.spawn for subprocess execution.
 */
export function createBunUBSCommandRunner(): UBSCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 60000 });
  return {
    run: async (command, args, options) => {
      try {
        const result = await runner.run(command, args, {
          cwd: options?.cwd,
          timeoutMs: options?.timeout,
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (error instanceof CliCommandError) {
          if (error.kind === "timeout") {
            throw new UBSClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 60000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new UBSClientError(
              "unavailable",
              "UBS command failed to start",
              {
                command,
                args,
                details: error.details,
              },
            );
          }
        }
        throw error;
      }
    },
  };
}
