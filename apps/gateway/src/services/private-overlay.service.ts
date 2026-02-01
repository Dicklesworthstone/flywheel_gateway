/**
 * Private Overlay Service (bd-2n73.13)
 *
 * Loads and merges private configuration overlays from an external
 * directory (e.g., /data/projects/flywheel_private). Overlays can:
 * - Override/extend tool definitions (enable/disable, add auth, aliases)
 * - Supply environment-mapped secrets (TOOL_<NAME>_API_KEY)
 * - Provide per-environment configuration profiles
 *
 * When the private directory is absent, all operations gracefully no-op.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolRegistry } from "@flywheel/shared";
import { parse as parseYaml } from "yaml";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PRIVATE_DIR = "/data/projects/flywheel_private";
const OVERLAY_MANIFEST_FILE = "overlay.manifest.yaml";
const ENV_MAPPING_FILE = "env-mapping.yaml";

// ============================================================================
// Types
// ============================================================================

export interface ToolOverride {
  /** Tool name to override (must match an existing tool) */
  name: string;
  /** Fields to merge into the tool definition */
  overrides: Partial<Omit<ToolDefinition, "id" | "name">>;
  /** If true, disable this tool entirely */
  disabled?: boolean;
  /** Environment-specific enable/disable */
  environments?: Record<string, { enabled: boolean }>;
}

export interface OverlayManifest {
  /** Schema version for the overlay format */
  schemaVersion: string;
  /** Tool overrides keyed by tool name */
  tools?: ToolOverride[];
  /** Additional tools to inject (not in public manifest) */
  additionalTools?: ToolDefinition[];
}

export interface EnvMapping {
  /** Tool name → environment variable name for API key/secret */
  toolSecrets?: Record<string, string>;
  /** Generic key → env var mappings */
  config?: Record<string, string>;
}

