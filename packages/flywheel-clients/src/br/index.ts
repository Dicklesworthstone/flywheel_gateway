/**
 * br (Beads) Client
 *
 * Provides typed access to the br CLI for issue tracking.
 * Always uses --json output and supports auto-import/flush controls.
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

export interface BrCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BrCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<BrCommandResult>;
}

export interface BrClientOptions {
  runner: BrCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Default DB path override */
  db?: string;
  /** Default actor name for audit trail */
  actor?: string;
  /** Disable auto-import (default: false) */
  autoImport?: boolean;
  /** Disable auto-flush (default: false) */
  autoFlush?: boolean;
  /** Allow stale DB (default: false) */
  allowStale?: boolean;
  /** SQLite busy timeout in ms */
  lockTimeoutMs?: number;
  /** JSONL-only mode (no DB connection) */
  noDb?: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

export class BrClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "BrClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const BrDependencySchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    status: z.string().optional(),
    priority: z.number().optional(),
    dep_type: z.string().optional(),
  })
  .passthrough();

const BrIssueSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.number().optional(),
    issue_type: z.string().optional(),
    created_at: z.string().optional(),
    created_by: z.string().optional(),
    updated_at: z.string().optional(),
    closed_at: z.string().optional(),
    due_at: z.string().optional(),
    defer_until: z.string().optional(),
    assignee: z.string().optional(),
    owner: z.string().optional(),
    labels: z.array(z.string()).optional(),
    dependency_count: z.number().optional(),
    dependent_count: z.number().optional(),
    dependencies: z.array(BrDependencySchema).optional(),
    dependents: z.array(BrDependencySchema).optional(),
    parent: z.string().optional(),
    external_ref: z.string().optional(),
    compaction_level: z.number().optional(),
    original_size: z.number().optional(),
  })
  .passthrough();

const BrIssueListSchema = z.array(BrIssueSchema);

const BrSyncStatusSchema = z
  .object({
    dirty_count: z.number().optional(),
    last_export_time: z.string().optional(),
    last_import_time: z.string().optional(),
    jsonl_content_hash: z.string().optional(),
    jsonl_exists: z.boolean().optional(),
    jsonl_newer: z.boolean().optional(),
    db_newer: z.boolean().optional(),
  })
  .passthrough();

const BrSyncResultSchema = z.object({}).passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type BrDependency = z.infer<typeof BrDependencySchema>;
export type BrIssue = z.infer<typeof BrIssueSchema>;
export type BrSyncStatus = z.infer<typeof BrSyncStatusSchema>;
export type BrSyncResult = z.infer<typeof BrSyncResultSchema>;

// ============================================================================
// Options Types
// ============================================================================

export interface BrCommandOptions {
  cwd?: string;
  timeout?: number;
  db?: string;
  actor?: string;
  autoImport?: boolean;
  autoFlush?: boolean;
  allowStale?: boolean;
  lockTimeoutMs?: number;
  noDb?: boolean;
}

export interface BrReadyOptions extends BrCommandOptions {
  limit?: number;
  assignee?: string;
  unassigned?: boolean;
  labels?: string[];
  labelsAny?: string[];
  types?: string[];
  priorities?: Array<number | string>;
  sort?: "hybrid" | "priority" | "oldest";
  includeDeferred?: boolean;
}

export interface BrListOptions extends BrCommandOptions {
  statuses?: string[];
  types?: string[];
  assignee?: string;
  unassigned?: boolean;
  ids?: string[];
  labels?: string[];
  labelsAny?: string[];
  priorities?: Array<number | string>;
  priorityMin?: number;
  priorityMax?: number;
  titleContains?: string;
  descContains?: string;
  notesContains?: string;
  all?: boolean;
  limit?: number;
  sort?: "priority" | "created_at" | "updated_at" | "title";
  reverse?: boolean;
  deferred?: boolean;
  overdue?: boolean;
}

export interface BrCreateInput {
  title?: string;
  type?: string;
  priority?: number | string;
  description?: string;
  assignee?: string;
  owner?: string;
  labels?: string[];
  parent?: string;
  deps?: string[] | string;
  estimateMinutes?: number;
  due?: string;
  defer?: string;
  externalRef?: string;
  ephemeral?: boolean;
  dryRun?: boolean;
}

