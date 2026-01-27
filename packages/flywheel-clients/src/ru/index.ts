/**
 * RU (Repo Updater) Client
 *
 * Provides typed access to the ru CLI for fleet repository management.
 * Supports sync operations and agent sweep workflows.
 *
 * Note: This client handles CLI execution and JSON parsing. Process tracking,
 * cancellation, and database operations are managed by the gateway services.
 */

import {
  CliClientError,
  type CliErrorDetails,
  type CliErrorKind,
} from "@flywheel/shared";
import { z } from "zod";
import {
  CliCommandError,
  type CliCommandOptions,
  createBunCliRunner as createSharedBunCliRunner,
} from "../cli-runner";

// ============================================================================
// Command Runner Interface
// ============================================================================

export interface RuCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RuCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<RuCommandResult>;
}

export interface RuClientOptions {
  runner: RuCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 60000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class RuClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "RuClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

// Sync result from `ru sync --json <repo>`
const RuSyncResultSchema = z
  .object({
    success: z.boolean().optional(),
    repo: z.string().optional(),
    commit: z.string().optional(),
    commits: z.number().optional(),
    files: z.number().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

// Version info from `ru --version`
const RuVersionSchema = z
  .object({
    version: z.string().optional(),
    commit: z.string().optional(),
    date: z.string().optional(),
  })
  .passthrough();

// Status from `ru status --json`
const RuStatusSchema = z
  .object({
    repos: z.number().optional(),
    cloned: z.number().optional(),
    dirty: z.number().optional(),
    synced: z.number().optional(),
    last_sync: z.string().optional(),
  })
  .passthrough();

// Repo info from `ru list --json`
const RuRepoSchema = z
  .object({
    name: z.string(),
    fullName: z.string().optional(),
    full_name: z.string().optional(),
    path: z.string().optional(),
    remote: z.string().optional(),
    branch: z.string().optional(),
    commit: z.string().optional(),
    dirty: z.boolean().optional(),
    cloned: z.boolean().optional(),
    group: z.string().optional(),
    lastSync: z.string().optional(),
    last_sync: z.string().optional(),
  })
  .passthrough();

const RuRepoListSchema = z.array(RuRepoSchema);

// Sweep phase result
const RuSweepPhaseResultSchema = z
  .object({
    phase: z.string().optional(),
    success: z.boolean().optional(),
    repo: z.string().optional(),
    message: z.string().optional(),
    actions: z.array(z.unknown()).optional(),
    plan: z.unknown().optional(),
    error: z.string().optional(),
    duration_ms: z.number().optional(),
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type RuSyncResult = z.infer<typeof RuSyncResultSchema>;
export type RuVersion = z.infer<typeof RuVersionSchema>;
export type RuStatus = z.infer<typeof RuStatusSchema>;
export type RuRepo = z.infer<typeof RuRepoSchema>;
export type RuSweepPhaseResult = z.infer<typeof RuSweepPhaseResultSchema>;

// ============================================================================
// Options Types
// ============================================================================

export interface RuSyncOptions {
  cwd?: string;
  timeout?: number;
  /** Force sync even if up-to-date */
  force?: boolean;
  /** Dry run - don't actually sync */
  dryRun?: boolean;
}

export interface RuSweepOptions {
  cwd?: string;
  timeout?: number;
  /** Don't execute, just analyze/plan */
  dryRun?: boolean;
  /** Skip approval for execution */
  autoApprove?: boolean;
  /** Specific repo to sweep */
  repo?: string;
}

export interface RuListOptions {
  cwd?: string;
  timeout?: number;
  /** Filter by group */
  group?: string;
  /** Filter by owner */
  owner?: string;
  /** Include only cloned repos */
  clonedOnly?: boolean;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface RuClient {
  /** Get ru version info */
  version: (options?: { cwd?: string; timeout?: number }) => Promise<RuVersion>;

  /** Get fleet status */
  status: (options?: { cwd?: string; timeout?: number }) => Promise<RuStatus>;

  /** List repos in the fleet */
  list: (options?: RuListOptions) => Promise<RuRepo[]>;

  /** Sync a specific repository */
  sync: (repo: string, options?: RuSyncOptions) => Promise<RuSyncResult>;

  /** Run sweep phase 1 (analysis) */
  sweepPhase1: (
    repo: string,
    options?: RuSweepOptions,
  ) => Promise<RuSweepPhaseResult>;

  /** Run sweep phase 2 (planning) */
  sweepPhase2: (
    repo: string,
    options?: RuSweepOptions,
  ) => Promise<RuSweepPhaseResult>;

  /** Run sweep phase 3 (execution) */
  sweepPhase3: (
    repo: string,
    planPath: string,
    options?: RuSweepOptions,
  ) => Promise<RuSweepPhaseResult>;
}

// ============================================================================
// Helpers
// ============================================================================

function extractJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return trimmed;

  const firstBrace = Math.min(
    ...["{", "["]
      .map((token) => trimmed.indexOf(token))
      .filter((index) => index >= 0),
  );
  const lastBrace = Math.max(
    trimmed.lastIndexOf("}"),
    trimmed.lastIndexOf("]"),
  );

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseJson<T>(
  stdout: string,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  const payload = extractJsonPayload(stdout);

  // Handle empty output
  if (!payload) {
    // Return empty object for optional schemas
    const emptyResult = schema.safeParse({});
    if (emptyResult.success) {
      return emptyResult.data;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new RuClientError("parse_error", `Failed to parse ru ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new RuClientError("validation_error", `Invalid ru ${context}`, {
      issues: result.error.issues,
    });
  }

  return result.data;
}

function parseRepoList(stdout: string, context: string): RuRepo[] {
  const payload = extractJsonPayload(stdout);

  if (!payload) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new RuClientError("parse_error", `Failed to parse ru ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const listResult = RuRepoListSchema.safeParse(parsed);
  if (listResult.success) {
    return listResult.data;
  }

  // Try single repo
  const singleResult = RuRepoSchema.safeParse(parsed);
  if (singleResult.success) {
    return [singleResult.data];
  }

  throw new RuClientError("validation_error", `Invalid ru ${context}`, {
    issues: listResult.error.issues,
  });
}

function buildRunOptions(
  defaults: RuClientOptions,
  overrides?: { cwd?: string; timeout?: number },
): { cwd?: string; timeout?: number } {
  const cwd = overrides?.cwd ?? defaults.cwd;
  const timeout = overrides?.timeout ?? defaults.timeout ?? 60000;
  const runOptions: { cwd?: string; timeout?: number } = { timeout };
  if (cwd !== undefined) runOptions.cwd = cwd;
  return runOptions;
}

async function runRuCommand(
  runner: RuCommandRunner,
  args: string[],
  runOptions: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; exitCode: number; stderr: string }> {
  const result = await runner.run("ru", args, runOptions);
  return result;
}

// ============================================================================
// Implementation
// ============================================================================

export function createRuClient(options: RuClientOptions): RuClient {
  return {
    version: async (opts) => {
      const result = await runRuCommand(
        options.runner,
        ["--version", "--json"],
        buildRunOptions(options, opts),
      );

      // Version command may output plain text, try to parse
      if (result.exitCode !== 0) {
        throw new RuClientError("command_failed", "ru version failed", {
          exitCode: result.exitCode,
          stderr: result.stderr,
        });
      }

      // Try JSON first
      try {
        return parseJson(result.stdout, RuVersionSchema, "version");
      } catch {
        // Fall back to plain text parsing
        const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
        return {
          version: versionMatch?.[1] ?? result.stdout.trim(),
        };
      }
    },

    status: async (opts) => {
      const result = await runRuCommand(
        options.runner,
        ["status", "--json"],
        buildRunOptions(options, opts),
      );

      if (result.exitCode !== 0) {
        throw new RuClientError("command_failed", "ru status failed", {
          exitCode: result.exitCode,
          stderr: result.stderr,
        });
      }

      return parseJson(result.stdout, RuStatusSchema, "status");
    },

    list: async (opts) => {
      const args = ["list", "--json"];
      if (opts?.group) args.push("--group", opts.group);
      if (opts?.owner) args.push("--owner", opts.owner);
      if (opts?.clonedOnly) args.push("--cloned");

      const result = await runRuCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );

      if (result.exitCode !== 0) {
        throw new RuClientError("command_failed", "ru list failed", {
          exitCode: result.exitCode,
          stderr: result.stderr,
        });
      }

      return parseRepoList(result.stdout, "list");
    },

    sync: async (repo, opts) => {
      const args = ["sync", "--json", repo];
      if (opts?.force) args.push("--force");
      if (opts?.dryRun) args.push("--dry-run");

      const result = await runRuCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );

      // Non-zero exit may still have valid JSON with error info
      try {
        const parsed = parseJson(result.stdout, RuSyncResultSchema, "sync");
        if (result.exitCode !== 0 && !parsed.error) {
          parsed.error = result.stderr || `Exit code: ${result.exitCode}`;
        }
        return parsed;
      } catch {
        if (result.exitCode !== 0) {
          throw new RuClientError("command_failed", "ru sync failed", {
            exitCode: result.exitCode,
            stderr: result.stderr,
            repo,
          });
        }
        throw new RuClientError("parse_error", "ru sync output invalid", {
          stdout: result.stdout.slice(0, 500),
        });
      }
    },

    sweepPhase1: async (repo, opts) => {
      const args = ["agent-sweep", "--phase1", "--json", "--repo", repo];
      if (opts?.dryRun) args.push("--dry-run");

      const result = await runRuCommand(
        options.runner,
        args,
        buildRunOptions(options, { ...opts, timeout: opts?.timeout ?? 300000 }),
      );

      try {
        const parsed = parseJson(
          result.stdout,
          RuSweepPhaseResultSchema,
          "sweep phase1",
        );
        if (result.exitCode !== 0 && !parsed.error) {
          parsed.error = result.stderr || `Exit code: ${result.exitCode}`;
        }
        return parsed;
      } catch {
        if (result.exitCode !== 0) {
          throw new RuClientError("command_failed", "ru sweep phase1 failed", {
            exitCode: result.exitCode,
            stderr: result.stderr,
            repo,
          });
        }
        throw new RuClientError(
          "parse_error",
          "ru sweep phase1 output invalid",
          {
            stdout: result.stdout.slice(0, 500),
          },
        );
      }
    },

    sweepPhase2: async (repo, opts) => {
      const args = ["agent-sweep", "--phase2", "--json", "--repo", repo];
      if (opts?.dryRun) args.push("--dry-run");

      const result = await runRuCommand(
        options.runner,
        args,
        buildRunOptions(options, { ...opts, timeout: opts?.timeout ?? 600000 }),
      );

      try {
        const parsed = parseJson(
          result.stdout,
          RuSweepPhaseResultSchema,
          "sweep phase2",
        );
        if (result.exitCode !== 0 && !parsed.error) {
          parsed.error = result.stderr || `Exit code: ${result.exitCode}`;
        }
        return parsed;
      } catch {
        if (result.exitCode !== 0) {
          throw new RuClientError("command_failed", "ru sweep phase2 failed", {
            exitCode: result.exitCode,
            stderr: result.stderr,
            repo,
          });
        }
        throw new RuClientError(
          "parse_error",
          "ru sweep phase2 output invalid",
          {
            stdout: result.stdout.slice(0, 500),
          },
        );
      }
    },

    sweepPhase3: async (repo, planPath, opts) => {
      const args = [
        "agent-sweep",
        "--phase3",
        "--json",
        "--repo",
        repo,
        "--plan",
        planPath,
      ];
      if (opts?.dryRun) args.push("--dry-run");
      if (opts?.autoApprove) args.push("--auto-approve");

      const result = await runRuCommand(
        options.runner,
        args,
        buildRunOptions(options, { ...opts, timeout: opts?.timeout ?? 300000 }),
      );

      try {
        const parsed = parseJson(
          result.stdout,
          RuSweepPhaseResultSchema,
          "sweep phase3",
        );
        if (result.exitCode !== 0 && !parsed.error) {
          parsed.error = result.stderr || `Exit code: ${result.exitCode}`;
        }
        return parsed;
      } catch {
        if (result.exitCode !== 0) {
          throw new RuClientError("command_failed", "ru sweep phase3 failed", {
            exitCode: result.exitCode,
            stderr: result.stderr,
            repo,
          });
        }
        throw new RuClientError(
          "parse_error",
          "ru sweep phase3 output invalid",
          {
            stdout: result.stdout.slice(0, 500),
          },
        );
      }
    },
  };
}

// ============================================================================
// Default Command Runner (Bun subprocess)
// ============================================================================

/**
 * Create a command runner that uses Bun.spawn for subprocess execution.
 */
export function createBunRuCommandRunner(): RuCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 60000 });
  return {
    run: async (command, args, options) => {
      try {
        const cliOpts: CliCommandOptions = {};
        if (options?.cwd) cliOpts.cwd = options.cwd;
        if (options?.timeout) cliOpts.timeoutMs = options.timeout;
        const result = await runner.run(command, args, cliOpts);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (error instanceof CliCommandError) {
          if (error.kind === "timeout") {
            throw new RuClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 60000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new RuClientError(
              "unavailable",
              "ru command failed to start",
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
