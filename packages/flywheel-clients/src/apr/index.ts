/**
 * APR (Automated Plan Reviser) Client
 *
 * Provides typed access to the apr CLI for plan revision workflows.
 * Always uses robot mode for JSON output.
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

export interface AprCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AprCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<AprCommandResult>;
}

export interface AprClientOptions {
  runner: AprCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 60000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class AprClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "AprClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const AprMetaSchema = z
  .object({
    v: z.string(),
    ts: z.string(),
  })
  .passthrough();

const AprEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    code: z.string(),
    data: z.unknown(),
    hint: z.string().optional(),
    meta: AprMetaSchema.optional(),
  })
  .passthrough();

const AprStatusSchema = z
  .object({
    configured: z.boolean(),
    default_workflow: z.string(),
    workflow_count: z.number(),
    workflows: z.array(z.string()),
    oracle_available: z.boolean(),
    oracle_method: z.string(),
    config_dir: z.string(),
    apr_home: z.string(),
  })
  .passthrough();

const AprWorkflowSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    path: z.string(),
    rounds: z.number(),
    last_run: z.string().optional(),
  })
  .passthrough();

const AprMetricsSchema = z
  .object({
    word_count: z.number(),
    section_count: z.number(),
    code_block_count: z.number(),
    convergence_score: z.number().optional(),
  })
  .passthrough();

const AprRoundSchema = z
  .object({
    round: z.number(),
    workflow: z.string(),
    status: z.enum(["pending", "running", "completed", "failed"]),
    created_at: z.string().optional(),
    completed_at: z.string().optional(),
    content: z.string().optional(),
    metrics: AprMetricsSchema.optional(),
  })
  .passthrough();

const AprDiffSchema = z
  .object({
    round_a: z.number(),
    round_b: z.number(),
    workflow: z.string(),
    additions: z.number(),
    deletions: z.number(),
    changes: z.array(z.string()),
  })
  .passthrough();

const AprIntegrationSchema = z
  .object({
    round: z.number(),
    workflow: z.string(),
    prompt: z.string(),
    include_impl: z.boolean(),
  })
  .passthrough();

const AprHistorySchema = z
  .object({
    workflow: z.string(),
    rounds: z.array(AprRoundSchema),
    total: z.number(),
  })
  .passthrough();

const AprWorkflowsResponseSchema = z
  .object({
    workflows: z.array(AprWorkflowSchema).optional(),
  })
  .passthrough();

const AprStatsSchema = AprMetricsSchema.and(
  z
    .object({
      convergence_trend: z.array(z.number()).optional(),
    })
    .passthrough(),
);

// ============================================================================
// Exported Types
// ============================================================================

export type AprMeta = z.infer<typeof AprMetaSchema>;
export type AprEnvelope = z.infer<typeof AprEnvelopeSchema>;
export type AprStatus = z.infer<typeof AprStatusSchema>;
export type AprWorkflow = z.infer<typeof AprWorkflowSchema>;
export type AprMetrics = z.infer<typeof AprMetricsSchema>;
export type AprRound = z.infer<typeof AprRoundSchema>;
export type AprDiff = z.infer<typeof AprDiffSchema>;
export type AprIntegration = z.infer<typeof AprIntegrationSchema>;
export type AprHistory = z.infer<typeof AprHistorySchema>;
export type AprStats = z.infer<typeof AprStatsSchema>;

// ============================================================================
// Options Types
// ============================================================================

export interface AprCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface AprWorkflowOptions extends AprCommandOptions {
  workflow?: string;
}

export interface AprRoundOptions extends AprCommandOptions {
  workflow?: string;
  includeImpl?: boolean;
}

export interface AprRunOptions extends AprCommandOptions {
  workflow?: string;
  timeout?: number;
}

export interface AprDiffOptions extends AprCommandOptions {
  workflow?: string;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface AprClient {
  /** Check if apr CLI is available */
  isAvailable: () => Promise<boolean>;

  /** Get apr CLI version */
  getVersion: () => Promise<string | null>;

  /** Get system status */
  getStatus: (options?: AprCommandOptions) => Promise<AprStatus>;

  /** List workflows */
  listWorkflows: (options?: AprCommandOptions) => Promise<AprWorkflow[]>;

  /** Get round details */
  getRound: (round: number, options?: AprRoundOptions) => Promise<AprRound>;

  /** Validate round */
  validateRound: (
    round: number,
    options?: AprWorkflowOptions,
  ) => Promise<{ valid: boolean; issues?: string[] }>;

  /** Run a revision round */
  runRound: (round: number, options?: AprRunOptions) => Promise<AprRound>;

  /** Get history */
  getHistory: (options?: AprWorkflowOptions) => Promise<AprHistory>;

  /** Diff rounds */
  diffRounds: (
    roundA: number,
    roundB?: number,
    options?: AprDiffOptions,
  ) => Promise<AprDiff>;

  /** Get integration prompt */
  getIntegrationPrompt: (
    round: number,
    options?: AprRoundOptions,
  ) => Promise<AprIntegration>;

  /** Get stats */
  getStats: (options?: AprWorkflowOptions) => Promise<AprStats>;
}