export interface OverlayLoadResult {
  /** Whether the private directory exists */
  available: boolean;
  /** Overlay manifest (if loaded) */
  manifest?: OverlayManifest;
  /** Environment mapping (if loaded) */
  envMapping?: EnvMapping;
  /** Errors encountered during loading */
  errors: string[];
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolve the private overlay directory path.
 * Uses FLYWHEEL_PRIVATE_DIR env var or the default path.
 */
export function resolvePrivateDir(): string {
  return process.env["FLYWHEEL_PRIVATE_DIR"] ?? DEFAULT_PRIVATE_DIR;
}

/**
 * Check if the private overlay directory exists.
 */
export function isPrivateOverlayAvailable(): boolean {
  return existsSync(resolvePrivateDir());
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Load the overlay manifest from the private directory.
 * Returns undefined if the file doesn't exist (not an error).
 */
export async function loadOverlayManifest(
  privateDir?: string,
): Promise<{ manifest?: OverlayManifest; error?: string }> {
  const dir = privateDir ?? resolvePrivateDir();
  const manifestPath = path.join(dir, OVERLAY_MANIFEST_FILE);

  if (!existsSync(manifestPath)) {
    return {};
  }

  try {
    const content = await readFile(manifestPath, "utf-8");
    const parsed = parseYaml(content) as OverlayManifest;
    return { manifest: parsed };
  } catch (error) {
    return {
      error: formatYamlLoadError("overlay manifest", error),
    };
  }
}

/**
 * Load the environment mapping from the private directory.
 */
export async function loadEnvMapping(
  privateDir?: string,
): Promise<{ envMapping?: EnvMapping; error?: string }> {
  const dir = privateDir ?? resolvePrivateDir();
  const mappingPath = path.join(dir, ENV_MAPPING_FILE);

  if (!existsSync(mappingPath)) {
    return {};
  }

  try {
    const content = await readFile(mappingPath, "utf-8");
    const parsed = parseYaml(content) as EnvMapping;
    return { envMapping: parsed };
  } catch (error) {
    return {
      error: formatYamlLoadError("env mapping", error),
    };
  }
}

function formatYamlLoadError(subject: string, error: unknown): string {
  const prefix = `Failed to load ${subject}`;
  if (!(error instanceof Error)) return prefix;

  const errorCodeRaw = (error as unknown as { code?: unknown }).code;
  const errorCode = typeof errorCodeRaw === "string" ? errorCodeRaw : undefined;

  const linePosRaw = (error as unknown as { linePos?: unknown }).linePos;
  const linePos = Array.isArray(linePosRaw) ? linePosRaw : undefined;
  const firstPos =
    linePos &&
    linePos.length > 0 &&
    linePos[0] &&
    typeof linePos[0] === "object"
      ? (linePos[0] as { line?: unknown; col?: unknown })
      : undefined;
  const line =
    typeof firstPos?.line === "number" ? Math.max(1, firstPos.line) : undefined;
  const col =
    typeof firstPos?.col === "number" ? Math.max(1, firstPos.col) : undefined;

  const detailParts: string[] = [error.name];
  if (errorCode) detailParts.push(errorCode);
  if (line !== undefined && col !== undefined) {
    detailParts.push(`line ${line}, col ${col}`);
  }

  return `${prefix} (${detailParts.join(" ")})`;
}

/**
 * Load all overlay data from the private directory.
 */
export async function loadOverlay(
  privateDir?: string,
): Promise<OverlayLoadResult> {
  const dir = privateDir ?? resolvePrivateDir();

  if (!existsSync(dir)) {
    return { available: false, errors: [] };
  }

  const errors: string[] = [];
  const { manifest, error: manifestError } = await loadOverlayManifest(dir);
  if (manifestError) errors.push(manifestError);

  const { envMapping, error: envError } = await loadEnvMapping(dir);
  if (envError) errors.push(envError);

  const result: OverlayLoadResult = { available: true, errors };
  if (manifest !== undefined) result.manifest = manifest;
  if (envMapping !== undefined) result.envMapping = envMapping;
  return result;
}

// ============================================================================
// Merging
// ============================================================================

/**
 * Resolve a tool secret from environment variables.
 * Checks TOOL_<NAME>_<KEY> and mapped env var names.
 */
export function resolveToolSecret(
  toolName: string,
  envMapping?: EnvMapping,
  secretKey = "apiKey",
): string | undefined {
  const toolVarPart = toolName.toUpperCase().replace(/-/g, "_");
  const keyVarPart = secretKey
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");

  // Check explicit mapping first
  const mappedVar = envMapping?.toolSecrets?.[toolName];
  if (mappedVar) {
    const value = process.env[mappedVar];
    if (value) return value;
  }

  // Check conventional TOOL_<NAME>_<KEY> pattern
  const conventionVar = `TOOL_${toolVarPart}_${keyVarPart}`;
  return process.env[conventionVar];
}

/**
 * Resolve a config value from environment variables via mapping.
 */
export function resolveConfigValue(
  key: string,
  envMapping?: EnvMapping,
): string | undefined {
  const mappedVar = envMapping?.config?.[key];
  if (mappedVar) return process.env[mappedVar];
  return undefined;
}

/**
 * Apply overlay overrides to a tool registry.
 * Returns a new registry with overrides applied — does not mutate the input.
 */
export function applyOverlay(
  registry: ToolRegistry,
  overlay: OverlayManifest,
  environment?: string,
): ToolRegistry {
  const toolMap = new Map(registry.tools.map((t) => [t.name, { ...t }]));

  // Apply tool overrides
  for (const override of overlay.tools ?? []) {
    const existing = toolMap.get(override.name);
    if (!existing) continue;

    // Check environment-specific enable/disable
    if (environment && override.environments?.[environment]) {
      if (!override.environments[environment].enabled) {
        toolMap.delete(override.name);
        continue;
      }
    }

    // Check global disable
    if (override.disabled) {
      toolMap.delete(override.name);
      continue;
    }

    // Merge overrides
    const merged = { ...existing, ...override.overrides };
    // Preserve id and name (non-overridable)
    merged.id = existing.id;
    merged.name = existing.name;
    toolMap.set(override.name, merged as ToolDefinition);
  }

  // Add additional tools
  for (const tool of overlay.additionalTools ?? []) {
    if (!toolMap.has(tool.name)) {
      toolMap.set(tool.name, tool);
    }
  }

  return {
    ...registry,
    tools: Array.from(toolMap.values()),
  };
}

/**
 * Get the current environment name from env vars.
 */
export function getCurrentEnvironment(): string | undefined {
  return process.env["FLYWHEEL_ENV"] ?? process.env["NODE_ENV"] ?? undefined;
}
