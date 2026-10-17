/**
 * XF (X Find) Client
 *
 * Provides typed access to the xf CLI for searching X (Twitter) data archives.
 * Useful for agents to search tweets, likes, DMs, and Grok conversations
 * from a user's downloaded X archive.
 *
 * CLI: https://github.com/Dicklesworthstone/x_find
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

export interface XfCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface XfCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<XfCommandResult>;
}

export interface XfClientOptions {
  runner: XfCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Path to the database file */
  db?: string;
  /** Path to the search index directory */
  index?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class XfClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "XfClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

/** Data type for filtering searches */
const XfDataTypeSchema = z.enum(["tweet", "like", "dm", "grok", "all"]);

/** Archive statistics */
const XfStatsSchema = z
  .object({
    tweets_count: z.number(),
    likes_count: z.number(),
    dms_count: z.number(),
    dm_conversations_count: z.number().optional(),
    followers_count: z.number().optional(),
    following_count: z.number().optional(),
    blocks_count: z.number().optional(),
    mutes_count: z.number().optional(),
    grok_messages_count: z.number().optional(),
    first_tweet_date: z.string().optional(),
    last_tweet_date: z.string().optional(),
    index_built_at: z.string().optional(),
  })
  .passthrough();

/** Tweet search result */
const XfTweetResultSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    created_at: z.string().optional(),
    favorite_count: z.number().optional(),
    retweet_count: z.number().optional(),
    reply_to_user: z.string().optional(),
    reply_to_tweet: z.string().optional(),
    is_retweet: z.boolean().optional(),
    hashtags: z.array(z.string()).optional(),
    urls: z.array(z.string()).optional(),
    score: z.number().optional(),
  })
  .passthrough();

/** Like search result */
const XfLikeResultSchema = z
  .object({
    tweet_id: z.string(),
    full_text: z.string().optional(),
    liked_at: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();

/** DM search result */
const XfDmResultSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    sent_at: z.string().optional(),
    conversation_id: z.string().optional(),
    sender: z.string().optional(),
    recipient: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();

/** Grok message search result */
const XfGrokResultSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    created_at: z.string().optional(),
    role: z.string().optional(),
    conversation_id: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();

/** Generic search result (union type) */
const XfSearchResultSchema = z.union([
  XfTweetResultSchema,
  XfLikeResultSchema,
  XfDmResultSchema,
  XfGrokResultSchema,
]);

const XfSearchResultListSchema = z.array(XfSearchResultSchema);

// ============================================================================
// Exported Types
// ============================================================================

export type XfDataType = z.infer<typeof XfDataTypeSchema>;
export type XfStats = z.infer<typeof XfStatsSchema>;
export type XfTweetResult = z.infer<typeof XfTweetResultSchema>;
export type XfLikeResult = z.infer<typeof XfLikeResultSchema>;
export type XfDmResult = z.infer<typeof XfDmResultSchema>;
export type XfGrokResult = z.infer<typeof XfGrokResultSchema>;
export type XfSearchResult = z.infer<typeof XfSearchResultSchema>;

export interface XfStatus {
  available: boolean;
  version?: string;
  hasIndex: boolean;
  tweetsCount: number;
  likesCount: number;
  dmsCount: number;
  grokCount: number;
}

// ============================================================================
// Options Types
// ============================================================================

export interface XfCommandOptions {
  cwd?: string;
  timeout?: number;
  db?: string;
  index?: string;
}

export interface XfSearchOptions extends XfCommandOptions {
  /** Filter by data type */
  types?: XfDataType[];
  /** Maximum number of results */
  limit?: number;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface XfClient {
  /** Get archive statistics */
  stats: (options?: XfCommandOptions) => Promise<XfStats>;

  /** Search the archive */
  search: (
    query: string,
    options?: XfSearchOptions,
  ) => Promise<XfSearchResult[]>;

  /** Get overall status */
  status: (options?: XfCommandOptions) => Promise<XfStatus>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

function buildDbArgs(
  options: XfClientOptions,
  override?: XfCommandOptions,
): string[] {
  const args: string[] = [];
  const db = override?.db ?? options.db;
  const index = override?.index ?? options.index;
  if (db) args.push("--db", db);
  if (index) args.push("--index", index);
  return args;
}

async function runXfCommand(
  runner: XfCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("xf", args, options);
  if (result.exitCode !== 0) {
    throw new XfClientError("command_failed", "XF command failed", {
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
    throw new XfClientError("parse_error", `Failed to parse XF ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new XfClientError(
      "validation_error",
      `Invalid XF ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: XfClientOptions,
  override?: XfCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout ?? 30000;
  if (cwd !== undefined) result.cwd = cwd;
  result.timeout = timeout;
  return result;
}

async function getVersion(
  runner: XfCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("xf", ["--version"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from output (e.g., "xf 1.2.3" -> "1.2.3")
    const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createXfClient(options: XfClientOptions): XfClient {
  return {
    stats: async (opts) => {
      const args = ["stats", "--format", "json", ...buildDbArgs(options, opts)];
      const stdout = await runXfCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, XfStatsSchema, "stats");
    },

    search: async (query, opts) => {
      const args = [
        "search",
        query,
        "--format",
        "json",
        ...buildDbArgs(options, opts),
      ];

      if (opts?.types && opts.types.length > 0) {
        for (const type of opts.types) {
          args.push("-t", type);
        }
      }

      if (opts?.limit !== undefined) {
        args.push("-n", String(opts.limit));
      }

      const stdout = await runXfCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, XfSearchResultListSchema, "search");
    },

    status: async (opts): Promise<XfStatus> => {
      try {
        const [stats, version] = await Promise.all([
          createXfClient(options).stats(opts),
          getVersion(options.runner, opts?.cwd ?? options.cwd),
        ]);

        const status: XfStatus = {
          available: true,
          hasIndex: stats.index_built_at !== undefined,
          tweetsCount: stats.tweets_count,
          likesCount: stats.likes_count,
          dmsCount: stats.dms_count,
          grokCount: stats.grok_messages_count ?? 0,
        };
        if (version !== null) status.version = version;
        return status;
      } catch {
        return {
          available: false,
          hasIndex: false,
          tweetsCount: 0,
          likesCount: 0,
          dmsCount: 0,
          grokCount: 0,
        };
      }
    },

    isAvailable: async () => {
      try {
        const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
        if (options.cwd !== undefined) opts.cwd = options.cwd;
        const result = await options.runner.run("xf", ["--version"], opts);
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
export function createBunXfCommandRunner(): XfCommandRunner {
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
            throw new XfClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new XfClientError(
              "unavailable",
              "XF command failed to start",
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
