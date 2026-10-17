/**
 * JeffreysPrompts (jfp) Service
 *
 * Provides access to the jfp prompt library CLI for curated AI prompts.
 * Prompts are organized by category and can be browsed, searched, and
 * retrieved for agent workflows.
 *
 * CLI: https://github.com/Dicklesworthstone/jeffreysprompts
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export interface JfpPrompt {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  twitter?: string;
  version: string;
  featured: boolean;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedTokens: number;
  created: string;
  content: string;
  whenToUse?: string[];
  tips?: string[];
}

export interface JfpCategory {
  name: string;
  count: number;
}

export interface JfpListResult {
  prompts: JfpPrompt[];
  total: number;
  cached: boolean;
  fetchedAt: Date;
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

// ============================================================================
// CLI Execution Helper
// ============================================================================

async function executeJfpCommand(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeout = 30000, maxOutputSize = 5 * 1024 * 1024 } = options;

  try {
    const proc = Bun.spawn(["jfp", ...args], {
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

      // Truncate output if too large
      const truncatedStdout =
        stdout.length > maxOutputSize
          ? `${stdout.slice(0, maxOutputSize)}\n[Output truncated]`
          : stdout;
      const truncatedStderr =
        stderr.length > maxOutputSize
          ? `${stderr.slice(0, maxOutputSize)}\n[Output truncated]`
          : stderr;

      return {
        stdout: truncatedStdout.trim(),
        stderr: truncatedStderr.trim(),
        exitCode,
      };
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unknown error",
      exitCode: -1,
    };
  }
}

// ============================================================================
// Cache
// ============================================================================

interface PromptCache {
  prompts: JfpPrompt[];
  fetchedAt: Date;
  expiresAt: number;
}

interface CategoryCache {
  categories: JfpCategory[];
  fetchedAt: Date;
  expiresAt: number;
}

let promptCache: PromptCache | null = null;
let categoryCache: CategoryCache | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearJfpCache(): void {
  promptCache = null;
  categoryCache = null;
}

// ============================================================================
// Detection
// ============================================================================

export async function isJfpAvailable(): Promise<boolean> {
  const result = await executeJfpCommand(["--version"], { timeout: 5000 });
  return result.exitCode === 0;
}

export async function getJfpVersion(): Promise<string | null> {
  const result = await executeJfpCommand(["--version"], { timeout: 5000 });
  if (result.exitCode !== 0) return null;

  // Extract version (format: "jfp/1.0.0")
  const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
  return versionMatch?.[1] ?? null;
}

// ============================================================================
// Prompt Functions
// ============================================================================

/**
 * List all available prompts with caching.
 */