// ============================================================================
// Implementation Helpers
// ============================================================================

function parseJson<T>(
  stdout: string,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new AprClientError("parse_error", `Failed to parse APR ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AprClientError(
      "validation_error",
      `Invalid APR ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function ensureOk(envelope: AprEnvelope, context: string): void {
  if (!envelope.ok) {
    throw new AprClientError("command_failed", `APR ${context} failed`, {
      code: envelope.code,
      hint: envelope.hint,
    });
  }
}

function parseData<T>(
  envelope: AprEnvelope,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  const result = schema.safeParse(envelope.data);
  if (!result.success) {
    throw new AprClientError(
      "validation_error",
      `Invalid APR ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }
  return result.data;
}

async function runAprCommand(
  runner: AprCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<AprEnvelope> {
  const result = await runner.run("apr", ["robot", ...args], options);
  if (result.exitCode !== 0) {
    throw new AprClientError("command_failed", "APR command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr,
      args,
    });
  }

  return parseJson(result.stdout, AprEnvelopeSchema, "response");
}

function buildWorkflowArgs(options?: AprWorkflowOptions): string[] {
  const args: string[] = [];
  if (options?.workflow) {
    args.push("-w", options.workflow);
  }
  return args;
}

function buildRoundArgs(options?: AprRoundOptions): string[] {
  const args = buildWorkflowArgs(options);
  if (options?.includeImpl) {
    args.push("-i");
  }
  return args;
}

function buildRunOptions(
  options: AprClientOptions,
  override?: AprCommandOptions,
  fallbackTimeout?: number,
): { cwd?: string; timeout?: number } {
  return {
    cwd: override?.cwd ?? options.cwd,
    timeout: override?.timeout ?? fallbackTimeout ?? options.timeout,
  };
}

// ============================================================================
// Client Factory
// ============================================================================

export function createAprClient(options: AprClientOptions): AprClient {
  const defaultTimeout = options.timeout ?? 60000;

  return {
    isAvailable: async () => {
      try {
        const result = await options.runner.run("apr", ["--version"], {
          ...buildRunOptions(options, { timeout: 5000 }),
        });
        return result.exitCode === 0 || result.stdout.includes("v");
      } catch {
        return false;
      }
    },

    getVersion: async () => {
      try {
        const result = await options.runner.run("apr", ["--version"], {
          ...buildRunOptions(options, { timeout: 5000 }),
        });
        if (result.exitCode !== 0) return null;
        const match = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
        return match?.[1] ?? null;
      } catch {
        return null;
      }
    },

    getStatus: async (opts) => {
      const envelope = await runAprCommand(
        options.runner,
        ["status"],
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "status");
      return parseData(envelope, AprStatusSchema, "status");
    },

    listWorkflows: async (opts) => {
      const envelope = await runAprCommand(
        options.runner,
        ["workflows"],
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "workflows");
      const data = parseData(envelope, AprWorkflowsResponseSchema, "workflows");
      return data.workflows ?? [];
    },

    getRound: async (round, opts) => {
      const args = ["show", String(round), ...buildRoundArgs(opts)];
      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "show");
      return parseData(envelope, AprRoundSchema, "show");
    },

    validateRound: async (round, opts) => {
      const args = ["validate", String(round), ...buildWorkflowArgs(opts)];
      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, defaultTimeout),
      );

      if (!envelope.ok) {
        const data = envelope.data as { issues?: string[] } | undefined;
        return {
          valid: false,
          issues: data?.issues ?? [envelope.hint ?? envelope.code],
        };
      }

      return { valid: true };
    },

    runRound: async (round, opts) => {
      const args = ["run", String(round), ...buildWorkflowArgs(opts)];
      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, 600000),
      );
      ensureOk(envelope, "run");
      return parseData(envelope, AprRoundSchema, "run");
    },

    getHistory: async (opts) => {
      const args = ["history", ...buildWorkflowArgs(opts)];
      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "history");
      return parseData(envelope, AprHistorySchema, "history");
    },

    diffRounds: async (roundA, roundB, opts) => {
      const args = ["diff", String(roundA)];
      if (roundB !== undefined) args.push(String(roundB));
      args.push(...buildWorkflowArgs(opts));

      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "diff");
      return parseData(envelope, AprDiffSchema, "diff");
    },

    getIntegrationPrompt: async (round, opts) => {
      const args = ["integrate", String(round), ...buildRoundArgs(opts)];
      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "integrate");
      return parseData(envelope, AprIntegrationSchema, "integrate");
    },

    getStats: async (opts) => {
      const args = ["stats", ...buildWorkflowArgs(opts)];
      const envelope = await runAprCommand(
        options.runner,
        args,
        buildRunOptions(options, opts, defaultTimeout),
      );
      ensureOk(envelope, "stats");
      return parseData(envelope, AprStatsSchema, "stats");
    },
  };
}

// ============================================================================
// Default Command Runner (Bun subprocess)
// ============================================================================

/**
 * Create a command runner that uses Bun.spawn for subprocess execution.
 */
export function createBunCommandRunner(): AprCommandRunner {
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
            throw new AprClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 60000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new AprClientError(
              "unavailable",
              "APR command failed to start",
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
