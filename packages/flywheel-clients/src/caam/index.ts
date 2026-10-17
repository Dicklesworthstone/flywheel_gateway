/**
 * CAAM (Coding Agent Account Manager) Client
 *
 * Provides typed access to the caam CLI for account status and activation flows.
 * Always uses --json output to avoid interactive prompts.
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

export interface CaamCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CaamCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<CaamCommandResult>;
}

export interface CaamClientOptions {
  runner: CaamCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class CaamClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "CaamClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const CaamStatusHealthSchema = z
  .object({
    status: z.string(),
    reason: z.string().optional(),
    expires_at: z.string().optional(),
    error_count: z.number(),
    cooldown_remaining: z.string().optional(),
  })
  .passthrough();

const CaamStatusIdentitySchema = z
  .object({
    email: z.string().optional(),
    plan_type: z.string().optional(),
  })
  .passthrough();

const CaamStatusToolSchema = z
  .object({
    tool: z.string(),
    logged_in: z.boolean(),
    active_profile: z.string().optional(),
    error: z.string().optional(),
    health: CaamStatusHealthSchema.optional(),
    identity: CaamStatusIdentitySchema.optional(),
  })
  .passthrough();

const CaamStatusSchema = z
  .object({
    tools: z.array(CaamStatusToolSchema),
    warnings: z.array(z.string()).optional(),
    recommendations: z.array(z.string()).optional(),
  })
  .passthrough();

const CaamRotationAlternativeSchema = z
  .object({
    profile: z.string(),
    score: z.number(),
  })
  .passthrough();

const CaamActivateRotationSchema = z
  .object({
    algorithm: z.string(),
    selected: z.string(),
    alternatives: z.array(CaamRotationAlternativeSchema).optional(),
  })
  .passthrough();

const CaamActivateSchema = z
  .object({
    success: z.boolean(),
    tool: z.string(),
    profile: z.string(),
    previous_profile: z.string().optional(),
    source: z.string().optional(),
    auto_backup: z.string().optional(),
    refreshed: z.boolean().optional(),
    rotation: CaamActivateRotationSchema.optional(),
    error: z.string().optional(),
  })
  .passthrough();

const CaamBackupSchema = z
  .object({
    success: z.boolean(),
    error: z.string().optional(),
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type CaamStatusTool = z.infer<typeof CaamStatusToolSchema>;
export type CaamStatus = z.infer<typeof CaamStatusSchema>;
export type CaamActivateResult = z.infer<typeof CaamActivateSchema>;
export type CaamBackupResult = z.infer<typeof CaamBackupSchema>;

// ============================================================================
// Options Types
// ============================================================================

export interface CaamCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface CaamStatusOptions extends CaamCommandOptions {
  provider?: string;
}

export interface CaamActivateOptions extends CaamCommandOptions {
  provider: string;
  profile: string;
}

export interface CaamBackupOptions extends CaamCommandOptions {
  provider: string;
  name: string;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface CaamClient {
  /** Get status for all tools or a specific provider */
  status: (options?: CaamStatusOptions) => Promise<CaamStatus>;

  /** Activate a specific profile */
  activate: (options: CaamActivateOptions) => Promise<CaamActivateResult>;

  /** Backup current auth files to vault */
  backup: (options: CaamBackupOptions) => Promise<CaamBackupResult>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runCaamCommand(
  runner: CaamCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("caam", args, options);
  if (result.exitCode !== 0) {
    throw new CaamClientError("command_failed", "CAAM command failed", {
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
    throw new CaamClientError(
      "parse_error",
      `Failed to parse CAAM ${context}`,
      {
        cause: error instanceof Error ? error.message : String(error),
        stdout: stdout.slice(0, 500),
      },
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new CaamClientError(
      "validation_error",
      `Invalid CAAM ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: CaamClientOptions,
  override?: CaamCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout;
  if (cwd !== undefined) result.cwd = cwd;
  if (timeout !== undefined) result.timeout = timeout;
  return result;
}

export function createCaamClient(options: CaamClientOptions): CaamClient {
  return {
    status: async (opts) => {
      const args = ["status", "--json"];
      if (opts?.provider) {
        args.push(opts.provider);
      }
      const stdout = await runCaamCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, CaamStatusSchema, "status");
    },

    activate: async (opts) => {
      const args = ["activate", opts.provider, opts.profile, "--json"];
      const stdout = await runCaamCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, CaamActivateSchema, "activate");
    },

    backup: async (opts) => {
      const args = ["backup", opts.provider, opts.name, "--json"];
      const stdout = await runCaamCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, CaamBackupSchema, "backup");
    },

    isAvailable: async () => {
      try {
        await runCaamCommand(
          options.runner,
          ["status", "--json"],
          buildRunOptions(options),
        );
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
export function createBunCaamCommandRunner(): CaamCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 30000 });
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
            throw new CaamClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new CaamClientError(
              "unavailable",
              "CAAM command failed to start",
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
