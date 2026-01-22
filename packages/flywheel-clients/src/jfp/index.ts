/**
 * JFP (Jeffrey's Prompts) Client
 *
 * Provides typed access to the jfp CLI for curated AI prompts.
 * Prompts are organized by category and can be browsed, searched, and
 * retrieved for agent workflows.
 *
 * CLI: https://github.com/Dicklesworthstone/jeffreysprompts
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

export interface JfpCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface JfpCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<JfpCommandResult>;
}

export interface JfpClientOptions {
  runner: JfpCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class JfpClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "JfpClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const JfpPromptSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    author: z.string(),
    twitter: z.string().optional(),
    version: z.string(),
    featured: z.boolean(),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]),
    estimatedTokens: z.number(),
    created: z.string(),
    content: z.string(),
    whenToUse: z.array(z.string()).optional(),
    tips: z.array(z.string()).optional(),
  })
  .passthrough();

const JfpCategorySchema = z
  .object({
    name: z.string(),
    count: z.number(),
  })
  .passthrough();

const JfpListResponseSchema = z
  .object({
    prompts: z.array(JfpPromptSchema),
  })
  .passthrough();

const JfpCategoriesResponseSchema = z.array(JfpCategorySchema);

// Search response can be various shapes, we'll handle that
const JfpSearchResponseSchema = z.union([
  z
    .object({
      results: z.array(JfpPromptSchema),
    })
    .passthrough(),
  z
    .object({
      prompts: z.array(JfpPromptSchema),
    })
    .passthrough(),
  z.array(JfpPromptSchema),
]);

// Suggest response can also be various shapes
const JfpSuggestResponseSchema = z.union([
  z
    .object({
      suggestions: z.array(JfpPromptSchema),
    })
    .passthrough(),
  z
    .object({
      prompts: z.array(JfpPromptSchema),
    })
    .passthrough(),
  z.array(JfpPromptSchema),
]);

// ============================================================================
// Exported Types
// ============================================================================

export type JfpPrompt = z.infer<typeof JfpPromptSchema>;
export type JfpCategory = z.infer<typeof JfpCategorySchema>;

export interface JfpListResult {
  prompts: JfpPrompt[];
  total: number;
}

export interface JfpSearchResult {
  prompts: JfpPrompt[];
  query: string;
  total: number;
}

export interface JfpSuggestResult {
  suggestions: JfpPrompt[];
  task: string;
}

export interface JfpStatus {
  available: boolean;
  version?: string;
}

// ============================================================================
// Options Types
// ============================================================================

export interface JfpCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface JfpSearchOptions extends JfpCommandOptions {
  limit?: number;
  category?: string;
}

export interface JfpSuggestOptions extends JfpCommandOptions {
  limit?: number;
}

export interface JfpListOptions extends JfpCommandOptions {
  limit?: number;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface JfpClient {
  /** Get overall status including version */
  status: (options?: JfpCommandOptions) => Promise<JfpStatus>;

  /** List all prompts */
  list: (options?: JfpListOptions) => Promise<JfpListResult>;

  /** Get a specific prompt by ID */
  get: (id: string, options?: JfpCommandOptions) => Promise<JfpPrompt | null>;

  /** List all categories with counts */
  listCategories: (options?: JfpCommandOptions) => Promise<JfpCategory[]>;

  /** Search prompts by query */
  search: (
    query: string,
    options?: JfpSearchOptions,
  ) => Promise<JfpSearchResult>;

  /** Suggest prompts for a task */
  suggest: (
    task: string,
    options?: JfpSuggestOptions,
  ) => Promise<JfpSuggestResult>;

  /** Get a random prompt */
  getRandom: (options?: JfpCommandOptions) => Promise<JfpPrompt | null>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runJfpCommand(
  runner: JfpCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("jfp", args, options);
  if (result.exitCode !== 0) {
    throw new JfpClientError("command_failed", "JFP command failed", {
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
    throw new JfpClientError("parse_error", `Failed to parse JFP ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new JfpClientError(
      "validation_error",
      `Invalid JFP ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: JfpClientOptions,
  override?: JfpCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout;
  if (cwd !== undefined) result.cwd = cwd;
  if (timeout !== undefined) result.timeout = timeout;
  return result;
}

async function getVersion(
  runner: JfpCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("jfp", ["--version"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from output (e.g., "jfp/1.2.3" or "jfp v1.2.3")
    const versionMatch = result.stdout.match(/(?:\/|v)?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract prompts array from various response shapes.
 * Type assertion needed because passthrough() interferes with TypeScript narrowing.
 */
function extractPrompts(
  response: z.infer<typeof JfpSearchResponseSchema>,
): JfpPrompt[] {
  if (Array.isArray(response)) {
    return response;
  }
  const obj = response as Record<string, unknown>;
  if ("results" in obj && Array.isArray(obj["results"])) {
    return obj["results"] as JfpPrompt[];
  }
  if ("prompts" in obj && Array.isArray(obj["prompts"])) {
    return obj["prompts"] as JfpPrompt[];
  }
  return [];
}

/**
 * Extract suggestions from various response shapes.
 * Type assertion needed because passthrough() interferes with TypeScript narrowing.
 */
function extractSuggestions(
  response: z.infer<typeof JfpSuggestResponseSchema>,
): JfpPrompt[] {
  if (Array.isArray(response)) {
    return response;
  }
  const obj = response as Record<string, unknown>;
  if ("suggestions" in obj && Array.isArray(obj["suggestions"])) {
    return obj["suggestions"] as JfpPrompt[];
  }
  if ("prompts" in obj && Array.isArray(obj["prompts"])) {
    return obj["prompts"] as JfpPrompt[];
  }
  return [];
}

export function createJfpClient(options: JfpClientOptions): JfpClient {
  return {
    status: async (opts): Promise<JfpStatus> => {
      try {
        const version = await getVersion(
          options.runner,
          opts?.cwd ?? options.cwd,
        );

        const status: JfpStatus = {
          available: true,
        };
        if (version !== null) status.version = version;
        return status;
      } catch {
        return {
          available: false,
        };
      }
    },

    list: async (opts) => {
      const args = ["list", "--json"];
      const stdout = await runJfpCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      const response = parseJson(stdout, JfpListResponseSchema, "list");
      const prompts = opts?.limit
        ? response.prompts.slice(0, opts.limit)
        : response.prompts;
      return {
        prompts,
        total: response.prompts.length,
      };
    },

    get: async (id, opts) => {
      try {
        const args = ["show", id, "--json"];
        const stdout = await runJfpCommand(
          options.runner,
          args,
          buildRunOptions(options, opts),
        );
        return parseJson(stdout, JfpPromptSchema, "show");
      } catch (error) {
        // Check if it's a "not found" error
        if (
          error instanceof JfpClientError &&
          error.kind === "command_failed"
        ) {
          const details = error.details as { stderr?: string } | undefined;
          const stderr = details?.stderr?.toLowerCase() ?? "";
          if (stderr.includes("not found") || stderr.includes("no prompt")) {
            return null;
          }
        }
        throw error;
      }
    },

    listCategories: async (opts) => {
      const args = ["categories", "--json"];
      const stdout = await runJfpCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, JfpCategoriesResponseSchema, "categories");
    },

    search: async (query, opts) => {
      const args = ["search", query, "--json"];

      if (opts?.limit !== undefined) {
        args.push("--limit", String(opts.limit));
      }

      const stdout = await runJfpCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      const response = parseJson(stdout, JfpSearchResponseSchema, "search");
      let prompts = extractPrompts(response);

      // Apply category filter locally if specified (CLI may not support it)
      if (opts?.category) {
        prompts = prompts.filter(
          (p) => p.category.toLowerCase() === opts.category!.toLowerCase(),
        );
      }

      return {
        prompts,
        query,
        total: prompts.length,
      };
    },

    suggest: async (task, opts) => {
      const args = ["suggest", task, "--json"];

      // Suggest can be slow (may call AI)
      const runOpts = buildRunOptions(options, opts);
      if (runOpts.timeout === undefined) {
        runOpts.timeout = 30000;
      }

      const stdout = await runJfpCommand(options.runner, args, runOpts);
      const response = parseJson(stdout, JfpSuggestResponseSchema, "suggest");
      let suggestions = extractSuggestions(response);

      if (opts?.limit !== undefined) {
        suggestions = suggestions.slice(0, opts.limit);
      }

      return {
        suggestions,
        task,
      };
    },

    getRandom: async (opts) => {
      try {
        const args = ["random", "--json"];
        const stdout = await runJfpCommand(
          options.runner,
          args,
          buildRunOptions(options, opts),
        );
        return parseJson(stdout, JfpPromptSchema, "random");
      } catch {
        return null;
      }
    },

    isAvailable: async () => {
      try {
        const version = await getVersion(options.runner, options.cwd);
        return version !== null;
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
export function createBunJfpCommandRunner(): JfpCommandRunner {
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
            throw new JfpClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 30000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new JfpClientError(
              "unavailable",
              "JFP command failed to start",
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
