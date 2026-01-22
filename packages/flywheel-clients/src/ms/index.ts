/**
 * MS (Meta Skill) Client
 *
 * Provides typed access to the ms CLI for local-first knowledge management
 * with hybrid semantic search. Useful for agents to query skill repositories
 * and documentation.
 *
 * CLI: https://github.com/Dicklesworthstone/meta_skill
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

export interface MsCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface MsCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<MsCommandResult>;
}

export interface MsClientOptions {
  runner: MsCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 60000) */
  timeout?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class MsClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "MsClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const MsResponseMetaSchema = z
  .object({
    v: z.string(),
    ts: z.string(),
  })
  .passthrough();

const MsResponseSchema = z
  .object({
    ok: z.boolean(),
    code: z.string(),
    data: z.unknown(),
    hint: z.string().optional(),
    meta: MsResponseMetaSchema,
  })
  .passthrough();

const MsDoctorCheckSchema = z
  .object({
    name: z.string(),
    status: z.enum(["ok", "warning", "error"]),
    message: z.string().optional(),
  })
  .passthrough();

const MsDoctorEmbeddingSchema = z
  .object({
    available: z.boolean(),
    model: z.string().optional(),
    latency_ms: z.number().optional(),
  })
  .passthrough();

const MsDoctorStorageSchema = z
  .object({
    data_dir: z.string(),
    size_bytes: z.number(),
    index_count: z.number(),
  })
  .passthrough();

const MsDoctorSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "error"]),
    checks: z.array(MsDoctorCheckSchema),
    embedding_service: MsDoctorEmbeddingSchema,
    storage: MsDoctorStorageSchema,
  })
  .passthrough();

const MsSearchResultSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    snippet: z.string(),
    score: z.number(),
    knowledge_base: z.string(),
    source: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const MsSearchResponseSchema = z
  .object({
    query: z.string(),
    results: z.array(MsSearchResultSchema),
    total: z.number(),
    took_ms: z.number(),
    semantic_enabled: z.boolean(),
  })
  .passthrough();

const MsKnowledgeBaseSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    entry_count: z.number(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const MsListResponseSchema = z
  .object({
    knowledge_bases: z.array(MsKnowledgeBaseSchema).optional(),
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type MsDoctor = z.infer<typeof MsDoctorSchema>;
export type MsDoctorCheck = z.infer<typeof MsDoctorCheckSchema>;
export type MsSearchResult = z.infer<typeof MsSearchResultSchema>;
export type MsSearchResponse = z.infer<typeof MsSearchResponseSchema>;
export type MsKnowledgeBase = z.infer<typeof MsKnowledgeBaseSchema>;

export interface MsStatus {
  available: boolean;
  version?: string;
  configured: boolean;
  knowledge_bases: string[];
  embedding_service_available: boolean;
  embedding_model?: string;
  index_count: number;
  data_dir: string;
}

// ============================================================================
// Options Types
// ============================================================================

export interface MsCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface MsSearchOptions extends MsCommandOptions {
  knowledgeBase?: string;
  limit?: number;
  threshold?: number;
  semantic?: boolean;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface MsClient {
  /** Run doctor check to get system health and configuration status */
  doctor: (options?: MsCommandOptions) => Promise<MsDoctor>;

  /** Get overall status including version and configuration */
  status: (options?: MsCommandOptions) => Promise<MsStatus>;

  /** List all knowledge bases */
  listKnowledgeBases: (
    options?: MsCommandOptions,
  ) => Promise<MsKnowledgeBase[]>;

  /** Semantic search across knowledge bases */
  search: (
    query: string,
    options?: MsSearchOptions,
  ) => Promise<MsSearchResponse>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runMsCommand(
  runner: MsCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("ms", [...args, "--json"], options);
  if (result.exitCode !== 0) {
    throw new MsClientError("command_failed", "MS command failed", {
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
  let envelope: z.infer<typeof MsResponseSchema>;
  try {
    const parsed = JSON.parse(stdout);
    envelope = MsResponseSchema.parse(parsed);
  } catch (error) {
    throw new MsClientError("parse_error", `Failed to parse MS ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, 500),
    });
  }

  // Check if response is OK
  if (!envelope.ok) {
    throw new MsClientError(
      "command_failed",
      `MS ${context} failed: ${envelope.code}`,
      {
        code: envelope.code,
        hint: envelope.hint,
      },
    );
  }

  // Parse the data with the specific schema
  const result = schema.safeParse(envelope.data);
  if (!result.success) {
    throw new MsClientError(
      "validation_error",
      `Invalid MS ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: MsClientOptions,
  override?: MsCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout;
  if (cwd !== undefined) result.cwd = cwd;
  if (timeout !== undefined) result.timeout = timeout;
  return result;
}

async function getVersion(
  runner: MsCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("ms", ["--version"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from output (e.g., "ms v1.2.3" -> "1.2.3")
    const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createMsClient(options: MsClientOptions): MsClient {
  return {
    doctor: async (opts) => {
      const stdout = await runMsCommand(
        options.runner,
        ["doctor"],
        buildRunOptions(options, opts),
      );
      return parseResponse(stdout, MsDoctorSchema, "doctor");
    },

    status: async (opts): Promise<MsStatus> => {
      try {
        const doctor = await createMsClient(options).doctor(opts);
        const version = await getVersion(
          options.runner,
          opts?.cwd ?? options.cwd,
        );

        // Try to get knowledge base list
        let knowledgeBaseNames: string[] = [];
        try {
          const kbs = await createMsClient(options).listKnowledgeBases(opts);
          knowledgeBaseNames = kbs.map((kb) => kb.name);
        } catch {
          // Ignore - list might not be available
        }

        const status: MsStatus = {
          available: true,
          configured: doctor.status !== "error",
          knowledge_bases: knowledgeBaseNames,
          embedding_service_available: doctor.embedding_service.available,
          index_count: doctor.storage.index_count,
          data_dir: doctor.storage.data_dir,
        };
        if (version !== null) status.version = version;
        if (doctor.embedding_service.model !== undefined) {
          status.embedding_model = doctor.embedding_service.model;
        }
        return status;
      } catch {
        return {
          available: false,
          configured: false,
          knowledge_bases: [],
          embedding_service_available: false,
          index_count: 0,
          data_dir: "",
        };
      }
    },

    listKnowledgeBases: async (opts) => {
      const stdout = await runMsCommand(
        options.runner,
        ["list"],
        buildRunOptions(options, opts),
      );
      const response = parseResponse(stdout, MsListResponseSchema, "list");
      return response.knowledge_bases ?? [];
    },

    search: async (query, opts) => {
      const args = ["search", query];

      if (opts?.knowledgeBase) {
        args.push("-kb", opts.knowledgeBase);
      }

      if (opts?.limit !== undefined) {
        args.push("-n", String(opts.limit));
      }

      if (opts?.threshold !== undefined) {
        args.push("-t", String(opts.threshold));
      }

      if (opts?.semantic === false) {
        args.push("--no-semantic");
      }

      const stdout = await runMsCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseResponse(stdout, MsSearchResponseSchema, "search");
    },

    isAvailable: async () => {
      try {
        await createMsClient(options).doctor({ timeout: 5000 });
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
export function createBunMsCommandRunner(): MsCommandRunner {
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
            throw new MsClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 60000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new MsClientError(
              "unavailable",
              "MS command failed to start",
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
