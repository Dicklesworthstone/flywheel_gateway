/**
 * Agent CLI Auto-Detection Service
 *
 * Detects installed agent CLIs and setup tools with capability probing,
 * version checking, and authentication status.
 *
 * Detection Targets:
 * - Registry-defined agents/tools from ACFS manifest
 * - Curated fallback list when registry is unavailable
 */

import type { ToolDefinition } from "@flywheel/shared";
import { getLogger } from "../middleware/correlation";
import { listAllTools } from "./tool-registry.service";

// ============================================================================
// Types
// ============================================================================

export type AgentType = "claude" | "codex" | "gemini" | "aider" | "gh-copilot";

export type ToolType = "dcg" | "ubs" | "cass" | "cm" | "br" | "bv" | "ru";

export type KnownDetectedType = AgentType | ToolType;

export type DetectedType = string;

export interface DetectedCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  codeExecution: boolean;
  fileAccess: boolean;
}

export interface DetectedCLI {
  name: DetectedType;
  available: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  authError?: string;
  capabilities: DetectedCapabilities;
  detectedAt: Date;
  durationMs: number;
}

export interface DetectionResult {
  agents: DetectedCLI[];
  tools: DetectedCLI[];
  summary: {
    agentsAvailable: number;
    agentsTotal: number;
    toolsAvailable: number;
    toolsTotal: number;
    authIssues: string[];
  };
  detectedAt: Date;
  durationMs: number;
}

// ============================================================================
// CLI Definitions
// ============================================================================

interface CLIDefinition {
  name: DetectedType;
  commands: string[]; // Try these in order
  versionFlag: string;
  authCheckCmd?: string[]; // Command to check authentication
  capabilities: DetectedCapabilities;
}

/**
 * ACFS manifest mapping note (bd-2k5b)
 * Source: acfs.manifest.yaml modules[] in agentic_coding_flywheel_setup.
 *
 * Mapping → DetectedCLI (auto-detection):
 * - module.installed_check.command hints the canonical binary (e.g. command -v <bin>)
 * - module.verify usually includes "<bin> --version" or "<bin> --help" → versionFlag
 * - module.dependencies / tags do not affect detection but inform readiness/UI
 * - authCheckCmd + capabilities remain curated here until ACFS adds explicit fields
 */
