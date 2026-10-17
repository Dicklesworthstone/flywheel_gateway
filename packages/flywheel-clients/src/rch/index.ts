/**
 * RCH (Remote Compilation Helper) Client
 *
 * Provides typed access to the rch CLI for offloading compilation
 * commands to remote workers. Useful for agents to check status,
 * manage workers, and run diagnostics.
 *
 * CLI: https://github.com/Dicklesworthstone/remote_compilation_helper
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

export interface RchCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RchCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<RchCommandResult>;
}

export interface RchClientOptions {
  runner: RchCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class RchClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "RchClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const RchResponseSchema = z
  .object({
    version: z.string(),
    command: z.string(),
    success: z.boolean(),
    data: z.unknown(),
    error: z.string().optional(),
  })
  .passthrough();

const RchDoctorCheckSchema = z
  .object({
    category: z.string(),
    name: z.string(),
    status: z.enum(["pass", "warning", "fail", "skip"]),
    message: z.string(),
    details: z.string().optional(),
    suggestion: z.string().optional(),
    fixable: z.boolean().optional(),
  })
  .passthrough();

const RchDoctorSchema = z
  .object({
    checks: z.array(RchDoctorCheckSchema),
    summary: z
      .object({
        total: z.number(),
        passed: z.number(),
        warnings: z.number(),
        failed: z.number(),
      })
      .passthrough()
      .optional(),
    fixes_applied: z.array(z.string()).optional(),
  })
  .passthrough();

const RchWorkerSchema = z
  .object({
    name: z.string(),
    host: z.string(),
    port: z.number().optional(),
    user: z.string().optional(),
    status: z.enum(["online", "offline", "busy", "unknown"]).optional(),
    cpu_cores: z.number().optional(),
    memory_gb: z.number().optional(),
    last_seen: z.string().optional(),
    jobs_completed: z.number().optional(),
  })
  .passthrough();

const RchWorkersListSchema = z
  .object({
    workers: z.array(RchWorkerSchema),
    total: z.number().optional(),
  })
  .passthrough();

const RchStatusSchema = z
  .object({
    daemon_running: z.boolean().optional(),
    daemon_pid: z.number().optional(),
    hook_installed: z.boolean().optional(),
    workers_online: z.number().optional(),
    workers_total: z.number().optional(),
    jobs_pending: z.number().optional(),
    jobs_running: z.number().optional(),
    jobs_completed_today: z.number().optional(),
  })
  .passthrough();

const RchAgentSchema = z
  .object({
    name: z.string(),
    pid: z.number().optional(),
    status: z.string().optional(),
    cwd: z.string().optional(),
    started_at: z.string().optional(),
  })
  .passthrough();

const RchAgentsListSchema = z
  .object({
    agents: z.array(RchAgentSchema),
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type RchDoctorCheck = z.infer<typeof RchDoctorCheckSchema>;
export type RchDoctor = z.infer<typeof RchDoctorSchema>;
export type RchWorker = z.infer<typeof RchWorkerSchema>;
export type RchStatus = z.infer<typeof RchStatusSchema>;
export type RchAgent = z.infer<typeof RchAgentSchema>;

export interface RchHealthStatus {
  available: boolean;
  version?: string;
  daemonRunning: boolean;
  hookInstalled: boolean;
  workersOnline: number;
  workersTotal: number;
  passedChecks: number;
  failedChecks: number;
}

// ============================================================================
// Options Types
// ============================================================================

export interface RchCommandOptions {
  cwd?: string;
  timeout?: number;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface RchClient {
  /** Run doctor diagnostics */
  doctor: (options?: RchCommandOptions) => Promise<RchDoctor>;

  /** Get overall status */
  status: (options?: RchCommandOptions) => Promise<RchStatus>;

  /** Get combined health status */
  health: (options?: RchCommandOptions) => Promise<RchHealthStatus>;

  /** List configured workers */
  listWorkers: (options?: RchCommandOptions) => Promise<RchWorker[]>;

  /** List detected agents */
  listAgents: (options?: RchCommandOptions) => Promise<RchAgent[]>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runRchCommand(
  runner: RchCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("rch", [...args, "--json"], options);
  if (result.exitCode !== 0 && !result.stdout) {
    throw new RchClientError("command_failed", "RCH command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr,
      args,
    });
  }
  return result.stdout;
}

