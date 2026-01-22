/**
 * CM (Cass-Memory) Client
 *
 * Provides typed access to the cm CLI for procedural memory operations.
 * Used for retrieving contextual rules and history for agent tasks.
 * Always uses --json flags to get machine-parseable output.
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

export interface CMCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CMCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<CMCommandResult>;
}

export interface CMClientOptions {
  runner: CMCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class CMClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "CMClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

// History snippet from CASS search results
const HistorySnippetSchema = z.object({
  source_path: z.string(),
  line_number: z.number(),
  agent: z.string(),
  workspace: z.string().optional(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  score: z.number().optional(),
  created_at: z.number().optional(),
  sessionPath: z.string().optional(),
  timestamp: z.string().optional(),
  origin: z
    .object({
      kind: z.enum(["local", "remote"]),
      host: z.string().optional(),
    })
    .optional(),
});

// Playbook bullet/rule
const PlaybookBulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string().optional(),
  scope: z.string().optional(),
  state: z.enum(["active", "deprecated", "pending"]).optional(),
  kind: z.enum(["rule", "anti-pattern", "procedure"]).optional(),
  confidence: z.number().optional(),
  sourceCount: z.number().optional(),
  lastApplied: z.string().optional(),
  helpfulCount: z.number().optional(),
  harmfulCount: z.number().optional(),
  score: z.number().optional(),
});

// Context response
const CMContextResultSchema = z.object({
  success: z.boolean(),
  task: z.string(),
  relevantBullets: z.array(PlaybookBulletSchema),
  antiPatterns: z.array(PlaybookBulletSchema),
  historySnippets: z.array(HistorySnippetSchema),
  deprecatedWarnings: z.array(z.string()).optional(),
  suggestedCassQueries: z.array(z.string()).optional(),
});

// Quickstart response
const CMQuickstartResultSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  oneCommand: z.string(),
  expectations: z.record(z.string(), z.string()),
  whatItReturns: z.array(z.string()),
  doNotDo: z.array(z.string()),
  protocol: z.record(z.string(), z.string()),
  examples: z.array(z.string()),
  operatorNote: z
    .object({
      automation: z.string().optional(),
      health: z.string().optional(),
    })
    .optional(),
  soloUser: z
    .object({
      description: z.string().optional(),
      manualReflection: z.array(z.string()).optional(),
      onboarding: z.array(z.string()).optional(),
    })
    .optional(),
  inlineFeedbackFormat: z
    .object({
      helpful: z.string().optional(),
      harmful: z.string().optional(),
    })
    .optional(),
});

// Stats response
const CMStatsResultSchema = z.object({
  success: z.boolean(),
  total: z.number(),
  byScope: z.record(z.string(), z.number()),
  byState: z.record(z.string(), z.number()),
  byKind: z.record(z.string(), z.number()),
  scoreDistribution: z.object({
    excellent: z.number(),
    good: z.number(),
    neutral: z.number(),
    atRisk: z.number(),
  }),
  topPerformers: z.array(PlaybookBulletSchema),
  mostHelpful: z.array(PlaybookBulletSchema),
  atRiskCount: z.number(),
  staleCount: z.number(),
  mergeCandidates: z.array(z.unknown()).optional(),
  semanticMergeCandidates: z.array(z.unknown()).optional(),
});

// Playbook list response
const CMPlaybookListResultSchema = z.object({
  success: z.boolean(),
  bullets: z.array(PlaybookBulletSchema),
});

// Doctor check item
const DoctorCheckSchema = z.object({
  category: z.string(),
  item: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  fix: z.string().optional(),
});

// Doctor response
const CMDoctorResultSchema = z.object({
  success: z.boolean(),
  version: z.string().optional(),
  generatedAt: z.string().optional(),
  overallStatus: z.enum(["healthy", "degraded", "unhealthy"]),
  checks: z.array(DoctorCheckSchema),
});

// Outcome response
const CMOutcomeResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  recorded: z.number().optional(),
});

// ============================================================================
// Exported Types
// ============================================================================

export type CMHistorySnippet = z.infer<typeof HistorySnippetSchema>;
export type CMPlaybookBullet = z.infer<typeof PlaybookBulletSchema>;
export type CMContextResult = z.infer<typeof CMContextResultSchema>;
export type CMQuickstartResult = z.infer<typeof CMQuickstartResultSchema>;
export type CMStatsResult = z.infer<typeof CMStatsResultSchema>;
export type CMPlaybookListResult = z.infer<typeof CMPlaybookListResultSchema>;
export type CMDoctorCheck = z.infer<typeof DoctorCheckSchema>;
export type CMDoctorResult = z.infer<typeof CMDoctorResultSchema>;
export type CMOutcomeResult = z.infer<typeof CMOutcomeResultSchema>;

// ============================================================================
// Options Types
// ============================================================================

export interface CMContextOptions {
  /** Filter by workspace */
  workspace?: string;
  /** Number of rules to show */
  top?: number;
  /** Number of history snippets */
  history?: number;
  /** Lookback days for history */
  days?: number;
  /** Optional session id for logging */
  session?: string;
  /** Log context usage for implicit feedback */
  logContext?: boolean;
}

