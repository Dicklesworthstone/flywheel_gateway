/**
 * XF (X Find) Service
 *
 * Provides access to the xf CLI for searching X (Twitter) data archives.
 * Useful for agents to search tweets, likes, DMs, and Grok conversations
 * from a user's downloaded X archive.
 *
 * CLI: https://github.com/Dicklesworthstone/x_find
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export type XfDataType = "tweet" | "like" | "dm" | "grok" | "all";

export interface XfStats {
  tweets_count: number;
  likes_count: number;
  dms_count: number;
  dm_conversations_count?: number;
  followers_count?: number;
  following_count?: number;
  blocks_count?: number;
  mutes_count?: number;
  grok_messages_count?: number;
  first_tweet_date?: string;
  last_tweet_date?: string;
  index_built_at?: string;
}

export interface XfTweetResult {
  id: string;
  text: string;
  created_at?: string;
  favorite_count?: number;
  retweet_count?: number;
  reply_to_user?: string;
  reply_to_tweet?: string;
  is_retweet?: boolean;
  hashtags?: string[];
  urls?: string[];
  score?: number;
}

export interface XfLikeResult {
  tweet_id: string;
  full_text?: string;
  liked_at?: string;
  score?: number;
}

export interface XfDmResult {
  id: string;
  text: string;
  sent_at?: string;
  conversation_id?: string;
  sender?: string;
  recipient?: string;
  score?: number;
}

export interface XfGrokResult {
  id: string;
  text: string;
  created_at?: string;
  role?: string;
  conversation_id?: string;
  score?: number;
}

export type XfSearchResult =
  | XfTweetResult
  | XfLikeResult
  | XfDmResult
  | XfGrokResult;

export interface XfSearchResponse {
  query: string;
  results: XfSearchResult[];
  total: number;
  took_ms: number;
  types_searched: XfDataType[];
}

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
// CLI Execution Helper
// ============================================================================

async function executeXfCommand(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number; db?: string; index?: string } = {},
): Promise<string> {
  const { timeout = 30000, maxOutputSize = 5 * 1024 * 1024, db, index } = options;
  const log = getLogger();

  try {
    const fullArgs = [...args];
    if (db) fullArgs.push("--db", db);
    if (index) fullArgs.push("--index", index);

    const proc = Bun.spawn(["xf", ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    // Set up timeout with cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    // Wait for command or timeout
    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        log.error(
          { exitCode, stderr, args },
          "xf command failed",
        );
        throw new Error(`xf command failed: ${stderr || "Unknown error"}`);
      }

      // Truncate if needed
      return stdout.length > maxOutputSize
        ? stdout.slice(0, maxOutputSize)
        : stdout;
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Failed to execute xf command");
  }
}

function parseJson<T>(output: string, context: string): T {
  const log = getLogger();
  try {
    return JSON.parse(output.trim()) as T;
  } catch {
    log.error(
      { output: output.slice(0, 200) },
      `Failed to parse xf ${context} output`,
    );
    throw new Error(`Failed to parse xf ${context} output as JSON`);
  }
}

// ============================================================================
// Detection
// ============================================================================

export async function isXfAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["xf", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function getXfVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["xf", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Extract version from output
    const versionMatch = stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Stats Functions
// ============================================================================

/**
 * Get archive statistics.
 */
export async function getStats(
  options: { db?: string; index?: string } = {},
): Promise<XfStats> {
  const output = await executeXfCommand(["stats", "--format", "json"], options);
  return parseJson<XfStats>(output, "stats");
}

/**
 * Get overall status.
 */
export async function getStatus(
  options: { db?: string; index?: string } = {},
): Promise<XfStatus> {
  try {
    const [stats, version] = await Promise.all([
      getStats(options),
      getXfVersion(),
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
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Search the archive.
 */
export async function search(
  query: string,
  options: {
    types?: XfDataType[];
    limit?: number;
    db?: string;
    index?: string;
  } = {},
): Promise<XfSearchResponse> {
  const args = ["search", query, "--format", "json"];

  if (options.types && options.types.length > 0) {
    for (const type of options.types) {
      args.push("-t", type);
    }
  }

  if (options.limit !== undefined) {
    args.push("-n", String(options.limit));
  }

  const startTime = Date.now();
  const output = await executeXfCommand(args, {
    db: options.db,
    index: options.index,
  });
  const took_ms = Date.now() - startTime;

  const results = parseJson<XfSearchResult[]>(output, "search");

  return {
    query,
    results,
    total: results.length,
    took_ms,
    types_searched: options.types ?? ["all"],
  };
}

// ============================================================================
// Service Interface
// ============================================================================

export interface XfService {
  /** Check if xf CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get xf CLI version */
  getVersion(): Promise<string | null>;

  /** Get archive statistics */
  getStats(options?: { db?: string; index?: string }): Promise<XfStats>;

  /** Get overall status */
  getStatus(options?: { db?: string; index?: string }): Promise<XfStatus>;

  /** Search the archive */
  search(
    query: string,
    options?: {
      types?: XfDataType[];
      limit?: number;
      db?: string;
      index?: string;
    },
  ): Promise<XfSearchResponse>;
}

export function createXfService(): XfService {
  return {
    isAvailable: isXfAvailable,
    getVersion: getXfVersion,
    getStats,
    getStatus,
    search,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: XfService | null = null;

export function getXfService(): XfService {
  if (!serviceInstance) {
    serviceInstance = createXfService();
  }
  return serviceInstance;
}