export async function listPrompts(bypassCache = false): Promise<JfpListResult> {
  const log = getLogger();

  // Check cache
  if (!bypassCache && promptCache && Date.now() < promptCache.expiresAt) {
    log.debug("Returning cached prompt list");
    return {
      prompts: promptCache.prompts,
      total: promptCache.prompts.length,
      cached: true,
      fetchedAt: promptCache.fetchedAt,
    };
  }

  log.info("Fetching prompts from jfp CLI");
  const result = await executeJfpCommand(["list", "--json"]);

  if (result.exitCode !== 0) {
    log.error({ stderr: result.stderr.slice(0, 200) }, "jfp list failed");
    throw new Error(
      `Failed to list prompts: ${result.stderr || "Unknown error"}`,
    );
  }

  try {
    const parsed = JSON.parse(result.stdout) as { prompts: JfpPrompt[] };
    const prompts = parsed.prompts || [];
    const now = new Date();

    // Update cache
    promptCache = {
      prompts,
      fetchedAt: now,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    log.info({ count: prompts.length }, "Prompts fetched successfully");

    return {
      prompts,
      total: prompts.length,
      cached: false,
      fetchedAt: now,
    };
  } catch (error) {
    log.error({ error }, "Failed to parse jfp output");
    throw new Error("Failed to parse prompt list output");
  }
}

/**
 * Get a specific prompt by ID.
 */
export async function getPrompt(id: string): Promise<JfpPrompt | null> {
  const log = getLogger();

  // First check cache
  if (promptCache && Date.now() < promptCache.expiresAt) {
    const cached = promptCache.prompts.find((p) => p.id === id);
    if (cached) {
      log.debug({ id }, "Returning prompt from cache");
      return cached;
    }
  }

  // Fetch from CLI
  log.info({ id }, "Fetching prompt from jfp CLI");
  const result = await executeJfpCommand(["show", id, "--json"]);

  if (result.exitCode !== 0) {
    // Check if it's a "not found" error
    if (
      result.stderr.toLowerCase().includes("not found") ||
      result.stderr.toLowerCase().includes("no prompt")
    ) {
      return null;
    }
    log.error({ id, stderr: result.stderr.slice(0, 200) }, "jfp show failed");
    throw new Error(
      `Failed to get prompt: ${result.stderr || "Unknown error"}`,
    );
  }

  try {
    const prompt = JSON.parse(result.stdout) as JfpPrompt;
    return prompt;
  } catch (error) {
    log.error({ id, error }, "Failed to parse prompt output");
    throw new Error("Failed to parse prompt output");
  }
}

/**
 * List categories with counts.
 */
export async function listCategories(
  bypassCache = false,
): Promise<JfpCategory[]> {
  const log = getLogger();

  // Check cache
  if (!bypassCache && categoryCache && Date.now() < categoryCache.expiresAt) {
    log.debug("Returning cached category list");
    return categoryCache.categories;
  }

  log.info("Fetching categories from jfp CLI");
  const result = await executeJfpCommand(["categories", "--json"]);

  if (result.exitCode !== 0) {
    log.error({ stderr: result.stderr.slice(0, 200) }, "jfp categories failed");
    throw new Error(
      `Failed to list categories: ${result.stderr || "Unknown error"}`,
    );
  }

  try {
    const categories = JSON.parse(result.stdout) as JfpCategory[];
    const now = new Date();

    // Update cache
    categoryCache = {
      categories,
      fetchedAt: now,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    log.info({ count: categories.length }, "Categories fetched successfully");
    return categories;
  } catch (error) {
    log.error({ error }, "Failed to parse categories output");
    throw new Error("Failed to parse categories output");
  }
}

/**
 * Search prompts by query.
 * Falls back to local filtering if CLI search has issues.
 */
export async function searchPrompts(
  query: string,
  options: { limit?: number; category?: string } = {},
): Promise<JfpSearchResult> {
  const log = getLogger();
  const { limit = 20, category } = options;

  // Try CLI search first
  const args = ["search", query, "--json", "--limit", String(limit)];
  if (category) {
    // Filter by category locally since jfp search doesn't support category filter
  }

  const result = await executeJfpCommand(args, { timeout: 10000 });

  if (result.exitCode === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      let prompts = (parsed.results || parsed.prompts || parsed) as JfpPrompt[];

      // Apply category filter locally if specified
      if (category) {
        prompts = prompts.filter(
          (p) => p.category.toLowerCase() === category.toLowerCase(),
        );
      }

      return {
        prompts: prompts.slice(0, limit),
        query,
        total: prompts.length,
      };
    } catch {
      // Fall through to local search
    }
  }

  // Fallback: local search on cached/fetched prompts
  log.info({ query }, "Using local prompt search fallback");
  const listResult = await listPrompts();
  const queryLower = query.toLowerCase();

  let filtered = listResult.prompts.filter(
    (p) =>
      p.title.toLowerCase().includes(queryLower) ||
      p.description.toLowerCase().includes(queryLower) ||
      p.tags.some((t) => t.toLowerCase().includes(queryLower)) ||
      p.category.toLowerCase().includes(queryLower),
  );

  // Apply category filter
  if (category) {
    filtered = filtered.filter(
      (p) => p.category.toLowerCase() === category.toLowerCase(),
    );
  }

  // Score and sort by relevance
  const scored = filtered.map((p) => {
    let score = 0;
    if (p.title.toLowerCase().includes(queryLower)) score += 10;
    if (p.description.toLowerCase().includes(queryLower)) score += 5;
    if (p.tags.some((t) => t.toLowerCase() === queryLower)) score += 8;
    if (p.featured) score += 3;
    return { prompt: p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    prompts: scored.slice(0, limit).map((s) => s.prompt),
    query,
    total: filtered.length,
  };
}

/**
 * Get prompts by category.
 */
export async function getPromptsByCategory(
  category: string,
  options: { limit?: number } = {},
): Promise<JfpPrompt[]> {
  const { limit = 50 } = options;
  const listResult = await listPrompts();

  const filtered = listResult.prompts.filter(
    (p) => p.category.toLowerCase() === category.toLowerCase(),
  );

  return filtered.slice(0, limit);
}

/**
 * Get featured prompts.
 */
export async function getFeaturedPrompts(
  options: { limit?: number } = {},
): Promise<JfpPrompt[]> {
  const { limit = 10 } = options;
  const listResult = await listPrompts();

  const featured = listResult.prompts.filter((p) => p.featured);
  return featured.slice(0, limit);
}

/**
 * Suggest prompts for a task description.
 */
export async function suggestPrompts(
  task: string,
  options: { limit?: number } = {},
): Promise<JfpSuggestResult> {
  const log = getLogger();
  const { limit = 5 } = options;

  // Try CLI suggest first
  const result = await executeJfpCommand(["suggest", task, "--json"], {
    timeout: 30000, // Suggest can be slow (may call AI)
  });

  if (result.exitCode === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      const suggestions = (parsed.suggestions ||
        parsed.prompts ||
        parsed) as JfpPrompt[];
      return {
        suggestions: suggestions.slice(0, limit),
        task,
      };
    } catch {
      // Fall through to search-based suggestion
    }
  }

  // Fallback: use search with task keywords
  log.info({ task }, "Using search-based suggestion fallback");
  const searchResult = await searchPrompts(task, { limit });

  return {
    suggestions: searchResult.prompts,
    task,
  };
}

/**
 * Get random prompt for discovery.
 */
export async function getRandomPrompt(): Promise<JfpPrompt | null> {
  const log = getLogger();

  const result = await executeJfpCommand(["random", "--json"]);

  if (result.exitCode === 0) {
    try {
      const prompt = JSON.parse(result.stdout) as JfpPrompt;
      return prompt;
    } catch {
      // Fall through to local random
    }
  }

  // Fallback: pick random from cached list
  log.info("Using local random prompt fallback");
  const listResult = await listPrompts();

  if (listResult.prompts.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * listResult.prompts.length);
  return listResult.prompts[randomIndex]!;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface JfpService {
  /** Check if jfp CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get jfp CLI version */
  getVersion(): Promise<string | null>;

  /** List all prompts */
  list(bypassCache?: boolean): Promise<JfpListResult>;

  /** Get a specific prompt by ID */
  get(id: string): Promise<JfpPrompt | null>;

  /** List all categories */
  listCategories(bypassCache?: boolean): Promise<JfpCategory[]>;

  /** Search prompts */
  search(
    query: string,
    options?: { limit?: number; category?: string },
  ): Promise<JfpSearchResult>;

  /** Get prompts by category */
  getByCategory(
    category: string,
    options?: { limit?: number },
  ): Promise<JfpPrompt[]>;

  /** Get featured prompts */
  getFeatured(options?: { limit?: number }): Promise<JfpPrompt[]>;

  /** Suggest prompts for a task */
  suggest(
    task: string,
    options?: { limit?: number },
  ): Promise<JfpSuggestResult>;

  /** Get random prompt */
  getRandom(): Promise<JfpPrompt | null>;

  /** Clear all caches */
  clearCache(): void;
}

export function createJfpService(): JfpService {
  return {
    isAvailable: isJfpAvailable,
    getVersion: getJfpVersion,
    list: listPrompts,
    get: getPrompt,
    listCategories,
    search: searchPrompts,
    getByCategory: getPromptsByCategory,
    getFeatured: getFeaturedPrompts,
    suggest: suggestPrompts,
    getRandom: getRandomPrompt,
    clearCache: clearJfpCache,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: JfpService | null = null;

export function getJfpService(): JfpService {
  if (!serviceInstance) {
    serviceInstance = createJfpService();
  }
  return serviceInstance;
}
