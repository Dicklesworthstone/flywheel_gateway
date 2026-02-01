/**
 * Configuration Service
 *
 * Supports flywheel.config.ts with multi-layer precedence and validation.
 *
 * Precedence (highest to lowest):
 * 1. Environment variables (override everything)
 * 2. Project config (CWD/flywheel.config.ts)
 * 3. User config (~/.config/flywheel/config.ts)
 * 4. Default values
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Server configuration schema.
 */
const serverConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(3000),
  host: z.string().default("127.0.0.1"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/**
 * Database configuration schema.
 */
const databaseConfigSchema = z.object({
  path: z.string().default("./flywheel.db"),
  slowQueryMs: z.number().min(0).default(100),
  enableWal: z.boolean().default(true),
});

/**
 * Agent configuration schema.
 */
const agentConfigSchema = z.object({
  defaultModel: z.string().default("claude-sonnet-4-20250514"),
  maxConcurrent: z.number().min(1).max(100).default(10),
  timeoutMs: z.number().min(1000).default(300_000), // 5 minutes
  checkpointEnabled: z.boolean().default(true),
});

/**
 * Security configuration schema.
 */
const securityConfigSchema = z.object({
  dcgEnabled: z.boolean().default(true),
  dcgStrictMode: z.boolean().default(false),
  allowedOrigins: z.array(z.string()).default(["*"]),
  rateLimitEnabled: z.boolean().default(true),
  rateLimitPerMinute: z.number().min(1).default(60),
});

/**
 * WebSocket configuration schema.
 */
const websocketConfigSchema = z.object({
  heartbeatIntervalMs: z.number().min(1000).default(30_000),
  maxConnections: z.number().min(1).default(1000),
  messageBufferSize: z.number().min(1).default(100),
});

/**
 * Analytics configuration schema.
 */
const analyticsConfigSchema = z.object({
  cacheTtlMs: z.number().min(0).default(30_000),
  cacheMaxSize: z.number().min(1).default(500),
  metricsEnabled: z.boolean().default(true),
});

/**
 * NTM throttling configuration schema.
 */
const ntmThrottlingConfigSchema = z.object({
  /** Whether throttling is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Batch window for event throttling in milliseconds (default: 100) */
  batchWindowMs: z.number().min(10).default(100),
  /** Maximum events per batch before dropping oldest (default: 50) */
  maxEventsPerBatch: z.number().min(1).default(50),
  /** Per-key debounce window in milliseconds (default: 50) */
  debounceMs: z.number().min(0).default(50),
});

/**
 * NTM WebSocket bridge configuration schema.
 */
const ntmWsBridgeConfigSchema = z.object({
  /** Whether the WS bridge is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Interval between tail polling in milliseconds (default: 2000) */
  tailPollIntervalMs: z.number().min(500).default(2000),
  /** Number of lines to fetch from tail (default: 50) */
  tailLines: z.number().min(1).default(50),
  /** Whether to enable output streaming (default: true) */
  enableOutputStreaming: z.boolean().default(true),
  /** Throttling configuration */
  throttling: ntmThrottlingConfigSchema
    .optional()
    .transform((v) => ntmThrottlingConfigSchema.parse(v ?? {})),
});

/**
 * NTM (Named Tmux Manager) configuration schema.
 */
const ntmConfigSchema = z.object({
  /** Whether NTM integration is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Polling interval for NTM status in milliseconds (default: 5000) */
  pollIntervalMs: z.number().min(1000).default(5000),
  /** Command timeout in milliseconds (default: 10000) */
  commandTimeoutMs: z.number().min(1000).default(10_000),
  /** Maximum backoff multiplier for polling (default: 6, max 30s with 5s base) */
  maxBackoffMultiplier: z.number().min(1).max(20).default(6),
  /** WebSocket bridge configuration */
  wsBridge: ntmWsBridgeConfigSchema
    .optional()
    .transform((v) => ntmWsBridgeConfigSchema.parse(v ?? {})),
});

/**
 * Complete Flywheel configuration schema.
 */
export const flywheelConfigSchema = z.object({
  server: serverConfigSchema
    .optional()
    .transform((v) => serverConfigSchema.parse(v ?? {})),
  database: databaseConfigSchema
    .optional()
    .transform((v) => databaseConfigSchema.parse(v ?? {})),
  agent: agentConfigSchema
    .optional()
    .transform((v) => agentConfigSchema.parse(v ?? {})),
  security: securityConfigSchema
    .optional()
    .transform((v) => securityConfigSchema.parse(v ?? {})),
  websocket: websocketConfigSchema
    .optional()
    .transform((v) => websocketConfigSchema.parse(v ?? {})),
  analytics: analyticsConfigSchema
    .optional()
    .transform((v) => analyticsConfigSchema.parse(v ?? {})),
  ntm: ntmConfigSchema
    .optional()
    .transform((v) => ntmConfigSchema.parse(v ?? {})),
});

export type FlywheelConfig = z.infer<typeof flywheelConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type WebsocketConfig = z.infer<typeof websocketConfigSchema>;
export type AnalyticsConfig = z.infer<typeof analyticsConfigSchema>;
export type NtmConfig = z.infer<typeof ntmConfigSchema>;
export type NtmWsBridgeConfig = z.infer<typeof ntmWsBridgeConfigSchema>;
export type NtmThrottlingConfig = z.infer<typeof ntmThrottlingConfigSchema>;

// ============================================================================
// Configuration Loading
// ============================================================================

/** Cached configuration */
let cachedConfig: FlywheelConfig | null = null;

/** Configuration sources for logging */
interface ConfigSource {
  path: string;
  loaded: boolean;
  error?: string;
}

/**
 * Get user config directory path.
 */
function getUserConfigDir(): string {
  return join(homedir(), ".config", "flywheel");
}

/**
 * Get user config file path.
 */
function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.ts");
}

