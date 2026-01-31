/**
 * Build Information Service.
 *
 * Provides version, build, and runtime information for health checks
 * and operational visibility.
 */

import { execSync } from "node:child_process";

// ============================================================================
// Types
// ============================================================================

export interface BuildInfo {
  /** Application version from package.json */
  version: string;
  /** Git commit SHA (short) */
  commit: string;
  /** Git branch name */
  branch: string;
  /** Build timestamp (server start time) */
  buildTime: string;
  /** Node.js/Bun version */
  runtime: string;
  /** Environment name */
  environment: string;
}

export interface RuntimeInfo {
  /** Server uptime in seconds */
  uptimeSeconds: number;
  /** Server uptime in human-readable format */
  uptimeFormatted: string;
  /** Memory usage in MB */
  memoryUsageMB: number;
  /** Process ID */
  pid: number;
}

export interface Capabilities {
  /** WebSocket support enabled */
  websocket: boolean;
  /** Checkpoints feature enabled */
  checkpoints: boolean;
  /** Fleet management enabled */
  fleet: boolean;
  /** Agent Mail integration available */
  agentMail: boolean;
  /** CASS integration available */
  cass: boolean;
  /** DCG (Destructive Command Guard) enabled */
  dcg: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Server startup timestamp */
const STARTUP_TIME = Date.now();

/** Build information (computed once at module load) */
const BUILD_INFO: BuildInfo = computeBuildInfo();

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Execute a git command and return the result, or a fallback value on error.
 */
function gitCommand(command: string, fallback: string): string {
  try {
    return execSync(command, { encoding: "utf-8", timeout: 1000 }).trim();
  } catch {
    return fallback;
  }
}

/**
 * Compute build information once at startup.
 */
function computeBuildInfo(): BuildInfo {
  const commit = gitCommand("git rev-parse --short HEAD", "unknown");
  const branch = gitCommand("git rev-parse --abbrev-ref HEAD", "unknown");

  return {
    version: process.env["npm_package_version"] || "0.0.0-dev",
    commit,
    branch,
    buildTime: new Date().toISOString(),
    runtime: `Bun ${Bun.version}`,
    environment: process.env["NODE_ENV"] || "development",
  };
}

/**
 * Compute available capabilities based on environment.
 */
function computeCapabilities(): Capabilities {
  const agentMailEnabled =
    process.env["AGENT_MAIL_MCP_ENABLED"] === "true" ||
    Boolean(process.env["AGENT_MAIL_MCP_COMMAND"]) ||
    // Legacy env var (kept for backward compatibility)
    Boolean(process.env["AGENTMAIL_URL"]);

  return {
    websocket: true,
    checkpoints: process.env["ENABLE_CHECKPOINTS"] !== "false",
    fleet: process.env["ENABLE_FLEET"] !== "false",
    agentMail: agentMailEnabled,
    cass: process.env["ENABLE_CASS"] !== "false",
    dcg: process.env["ENABLE_DCG"] !== "false",
  };
}

/**
 * Format uptime in human-readable format.
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get build information.
 */
export function getBuildInfo(): BuildInfo {
  return BUILD_INFO;
}

/**
 * Get runtime information including uptime and memory.
 */
export function getRuntimeInfo(): RuntimeInfo {
  const uptimeSeconds = Math.floor((Date.now() - STARTUP_TIME) / 1000);
  const memoryUsage = process.memoryUsage();

  return {
    uptimeSeconds,
    uptimeFormatted: formatUptime(uptimeSeconds),
    memoryUsageMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    pid: process.pid,
  };
}

/**
 * Get available capabilities.
 */
export function getCapabilities(): Capabilities {
  return computeCapabilities();
}

/**
 * Get server startup timestamp.
 */
export function getStartupTime(): Date {
  return new Date(STARTUP_TIME);
}