export interface CMPlaybookListOptions {
  /** Filter by category */
  category?: string;
  /** Filter by scope */
  scope?: string;
  /** Filter by state */
  state?: "active" | "deprecated" | "pending";
  /** Filter by kind */
  kind?: "rule" | "anti-pattern" | "procedure";
  /** Limit results */
  limit?: number;
}

export interface CMDoctorOptions {
  /** Apply automatic fixes */
  fix?: boolean;
}

export interface CMOutcomeOptions {
  /** Session ID for the outcome */
  session?: string;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface CMClient {
  /** Get context (rules and history) for a task */
  context: (
    task: string,
    options?: CMContextOptions,
  ) => Promise<CMContextResult>;

  /** Get quickstart/self-documentation */
  quickstart: () => Promise<CMQuickstartResult>;

  /** Get playbook statistics */
  stats: () => Promise<CMStatsResult>;

  /** List playbook bullets/rules */
  listPlaybook: (
    options?: CMPlaybookListOptions,
  ) => Promise<CMPlaybookListResult>;

  /** Run health diagnostics */
  doctor: (options?: CMDoctorOptions) => Promise<CMDoctorResult>;

  /** Record session outcome for implicit feedback */
  outcome: (
    status: "success" | "failure" | "partial",
    ruleIds: string[],
    options?: CMOutcomeOptions,
  ) => Promise<CMOutcomeResult>;

  /** Check if cm is available (fast check) */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runCMCommand(
  runner: CMCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("cm", args, options);
  if (result.exitCode !== 0) {
    throw new CMClientError("command_failed", "CM command failed", {
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
    throw new CMClientError("parse_error", `Failed to parse CM ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new CMClientError(
      "validation_error",
      `Invalid CM ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

export function createCMClient(options: CMClientOptions): CMClient {
  const baseCwd = options.cwd;
  const defaultTimeout = options.timeout ?? 30000;

  const buildRunOptions = (
    timeout: number,
  ): { cwd?: string; timeout: number } => {
    const opts: { cwd?: string; timeout: number } = { timeout };
    if (baseCwd !== undefined) opts.cwd = baseCwd;
    return opts;
  };

  return {
    context: async (task, contextOpts) => {
      const args = ["context", task, "--json"];

      if (contextOpts?.workspace) {
        args.push("--workspace", contextOpts.workspace);
      }
      if (contextOpts?.top !== undefined) {
        args.push("--top", String(contextOpts.top));
      }
      if (contextOpts?.history !== undefined) {
        args.push("--history", String(contextOpts.history));
      }
      if (contextOpts?.days !== undefined) {
        args.push("--days", String(contextOpts.days));
      }
      if (contextOpts?.session) {
        args.push("--session", contextOpts.session);
      }
      if (contextOpts?.logContext) {
        args.push("--log-context");
      }

      const stdout = await runCMCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout),
      );
      return parseJson(stdout, CMContextResultSchema, "context");
    },

    quickstart: async () => {
      const args = ["quickstart", "--json"];
      const stdout = await runCMCommand(
        options.runner,
        args,
        buildRunOptions(10000),
      );
      return parseJson(stdout, CMQuickstartResultSchema, "quickstart");
    },

    stats: async () => {
      const args = ["stats", "--json"];
      const stdout = await runCMCommand(
        options.runner,
        args,
        buildRunOptions(15000),
      );
      return parseJson(stdout, CMStatsResultSchema, "stats");
    },

    listPlaybook: async (listOpts) => {
      const args = ["playbook", "list", "--json"];

      if (listOpts?.category) {
        args.push("--category", listOpts.category);
      }
      if (listOpts?.scope) {
        args.push("--scope", listOpts.scope);
      }
      if (listOpts?.state) {
        args.push("--state", listOpts.state);
      }
      if (listOpts?.kind) {
        args.push("--kind", listOpts.kind);
      }
      if (listOpts?.limit !== undefined) {
        args.push("--limit", String(listOpts.limit));
      }

      const stdout = await runCMCommand(
        options.runner,
        args,
        buildRunOptions(15000),
      );
      return parseJson(stdout, CMPlaybookListResultSchema, "playbook list");
    },

    doctor: async (doctorOpts) => {
      const args = ["doctor", "--json"];

      if (doctorOpts?.fix) {
        args.push("--fix");
      }

      const stdout = await runCMCommand(
        options.runner,
        args,
        buildRunOptions(60000), // Doctor can take longer
      );
      return parseJson(stdout, CMDoctorResultSchema, "doctor");
    },

    outcome: async (status, ruleIds, outcomeOpts) => {
      const args = ["outcome", status, ruleIds.join(","), "--json"];

      if (outcomeOpts?.session) {
        args.push("--session", outcomeOpts.session);
      }

      const stdout = await runCMCommand(
        options.runner,
        args,
        buildRunOptions(10000),
      );
      return parseJson(stdout, CMOutcomeResultSchema, "outcome");
    },

    isAvailable: async () => {
      try {
        const runOpts = buildRunOptions(5000);
        const result = await options.runner.run("cm", ["--version"], runOpts);
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
export function createBunCMCommandRunner(): CMCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 30000 });
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
            throw new CMClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new CMClientError(
              "unavailable",
              "CM command failed to start",
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
