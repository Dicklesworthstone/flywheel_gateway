/**
 * Secret Loader Service (bd-2n73.12)
 *
 * Provides secure loading hooks for tool secrets and credentials
 * from the private overlay directory and environment variables.
 *
 * Security guarantees:
 * - Secrets are never logged (even at debug level)
 * - Error messages never contain secret values
 * - Missing secrets produce safe, actionable error messages
 * - Loading failures are isolated per-tool (one failure doesn't block others)
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type EnvMapping,
  loadEnvMapping,
  resolvePrivateDir,
  resolveToolSecret,
} from "./private-overlay.service";

// ============================================================================
// Types
// ============================================================================

export interface ToolSecretSpec {
  /** Tool name */
  tool: string;
  /** Secret key (e.g., "apiKey", "token", "credentials") */
  key: string;
  /** Whether this secret is required for the tool to function */
  required: boolean;
  /** Description for error messages (never includes the value) */
  description: string;
}

export interface ResolvedSecret {
  tool: string;
  key: string;
  /** Whether the secret was found */
  found: boolean;
  /** The source of the secret (for diagnostics — never the value itself) */
  source: "env" | "file" | "mapping" | "none";
  /** The actual secret value (only present when found) */
  value?: string;
}

export interface SecretLoadResult {
  /** All resolved secrets */
  secrets: ResolvedSecret[];
  /** Tools with missing required secrets */
  missingRequired: string[];
  /** Whether all required secrets are available */
  allRequiredPresent: boolean;
  /** Errors encountered during loading */
  errors: string[];
}

export interface SecretFileEntry {
  tool: string;
  key: string;
  value: string;
}

// ============================================================================
// Constants
// ============================================================================

const SECRETS_DIR = "secrets";
const SECRETS_INDEX_FILE = "secrets.yaml";

// ============================================================================
// File-Based Secret Loading
// ============================================================================

/**
 * Load secrets from the private directory's secrets/ folder.
 * Expected structure:
 *   secrets/
 *     secrets.yaml (index file mapping tool→key→filename)
 *     tool-secret.txt
 *
 * Or secrets.yaml can contain inline values:
 *   tools:
 *     dcg:
 *       <key>: "<redacted>"
 */
export async function loadSecretsFromDir(
  privateDir?: string,
): Promise<{ entries: SecretFileEntry[]; error?: string }> {
  const dir = privateDir ?? resolvePrivateDir();
  const secretsDir = path.join(dir, SECRETS_DIR);
  const indexPath = path.join(secretsDir, SECRETS_INDEX_FILE);

  if (!existsSync(indexPath)) {
    // Try flat secrets.yaml at private dir root
    const rootIndex = path.join(dir, SECRETS_INDEX_FILE);
    if (!existsSync(rootIndex)) {
      return { entries: [] };
    }
    return loadSecretsIndex(rootIndex, dir);
  }

  return loadSecretsIndex(indexPath, secretsDir);
}

async function loadSecretsIndex(
  indexPath: string,
  baseDir: string,
): Promise<{ entries: SecretFileEntry[]; error?: string }> {
  try {
    const content = await readFile(indexPath, "utf-8");
    const parsed = parseYaml(content) as {
      tools?: Record<string, Record<string, string>>;
    };

    if (!parsed?.tools) {
      return { entries: [] };
    }

    const entries: SecretFileEntry[] = [];
    const basePath = path.resolve(baseDir);

    for (const [tool, keys] of Object.entries(parsed.tools)) {
      for (const [key, valueOrFile] of Object.entries(keys)) {
        // If value starts with "file:", load from file
        if (valueOrFile.startsWith("file:")) {
          const filePath = path.resolve(basePath, valueOrFile.slice(5));
          if (!filePath.startsWith(`${basePath}${path.sep}`)) {
            continue;
          }
          if (existsSync(filePath)) {
            try {
              const fileValue = (await readFile(filePath, "utf-8")).trim();
              entries.push({ tool, key, value: fileValue });
            } catch {
              // Skip unreadable files
            }
          }
        } else {
          entries.push({ tool, key, value: valueOrFile });
        }
      }
    }

    return { entries };
  } catch (error) {
    return {
      entries: [],
      // Never include raw parse error messages since they may echo secret values.
      error: formatSecretsIndexError(error),
    };
  }
}

