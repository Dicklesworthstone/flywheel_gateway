/**
 * Tool Registry Service
 *
 * Loads and validates the ACFS tool registry manifest (YAML) with caching.
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

let cached:
  | {
      registry: ToolRegistry;
      path: string;
      loadedAt: number;
      manifestHash: string;
    }
  | undefined;

export interface ToolRegistryLoadOptions {
  bypassCache?: boolean;
  pathOverride?: string;
}

export async function loadToolRegistry(
  options: ToolRegistryLoadOptions = {},
): Promise<ToolRegistry> {
  const log = getLogger();
  const manifestPath = resolveManifestPath(options.pathOverride);
  const ttlMs = getCacheTtlMs();

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
      },
      "Tool registry cache hit",
    );
    return cached.registry;
  }

  if (!existsSync(manifestPath)) {
    log.warn(
      {
        manifestPath,
        manifestHash: null,
        schemaVersion: null,
        errorCategory: "manifest_missing",
      },
      "Tool registry manifest not found",
    );
    throw createGatewayError(
      "SYSTEM_UNAVAILABLE",
      "Tool registry manifest not found",
      { details: { path: manifestPath } },
    );
  }

  const start = performance.now();
  const content = await readFile(manifestPath, "utf-8");
  const manifestHash = createHash("sha256").update(content).digest("hex");
  let registry: ToolRegistry;
  try {
    registry = parseManifest(content, manifestPath, manifestHash);
  } catch (error) {
    const errorCategory =
      isGatewayError(error) && error.details?.["errorCategory"]
        ? String(error.details["errorCategory"])
        : "manifest_load_failed";
    const schemaVersion =
      isGatewayError(error) &&
      typeof error.details?.["schemaVersion"] === "string"
        ? String(error.details["schemaVersion"])
        : null;
    log.warn(
      {
        manifestPath,
        manifestHash,
        schemaVersion,
        errorCategory,
        error,
      },
      "Tool registry load failed",
    );
    throw error;
  }
  const latencyMs = Math.round(performance.now() - start);

  cached = {
    registry,
    path: manifestPath,
    loadedAt: Date.now(),
    manifestHash,
  };
  log.info(
    {
      manifestPath,
      schemaVersion: registry.schemaVersion,
      manifestHash,
      toolCount: registry.tools.length,
      latencyMs,
    },
    "Tool registry loaded",
  );

  return registry;
}

export function clearToolRegistryCache(): void {
  cached = undefined;
}

export interface ToolRegistryMetadata {
  manifestPath: string;
  schemaVersion: string;
  source?: string;
  generatedAt?: string;
  manifestHash: string;
  loadedAt: number;
}

export function getToolRegistryMetadata(): ToolRegistryMetadata | null {
  if (!cached) {
    return null;
  }

  const metadata: ToolRegistryMetadata = {
    manifestPath: cached.path,
    schemaVersion: cached.registry.schemaVersion,
    manifestHash: cached.manifestHash,
    loadedAt: cached.loadedAt,
  };

  if (cached.registry.source !== undefined) {
    metadata.source = cached.registry.source;
  }
  if (cached.registry.generatedAt !== undefined) {
    metadata.generatedAt = cached.registry.generatedAt;
  }

  return metadata;
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
