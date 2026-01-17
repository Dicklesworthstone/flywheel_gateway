/**
 * Meta Skill (ms) Service
 *
 * Provides access to the ms CLI for local-first knowledge management
 * with hybrid semantic search. Useful for agents to query skill
 * repositories and documentation.
 *
 * CLI: https://github.com/Dicklesworthstone/meta_skill
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export interface MsResponse<T = unknown> {
  ok: boolean;
  code: string;
  data: T;
  hint?: string;
  meta: {
    v: string;
    ts: string;
  };
}

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

export interface MsKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  source: string;
  knowledge_base: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface MsSearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  knowledge_base: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface MsSearchResponse {
  query: string;
  results: MsSearchResult[];
  total: number;
  took_ms: number;
  semantic_enabled: boolean;
}

export interface MsDoctor {
  status: "healthy" | "degraded" | "error";
  checks: {
    name: string;
    status: "ok" | "warning" | "error";
    message?: string;
  }[];
  embedding_service: {
    available: boolean;
    model?: string;
    latency_ms?: number;
  };
  storage: {
    data_dir: string;
    size_bytes: number;
    index_count: number;
  };
}

export interface MsKnowledgeBase {
  name: string;
  description?: string;
  entry_count: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// CLI Execution Helper
// ============================================================================

async function executeMsCommand(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number } = {},
): Promise<MsResponse> {
  const { timeout = 60000, maxOutputSize = 5 * 1024 * 1024 } = options;
  const log = getLogger();

  try {
    // Add --json flag for structured output
    const fullArgs = [...args, "--json"];

    const proc = Bun.spawn(["ms", ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    // Wait for command or timeout
    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      // Truncate if needed
      const output =
        stdout.length > maxOutputSize ? stdout.slice(0, maxOutputSize) : stdout;

      // Parse JSON response
      try {
        return JSON.parse(output.trim()) as MsResponse;
      } catch {
        // If parsing fails, create an error response
        log.error(
          { stdout: output.slice(0, 200), stderr },
          "Failed to parse ms output",
        );
        return {
          ok: false,
          code: "parse_error",
          data: { stdout: output, stderr },
          hint: "Failed to parse ms output as JSON",
          meta: { v: "unknown", ts: new Date().toISOString() },
        } as MsResponse;
      }
    })();

    return await Promise.race([resultPromise, timeoutPromise]);
  } catch (error) {
    return {
      ok: false,
      code: "execution_error",
      data: { error: error instanceof Error ? error.message : "Unknown error" },
      hint: "Failed to execute ms command",
      meta: { v: "unknown", ts: new Date().toISOString() },
    };
  }
}

// ============================================================================
// Detection
// ============================================================================

export async function isMsAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["ms", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    // Check for version pattern in output
    return exitCode === 0 || stdout.includes("v");
  } catch {
    return false;
  }
}

export async function getMsVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["ms", "--version"], {
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
// Status Functions
// ============================================================================

/**
 * Run doctor check to get system health and configuration status.
 */
export async function getDoctor(): Promise<MsDoctor> {
  const response = await executeMsCommand(["doctor"]);

  if (!response.ok) {
    throw new Error(response.hint ?? `ms doctor failed: ${response.code}`);
  }

  return response.data as MsDoctor;
}

/**
 * Get ms system status.
 */
export async function getStatus(): Promise<MsStatus> {
  // Try to get doctor info for comprehensive status
  try {
    const doctor = await getDoctor();
    const version = await getMsVersion();

    const status: MsStatus = {
      available: true,
      configured: doctor.status !== "error",
      knowledge_bases: [], // Would come from list command
      embedding_service_available: doctor.embedding_service.available,
      index_count: doctor.storage.index_count,
      data_dir: doctor.storage.data_dir,
    };

    if (version) {
      status.version = version;
    }
    if (doctor.embedding_service.model) {
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
}

/**
 * List all knowledge bases.
 */
export async function listKnowledgeBases(): Promise<MsKnowledgeBase[]> {
  const response = await executeMsCommand(["list"]);

  if (!response.ok) {
    throw new Error(response.hint ?? `ms list failed: ${response.code}`);
  }

  const data = response.data as { knowledge_bases?: MsKnowledgeBase[] };
  return data.knowledge_bases ?? [];
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Semantic search across knowledge bases.
 */
export async function search(
  query: string,
  options: {
    knowledgeBase?: string;
    limit?: number;
    threshold?: number;
    semantic?: boolean;
  } = {},
): Promise<MsSearchResponse> {
  const args = ["search", query];

  if (options.knowledgeBase) {
    args.push("-kb", options.knowledgeBase);
  }

  if (options.limit !== undefined) {
    args.push("-n", String(options.limit));
  }

  if (options.threshold !== undefined) {
    args.push("-t", String(options.threshold));
  }

  if (options.semantic === false) {
    args.push("--no-semantic");
  }

  const response = await executeMsCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `ms search failed: ${response.code}`);
  }

  return response.data as MsSearchResponse;
}

// ============================================================================
// Knowledge Entry Functions
// ============================================================================

/**
 * Get a specific knowledge entry by ID.
 */
export async function getEntry(
  id: string,
  options: { knowledgeBase?: string } = {},
): Promise<MsKnowledgeEntry> {
  const args = ["get", id];

  if (options.knowledgeBase) {
    args.push("-kb", options.knowledgeBase);
  }

  const response = await executeMsCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `ms get failed: ${response.code}`);
  }

  return response.data as MsKnowledgeEntry;
}