function formatSecretsIndexError(error: unknown): string {
  const prefix = "Failed to load secrets index";

  if (!(error instanceof Error)) return prefix;

  const errorCodeRaw = (error as unknown as { code?: unknown }).code;
  const errorCode = typeof errorCodeRaw === "string" ? errorCodeRaw : undefined;

  // YAMLParseError includes linePos/pos, which we can safely surface without leaking content.
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

// ============================================================================
// Secret Resolution
// ============================================================================

/**
 * Resolve a single tool secret from all available sources.
 * Priority: env mapping → conventional env var → secrets file → none
 */
export async function resolveSecret(
  spec: ToolSecretSpec,
  envMapping?: EnvMapping,
  fileEntries?: SecretFileEntry[],
): Promise<ResolvedSecret> {
  // 1. Try environment (mapping + convention)
  const mappedEnvVar = envMapping?.toolSecrets?.[spec.tool];
  const envValue = resolveToolSecret(spec.tool, envMapping, spec.key);
  if (envValue) {
    // Source is "mapping" only if the mapped env var actually provided the value
    const mappedVarValue = mappedEnvVar ? process.env[mappedEnvVar] : undefined;
    return {
      tool: spec.tool,
      key: spec.key,
      found: true,
      source: mappedEnvVar && mappedVarValue ? "mapping" : "env",
      value: envValue,
    };
  }

  // 2. Try file-based secrets
  if (fileEntries) {
    const entry = fileEntries.find(
      (e) => e.tool === spec.tool && e.key === spec.key,
    );
    if (entry) {
      return {
        tool: spec.tool,
        key: spec.key,
        found: true,
        source: "file",
        value: entry.value,
      };
    }
  }

  return {
    tool: spec.tool,
    key: spec.key,
    found: false,
    source: "none",
  };
}

/**
 * Load all tool secrets for a given set of specs.
 * Aggregates results with safe error reporting.
 */
export async function loadSecrets(
  specs: ToolSecretSpec[],
  privateDir?: string,
): Promise<SecretLoadResult> {
  const errors: string[] = [];

  // Load env mapping
  const dir = privateDir ?? resolvePrivateDir();
  const { envMapping, error: envError } = await loadEnvMapping(dir);
  if (envError) errors.push(envError);

  // Load file-based secrets
  const { entries: fileEntries, error: fileError } =
    await loadSecretsFromDir(dir);
  if (fileError) errors.push(fileError);

  // Resolve each spec
  const secrets: ResolvedSecret[] = [];
  for (const spec of specs) {
    const resolved = await resolveSecret(spec, envMapping, fileEntries);
    secrets.push(resolved);
  }

  const missingRequired = secrets
    .filter(
      (s) =>
        !s.found &&
        specs.find((sp) => sp.tool === s.tool && sp.key === s.key)?.required,
    )
    .map((s) => `${s.tool}:${s.key}`);

  return {
    secrets,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
    errors,
  };
}

// ============================================================================
// Safe Diagnostics
// ============================================================================

/**
 * Generate a safe diagnostic summary (no secret values).
 */
export function secretDiagnostics(result: SecretLoadResult): {
  total: number;
  found: number;
  missing: number;
  missingRequired: string[];
  sources: Record<string, number>;
} {
  const sources: Record<string, number> = {};
  for (const s of result.secrets) {
    sources[s.source] = (sources[s.source] ?? 0) + 1;
  }

  return {
    total: result.secrets.length,
    found: result.secrets.filter((s) => s.found).length,
    missing: result.secrets.filter((s) => !s.found).length,
    missingRequired: result.missingRequired,
    sources,
  };
}
