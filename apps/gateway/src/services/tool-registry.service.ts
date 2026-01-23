/**
 * Tool Registry Service
 *
 * Loads and validates the ACFS tool registry manifest (YAML) with caching.
 * Provides graceful fallback to a minimal built-in registry when the manifest
 * is missing, invalid, or fails to load.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ToolDefinition, ToolRegistry } from "@flywheel/shared";
import { createGatewayError, isGatewayError } from "@flywheel/shared/errors";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { getLogger } from "../middleware/correlation";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_MANIFEST_FILE = "acfs.manifest.yaml";

// ============================================================================
// Error Categories (for structured logging)
// ============================================================================

export type ManifestErrorCategory =
  | "manifest_missing"
  | "manifest_read_error"
  | "manifest_parse_error"
  | "manifest_validation_error"
  | "registry_load_failed";

// ============================================================================
// Fallback Registry
// ============================================================================

/**
 * Minimal built-in registry with core tools.
 * Used when the ACFS manifest is missing or invalid.
 * Contains only essential tools required for basic Flywheel Gateway operation.
 */
const FALLBACK_REGISTRY: ToolRegistry = {
  schemaVersion: "1.0.0-fallback",
  source: "built-in",
  generatedAt: new Date().toISOString(),
  tools: [
    // Core agent CLI
    {
      id: "agents.claude",
      name: "claude",
      displayName: "Claude Code",
      description: "Anthropic's official CLI for Claude - primary agent interface",
      category: "agent",
      tags: ["critical", "recommended"],
      optional: false,
      enabledByDefault: true,
      phase: 1,
      docsUrl: "https://docs.anthropic.com/claude-code",
      verify: {
        command: ["claude", "--version"],
        expectedExitCodes: [0],
      },
      installedCheck: {
        command: ["command", "-v", "claude"],
      },
    },
    // Safety guardrails
    {
      id: "tools.dcg",
      name: "dcg",
      displayName: "DCG",
      description: "Destructive Command Guard - prevents dangerous operations",
      category: "tool",
      tags: ["critical", "required"],
      optional: false,
      enabledByDefault: true,
      phase: 0, // Install first for safety
      docsUrl: "https://github.com/Dicklesworthstone/dcg",
      install: [
        {
          command: "curl",
          args: [
            "-fsSL",
            "https://raw.githubusercontent.com/Dicklesworthstone/dcg/main/install.sh",
            "|",
            "bash",
          ],
        },
      ],
      verify: {
        command: ["dcg", "--version"],
        expectedExitCodes: [0],
      },
      installedCheck: {
        command: ["command", "-v", "dcg"],
      },
    },
    // Issue tracking
    {
      id: "tools.br",
      name: "br",
      displayName: "br (Beads)",
      description: "Beads issue tracker with dependency graphs",
      category: "tool",
      tags: ["critical", "required"],
      optional: false,
      enabledByDefault: true,
      phase: 1,
      docsUrl: "https://github.com/Dicklesworthstone/beads_rust",
      install: [
        {
          command: "curl",
          args: [
            "-fsSL",
            "https://raw.githubusercontent.com/Dicklesworthstone/beads_rust/main/install.sh",
            "|",
            "bash",
          ],
        },
      ],
      verify: {
        command: ["br", "--version"],
        expectedExitCodes: [0],
      },
      installedCheck: {
        command: ["command", "-v", "br"],
      },
    },
    // Graph-aware triage
    {
      id: "tools.bv",
      name: "bv",
      displayName: "bv",
      description: "Graph-aware issue triage engine",
      category: "tool",
      tags: ["recommended"],
      optional: true,
      enabledByDefault: true,
      phase: 2,
      docsUrl: "https://github.com/Dicklesworthstone/bv",
      install: [
        {
          command: "curl",
          args: [
            "-fsSL",
            "https://raw.githubusercontent.com/Dicklesworthstone/bv/main/install.sh",
            "|",
            "bash",
          ],
        },
      ],
      verify: {
        command: ["bv", "--version"],
        expectedExitCodes: [0],
      },
      installedCheck: {
        command: ["command", "-v", "bv"],
      },
    },
  ],
};

/**
 * User-facing error messages with actionable guidance.
 */