/**
 * Get project config file path.
 */
function getProjectConfigPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), "flywheel.config.ts");
}

/**
 * Load config from a TypeScript file using Bun's dynamic import.
 */
async function loadConfigFile(path: string): Promise<{
  config: Partial<FlywheelConfig>;
  loaded: boolean;
  error?: string;
}> {
  if (!existsSync(path)) {
    return { config: {}, loaded: false };
  }

  try {
    // Bun can import TypeScript directly
    const module = await import(path);
    const config = module.default ?? module.config ?? module;

    // Basic validation that it's an object
    if (typeof config !== "object" || config === null) {
      return {
        config: {},
        loaded: false,
        error: `Config file ${path} does not export an object`,
      };
    }

    return { config: config as Partial<FlywheelConfig>, loaded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: {}, loaded: false, error: message };
  }
}

/**
 * Deep merge two config objects.
 * Later values override earlier values.
 */
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>,
): T {
  const result = { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideValue = override[key];
    const baseValue = result[key];

    if (
      overrideValue !== undefined &&
      typeof overrideValue === "object" &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      // Recursively merge nested objects
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>,
      ) as T[keyof T];
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue as T[keyof T];
    }
  }

  return result;
}

/** Deep partial type for config building */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Apply environment variable overrides.
 */
