/**
 * NTM (Named Tmux Manager) Robot Client
 *
 * Provides typed access to NTM robot-mode commands for orchestration.
 * Always sets --robot-format=json to guarantee machine-readable output.
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

export interface NtmCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface NtmCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<NtmCommandResult>;
}

export interface NtmClientOptions {
  runner: NtmCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class NtmClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "NtmClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const RobotResponseSchema = z
  .object({
    success: z.boolean(),
    timestamp: z.string(),
    error: z.string().optional(),
    error_code: z.string().optional(),
    hint: z.string().optional(),
  })
  .passthrough();

const RobotActionSchema = z.object({
  action: z.string(),
  target: z.string().optional(),
  reason: z.string().optional(),
});

const AgentHintsSchema = z
  .object({
    summary: z.string().optional(),
    suggested_actions: z.array(RobotActionSchema).optional(),
    warnings: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional(),
  })
  .passthrough();

const SystemInfoSchema = z.object({
  version: z.string(),
  commit: z.string(),
  build_date: z.string(),
  go_version: z.string(),
  os: z.string(),
  arch: z.string(),
  tmux_available: z.boolean(),
});

const AgentSchema = z
  .object({
    type: z.string(),
    variant: z.string().optional(),
    pane: z.string(),
    window: z.number(),
    pane_idx: z.number(),
    is_active: z.boolean(),
  })
  .passthrough();

const SessionInfoSchema = z
  .object({
    name: z.string(),
    exists: z.boolean(),
    attached: z.boolean().optional(),
    windows: z.number().optional(),
    panes: z.number().optional(),
    created_at: z.string().optional(),
    agents: z.array(AgentSchema).optional(),
  })
  .passthrough();

const StatusSummarySchema = z
  .object({
    total_sessions: z.number(),
    total_agents: z.number(),
    attached_count: z.number(),
    claude_count: z.number(),
    codex_count: z.number(),
    gemini_count: z.number(),
    cursor_count: z.number(),
    windsurf_count: z.number(),
    aider_count: z.number(),
  })
  .passthrough();

const StatusOutputSchema = z
  .object({
    generated_at: z.string(),
    system: SystemInfoSchema,
    sessions: z.array(SessionInfoSchema),
    summary: StatusSummarySchema,
  })
  .passthrough();

const ContextAgentInfoSchema = z.object({
  pane: z.string(),
  pane_idx: z.number(),
  agent_type: z.string(),
  model: z.string(),
  estimated_tokens: z.number(),
  with_overhead: z.number(),
  context_limit: z.number(),
  usage_percent: z.number(),
  usage_level: z.string(),
  confidence: z.string(),
  state: z.string(),
});

const ContextSummarySchema = z.object({
  total_agents: z.number(),
  high_usage_count: z.number(),
  avg_usage: z.number(),
});

const ContextPendingRotationSchema = z.object({
  agent_id: z.string(),
  session_name: z.string(),
  pane_id: z.string(),
  context_percent: z.number(),
  created_at: z.string(),
  timeout_at: z.string(),
  default_action: z.string(),
  work_dir: z.string().optional(),
});

const ContextAgentHintsSchema = z
  .object({
    low_usage_agents: z.array(z.string()).optional(),
    high_usage_agents: z.array(z.string()).optional(),
    suggestions: z.array(z.string()).optional(),
  })
  .passthrough();

const ContextOutputSchema = RobotResponseSchema.and(
  z
    .object({
      session: z.string(),
      captured_at: z.string(),
      agents: z.array(ContextAgentInfoSchema),
      summary: ContextSummarySchema,
      pending_rotations: z.array(ContextPendingRotationSchema).optional(),
      _agent_hints: ContextAgentHintsSchema.optional(),
    })
    .passthrough(),
);

const FileChangeRecordSchema = z.object({
  timestamp: z.string(),
  path: z.string(),
  operation: z.string(),
  agents: z.array(z.string()),
  session: z.string(),
  size_bytes: z.number().optional(),
  lines_added: z.number().optional(),
  lines_removed: z.number().optional(),
});

const FileConflictSchema = z.object({
  path: z.string(),
  agents: z.array(z.string()),
  severity: z.string(),
  first_edit: z.string(),
  last_edit: z.string(),
});

const FileChangesSummarySchema = z.object({
  total_changes: z.number(),
  unique_files: z.number(),
  by_agent: z.record(z.string(), z.number()),
  by_operation: z.record(z.string(), z.number()),
  most_active_agent: z.string().optional(),
  conflicts: z.array(FileConflictSchema).optional(),
});

const FilesOutputSchema = RobotResponseSchema.and(
  z
    .object({
      session: z.string().optional(),
      time_window: z.string(),
      count: z.number(),
      changes: z.array(FileChangeRecordSchema),
      summary: FileChangesSummarySchema,
      _agent_hints: AgentHintsSchema.optional(),
    })
    .passthrough(),
);

const MetricsTokenUsageSchema = z.object({
  total_tokens: z.number(),
  total_cost_usd: z.number(),
  by_agent: z.record(z.string(), z.number()),
  by_model: z.record(z.string(), z.number()),
  context_current_percent: z.record(z.string(), z.number()),
});

const AgentMetricsSchema = z.object({
  type: z.string(),
  prompts_received: z.number(),
  tokens_used: z.number(),
  avg_response_time_sec: z.number(),
  error_count: z.number(),
  restart_count: z.number(),
  uptime: z.string(),
});

const SessionMetricsSchema = z.object({
  total_prompts: z.number(),
  total_agents: z.number(),
  active_agents: z.number(),
  session_duration: z.string(),
  files_changed: z.number(),
  commits: z.number().optional(),
});

const MetricsOutputSchema = RobotResponseSchema.and(
  z
    .object({
      session: z.string().optional(),
      period: z.string(),
      token_usage: MetricsTokenUsageSchema,
      agent_stats: z.record(z.string(), AgentMetricsSchema),
      session_stats: SessionMetricsSchema,
      _agent_hints: AgentHintsSchema.optional(),
    })
    .passthrough(),
);

const PaneOutputSchema = z.object({
  type: z.string(),
  state: z.string(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
});

const TailAgentHintsSchema = z
  .object({
    idle_agents: z.array(z.string()).optional(),
    active_agents: z.array(z.string()).optional(),
    suggestions: z.array(z.string()).optional(),
  })
  .passthrough();

const TailOutputSchema = RobotResponseSchema.and(
  z
    .object({
      session: z.string(),
      captured_at: z.string(),
      panes: z.record(z.string(), PaneOutputSchema),
      _agent_hints: TailAgentHintsSchema.optional(),
    })
    .passthrough(),
);

const SnapshotAgentSchema = z
  .object({
    pane: z.string(),
    type: z.string(),
    variant: z.string().optional(),
    type_confidence: z.number(),
    type_method: z.string(),
    state: z.string(),
    last_output_age_sec: z.number(),
    output_tail_lines: z.number(),
    current_bead: z.string().nullable().optional(),
    pending_mail: z.number(),
  })
  .passthrough();

const SnapshotSessionSchema = z
  .object({
    name: z.string(),
    attached: z.boolean(),
    agents: z.array(SnapshotAgentSchema),
  })
  .passthrough();

const NtmAlertSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    severity: z.enum(["info", "warning", "error", "critical"]),
    message: z.string(),
    session: z.string().optional(),
    pane: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    created_at: z.string(),
    duration_ms: z.number().optional(),
    count: z.number().optional(),
  })
  .passthrough();

const NtmAlertSummarySchema = z
  .object({
    total_active: z.number(),
    by_severity: z.record(z.string(), z.number()).optional(),
    by_type: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

const SnapshotOutputSchema = z
  .object({
    ts: z.string(),
    sessions: z.array(SnapshotSessionSchema),
    alerts: z.array(NtmAlertSchema),
    alert_summary: NtmAlertSummarySchema.optional(),
  })
  .passthrough();

const SnapshotChangeSchema = z.object({
  type: z.string(),
  session: z.string().optional(),
  pane: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const SnapshotDeltaOutputSchema = z
  .object({
    ts: z.string(),
    since: z.string(),
    changes: z.array(SnapshotChangeSchema),
  })
  .passthrough();

const HealthSystemSchema = z.object({
  tmux_ok: z.boolean(),
  disk_free_gb: z.number(),
  load_avg: z.number(),
});

const SessionHealthAgentSchema = z.object({
  pane: z.number(),
  agent_type: z.string(),
  health: z.string(),
  idle_since_seconds: z.number(),
  restarts: z.number(),
  last_error: z.string().optional(),
  rate_limit_count: z.number(),
  backoff_remaining: z.number(),
  confidence: z.number(),
});

const SessionHealthSummarySchema = z.object({
  total: z.number(),
  healthy: z.number(),
  degraded: z.number(),
  unhealthy: z.number(),
  rate_limited: z.number(),
});

const SessionHealthOutputSchema = z
  .object({
    success: z.boolean(),
    session: z.string(),
    checked_at: z.string(),
    agents: z.array(SessionHealthAgentSchema),
    summary: SessionHealthSummarySchema,
    error: z.string().optional(),
  })
  .passthrough();

const ProjectHealthOutputSchema = z
  .object({
    checked_at: z.string(),
    system: HealthSystemSchema,
    sessions: z.record(
      z.string(),
      z.object({
        healthy: z.boolean(),
        agents: z.record(
          z.string(),
          z.object({
            responsive: z.boolean(),
            output_rate: z.string(),
            last_activity_sec: z.number(),
            issue: z.string().optional(),
          }),
        ),
      }),
    ),
    alerts: z.array(z.string()),
    bv_available: z.boolean(),
    bd_available: z.boolean(),
    error: z.string().optional(),
    drift_status: z.string().optional(),
    drift_message: z.string().optional(),
    ready_count: z.number(),
    in_progress_count: z.number(),
    blocked_count: z.number(),
  })
  .passthrough();

const IsWorkingQuerySchema = z.object({
  agents_requested: z.array(z.string()),
  lines_captured: z.number(),
});

const WorkIndicatorsSchema = z
  .object({
    work: z.array(z.string()),
    limit: z.array(z.string()),
  })
  .passthrough();

const AgentWorkStatusSchema = z
  .object({
    agent_type: z.string(),
    is_working: z.boolean(),
    is_idle: z.boolean(),
    is_rate_limited: z.boolean(),
    is_context_low: z.boolean(),
    context_remaining: z.number().optional(),
    confidence: z.number(),
    indicators: WorkIndicatorsSchema,
    recommendation: z.string(),
    recommendation_reason: z.string(),
    raw_sample: z.string().optional(),
  })
  .passthrough();

const IsWorkingSummarySchema = z.object({
  total_agents: z.number(),
  working_count: z.number(),
  idle_count: z.number(),
  rate_limited_count: z.number(),
  context_low_count: z.number(),
  error_count: z.number(),
  by_recommendation: z.record(z.string(), z.array(z.string())),
});

const IsWorkingOutputSchema = RobotResponseSchema.and(
  z
    .object({
      query: IsWorkingQuerySchema,
      agents: z.record(z.string(), AgentWorkStatusSchema),
      summary: IsWorkingSummarySchema,
    })
    .passthrough(),
);

// ============================================================================
// Exported Types
// ============================================================================

export type NtmStatusOutput = z.infer<typeof StatusOutputSchema>;
export type NtmContextOutput = z.infer<typeof ContextOutputSchema>;
export type NtmFilesOutput = z.infer<typeof FilesOutputSchema>;
export type NtmMetricsOutput = z.infer<typeof MetricsOutputSchema>;
export type NtmTailOutput = z.infer<typeof TailOutputSchema>;
export type NtmSnapshotOutput = z.infer<typeof SnapshotOutputSchema>;
export type NtmSnapshotDeltaOutput = z.infer<typeof SnapshotDeltaOutputSchema>;
export type NtmSessionHealthOutput = z.infer<typeof SessionHealthOutputSchema>;
export type NtmProjectHealthOutput = z.infer<typeof ProjectHealthOutputSchema>;
export type NtmIsWorkingOutput = z.infer<typeof IsWorkingOutputSchema>;
export type NtmSnapshotResult = NtmSnapshotOutput | NtmSnapshotDeltaOutput;
export type NtmHealthResult = NtmSessionHealthOutput | NtmProjectHealthOutput;
export type NtmAlert = z.infer<typeof NtmAlertSchema>;
export type NtmAlertSummary = z.infer<typeof NtmAlertSummarySchema>;

// ============================================================================
// Client Options
// ============================================================================

export interface NtmContextOptions {
  lines?: number;
  cwd?: string;
}

export interface NtmFilesOptions {
  window?: string;
  limit?: number;
  cwd?: string;
}

export interface NtmMetricsOptions {
  period?: string;
  cwd?: string;
}

export interface NtmTailOptions {
  lines?: number;
  panes?: Array<string | number>;
  cwd?: string;
}

export interface NtmSnapshotOptions {
  since?: string;
  cwd?: string;
}

export interface NtmHealthOptions {
  cwd?: string;
}

export interface NtmIsWorkingOptions {
  agents?: string[];
  linesCaptured?: number;
  verbose?: boolean;
  cwd?: string;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface NtmClient {
  status: (options?: { cwd?: string }) => Promise<NtmStatusOutput>;
  context: (
    session: string,
    options?: NtmContextOptions,
  ) => Promise<NtmContextOutput>;
  files: (
    session: string,
    options?: NtmFilesOptions,
  ) => Promise<NtmFilesOutput>;
  metrics: (
    session: string,
    options?: NtmMetricsOptions,
  ) => Promise<NtmMetricsOutput>;
  snapshot: (options?: NtmSnapshotOptions) => Promise<NtmSnapshotResult>;
  tail: (session: string, options?: NtmTailOptions) => Promise<NtmTailOutput>;
  health: (
    session: string,
    options?: NtmHealthOptions,
  ) => Promise<NtmSessionHealthOutput>;
  isWorking: (options?: NtmIsWorkingOptions) => Promise<NtmIsWorkingOutput>;
  /** Returns true if ntm is available on PATH */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

