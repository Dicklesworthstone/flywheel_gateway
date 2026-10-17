/**
 * SLB (Simultaneous Launch Button) Client
 *
 * Provides typed access to the slb CLI for two-person authorization
 * of dangerous commands. Useful for agents to check command risk levels,
 * manage pending requests, and query history.
 *
 * CLI: https://github.com/Dicklesworthstone/slb
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

export interface SlbCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SlbCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<SlbCommandResult>;
}

export interface SlbClientOptions {
  runner: SlbCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class SlbClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "SlbClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

/** Risk tiers for command classification */
const SlbTierSchema = z.enum(["critical", "dangerous", "caution", "safe"]);

/** Result of checking a command's risk tier */
const SlbCheckResultSchema = z
  .object({
    command: z.string(),
    is_safe: z.boolean(),
    matched_pattern: z.string().optional(),
    min_approvals: z.number(),
    needs_approval: z.boolean(),
    tier: SlbTierSchema,
  })
  .passthrough();

/** Pending approval request */
const SlbRequestSchema = z
  .object({
    id: z.string(),
    command: z.string(),
    tier: SlbTierSchema,
    requester: z.string().optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    created_at: z.string().optional(),
    expires_at: z.string().optional(),
    approvals: z.number().optional(),
    required_approvals: z.number().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const SlbRequestListSchema = z.array(SlbRequestSchema);

/** Historical request record */
const SlbHistoryEntrySchema = z
  .object({
    id: z.string(),
    command: z.string(),
    tier: SlbTierSchema,
    status: z.string(),
    requester: z.string().optional(),
    approvers: z.array(z.string()).optional(),
    created_at: z.string().optional(),
    resolved_at: z.string().optional(),
    outcome: z.string().optional(),
  })
  .passthrough();

const SlbHistoryListSchema = z.array(SlbHistoryEntrySchema);

/** Pattern configuration */
const SlbPatternConfigSchema = z
  .object({
    MinApprovals: z.number(),
    DynamicQuorum: z.boolean().optional(),
    DynamicQuorumFloor: z.number().optional(),
    AutoApproveDelaySeconds: z.number().optional(),
    Patterns: z.array(z.string()),
  })
  .passthrough();

/** SLB configuration */
const SlbConfigSchema = z
  .object({
    General: z
      .object({
        MinApprovals: z.number(),
        RequireDifferentModel: z.boolean().optional(),
        RequestTimeoutSecs: z.number().optional(),
        ApprovalTTLMins: z.number().optional(),
        EnableDryRun: z.boolean().optional(),
        EnableRollbackCapture: z.boolean().optional(),
      })
      .passthrough(),
    Daemon: z
      .object({
        UseFileWatcher: z.boolean().optional(),
        LogLevel: z.string().optional(),
      })
      .passthrough()
      .optional(),
    RateLimits: z
      .object({
        MaxPendingPerSession: z.number().optional(),
        MaxRequestsPerMinute: z.number().optional(),
      })
      .passthrough()
      .optional(),
    Patterns: z
      .object({
        Critical: SlbPatternConfigSchema.optional(),
        Dangerous: SlbPatternConfigSchema.optional(),
        Caution: SlbPatternConfigSchema.optional(),
        Safe: SlbPatternConfigSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type SlbTier = z.infer<typeof SlbTierSchema>;
export type SlbCheckResult = z.infer<typeof SlbCheckResultSchema>;
export type SlbRequest = z.infer<typeof SlbRequestSchema>;
export type SlbHistoryEntry = z.infer<typeof SlbHistoryEntrySchema>;
export type SlbConfig = z.infer<typeof SlbConfigSchema>;

export interface SlbStatus {
  available: boolean;
  version?: string;
  daemonRunning?: boolean;
  pendingCount: number;
  defaultMinApprovals: number;
}

// ============================================================================
// Options Types
// ============================================================================

export interface SlbCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface SlbHistoryOptions extends SlbCommandOptions {
  /** Filter by tier */
  tier?: SlbTier;
  /** Filter by status */
  status?: string;
  /** Limit number of results */
  limit?: number;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface SlbClient {
  /** Check what tier a command would be classified as */
  check: (
    command: string,
    options?: SlbCommandOptions,
  ) => Promise<SlbCheckResult>;

  /** Get current configuration */
  config: (options?: SlbCommandOptions) => Promise<SlbConfig>;

  /** List pending approval requests */
  pending: (options?: SlbCommandOptions) => Promise<SlbRequest[]>;

  /** Get request history */
  history: (options?: SlbHistoryOptions) => Promise<SlbHistoryEntry[]>;

  /** Get overall status */
  status: (options?: SlbCommandOptions) => Promise<SlbStatus>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runSlbCommand(
  runner: SlbCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("slb", [...args, "--json"], options);
  // slb might return non-zero for "blocked" checks which is valid
  if (result.exitCode !== 0 && !result.stdout) {
    throw new SlbClientError("command_failed", "SLB command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr,
      args,
    });
  }
  return result.stdout;
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
    throw new SlbClientError("parse_error", `Failed to parse SLB ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new SlbClientError(
      "validation_error",
      `Invalid SLB ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: SlbClientOptions,
  override?: SlbCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout ?? 30000;
  if (cwd !== undefined) result.cwd = cwd;
  result.timeout = timeout;
  return result;
}

async function getVersion(
  runner: SlbCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("slb", ["--version"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from output (e.g., "slb v1.2.3" -> "1.2.3")
    const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createSlbClient(options: SlbClientOptions): SlbClient {
  return {
    check: async (command, opts) => {
      const stdout = await runSlbCommand(
        options.runner,
        ["check", command],
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, SlbCheckResultSchema, "check");
    },

    config: async (opts) => {
      const stdout = await runSlbCommand(
        options.runner,
        ["config"],
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, SlbConfigSchema, "config");
    },

    pending: async (opts) => {
      const stdout = await runSlbCommand(
        options.runner,
        ["pending"],
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, SlbRequestListSchema, "pending");
    },

    history: async (opts) => {
      const args = ["history"];
      if (opts?.tier) args.push("--tier", opts.tier);
      if (opts?.status) args.push("--status", opts.status);
      if (opts?.limit !== undefined) args.push("--limit", String(opts.limit));

      const stdout = await runSlbCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, SlbHistoryListSchema, "history");
    },

    status: async (opts): Promise<SlbStatus> => {
      try {
        const [config, pending, version] = await Promise.all([
          createSlbClient(options).config(opts),
          createSlbClient(options).pending(opts),
          getVersion(options.runner, opts?.cwd ?? options.cwd),
        ]);

        const status: SlbStatus = {
          available: true,
          pendingCount: pending.length,
          defaultMinApprovals: config.General.MinApprovals,
        };
        if (version !== null) status.version = version;
        return status;
      } catch {
        return {
          available: false,
          pendingCount: 0,
          defaultMinApprovals: 2,
        };
      }
    },

    isAvailable: async () => {
      try {
        const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
        if (options.cwd !== undefined) opts.cwd = options.cwd;
        const result = await options.runner.run("slb", ["--version"], opts);
        return result.exitCode === 0;
      } catch {
        return false;
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
export function createBunSlbCommandRunner(): SlbCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 30000 });
  return {
    run: async (command, args, options) => {
      try {
        const runOpts: { cwd?: string; timeoutMs?: number } = {};
        if (options?.cwd !== undefined) runOpts.cwd = options.cwd;
        if (options?.timeout !== undefined) runOpts.timeoutMs = options.timeout;
        const result = await runner.run(command, args, runOpts);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (error instanceof CliCommandError) {
          if (error.kind === "timeout") {
            throw new SlbClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new SlbClientError(
              "unavailable",
              "SLB command failed to start",
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