const FALLBACK_AGENT_CLIS: CLIDefinition[] = [
  {
    name: "claude",
    commands: ["claude"],
    versionFlag: "--version",
    authCheckCmd: ["claude", "auth", "status"],
    capabilities: {
      streaming: true,
      toolUse: true,
      vision: true,
      codeExecution: true,
      fileAccess: true,
    },
  },
  {
    name: "codex",
    commands: ["codex"],
    versionFlag: "--version",
    authCheckCmd: ["codex", "auth", "whoami"],
    capabilities: {
      streaming: true,
      toolUse: true,
      vision: false,
      codeExecution: true,
      fileAccess: true,
    },
  },
  {
    name: "gemini",
    commands: ["gemini"],
    versionFlag: "--version",
    capabilities: {
      streaming: true,
      toolUse: true,
      vision: true,
      codeExecution: true,
      fileAccess: true,
    },
  },
  {
    name: "aider",
    commands: ["aider"],
    versionFlag: "--version",
    capabilities: {
      streaming: true,
      toolUse: false,
      vision: false,
      codeExecution: true,
      fileAccess: true,
    },
  },
  {
    name: "gh-copilot",
    commands: ["gh", "copilot"],
    versionFlag: "--version",
    authCheckCmd: ["gh", "auth", "status"],
    capabilities: {
      streaming: true,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
];

const FALLBACK_TOOL_CLIS: CLIDefinition[] = [
  {
    name: "dcg",
    commands: ["dcg"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
  {
    name: "ubs",
    commands: ["ubs"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
  {
    name: "cass",
    commands: ["cass"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
  {
    name: "cm",
    commands: ["cm"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
  {
    name: "br",
    commands: ["br"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
  {
    name: "bv",
    commands: ["bv"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
  {
    name: "ru",
    commands: ["ru"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
  },
];

const FALLBACK_DEFINITIONS = new Map<string, CLIDefinition>(
  [...FALLBACK_AGENT_CLIS, ...FALLBACK_TOOL_CLIS].map((def) => [def.name, def]),
);

const DEFAULT_AGENT_CAPABILITIES: DetectedCapabilities = {
  streaming: false,
  toolUse: false,
  vision: false,
  codeExecution: false,
  fileAccess: false,
};

const DEFAULT_TOOL_CAPABILITIES: DetectedCapabilities = {
  streaming: false,
  toolUse: false,
  vision: false,
  codeExecution: false,
  fileAccess: false,
};

const VERSION_FLAG_TOKENS = new Set(["--version", "-v", "-V", "version"]);

function deriveCommandSpec(
  tool: ToolDefinition,
  fallback?: CLIDefinition,
): { commands: string[]; versionFlag: string } {
  if (fallback) {
    return { commands: fallback.commands, versionFlag: fallback.versionFlag };
  }

  const verifyCommand = tool.verify?.command;
  if (verifyCommand && verifyCommand.length > 0) {
    const last = verifyCommand[verifyCommand.length - 1];
    if (verifyCommand.length > 1 && VERSION_FLAG_TOKENS.has(last)) {
      const commands = verifyCommand.slice(0, -1);
      return {
        commands: commands.length > 0 ? commands : [tool.name],
        versionFlag: last,
      };
    }
    if (verifyCommand.length === 1) {
      return { commands: verifyCommand, versionFlag: "--version" };
    }
  }

  return { commands: [tool.name], versionFlag: "--version" };
}

function deriveCapabilities(
  tool: ToolDefinition,
  fallback?: CLIDefinition,
): DetectedCapabilities {
  if (fallback) return fallback.capabilities;
  return tool.category === "agent"
    ? DEFAULT_AGENT_CAPABILITIES
    : DEFAULT_TOOL_CAPABILITIES;
}

function buildCLIDefinition(tool: ToolDefinition): CLIDefinition {
  const fallback = FALLBACK_DEFINITIONS.get(tool.name);
  const { commands, versionFlag } = deriveCommandSpec(tool, fallback);

  return {
    name: tool.name,
    commands,
    versionFlag,
    authCheckCmd: fallback?.authCheckCmd,
    capabilities: deriveCapabilities(tool, fallback),
  };
}

async function getRegistryDefinitions(): Promise<{
  agents: CLIDefinition[];
  tools: CLIDefinition[];
}> {
  const log = getLogger();

  try {
    const registryTools = await listAllTools();
    if (registryTools.length === 0) {
      return {
        agents: FALLBACK_AGENT_CLIS,
        tools: FALLBACK_TOOL_CLIS,
      };
    }

    const agents: CLIDefinition[] = [];
    const tools: CLIDefinition[] = [];
    const seen = new Set<string>();

    for (const tool of registryTools) {
      if (!tool.name || seen.has(tool.name)) continue;
      seen.add(tool.name);

      const def = buildCLIDefinition(tool);
      if (tool.category === "agent") {
        agents.push(def);
      } else {
        tools.push(def);
      }
    }

    return { agents, tools };
  } catch (error) {
    log.warn({ error }, "Failed to load ToolRegistry; using fallback detection list");
    return {
      agents: FALLBACK_AGENT_CLIS,
      tools: FALLBACK_TOOL_CLIS,
    };
  }
}

// ============================================================================
// Detection Helpers
// ============================================================================

/**
 * Find executable path using 'which' (Unix) or 'where' (Windows)
 */
async function findExecutable(command: string): Promise<string | null> {
  const isWindows = process.platform === "win32";
  const findCmd = isWindows ? "where" : "which";

  try {
    const proc = Bun.spawn([findCmd, command], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0 && stdout.trim()) {
      // Return first line (in case of multiple matches)
      return stdout.trim().split("\n")[0]!;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get version from CLI
 */
async function getVersion(
  commands: string[],
  versionFlag: string,
): Promise<string | null> {
  try {
    const args = [...commands, versionFlag];
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    // Some CLIs output version to stderr
    const output = stdout.trim() || stderr.trim();

    if (exitCode === 0 && output) {
      // Extract version pattern (e.g., "v1.2.3" or "1.2.3")
      const versionMatch = output.match(/v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/);
      return versionMatch ? versionMatch[0] : output.slice(0, 50);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check authentication status
 */
async function checkAuth(
  authCmd: string[],
): Promise<{ authenticated: boolean; error?: string }> {
  try {
    const proc = Bun.spawn(authCmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    // Exit code 0 typically means authenticated
    if (exitCode === 0) {
      return { authenticated: true };
    }

    // Check for common auth error patterns
    const output = (stdout + stderr).toLowerCase();
    if (
      output.includes("not logged in") ||
      output.includes("not authenticated") ||
      output.includes("unauthorized") ||
      output.includes("no api key") ||
      output.includes("missing credentials")
    ) {
      return {
        authenticated: false,
        error: "Not authenticated - run auth/login command",
      };
    }

    return {
      authenticated: false,
      error: stderr.trim() || "Auth check failed",
    };
  } catch (error) {
    return {
      authenticated: false,
      error: error instanceof Error ? error.message : "Auth check failed",
    };
  }
}

/**
 * Detect a single CLI
 */
async function detectCLI(def: CLIDefinition): Promise<DetectedCLI> {
  const startTime = performance.now();
  const log = getLogger();

  // Find the primary executable
  const primaryCmd = def.commands[0]!;
  const path = await findExecutable(primaryCmd);

  if (!path) {
    log.debug({ cli: def.name }, "CLI not found in PATH");
    return {
      name: def.name,
      available: false,
      capabilities: def.capabilities,
      detectedAt: new Date(),
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Get version using the found path
  const versionArgs = [path, ...def.commands.slice(1)];
  const version = await getVersion(versionArgs, def.versionFlag);

  // Check authentication if applicable
  let authenticated: boolean | undefined;
  let authError: string | undefined;

  if (def.authCheckCmd) {
    // Use full path for auth check to ensure we test the same binary
    const authCmd = [...def.authCheckCmd];
    if (authCmd[0] === primaryCmd) {
      authCmd[0] = path;
    }
    const authResult = await checkAuth(authCmd);
    authenticated = authResult.authenticated;
    authError = authResult.error;
  }

  const durationMs = Math.round(performance.now() - startTime);

  log.info(
    {
      cli: def.name,
      path,
      version,
      authenticated,
      durationMs,
    },
    "CLI detected",
  );

  return {
    name: def.name,
    available: true,
    path,
    ...(version != null && { version }),
    ...(authenticated != null && { authenticated }),
    ...(authError != null && { authError }),
    capabilities: def.capabilities,
    detectedAt: new Date(),
    durationMs,
  };
}

// ============================================================================
// Cache
// ============================================================================

interface DetectionCache {
  result: DetectionResult;
  expiresAt: number;
}

let cache: DetectionCache | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Clear the detection cache
 */
export function clearDetectionCache(): void {
  cache = null;
}

// ============================================================================
// Main Detection Functions
// ============================================================================

/**
 * Detect all agent CLIs in parallel
 */
export async function detectAgentCLIs(): Promise<DetectedCLI[]> {
  const { agents } = await getRegistryDefinitions();
  return Promise.all(agents.map(detectCLI));
}

/**
 * Detect all setup tools in parallel
 */
export async function detectToolCLIs(): Promise<DetectedCLI[]> {
  const { tools } = await getRegistryDefinitions();
  return Promise.all(tools.map(detectCLI));
}

/**
 * Detect all CLIs with caching
 */
export async function detectAllCLIs(
  bypassCache = false,
): Promise<DetectionResult> {
  const log = getLogger();

  // Check cache
  if (!bypassCache && cache && Date.now() < cache.expiresAt) {
    log.debug("Returning cached detection result");
    return cache.result;
  }

  const startTime = performance.now();
  log.info("Starting CLI detection");

  // Detect agents and tools in parallel
  const { agents: agentDefs, tools: toolDefs } =
    await getRegistryDefinitions();
  const [agents, tools] = await Promise.all([
    Promise.all(agentDefs.map(detectCLI)),
    Promise.all(toolDefs.map(detectCLI)),
  ]);

  // Collect auth issues
  const authIssues: string[] = [];
  for (const cli of [...agents, ...tools]) {
    if (cli.available && cli.authenticated === false && cli.authError) {
      authIssues.push(`${cli.name}: ${cli.authError}`);
    }
  }

  const result: DetectionResult = {
    agents,
    tools,
    summary: {
      agentsAvailable: agents.filter((a) => a.available).length,
      agentsTotal: agents.length,
      toolsAvailable: tools.filter((t) => t.available).length,
      toolsTotal: tools.length,
      authIssues,
    },
    detectedAt: new Date(),
    durationMs: Math.round(performance.now() - startTime),
  };

  // Update cache
  cache = {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  log.info(
    {
      agentsAvailable: result.summary.agentsAvailable,
      toolsAvailable: result.summary.toolsAvailable,
      authIssues: authIssues.length,
      durationMs: result.durationMs,
    },
    "CLI detection complete",
  );

  return result;
}

/**
 * Detect a specific CLI by name
 */
export async function detectCLIByName(
  name: DetectedType,
): Promise<DetectedCLI | null> {
  const { agents, tools } = await getRegistryDefinitions();
  const def = agents.find((d) => d.name === name) || tools.find((d) => d.name === name);

  if (!def) {
    return null;
  }

  return detectCLI(def);
}

// ============================================================================
// Service Interface
// ============================================================================

export interface AgentDetectionService {
  /** Detect all CLIs (agents + tools) */
  detectAll(bypassCache?: boolean): Promise<DetectionResult>;

  /** Detect only agent CLIs */
  detectAgents(): Promise<DetectedCLI[]>;

  /** Detect only tool CLIs */
  detectTools(): Promise<DetectedCLI[]>;

  /** Detect a specific CLI by name */
  detect(name: DetectedType): Promise<DetectedCLI | null>;

  /** Clear the detection cache */
  clearCache(): void;

  /** Get cache status */
  getCacheStatus(): { cached: boolean; expiresIn?: number };
}

export function createAgentDetectionService(): AgentDetectionService {
  return {
    detectAll: detectAllCLIs,
    detectAgents: detectAgentCLIs,
    detectTools: detectToolCLIs,
    detect: detectCLIByName,
    clearCache: clearDetectionCache,
    getCacheStatus() {
      if (!cache) {
        return { cached: false };
      }
      const expiresIn = cache.expiresAt - Date.now();
      if (expiresIn <= 0) {
        return { cached: false };
      }
      return { cached: true, expiresIn };
    },
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: AgentDetectionService | null = null;

export function getAgentDetectionService(): AgentDetectionService {
  if (!serviceInstance) {
    serviceInstance = createAgentDetectionService();
  }
  return serviceInstance;
}