const ROBOT_FORMAT_ARG = "--robot-format=json";

async function runNtmCommand(
  runner: NtmCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("ntm", args, options);
  if (result.exitCode !== 0) {
    const kind: CliErrorKind =
      result.exitCode === 2 ? "unavailable" : "command_failed";
    throw new NtmClientError(kind, "NTM command failed", {
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
    throw new NtmClientError("parse_error", `Failed to parse NTM ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new NtmClientError(
      "validation_error",
      `Invalid NTM ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

export function createNtmClient(options: NtmClientOptions): NtmClient {
  const baseCwd = options.cwd;
  const defaultTimeout = options.timeout ?? 30000;

  const buildRunOptions = (
    timeout: number,
    cwdOverride?: string,
  ): { cwd?: string; timeout: number } => {
    const opts: { cwd?: string; timeout: number } = { timeout };
    const cwd = cwdOverride ?? baseCwd;
    if (cwd !== undefined) opts.cwd = cwd;
    return opts;
  };

  return {
    status: async (opts) => {
      const stdout = await runNtmCommand(
        options.runner,
        ["--robot-status", ROBOT_FORMAT_ARG],
        buildRunOptions(10000, opts?.cwd),
      );
      return parseJson(stdout, StatusOutputSchema, "status");
    },

    context: async (session, contextOpts) => {
      const args = [`--robot-context=${session}`, ROBOT_FORMAT_ARG];
      if (contextOpts?.lines !== undefined) {
        args.push("--lines", String(contextOpts.lines));
      }
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, contextOpts?.cwd),
      );
      return parseJson(stdout, ContextOutputSchema, "context");
    },

    files: async (session, filesOpts) => {
      const args = [`--robot-files=${session}`, ROBOT_FORMAT_ARG];
      if (filesOpts?.window) {
        args.push("--files-window", filesOpts.window);
      }
      if (filesOpts?.limit !== undefined) {
        args.push("--files-limit", String(filesOpts.limit));
      }
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, filesOpts?.cwd),
      );
      return parseJson(stdout, FilesOutputSchema, "files");
    },

    metrics: async (session, metricsOpts) => {
      const args = [`--robot-metrics=${session}`, ROBOT_FORMAT_ARG];
      if (metricsOpts?.period) {
        args.push("--metrics-period", metricsOpts.period);
      }
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, metricsOpts?.cwd),
      );
      return parseJson(stdout, MetricsOutputSchema, "metrics");
    },

    snapshot: async (snapshotOpts) => {
      const args = ["--robot-snapshot", ROBOT_FORMAT_ARG];
      if (snapshotOpts?.since) {
        args.push("--since", snapshotOpts.since);
      }
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, snapshotOpts?.cwd),
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout) as unknown;
      } catch (error) {
        throw new NtmClientError(
          "parse_error",
          "Failed to parse NTM snapshot",
          {
            cause: error instanceof Error ? error.message : String(error),
            stdout: stdout.slice(0, 500),
          },
        );
      }

      const delta = SnapshotDeltaOutputSchema.safeParse(parsed);
      if (delta.success) return delta.data;

      const snapshot = SnapshotOutputSchema.safeParse(parsed);
      if (!snapshot.success) {
        throw new NtmClientError(
          "validation_error",
          "Invalid NTM snapshot response",
          { issues: snapshot.error.issues },
        );
      }
      return snapshot.data;
    },

    tail: async (session, tailOpts) => {
      const args = [`--robot-tail=${session}`, ROBOT_FORMAT_ARG];
      if (tailOpts?.lines !== undefined) {
        args.push("--lines", String(tailOpts.lines));
      }
      if (tailOpts?.panes && tailOpts.panes.length > 0) {
        args.push("--panes", tailOpts.panes.join(","));
      }
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, tailOpts?.cwd),
      );
      return parseJson(stdout, TailOutputSchema, "tail");
    },

    health: async (session, healthOpts) => {
      const args = [`--robot-health=${session}`, ROBOT_FORMAT_ARG];
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, healthOpts?.cwd),
      );
      return parseJson(stdout, SessionHealthOutputSchema, "health");
    },

    isWorking: async (workingOpts) => {
      const args = ["--robot-is-working", ROBOT_FORMAT_ARG];
      if (workingOpts?.agents && workingOpts.agents.length > 0) {
        args.push("--agents", workingOpts.agents.join(","));
      }
      if (workingOpts?.linesCaptured !== undefined) {
        args.push("--lines", String(workingOpts.linesCaptured));
      }
      if (workingOpts?.verbose) {
        args.push("--verbose");
      }
      const stdout = await runNtmCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout, workingOpts?.cwd),
      );
      return parseJson(stdout, IsWorkingOutputSchema, "is-working");
    },

    isAvailable: async () => {
      try {
        const runOpts = buildRunOptions(5000);
        // --version is a standard flag that should exit 0
        const result = await options.runner.run("ntm", ["--version"], runOpts);
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
export function createBunNtmCommandRunner(): NtmCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 30000 });
  return {
    run: async (command, args, options) => {
      try {
        const runOptions: { cwd?: string; timeoutMs?: number } = {};
        if (options?.cwd) runOptions.cwd = options.cwd;
        if (options?.timeout) runOptions.timeoutMs = options.timeout;
        const result = await runner.run(command, args, runOptions);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (error instanceof CliCommandError) {
          if (error.kind === "timeout") {
            throw new NtmClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new NtmClientError(
              "unavailable",
              "NTM command failed to start",
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