function parseResponse<T>(
  stdout: string,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  // First parse the envelope
  let envelope: z.infer<typeof RchResponseSchema>;
  try {
    const parsed = JSON.parse(stdout);
    envelope = RchResponseSchema.parse(parsed);
  } catch (error) {
    throw new RchClientError("parse_error", `Failed to parse RCH ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  // Check if response succeeded
  if (!envelope.success) {
    throw new RchClientError(
      "command_failed",
      `RCH ${context} failed: ${envelope.error ?? "unknown error"}`,
      {
        command: envelope.command,
        error: envelope.error,
      },
    );
  }

  // Parse the data with the specific schema
  const result = schema.safeParse(envelope.data);
  if (!result.success) {
    throw new RchClientError(
      "validation_error",
      `Invalid RCH ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: RchClientOptions,
  override?: RchCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout ?? 30000;
  if (cwd !== undefined) result.cwd = cwd;
  result.timeout = timeout;
  return result;
}

async function getVersion(
  runner: RchCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("rch", ["--version"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from output (e.g., "rch 1.2.3" -> "1.2.3")
    const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createRchClient(options: RchClientOptions): RchClient {
  return {
    doctor: async (opts) => {
      const stdout = await runRchCommand(
        options.runner,
        ["doctor"],
        buildRunOptions(options, opts),
      );
      return parseResponse(stdout, RchDoctorSchema, "doctor");
    },

    status: async (opts) => {
      const stdout = await runRchCommand(
        options.runner,
        ["status"],
        buildRunOptions(options, opts),
      );
      return parseResponse(stdout, RchStatusSchema, "status");
    },

    health: async (opts): Promise<RchHealthStatus> => {
      try {
        const [doctor, version] = await Promise.all([
          createRchClient(options).doctor(opts),
          getVersion(options.runner, opts?.cwd ?? options.cwd),
        ]);

        let status: RchStatus = {};
        try {
          status = await createRchClient(options).status(opts);
        } catch {
          // Status might fail if daemon not running
        }

        const passedChecks =
          doctor.summary?.passed ??
          doctor.checks?.filter((c) => c.status === "pass").length ??
          0;
        const failedChecks =
          doctor.summary?.failed ??
          doctor.checks?.filter((c) => c.status === "fail").length ??
          0;

        const health: RchHealthStatus = {
          available: true,
          daemonRunning: status.daemon_running ?? false,
          hookInstalled: status.hook_installed ?? false,
          workersOnline: status.workers_online ?? 0,
          workersTotal: status.workers_total ?? 0,
          passedChecks,
          failedChecks,
        };
        if (version !== null) health.version = version;
        return health;
      } catch {
        return {
          available: false,
          daemonRunning: false,
          hookInstalled: false,
          workersOnline: 0,
          workersTotal: 0,
          passedChecks: 0,
          failedChecks: 0,
        };
      }
    },

    listWorkers: async (opts) => {
      const stdout = await runRchCommand(
        options.runner,
        ["workers", "list"],
        buildRunOptions(options, opts),
      );
      const response = parseResponse(stdout, RchWorkersListSchema, "workers");
      return response.workers ?? [];
    },

    listAgents: async (opts) => {
      const stdout = await runRchCommand(
        options.runner,
        ["agents", "list"],
        buildRunOptions(options, opts),
      );
      const response = parseResponse(stdout, RchAgentsListSchema, "agents");
      return response.agents ?? [];
    },

    isAvailable: async () => {
      try {
        await createRchClient(options).doctor({ timeout: 5000 });
        return true;
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
export function createBunRchCommandRunner(): RchCommandRunner {
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
            throw new RchClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new RchClientError(
              "unavailable",
              "RCH command failed to start",
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