export interface BrUpdateInput {
  title?: string;
  description?: string;
  design?: string;
  acceptanceCriteria?: string;
  notes?: string;
  status?: string;
  priority?: number | string;
  type?: string;
  assignee?: string;
  owner?: string;
  claim?: boolean;
  due?: string;
  defer?: string;
  estimateMinutes?: number;
  addLabels?: string[];
  removeLabels?: string[];
  setLabels?: string[];
  parent?: string;
  externalRef?: string;
  session?: string;
}

export interface BrCloseOptions extends BrCommandOptions {
  reason?: string;
  force?: boolean;
  suggestNext?: boolean;
  session?: string;
}

export interface BrSyncOptions extends BrCommandOptions {
  mode?: "status" | "flush-only" | "import-only" | "merge";
  force?: boolean;
  allowExternalJsonl?: boolean;
  manifest?: boolean;
  errorPolicy?: "strict" | "best-effort" | "partial" | "required-core";
  orphans?: "strict" | "resurrect" | "skip" | "allow";
}

// ============================================================================
// Client Interface
// ============================================================================

export interface BrClient {
  ready: (options?: BrReadyOptions) => Promise<BrIssue[]>;
  list: (options?: BrListOptions) => Promise<BrIssue[]>;
  show: (
    ids: string | string[],
    options?: BrCommandOptions,
  ) => Promise<BrIssue[]>;
  create: (
    input: BrCreateInput,
    options?: BrCommandOptions,
  ) => Promise<BrIssue>;
  update: (
    ids: string | string[],
    input: BrUpdateInput,
    options?: BrCommandOptions,
  ) => Promise<BrIssue[]>;
  close: (
    ids: string | string[],
    options?: BrCloseOptions,
  ) => Promise<BrIssue[]>;
  syncStatus: (options?: BrCommandOptions) => Promise<BrSyncStatus>;
  sync: (options?: BrSyncOptions) => Promise<BrSyncResult>;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new BrClientError("parse_error", `Failed to parse br ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new BrClientError("validation_error", `Invalid br ${context}`, {
      issues: result.error.issues,
    });
  }

  return result.data;
}

function parseIssueList(stdout: string, context: string): BrIssue[] {
  const payload = extractJsonPayload(stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new BrClientError("parse_error", `Failed to parse br ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const listResult = BrIssueListSchema.safeParse(parsed);
  if (listResult.success) {
    return listResult.data;
  }

  const singleResult = BrIssueSchema.safeParse(parsed);
  if (singleResult.success) {
    return [singleResult.data];
  }

  throw new BrClientError("validation_error", `Invalid br ${context}`, {
    issues: listResult.error.issues,
  });
}

function pushRepeated(
  args: string[],
  flag: string,
  values?: Array<string | number>,
) {
  if (!values || values.length === 0) return;
  for (const value of values) {
    args.push(flag, String(value));
  }
}

function buildGlobalArgs(
  defaults: BrClientOptions,
  overrides?: BrCommandOptions,
): string[] {
  const merged: BrCommandOptions = {
    db: defaults.db,
    actor: defaults.actor,
    autoImport: defaults.autoImport,
    autoFlush: defaults.autoFlush,
    allowStale: defaults.allowStale,
    lockTimeoutMs: defaults.lockTimeoutMs,
    noDb: defaults.noDb,
    ...overrides,
  };

  const args: string[] = [];
  if (merged.db) args.push("--db", merged.db);
  if (merged.actor) args.push("--actor", merged.actor);
  if (merged.autoImport === false) args.push("--no-auto-import");
  if (merged.autoFlush === false) args.push("--no-auto-flush");
  if (merged.allowStale) args.push("--allow-stale");
  if (merged.lockTimeoutMs !== undefined)
    args.push("--lock-timeout", String(merged.lockTimeoutMs));
  if (merged.noDb) args.push("--no-db");
  return args;
}

function buildRunOptions(
  defaults: BrClientOptions,
  overrides?: BrCommandOptions,
): { cwd?: string; timeout?: number } {
  const cwd = overrides?.cwd ?? defaults.cwd;
  const timeout = overrides?.timeout ?? defaults.timeout ?? 30000;
  const runOptions: { cwd?: string; timeout?: number } = { timeout };
  if (cwd !== undefined) runOptions.cwd = cwd;
  return runOptions;
}

async function runBrCommand(
  runner: BrCommandRunner,
  args: string[],
  runOptions: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("br", args, runOptions);
  if (result.exitCode !== 0) {
    throw new BrClientError("command_failed", "br command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr,
      args,
    });
  }
  return result.stdout;
}