function applyEnvOverrides(
  config: Partial<FlywheelConfig>,
): Partial<FlywheelConfig> {
  // Use DeepPartial internally since we build up partial nested objects
  const result: DeepPartial<FlywheelConfig> = { ...config };

  // Server overrides
  if (process.env["PORT"]) {
    result.server = { ...result.server, port: Number(process.env["PORT"]) };
  }
  if (process.env["HOST"]) {
    result.server = { ...result.server, host: process.env["HOST"] };
  }
  if (process.env["LOG_LEVEL"]) {
    const level = process.env["LOG_LEVEL"] as
      | "debug"
      | "info"
      | "warn"
      | "error";
    result.server = { ...result.server, logLevel: level };
  }

  // Database overrides
  if (process.env["DB_PATH"]) {
    result.database = { ...result.database, path: process.env["DB_PATH"] };
  }
  if (process.env["DB_SLOW_QUERY_MS"]) {
    result.database = {
      ...result.database,
      slowQueryMs: Number(process.env["DB_SLOW_QUERY_MS"]),
    };
  }

  // Agent overrides
  if (process.env["DEFAULT_MODEL"]) {
    result.agent = {
      ...result.agent,
      defaultModel: process.env["DEFAULT_MODEL"],
    };
  }
  if (process.env["MAX_CONCURRENT_AGENTS"]) {
    result.agent = {
      ...result.agent,
      maxConcurrent: Number(process.env["MAX_CONCURRENT_AGENTS"]),
    };
  }
  if (process.env["AGENT_TIMEOUT_MS"]) {
    result.agent = {
      ...result.agent,
      timeoutMs: Number(process.env["AGENT_TIMEOUT_MS"]),
    };
  }

  // Security overrides
  if (process.env["DCG_ENABLED"]) {
    result.security = {
      ...result.security,
      dcgEnabled: process.env["DCG_ENABLED"] === "true",
    };
  }
  if (process.env["DCG_STRICT_MODE"]) {
    result.security = {
      ...result.security,
      dcgStrictMode: process.env["DCG_STRICT_MODE"] === "true",
    };
  }
  if (process.env["ALLOWED_ORIGINS"]) {
    result.security = {
      ...result.security,
      allowedOrigins: process.env["ALLOWED_ORIGINS"].split(","),
    };
  }
  if (process.env["RATE_LIMIT_ENABLED"]) {
    result.security = {
      ...result.security,
      rateLimitEnabled: process.env["RATE_LIMIT_ENABLED"] === "true",
    };
  }
  if (process.env["RATE_LIMIT_PER_MINUTE"]) {
    result.security = {
      ...result.security,
      rateLimitPerMinute: Number(process.env["RATE_LIMIT_PER_MINUTE"]),
    };
  }

  // Analytics overrides
  if (process.env["CACHE_TTL_MS"]) {
    result.analytics = {
      ...result.analytics,
      cacheTtlMs: Number(process.env["CACHE_TTL_MS"]),
    };
  }

  // NTM overrides
  if (process.env["NTM_ENABLED"]) {
    result.ntm = {
      ...result.ntm,
      enabled: process.env["NTM_ENABLED"] === "true",
    };
  }
  if (process.env["NTM_POLL_INTERVAL_MS"]) {
    result.ntm = {
      ...result.ntm,
      pollIntervalMs: Number(process.env["NTM_POLL_INTERVAL_MS"]),
    };
  }
  if (process.env["NTM_COMMAND_TIMEOUT_MS"]) {
    result.ntm = {
      ...result.ntm,
      commandTimeoutMs: Number(process.env["NTM_COMMAND_TIMEOUT_MS"]),
    };
  }
  if (process.env["NTM_MAX_BACKOFF_MULTIPLIER"]) {
    result.ntm = {
      ...result.ntm,
      maxBackoffMultiplier: Number(process.env["NTM_MAX_BACKOFF_MULTIPLIER"]),
    };
  }
  if (process.env["NTM_WS_BRIDGE_ENABLED"]) {
    result.ntm = {
      ...result.ntm,
      wsBridge: {
        ...result.ntm?.wsBridge,
        enabled: process.env["NTM_WS_BRIDGE_ENABLED"] === "true",
      },
    };
  }
  if (process.env["NTM_WS_TAIL_POLL_INTERVAL_MS"]) {
    result.ntm = {
      ...result.ntm,
      wsBridge: {
        ...result.ntm?.wsBridge,
        tailPollIntervalMs: Number(process.env["NTM_WS_TAIL_POLL_INTERVAL_MS"]),
      },
    };
  }
  if (process.env["NTM_WS_THROTTLING_ENABLED"]) {
    result.ntm = {
      ...result.ntm,
      wsBridge: {
        ...result.ntm?.wsBridge,
        throttling: {
          ...result.ntm?.wsBridge?.throttling,
          enabled: process.env["NTM_WS_THROTTLING_ENABLED"] === "true",
        },
      },
    };
  }

  // Cast back to Partial - Zod validation will fill in defaults
  return result as Partial<FlywheelConfig>;
}