const USER_FACING_MESSAGES: Record<ManifestErrorCategory, string> = {
  manifest_missing:
    "ACFS manifest file not found. Using built-in fallback registry. " +
    "To use the full tool registry, ensure the manifest exists at the configured path " +
    "(set ACFS_MANIFEST_PATH or TOOL_REGISTRY_PATH environment variable).",
  manifest_read_error:
    "Failed to read ACFS manifest file. Using built-in fallback registry. " +
    "Check file permissions and ensure the path is accessible.",
  manifest_parse_error:
    "ACFS manifest contains invalid YAML. Using built-in fallback registry. " +
    "Validate your manifest file with a YAML linter.",
  manifest_validation_error:
    "ACFS manifest failed schema validation. Using built-in fallback registry. " +
    "Ensure the manifest conforms to the expected schema version.",
  registry_load_failed:
    "Failed to load tool registry. Using built-in fallback registry. " +
    "Check logs for details.",
};

// ============================================================================
// Schema Validation
// ============================================================================

const InstallSpecSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  mode: z.enum(["interactive", "easy", "manual"]).optional(),
  requiresSudo: z.boolean().optional(),
  notes: z.string().optional(),
});

const VerificationSpecSchema = z.object({
  command: z.array(z.string()).optional(),
  expectedExitCodes: z.array(z.number()).optional(),
  minVersion: z.string().optional(),
  versionRegex: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const InstalledCheckSpecSchema = z.object({
  command: z.array(z.string()),
  run_as: z.enum(["root", "user"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
  outputCapBytes: z.number().int().positive().optional(),
});

const VerifiedInstallerSpecSchema = z.object({
  runner: z.string(),
  args: z.array(z.string()).optional(),
  fallback_url: z.string().optional(),
  run_in_tmux: z.boolean().optional(),
});

const ToolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(["agent", "tool"]),
  tags: z.array(z.string()).optional(),
  optional: z.boolean().optional(),
  enabledByDefault: z.boolean().optional(),
  phase: z.number().int().optional(),
  docsUrl: z.string().optional(),
  install: z.array(InstallSpecSchema).optional(),
  verifiedInstaller: VerifiedInstallerSpecSchema.optional(),
  verify: VerificationSpecSchema.optional(),
  installedCheck: InstalledCheckSpecSchema.optional(),
  checksums: z.record(z.string()).optional(),
});

const ToolRegistrySchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  source: z.string().optional(),
  generatedAt: z.string().optional(),
  tools: z.array(ToolDefinitionSchema).default([]),
});

// ============================================================================
// Helpers
// ============================================================================

function resolveProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}apps${path.sep}gateway`)) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

function resolveManifestPath(pathOverride?: string): string {
  const envPath =
    pathOverride ??
    process.env["ACFS_MANIFEST_PATH"] ??
    process.env["TOOL_REGISTRY_PATH"] ??
    DEFAULT_MANIFEST_FILE;

  if (path.isAbsolute(envPath)) {
    return envPath;
  }

  return path.resolve(resolveProjectRoot(), envPath);
}

function getCacheTtlMs(): number {
  const raw =
    process.env["ACFS_MANIFEST_TTL_MS"] ?? process.env["TOOL_REGISTRY_TTL_MS"];
  const ttl = Number(raw);
  if (Number.isFinite(ttl) && ttl >= 0) return ttl;
  return DEFAULT_CACHE_TTL_MS;
}

function parseManifest(
  content: string,
  sourcePath: string,
  manifestHash: string,
): ToolRegistry {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw createGatewayError(
      "SYSTEM_INTERNAL_ERROR",
      "Failed to parse tool registry manifest",
      {
        details: {
          path: sourcePath,
          manifestHash,
          errorCategory: "manifest_parse_error",
          cause: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }

  const schemaVersion =
    typeof raw === "object" && raw && "schemaVersion" in raw
      ? String((raw as { schemaVersion?: unknown }).schemaVersion)
      : undefined;
  const result = ToolRegistrySchema.safeParse(raw);
  if (!result.success) {
    throw createGatewayError(
      "SYSTEM_INTERNAL_ERROR",
      "Tool registry manifest failed validation",
      {
        details: {
          path: sourcePath,
          manifestHash,
          ...(schemaVersion && { schemaVersion }),
          errorCategory: "manifest_validation_error",
          issues: result.error.issues,
        },
      },
    );
  }

  return result.data;
}

// ============================================================================
// Loader
// ============================================================================

export type RegistrySource = "manifest" | "fallback";

interface CachedRegistry {
  registry: ToolRegistry;
  path: string;
  loadedAt: number;
  manifestHash: string | null;
  source: RegistrySource;
  errorCategory?: ManifestErrorCategory;
}

let cached: CachedRegistry | undefined;

export interface ToolRegistryLoadOptions {
  bypassCache?: boolean;
  pathOverride?: string;
  /** If true, throw errors instead of falling back. Default: false */
  throwOnError?: boolean;
}

export interface ToolRegistryLoadResult {
  registry: ToolRegistry;
  source: RegistrySource;
  errorCategory?: ManifestErrorCategory;
  userMessage?: string;
}

/**
 * Load the tool registry from the ACFS manifest.
 * Falls back to the built-in registry if the manifest is missing or invalid.
 *
 * @param options - Load options
 * @returns The loaded registry
 */
export async function loadToolRegistry(
  options: ToolRegistryLoadOptions = {},
): Promise<ToolRegistry> {
  const result = await loadToolRegistryWithMetadata(options);
  return result.registry;
}

/**
 * Load the tool registry with metadata about the load operation.
 * This is the primary internal method that handles fallback logic.
 *
 * @param options - Load options
 * @returns The registry with source metadata
 */
export async function loadToolRegistryWithMetadata(
  options: ToolRegistryLoadOptions = {},
): Promise<ToolRegistryLoadResult> {
  const log = getLogger();
  const manifestPath = resolveManifestPath(options.pathOverride);
  const ttlMs = getCacheTtlMs();

  // Check cache
  if (
    cached &&
    !options.bypassCache &&
    cached.path === manifestPath &&
    Date.now() - cached.loadedAt < ttlMs
  ) {
    log.debug(
      {
        manifestPath,
        ttlMs,
        schemaVersion: cached.registry.schemaVersion,
        manifestHash: cached.manifestHash,
        source: cached.source,
      },
      "Tool registry cache hit",
    );
    return {
      registry: cached.registry,
      source: cached.source,
      errorCategory: cached.errorCategory,
      userMessage: cached.errorCategory
        ? USER_FACING_MESSAGES[cached.errorCategory]
        : undefined,
    };
  }

  // Check if manifest exists
  if (!existsSync(manifestPath)) {
    const errorCategory: ManifestErrorCategory = "manifest_missing";
    const userMessage = USER_FACING_MESSAGES[errorCategory];

    log.warn(
      {
        manifestPath,
        manifestHash: null,
        schemaVersion: null,
        errorCategory,
        userMessage,
        fallbackToolCount: FALLBACK_REGISTRY.tools.length,
      },
      "Tool registry manifest not found, using fallback",
    );

    if (options.throwOnError) {
      throw createGatewayError(
        "SYSTEM_UNAVAILABLE",
        "Tool registry manifest not found",
        {
          details: {
            path: manifestPath,
            errorCategory,
            userMessage,
          },
        },
      );
    }

    // Cache and return fallback
    cached = {
      registry: FALLBACK_REGISTRY,
      path: manifestPath,
      loadedAt: Date.now(),
      manifestHash: null,
      source: "fallback",
      errorCategory,
    };

    return {
      registry: FALLBACK_REGISTRY,
      source: "fallback",
      errorCategory,
      userMessage,
    };
  }

  // Try to load manifest
  const start = performance.now();
  let content: string;
  try {
    content = await readFile(manifestPath, "utf-8");
  } catch (readError) {
    const errorCategory: ManifestErrorCategory = "manifest_read_error";
    const userMessage = USER_FACING_MESSAGES[errorCategory];

    log.warn(
      {
        manifestPath,
        manifestHash: null,
        schemaVersion: null,
        errorCategory,
        userMessage,
        error: readError instanceof Error ? readError.message : String(readError),
        fallbackToolCount: FALLBACK_REGISTRY.tools.length,
      },
      "Failed to read tool registry manifest, using fallback",
    );

    if (options.throwOnError) {
      throw createGatewayError(
        "SYSTEM_UNAVAILABLE",
        "Failed to read tool registry manifest",
        {
          details: {
            path: manifestPath,
            errorCategory,
            userMessage,
            cause: readError instanceof Error ? readError.message : String(readError),
          },
        },
      );
    }

    cached = {
      registry: FALLBACK_REGISTRY,
      path: manifestPath,
      loadedAt: Date.now(),
      manifestHash: null,
      source: "fallback",
      errorCategory,
    };

    return {
      registry: FALLBACK_REGISTRY,
      source: "fallback",
      errorCategory,
      userMessage,
    };
  }

  const manifestHash = createHash("sha256").update(content).digest("hex");
  let registry: ToolRegistry;

  try {
    registry = parseManifest(content, manifestPath, manifestHash);
  } catch (parseError) {
    const errorCategory: ManifestErrorCategory =
      isGatewayError(parseError) && parseError.details?.["errorCategory"]
        ? (parseError.details["errorCategory"] as ManifestErrorCategory)
        : "manifest_parse_error";
    const schemaVersion =
      isGatewayError(parseError) &&
      typeof parseError.details?.["schemaVersion"] === "string"
        ? String(parseError.details["schemaVersion"])
        : null;
    const userMessage = USER_FACING_MESSAGES[errorCategory];

    log.warn(
      {
        manifestPath,
        manifestHash,
        schemaVersion,
        errorCategory,
        userMessage,
        error: parseError instanceof Error ? parseError.message : String(parseError),
        fallbackToolCount: FALLBACK_REGISTRY.tools.length,
      },
      "Tool registry manifest parse/validation failed, using fallback",
    );

    if (options.throwOnError) {
      throw parseError;
    }

    cached = {
      registry: FALLBACK_REGISTRY,
      path: manifestPath,
      loadedAt: Date.now(),
      manifestHash,
      source: "fallback",
      errorCategory,
    };

    return {
      registry: FALLBACK_REGISTRY,
      source: "fallback",
      errorCategory,
      userMessage,
    };
  }

  const latencyMs = Math.round(performance.now() - start);

  // Successfully loaded from manifest
  cached = {
    registry,
    path: manifestPath,
    loadedAt: Date.now(),
    manifestHash,
    source: "manifest",
  };

  log.info(
    {
      manifestPath,
      schemaVersion: registry.schemaVersion,
      manifestHash,
      toolCount: registry.tools.length,
      latencyMs,
      source: "manifest",
    },
    "Tool registry loaded from manifest",
  );

  return {
    registry,
    source: "manifest",
  };
}

export function clearToolRegistryCache(): void {
  cached = undefined;
}

export interface ToolRegistryMetadata {
  manifestPath: string;
  schemaVersion: string;
  source?: string;
  generatedAt?: string;
  manifestHash: string | null;
  loadedAt: number;
  /** Whether the registry came from manifest or fallback */
  registrySource: RegistrySource;
  /** If fallback, the reason why */
  errorCategory?: ManifestErrorCategory;
  /** User-facing message about the fallback */
  userMessage?: string;
}

/**
 * Get metadata about the currently cached tool registry.
 * Returns null if no registry has been loaded yet.
 */
export function getToolRegistryMetadata(): ToolRegistryMetadata | null {
  if (!cached) {
    return null;
  }

  const metadata: ToolRegistryMetadata = {
    manifestPath: cached.path,
    schemaVersion: cached.registry.schemaVersion,
    manifestHash: cached.manifestHash,
    loadedAt: cached.loadedAt,
    registrySource: cached.source,
  };

  if (cached.registry.source !== undefined) {
    metadata.source = cached.registry.source;
  }
  if (cached.registry.generatedAt !== undefined) {
    metadata.generatedAt = cached.registry.generatedAt;
  }
  if (cached.errorCategory !== undefined) {
    metadata.errorCategory = cached.errorCategory;
    metadata.userMessage = USER_FACING_MESSAGES[cached.errorCategory];
  }

  return metadata;
}

/**
 * Check if the current registry is using the built-in fallback.
 * Returns true if fallback is active, false if using manifest, null if not loaded.
 */
export function isUsingFallbackRegistry(): boolean | null {
  if (!cached) {
    return null;
  }
  return cached.source === "fallback";
}

/**
 * Get the built-in fallback registry directly.
 * Useful for testing or manual comparison.
 */
export function getFallbackRegistry(): ToolRegistry {
  return { ...FALLBACK_REGISTRY };
}

// ============================================================================
// Accessors
// ============================================================================

export interface ToolRegistryAccessOptions extends ToolRegistryLoadOptions {}

/**
 * Determine if a tool is required.
 * Required if:
 * - Has "critical" or "required" tag
 * - OR (optional !== true AND enabledByDefault === true)
 * - OR (optional is not set AND no tags indicate otherwise)
 */
function isRequiredTool(tool: ToolDefinition): boolean {
  // Critical/required tags always mean required
  if (tool.tags?.some((tag) => tag === "critical" || tag === "required")) {
    return true;
  }
  // Explicitly optional tools are not required
  if (tool.optional === true) return false;
  // Enabled by default and not optional means required
  if (tool.enabledByDefault === true) return true;
  // Default: non-optional tools are required
  // (At this point tool.optional is false or undefined, which we treat as required)
  return true;
}

/**
 * Determine if a tool is recommended (not required, but suggested).
 * Recommended if:
 * - Has "recommended" tag
 * - OR (optional === true AND enabledByDefault === true)
 */
function isRecommendedTool(tool: ToolDefinition): boolean {
  if (isRequiredTool(tool)) return false;
  if (tool.tags?.some((tag) => tag === "recommended")) {
    return true;
  }
  // Optional but enabled by default = recommended
  if (tool.optional === true && tool.enabledByDefault === true) {
    return true;
  }
  return false;
}

/**
 * Determine if a tool is truly optional (not required or recommended).
 */
function isOptionalTool(tool: ToolDefinition): boolean {
  return tool.optional === true && !isRequiredTool(tool) && !isRecommendedTool(tool);
}

async function withRegistry<T>(
  options: ToolRegistryAccessOptions,
  fn: (registry: ToolRegistry) => T,
): Promise<T> {
  try {
    const registry = await loadToolRegistry(options);
    return fn(registry);
  } catch (error) {
    if (isGatewayError(error)) {
      throw error;
    }
    throw createGatewayError("SYSTEM_INTERNAL_ERROR", "Tool registry failed", {
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export async function listAllTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolDefinition[]> {
  return withRegistry(options, (registry) => registry.tools);
}

export async function listAgentTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolDefinition[]> {
  return withRegistry(options, (registry) =>
    registry.tools.filter((tool) => tool.category === "agent"),
  );
}

export async function listSetupTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolDefinition[]> {
  return withRegistry(options, (registry) =>
    registry.tools.filter((tool) => tool.category === "tool"),
  );
}

export async function getRequiredTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolDefinition[]> {
  return withRegistry(options, (registry) =>
    registry.tools.filter((tool) => isRequiredTool(tool)),
  );
}

export async function getRecommendedTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolDefinition[]> {
  return withRegistry(options, (registry) =>
    registry.tools.filter((tool) => isRecommendedTool(tool)),
  );
}

export async function getOptionalTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolDefinition[]> {
  return withRegistry(options, (registry) =>
    registry.tools.filter((tool) => isOptionalTool(tool)),
  );
}

export interface PhaseGroup {
  phase: number;
  tools: ToolDefinition[];
}

/**
 * Get tools grouped by installation phase.
 * Tools without a phase are assigned to phase 999 (last).
 * Returns groups sorted by phase number (ascending).
 */
export async function getToolsByPhase(
  options: ToolRegistryAccessOptions = {},
): Promise<PhaseGroup[]> {
  return withRegistry(options, (registry) => {
    const phaseMap = new Map<number, ToolDefinition[]>();

    for (const tool of registry.tools) {
      const phase = tool.phase ?? 999;
      const existing = phaseMap.get(phase) ?? [];
      existing.push(tool);
      phaseMap.set(phase, existing);
    }

    // Sort by phase number and return
    return Array.from(phaseMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([phase, tools]) => ({ phase, tools }));
  });
}

export interface ToolCategorization {
  required: ToolDefinition[];
  recommended: ToolDefinition[];
  optional: ToolDefinition[];
}

/**
 * Get all tools categorized by priority (required/recommended/optional).
 */
export async function categorizeTools(
  options: ToolRegistryAccessOptions = {},
): Promise<ToolCategorization> {
  return withRegistry(options, (registry) => {
    const required: ToolDefinition[] = [];
    const recommended: ToolDefinition[] = [];
    const optional: ToolDefinition[] = [];

    for (const tool of registry.tools) {
      if (isRequiredTool(tool)) {
        required.push(tool);
      } else if (isRecommendedTool(tool)) {
        recommended.push(tool);
      } else {
        optional.push(tool);
      }
    }

    return { required, recommended, optional };
  });
}
