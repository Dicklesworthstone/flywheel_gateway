/**
 * PT (Process Triage) Client
 *
 * Provides typed access to the pt CLI for finding and triaging stuck/zombie
 * processes that may be consuming resources or blocking agent work.
 *
 * CLI: https://github.com/Dicklesworthstone/process_triage
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

export interface PtCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PtCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<PtCommandResult>;
}

export interface PtClientOptions {
  runner: PtCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 60000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class PtClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "PtClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const PtResponseMetaSchema = z
  .object({
    v: z.string(),
    ts: z.string(),
  })
  .passthrough();

const PtResponseSchema = z
  .object({
    ok: z.boolean(),
    code: z.string(),
    data: z.unknown(),
    hint: z.string().optional(),
    meta: PtResponseMetaSchema,
  })
  .passthrough();

const PtDoctorCheckSchema = z
  .object({
    name: z.string(),
    status: z.enum(["ok", "warning", "error"]),
    message: z.string().optional(),
  })
  .passthrough();

const PtDoctorPermissionsSchema = z
  .object({
    can_list_processes: z.boolean(),
    can_kill_processes: z.boolean(),
  })
  .passthrough();

const PtDoctorSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "error"]),
    checks: z.array(PtDoctorCheckSchema),
    permissions: PtDoctorPermissionsSchema,
  })
  .passthrough();

const PtScoreBreakdownSchema = z
  .object({
    cpu_score: z.number(),
    memory_score: z.number(),
    runtime_score: z.number(),
    state_score: z.number(),
  })
  .passthrough();

const PtProcessSchema = z
  .object({
    pid: z.number(),
    ppid: z.number(),
    name: z.string(),
    cmdline: z.string(),
    user: z.string(),
    state: z.string(),
    cpu_percent: z.number(),
    memory_percent: z.number(),
    memory_rss_mb: z.number(),
    started_at: z.string().optional(),
    runtime_seconds: z.number().optional(),
    score: z.number(),
    score_breakdown: PtScoreBreakdownSchema.optional(),
    flags: z.array(z.string()),
  })
  .passthrough();

const PtScanThresholdsSchema = z
  .object({
    min_score: z.number(),
    min_runtime_seconds: z.number().optional(),
    min_memory_mb: z.number().optional(),
    min_cpu_percent: z.number().optional(),
  })
  .passthrough();

const PtScanResultSchema = z
  .object({
    processes: z.array(PtProcessSchema),
    total_scanned: z.number(),
    suspicious_count: z.number(),
    scan_time_ms: z.number(),
    timestamp: z.string(),
    thresholds: PtScanThresholdsSchema,
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type PtDoctor = z.infer<typeof PtDoctorSchema>;
export type PtDoctorCheck = z.infer<typeof PtDoctorCheckSchema>;
export type PtProcess = z.infer<typeof PtProcessSchema>;
export type PtScanResult = z.infer<typeof PtScanResultSchema>;

export interface PtStatus {
  available: boolean;
  version?: string;
  canListProcesses: boolean;
  canKillProcesses: boolean;
}

// ============================================================================
// Options Types
// ============================================================================

export interface PtCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface PtScanOptions extends PtCommandOptions {
  /** Minimum suspicion score threshold (0-100). Default: 50 */
  minScore?: number;
  /** Minimum runtime in seconds to consider. Default: 0 */
  minRuntimeSeconds?: number;
  /** Minimum memory usage in MB. Default: 0 */
  minMemoryMb?: number;
  /** Minimum CPU percentage. Default: 0 */
  minCpuPercent?: number;
  /** Only include processes matching these names (regex) */
  namePattern?: string;
  /** Exclude processes matching these names (regex) */
  excludePattern?: string;
  /** Limit results to top N by score */
  limit?: number;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface PtClient {
  /** Run doctor check to get system health and permissions */
  doctor: (options?: PtCommandOptions) => Promise<PtDoctor>;

  /** Get overall status including version and permissions */
  status: (options?: PtCommandOptions) => Promise<PtStatus>;

  /** Scan for suspicious/stuck processes */
  scan: (options?: PtScanOptions) => Promise<PtScanResult>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runPtCommand(
  runner: PtCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("pt", [...args, "--json"], options);
  if (result.exitCode !== 0) {
    throw new PtClientError("command_failed", "PT command failed", {
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
  let envelope: z.infer<typeof PtResponseSchema>;
  try {
    const parsed = JSON.parse(stdout);
    envelope = PtResponseSchema.parse(parsed);
  } catch (error) {
    throw new PtClientError("parse_error", `Failed to parse PT ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  // Check if response is OK
  if (!envelope.ok) {
    throw new PtClientError(
      "command_failed",
      `PT ${context} failed: ${envelope.code}`,
      {
        code: envelope.code,
        hint: envelope.hint,
      },
    );
  }

  // Parse the data with the specific schema
  const result = schema.safeParse(envelope.data);
  if (!result.success) {
    throw new PtClientError(
      "validation_error",
      `Invalid PT ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: PtClientOptions,
  override?: PtCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout;
  if (cwd !== undefined) result.cwd = cwd;
  if (timeout !== undefined) result.timeout = timeout;
  return result;
}

async function getVersion(
  runner: PtCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("pt", ["--version"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from output (e.g., "pt v1.2.3" -> "1.2.3")
    const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createPtClient(options: PtClientOptions): PtClient {
  return {
    doctor: async (opts) => {
      const stdout = await runPtCommand(
        options.runner,
        ["doctor"],
        buildRunOptions(options, opts),
      );
      return parseResponse(stdout, PtDoctorSchema, "doctor");
    },

    status: async (opts): Promise<PtStatus> => {
      try {
        const doctor = await createPtClient(options).doctor(opts);
        const version = await getVersion(
          options.runner,
          opts?.cwd ?? options.cwd,
        );

        const status: PtStatus = {
          available: true,
          canListProcesses: doctor.permissions.can_list_processes,
          canKillProcesses: doctor.permissions.can_kill_processes,
        };
        if (version !== null) status.version = version;
        return status;
      } catch {
        return {
          available: false,
          canListProcesses: false,
          canKillProcesses: false,
        };
      }
    },

    scan: async (opts) => {
      const args = ["scan"];

      if (opts?.minScore !== undefined) {
        args.push("--min-score", String(opts.minScore));
      }

      if (opts?.minRuntimeSeconds !== undefined) {
        args.push("--min-runtime", String(opts.minRuntimeSeconds));
      }

      if (opts?.minMemoryMb !== undefined) {
        args.push("--min-memory", String(opts.minMemoryMb));
      }

      if (opts?.minCpuPercent !== undefined) {
        args.push("--min-cpu", String(opts.minCpuPercent));
      }

      if (opts?.namePattern) {
        args.push("--name", opts.namePattern);
      }

      if (opts?.excludePattern) {
        args.push("--exclude", opts.excludePattern);
      }

      if (opts?.limit !== undefined) {
        args.push("--limit", String(opts.limit));
      }

      const stdout = await runPtCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseResponse(stdout, PtScanResultSchema, "scan");
    },

    isAvailable: async () => {
      try {
        await createPtClient(options).doctor({ timeout: 5000 });
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
export function createBunPtCommandRunner(): PtCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 60000 });
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
            throw new PtClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 60000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new PtClientError(
              "unavailable",
              "PT command failed to start",
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