// ============================================================================
// Implementation
// ============================================================================

export function createBrClient(options: BrClientOptions): BrClient {
  return {
    ready: async (opts) => {
      const args = ["ready", "--json"];
      if (opts?.limit !== undefined) args.push("--limit", String(opts.limit));
      if (opts?.assignee) args.push("--assignee", opts.assignee);
      if (opts?.unassigned) args.push("--unassigned");
      if (opts?.labels) pushRepeated(args, "--label", opts.labels);
      if (opts?.labelsAny) pushRepeated(args, "--label-any", opts.labelsAny);
      if (opts?.types) pushRepeated(args, "--type", opts.types);
      if (opts?.priorities) pushRepeated(args, "--priority", opts.priorities);
      if (opts?.sort) args.push("--sort", opts.sort);
      if (opts?.includeDeferred) args.push("--include-deferred");
      args.push(...buildGlobalArgs(options, opts));

      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseIssueList(stdout, "ready");
    },

    list: async (opts) => {
      const args = ["list", "--json"];
      if (opts?.statuses) pushRepeated(args, "--status", opts.statuses);
      if (opts?.types) pushRepeated(args, "--type", opts.types);
      if (opts?.assignee) args.push("--assignee", opts.assignee);
      if (opts?.unassigned) args.push("--unassigned");
      if (opts?.ids) pushRepeated(args, "--id", opts.ids);
      if (opts?.labels) pushRepeated(args, "--label", opts.labels);
      if (opts?.labelsAny) pushRepeated(args, "--label-any", opts.labelsAny);
      if (opts?.priorities) pushRepeated(args, "--priority", opts.priorities);
      if (opts?.priorityMin !== undefined)
        args.push("--priority-min", String(opts.priorityMin));
      if (opts?.priorityMax !== undefined)
        args.push("--priority-max", String(opts.priorityMax));
      if (opts?.titleContains)
        args.push("--title-contains", opts.titleContains);
      if (opts?.descContains) args.push("--desc-contains", opts.descContains);
      if (opts?.notesContains)
        args.push("--notes-contains", opts.notesContains);
      if (opts?.all) args.push("--all");
      if (opts?.limit !== undefined) args.push("--limit", String(opts.limit));
      if (opts?.sort) args.push("--sort", opts.sort);
      if (opts?.reverse) args.push("--reverse");
      if (opts?.deferred) args.push("--deferred");
      if (opts?.overdue) args.push("--overdue");
      args.push(...buildGlobalArgs(options, opts));

      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseIssueList(stdout, "list");
    },

    show: async (ids, opts) => {
      const idList = Array.isArray(ids) ? ids : [ids];
      const args = [
        "show",
        ...idList,
        "--json",
        ...buildGlobalArgs(options, opts),
      ];
      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseIssueList(stdout, "show");
    },

    create: async (input, opts) => {
      const args = ["create"];
      if (input.title) args.push(input.title);
      if (input.type) args.push("--type", input.type);
      if (input.priority !== undefined)
        args.push("--priority", String(input.priority));
      if (input.description) args.push("--description", input.description);
      if (input.assignee) args.push("--assignee", input.assignee);
      if (input.owner) args.push("--owner", input.owner);
      if (input.labels && input.labels.length > 0)
        args.push("--labels", input.labels.join(","));
      if (input.parent) args.push("--parent", input.parent);
      if (input.deps) {
        const deps = Array.isArray(input.deps) ? input.deps : [input.deps];
        args.push("--deps", deps.join(","));
      }
      if (input.estimateMinutes !== undefined)
        args.push("--estimate", String(input.estimateMinutes));
      if (input.due) args.push("--due", input.due);
      if (input.defer) args.push("--defer", input.defer);
      if (input.externalRef) args.push("--external-ref", input.externalRef);
      if (input.ephemeral) args.push("--ephemeral");
      if (input.dryRun) args.push("--dry-run");
      args.push("--json", ...buildGlobalArgs(options, opts));

      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, BrIssueSchema, "create");
    },

    update: async (ids, input, opts) => {
      const idList = Array.isArray(ids) ? ids : [ids];
      const args = ["update", ...idList];
      if (input.title) args.push("--title", input.title);
      if (input.description) args.push("--description", input.description);
      if (input.design) args.push("--design", input.design);
      if (input.acceptanceCriteria)
        args.push("--acceptance-criteria", input.acceptanceCriteria);
      if (input.notes) args.push("--notes", input.notes);
      if (input.status) args.push("--status", input.status);
      if (input.priority !== undefined)
        args.push("--priority", String(input.priority));
      if (input.type) args.push("--type", input.type);
      if (input.assignee !== undefined) args.push("--assignee", input.assignee);
      if (input.owner !== undefined) args.push("--owner", input.owner);
      if (input.claim) args.push("--claim");
      if (input.due !== undefined) args.push("--due", input.due);
      if (input.defer !== undefined) args.push("--defer", input.defer);
      if (input.estimateMinutes !== undefined)
        args.push("--estimate", String(input.estimateMinutes));
      if (input.addLabels && input.addLabels.length > 0)
        pushRepeated(args, "--add-label", input.addLabels);
      if (input.removeLabels && input.removeLabels.length > 0)
        pushRepeated(args, "--remove-label", input.removeLabels);
      if (input.setLabels && input.setLabels.length > 0)
        args.push("--set-labels", input.setLabels.join(","));
      if (input.parent !== undefined) args.push("--parent", input.parent);
      if (input.externalRef) args.push("--external-ref", input.externalRef);
      if (input.session) args.push("--session", input.session);
      args.push("--json", ...buildGlobalArgs(options, opts));

      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseIssueList(stdout, "update");
    },

    close: async (ids, opts) => {
      const idList = Array.isArray(ids) ? ids : [ids];
      const args = ["close", ...idList];
      if (opts?.reason) args.push("--reason", opts.reason);
      if (opts?.force) args.push("--force");
      if (opts?.suggestNext) args.push("--suggest-next");
      if (opts?.session) args.push("--session", opts.session);
      args.push("--json", ...buildGlobalArgs(options, opts));

      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseIssueList(stdout, "close");
    },

    syncStatus: async (opts) => {
      const args = [
        "sync",
        "--status",
        "--json",
        ...buildGlobalArgs(options, opts),
      ];
      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, BrSyncStatusSchema, "sync status");
    },

    sync: async (opts) => {
      const mode = opts?.mode ?? "flush-only";
      const args = ["sync"];
      if (mode === "status") args.push("--status");
      if (mode === "flush-only") args.push("--flush-only");
      if (mode === "import-only") args.push("--import-only");
      if (mode === "merge") args.push("--merge");
      if (opts?.force) args.push("--force");
      if (opts?.allowExternalJsonl) args.push("--allow-external-jsonl");
      if (opts?.manifest) args.push("--manifest");
      if (opts?.errorPolicy) args.push("--error-policy", opts.errorPolicy);
      if (opts?.orphans) args.push("--orphans", opts.orphans);
      args.push("--json", ...buildGlobalArgs(options, opts));

      const stdout = await runBrCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, BrSyncResultSchema, "sync");
    },
  };
}

// ============================================================================
// Default Command Runner (Bun subprocess)
// ============================================================================

/**
 * Create a command runner that uses Bun.spawn for subprocess execution.
 */
export function createBunCommandRunner(): BrCommandRunner {
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
            throw new BrClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new BrClientError(
              "unavailable",
              "br command failed to start",
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
