/**
 * Tool Registry Service
 *
 * Loads and validates the ACFS tool registry manifest (YAML) with caching.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ToolRegistry } from "@flywheel/shared";
import { createGatewayError } from "@flywheel/shared/errors";
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

const ToolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(["agent", "tool"]),
  tags: z.array(z.string()).optional(),
  optional: z.boolean().optional(),
  enabledByDefault: z.boolean().optional(),
  docsUrl: z.string().optional(),
  install: z.array(InstallSpecSchema).optional(),
  verify: VerificationSpecSchema.optional(),
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
    process.env["ACFS_MANIFEST_TTL_MS"] ??
    process.env["TOOL_REGISTRY_TTL_MS"];
  const ttl = Number(raw);
  if (Number.isFinite(ttl) && ttl >= 0) return ttl;
  return DEFAULT_CACHE_TTL_MS;
}

function parseManifest(content: string, sourcePath: string): ToolRegistry {
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
          cause: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }

  const result = ToolRegistrySchema.safeParse(raw);
  if (!result.success) {
    throw createGatewayError(
      "SYSTEM_INTERNAL_ERROR",
      "Tool registry manifest failed validation",
      {
        details: {
          path: sourcePath,
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
    log.debug({ manifestPath, ttlMs }, "Tool registry cache hit");
    return cached.registry;
  }

  if (!existsSync(manifestPath)) {
    throw createGatewayError(
      "SYSTEM_UNAVAILABLE",
      "Tool registry manifest not found",
      { details: { path: manifestPath } },
    );
  }

  const start = performance.now();
  const content = await readFile(manifestPath, "utf-8");
  const registry = parseManifest(content, manifestPath);
  const latencyMs = Math.round(performance.now() - start);

  cached = { registry, path: manifestPath, loadedAt: Date.now() };
  log.info({ manifestPath, latencyMs }, "Tool registry loaded");

  return registry;
}

export function clearToolRegistryCache(): void {
  cached = undefined;
}
