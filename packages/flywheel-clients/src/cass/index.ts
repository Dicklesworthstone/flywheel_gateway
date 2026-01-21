/**
 * CASS (Cross-Agent Session Search) Client
 *
 * Provides typed access to the cass CLI for searching across agent session histories.
 * Always uses --json/--robot flags to avoid interactive TUI mode.
 */

import { CliClientError, type CliErrorDetails, type CliErrorKind } from "@flywheel/shared";
import { z } from "zod";
import {
  CliCommandError,
  createBunCliRunner as createSharedBunCliRunner,
} from "../cli-runner";

// ============================================================================
// Command Runner Interface
// ============================================================================

export interface CassCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CassCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<CassCommandResult>;
}

export interface CassClientOptions {
  runner: CassCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class CassClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "CassClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

// Health response
const CassHealthSchema = z.object({
  healthy: z.boolean(),
  latency_ms: z.number(),
  _meta: z
    .object({
      elapsed_ms: z.number().optional(),
      data_dir: z.string().optional(),
      db_path: z.string().optional(),
      index_freshness_seconds: z.number().optional(),
    })
    .optional(),
});

// Search hit
const CassSearchHitSchema = z.object({
  agent: z.string(),
  content: z.string().optional(),
  created_at: z.number().optional(),
  line_number: z.number(),
  match_type: z.string().optional(),
  origin_kind: z.string().optional(),
  score: z.number().optional(),
  snippet: z.string().optional(),
  source_id: z.string().optional(),
  source_path: z.string(),
  title: z.string().optional(),
  workspace: z.string().optional(),
});

// Search response
const CassSearchResultSchema = z.object({
  count: z.number(),
  cursor: z.string().nullable().optional(),
  hits: z.array(CassSearchHitSchema),
  hits_clamped: z.boolean().optional(),
  limit: z.number(),
  max_tokens: z.number().nullable().optional(),
  offset: z.number(),
  query: z.string(),
  request_id: z.string().nullable().optional(),
  total_matches: z.number(),
  _meta: z
    .object({
      elapsed_ms: z.number().optional(),
      wildcard_fallback: z.boolean().optional(),
    })
    .optional(),
});

// View response (session content at a line)
const CassViewResultSchema = z.object({
  path: z.string(),
  line_number: z.number(),
  context_before: z.array(z.string()).optional(),
  content: z.string(),
  context_after: z.array(z.string()).optional(),
  role: z.string().optional(),
  agent: z.string().optional(),
});

// Expand response (messages around a line)
const CassExpandMessageSchema = z.object({
  line_number: z.number(),
  role: z.string(),
  content: z.string(),
  timestamp: z.number().optional(),
});

const CassExpandResultSchema = z.object({
  path: z.string(),
  target_line: z.number(),
  messages: z.array(CassExpandMessageSchema),
  total_messages: z.number().optional(),
});

// ============================================================================
// Exported Types
// ============================================================================

export type CassHealth = z.infer<typeof CassHealthSchema>;
export type CassSearchHit = z.infer<typeof CassSearchHitSchema>;
export type CassSearchResult = z.infer<typeof CassSearchResultSchema>;
export type CassViewResult = z.infer<typeof CassViewResultSchema>;
export type CassExpandMessage = z.infer<typeof CassExpandMessageSchema>;
export type CassExpandResult = z.infer<typeof CassExpandResultSchema>;

// ============================================================================
// Search Options
// ============================================================================

export interface CassSearchOptions {
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by agent name */
  agent?: string | string[];
  /** Filter by workspace path */
  workspace?: string | string[];
  /** Filter to last N days */
  days?: number;
  /** Filter since ISO date */
  since?: string;
  /** Filter until ISO date */
  until?: string;
  /** Field set: 'minimal', 'summary', or comma-separated list */
  fields?: "minimal" | "summary" | string;
  /** Truncate content to max N characters */
  maxContentLength?: number;
  /** Soft token budget for output */
  maxTokens?: number;
  /** Request ID for correlation */
  requestId?: string;
  /** Search mode: lexical, semantic, or hybrid */
  mode?: "lexical" | "semantic" | "hybrid";
  /** Include match highlighting */
  highlight?: boolean;
  /** Include query explanation */
  explain?: boolean;
}

export interface CassViewOptions {
  /** Line number to view (1-indexed) */
  line: number;
  /** Context lines before/after (default: 5) */
  context?: number;
}

export interface CassExpandOptions {
  /** Line number to expand around (1-indexed) */
  line: number;
  /** Number of messages before/after (default: 3) */
  context?: number;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface CassClient {
  /** Check if cass is healthy and available */
  health: (options?: { includeMeta?: boolean }) => Promise<CassHealth>;

  /** Check if cass is available (fast health check) */
  isAvailable: () => Promise<boolean>;

  /** Search across agent sessions */
  search: (
    query: string,
    options?: CassSearchOptions,
  ) => Promise<CassSearchResult>;

  /** View content at a specific line in a session */
  view: (path: string, options: CassViewOptions) => Promise<CassViewResult>;

  /** Expand messages around a specific line in a session */
  expand: (
    path: string,
    options: CassExpandOptions,
  ) => Promise<CassExpandResult>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runCassCommand(
  runner: CassCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("cass", args, options);
  if (result.exitCode !== 0) {
    throw new CassClientError("command_failed", "CASS command failed", {
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
    throw new CassClientError(
      "parse_error",
      `Failed to parse CASS ${context}`,
      {
        cause: error instanceof Error ? error.message : String(error),
        stdout: stdout.slice(0, 500),
      },
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new CassClientError(
      "validation_error",
      `Invalid CASS ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildSearchArgs(query: string, options?: CassSearchOptions): string[] {
  const args = ["search", query, "--json"];

  if (options?.limit !== undefined) {
    args.push("--limit", String(options.limit));
  }
  if (options?.offset !== undefined) {
    args.push("--offset", String(options.offset));
  }
  if (options?.agent) {
    const agents = Array.isArray(options.agent)
      ? options.agent
      : [options.agent];
    for (const agent of agents) {
      args.push("--agent", agent);
    }
  }
  if (options?.workspace) {
    const workspaces = Array.isArray(options.workspace)
      ? options.workspace
      : [options.workspace];
    for (const ws of workspaces) {
      args.push("--workspace", ws);
    }
  }
  if (options?.days !== undefined) {
    args.push("--days", String(options.days));
  }
  if (options?.since) {
    args.push("--since", options.since);
  }
  if (options?.until) {
    args.push("--until", options.until);
  }
  if (options?.fields) {
    args.push("--fields", options.fields);
  }
  if (options?.maxContentLength !== undefined) {
    args.push("--max-content-length", String(options.maxContentLength));
  }
  if (options?.maxTokens !== undefined) {
    args.push("--max-tokens", String(options.maxTokens));
  }
  if (options?.requestId) {
    args.push("--request-id", options.requestId);
  }
  if (options?.mode) {
    args.push("--mode", options.mode);
  }
  if (options?.highlight) {
    args.push("--highlight");
  }
  if (options?.explain) {
    args.push("--explain");
  }

  return args;
}

export function createCassClient(options: CassClientOptions): CassClient {
  const baseCwd = options.cwd;
  const defaultTimeout = options.timeout ?? 30000;

  // Build run options, only including cwd if defined
  const buildRunOptions = (
    timeout: number,
  ): { cwd?: string; timeout: number } => {
    const opts: { cwd?: string; timeout: number } = { timeout };
    if (baseCwd !== undefined) opts.cwd = baseCwd;
    return opts;
  };

  return {
    health: async (opts) => {
      const args = ["health", "--json"];
      if (opts?.includeMeta) {
        args.push("--robot-meta");
      }

      try {
        const stdout = await runCassCommand(
          options.runner,
          args,
          buildRunOptions(5000), // Health check should be fast
        );
        return parseJson(stdout, CassHealthSchema, "health");
      } catch (error) {
        if (error instanceof CassClientError) {
          throw error;
        }
        throw new CassClientError("unavailable", "CASS is not available", {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    },

    isAvailable: async () => {
      try {
        const runOpts = buildRunOptions(5000);
        const result = await options.runner.run("cass", ["health"], runOpts);
        return result.exitCode === 0;
      } catch {
        return false;
      }
    },

    search: async (query, searchOpts) => {
      const args = buildSearchArgs(query, searchOpts);
      const stdout = await runCassCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout),
      );
      return parseJson(stdout, CassSearchResultSchema, "search");
    },

    view: async (path, viewOpts) => {
      const args = ["view", path, "--json", "-n", String(viewOpts.line)];
      if (viewOpts.context !== undefined) {
        args.push("-C", String(viewOpts.context));
      }

      const stdout = await runCassCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout),
      );
      return parseJson(stdout, CassViewResultSchema, "view");
    },

    expand: async (path, expandOpts) => {
      const args = [
        "expand",
        path,
        "--json",
        "--line",
        String(expandOpts.line),
      ];
      if (expandOpts.context !== undefined) {
        args.push("-C", String(expandOpts.context));
      }

      const stdout = await runCassCommand(
        options.runner,
        args,
        buildRunOptions(defaultTimeout),
      );
      return parseJson(stdout, CassExpandResultSchema, "expand");
    },
  };
}

// ============================================================================
// Default Command Runner (Bun subprocess)
// ============================================================================

/**
 * Create a command runner that uses Bun.spawn for subprocess execution.
 */
export function createBunCommandRunner(): CassCommandRunner {
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
            throw new CassClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new CassClientError(
              "unavailable",
              "CASS command failed to start",
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