/**
 * Load and validate the complete configuration.
 *
 * Loads from multiple sources with the following precedence:
 * 1. Environment variables (highest)
 * 2. Project config (CWD/flywheel.config.ts)
 * 3. User config (~/.config/flywheel/config.ts)
 * 4. Defaults (lowest)
 */
export async function loadConfig(
  options: { cwd?: string; forceReload?: boolean } = {},
): Promise<FlywheelConfig> {
  const { cwd, forceReload = false } = options;
  const log = getLogger();

  // Return cached config if available and not forcing reload
  if (cachedConfig && !forceReload) {
    return cachedConfig;
  }

  const sources: ConfigSource[] = [];

  // Start with empty config
  let mergedConfig: Partial<FlywheelConfig> = {};

  // 1. Load user config (lowest precedence after defaults)
  const userConfigPath = getUserConfigPath();
  const userResult = await loadConfigFile(userConfigPath);
  sources.push({
    path: userConfigPath,
    loaded: userResult.loaded,
    ...(userResult.error !== undefined ? { error: userResult.error } : {}),
  });
  if (userResult.loaded) {
    mergedConfig = deepMerge(mergedConfig, userResult.config);
  }

  // 2. Load project config (higher precedence)
  const projectConfigPath = getProjectConfigPath(cwd);
  const projectResult = await loadConfigFile(projectConfigPath);
  sources.push({
    path: projectConfigPath,
    loaded: projectResult.loaded,
    ...(projectResult.error !== undefined
      ? { error: projectResult.error }
      : {}),
  });
  if (projectResult.loaded) {
    mergedConfig = deepMerge(mergedConfig, projectResult.config);
  }

  // 3. Apply environment variable overrides (highest precedence)
  mergedConfig = applyEnvOverrides(mergedConfig);

  // 4. Validate and apply defaults
  const parseResult = flywheelConfigSchema.safeParse(mergedConfig);

  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");

    log.error(
      {
        type: "config:validation_error",
        correlationId: getCorrelationId(),
        errors: parseResult.error.issues,
        sources,
      },
      `Configuration validation failed: ${errors}`,
    );

    throw new Error(`Configuration validation failed: ${errors}`);
  }

  // Log which sources were loaded
  log.info(
    {
      type: "config:loaded",
      correlationId: getCorrelationId(),
      sources: sources.map((s) => ({
        path: s.path,
        loaded: s.loaded,
        error: s.error,
      })),
      overriddenKeys: getOverriddenKeys(mergedConfig),
    },
    "Configuration loaded",
  );

  // Cache the validated config
  cachedConfig = parseResult.data;
  return cachedConfig;
}

/**
 * Get the current configuration (synchronous, must be loaded first).
 */
export function getConfig(): FlywheelConfig {
  if (!cachedConfig) {
    // Return defaults if not loaded yet
    return flywheelConfigSchema.parse({});
  }
  return cachedConfig;
}

/**
 * Clear the cached configuration.
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get keys that were explicitly set (not defaults).
 */
function getOverriddenKeys(config: Partial<FlywheelConfig>): string[] {
  const keys: string[] = [];

  function traverse(obj: Record<string, unknown>, prefix: string) {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        traverse(value as Record<string, unknown>, path);
      } else if (value !== undefined) {
        keys.push(path);
      }
    }
  }

  traverse(config as Record<string, unknown>, "");
  return keys;
}

// ============================================================================
// Exports
// ============================================================================

export { getUserConfigDir, getUserConfigPath, getProjectConfigPath };