/**
 * Add a knowledge entry.
 */
export async function addEntry(
  entry: {
    title: string;
    content: string;
    source?: string;
    knowledgeBase?: string;
    metadata?: Record<string, unknown>;
  },
  options: { skipEmbedding?: boolean } = {},
): Promise<MsKnowledgeEntry> {
  const args = ["add", "--title", entry.title, "--content", entry.content];

  if (entry.source) {
    args.push("--source", entry.source);
  }

  if (entry.knowledgeBase) {
    args.push("-kb", entry.knowledgeBase);
  }

  if (entry.metadata) {
    args.push("--metadata", JSON.stringify(entry.metadata));
  }

  if (options.skipEmbedding) {
    args.push("--skip-embedding");
  }

  const response = await executeMsCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `ms add failed: ${response.code}`);
  }

  return response.data as MsKnowledgeEntry;
}

/**
 * Delete a knowledge entry.
 */
export async function deleteEntry(
  id: string,
  options: { knowledgeBase?: string } = {},
): Promise<{ deleted: boolean; id: string }> {
  const args = ["delete", id];

  if (options.knowledgeBase) {
    args.push("-kb", options.knowledgeBase);
  }

  const response = await executeMsCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `ms delete failed: ${response.code}`);
  }

  return response.data as { deleted: boolean; id: string };
}

// ============================================================================
// Index Functions
// ============================================================================

/**
 * Rebuild the search index for a knowledge base.
 */
export async function rebuildIndex(
  options: { knowledgeBase?: string; force?: boolean } = {},
): Promise<{ success: boolean; indexed: number; took_ms: number }> {
  const args = ["index", "rebuild"];

  if (options.knowledgeBase) {
    args.push("-kb", options.knowledgeBase);
  }

  if (options.force) {
    args.push("--force");
  }

  // Extended timeout for index rebuilds
  const response = await executeMsCommand(args, { timeout: 300000 });

  if (!response.ok) {
    throw new Error(
      response.hint ?? `ms index rebuild failed: ${response.code}`,
    );
  }

  return response.data as { success: boolean; indexed: number; took_ms: number };
}

// ============================================================================
// Service Interface
// ============================================================================

export interface MsService {
  /** Check if ms CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get ms CLI version */
  getVersion(): Promise<string | null>;

  /** Get system status */
  getStatus(): Promise<MsStatus>;

  /** Run doctor check */
  getDoctor(): Promise<MsDoctor>;

  /** List all knowledge bases */
  listKnowledgeBases(): Promise<MsKnowledgeBase[]>;

  /** Semantic search across knowledge bases */
  search(
    query: string,
    options?: {
      knowledgeBase?: string;
      limit?: number;
      threshold?: number;
      semantic?: boolean;
    },
  ): Promise<MsSearchResponse>;

  /** Get a knowledge entry by ID */
  getEntry(
    id: string,
    options?: { knowledgeBase?: string },
  ): Promise<MsKnowledgeEntry>;

  /** Add a knowledge entry */
  addEntry(
    entry: {
      title: string;
      content: string;
      source?: string;
      knowledgeBase?: string;
      metadata?: Record<string, unknown>;
    },
    options?: { skipEmbedding?: boolean },
  ): Promise<MsKnowledgeEntry>;

  /** Delete a knowledge entry */
  deleteEntry(
    id: string,
    options?: { knowledgeBase?: string },
  ): Promise<{ deleted: boolean; id: string }>;

  /** Rebuild search index */
  rebuildIndex(options?: {
    knowledgeBase?: string;
    force?: boolean;
  }): Promise<{ success: boolean; indexed: number; took_ms: number }>;
}

export function createMsService(): MsService {
  return {
    isAvailable: isMsAvailable,
    getVersion: getMsVersion,
    getStatus,
    getDoctor,
    listKnowledgeBases,
    search,
    getEntry,
    addEntry,
    deleteEntry,
    rebuildIndex,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: MsService | null = null;

export function getMsService(): MsService {
  if (!serviceInstance) {
    serviceInstance = createMsService();
  }
  return serviceInstance;
}
