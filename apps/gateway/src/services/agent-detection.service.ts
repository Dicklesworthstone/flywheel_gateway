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
import { getToolRegistryMetadata, listAllTools } from "./tool-registry.service";

// ============================================================================
// Types
// ============================================================================

export type AgentType = "claude" | "codex" | "gemini" | "aider" | "gh-copilot";

export type ToolType =
  | "dcg"
  | "ubs"
  | "slb"
  | "cass"
  | "cm"
  | "br"
  | "bv"
  | "ru"
  | "ms"
  | "xf"
  | "pt"
  | "rch"
  | "giil"
  | "csctf"
  | "caam"
  | "ntm"
  | "scanner";

export type KnownDetectedType = AgentType | ToolType;

export type DetectedType = string;

export interface RobotModeInfo {
  /** Whether robot/machine-readable mode is supported */
  supported: boolean;
  /** Primary flag to enable robot output (e.g., "--json", "--robot") */
  flag?: string;
  /** Output formats this mode can produce */
  outputFormats?: string[];
  /** Whether output conforms to the standard JSON envelope */
  envelopeCompliant?: boolean;
}

export interface McpInfo {
  /** Whether the tool exposes an MCP server */
  available: boolean;
  /** Capability level (tools, resources, or full) */
  capabilities?: string;
  /** Estimated count of available MCP tools */
  toolCount?: number;
}

export interface DetectedCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  codeExecution: boolean;
  fileAccess: boolean;
  /** Robot/machine-readable output mode info */
  robotMode?: RobotModeInfo;
  /** MCP server info */
  mcp?: McpInfo;
}

export interface DetectedCLI {
  name: DetectedType;
  available: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  authError?: string;
  /** Canonical reason the tool is unavailable (only set when available=false). */
  unavailabilityReason?: import("@flywheel/shared/errors").ToolUnavailabilityReason;
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

interface InstalledCheck {
  command: string[];
  run_as?: "root" | "user";
  timeoutMs?: number;
  outputCapBytes?: number;
}

interface CLIDefinition {
  name: DetectedType;
  commands: string[]; // Try these in order
  versionFlag: string;
  authCheckCmd?: string[]; // Command to check authentication
  installedCheck?: InstalledCheck; // Manifest-defined install check
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
  // Safety & Security Tools
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
      robotMode: {
        supported: true,
        flag: "--format json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
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
      robotMode: {
        supported: true,
        flag: "--format json",
        outputFormats: ["json", "jsonl", "sarif"],
        envelopeCompliant: true,
      },
    },
  },
  {
    name: "slb",
    commands: ["slb"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
    },
  },
  // Session & Memory Tools
  {
    name: "cass",
    commands: ["cass"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--robot",
        outputFormats: ["json"],
        envelopeCompliant: false,
      },
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
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
      mcp: {
        available: true,
        capabilities: "full",
        toolCount: 10,
      },
    },
  },
  // Issue Tracking Tools
  {
    name: "br",
    commands: ["br"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
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
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--robot-triage",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
    },
  },
  // Repository & Project Tools
  {
    name: "ru",
    commands: ["ru"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
    },
  },
  // Knowledge & Search Tools
  {
    name: "ms",
    commands: ["ms"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
    },
  },
  {
    name: "xf",
    commands: ["xf"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
      robotMode: {
        supported: true,
        flag: "--format json",
        outputFormats: ["json", "jsonl"],
        envelopeCompliant: true,
      },
    },
  },
  // Process & System Tools
  {
    name: "pt",
    commands: ["pt"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
    },
  },
  {
    name: "rch",
    commands: ["rch"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
      robotMode: {
        supported: true,
        flag: "--json",
        outputFormats: ["json"],
        envelopeCompliant: true,
      },
    },
  },
  // Utilities & Converters
  {
    name: "giil",
    commands: ["giil"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
    },
  },
  {
    name: "csctf",
    commands: ["csctf"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
    },
  },
  // Account & Orchestration Tools
  {
    name: "caam",
    commands: ["caam"],
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
    name: "ntm",
    commands: ["ntm"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: true,
      fileAccess: true,
    },
  },
  // Code Analysis Tools
  {
    name: "scanner",
    commands: ["scanner"],
    versionFlag: "--version",
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: true,
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
    if (
      last !== undefined &&
      verifyCommand.length > 1 &&
      VERSION_FLAG_TOKENS.has(last)
    ) {
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
  // Start with base capabilities
  const base =
    fallback?.capabilities ??
    (tool.category === "agent"
      ? DEFAULT_AGENT_CAPABILITIES
      : DEFAULT_TOOL_CAPABILITIES);

  // Build result with robot mode and MCP info from manifest
  const result: DetectedCapabilities = { ...base };

  // Derive robot mode info from manifest
  if (tool.robotMode) {
    result.robotMode = {
      supported: true,
      flag: tool.robotMode.flag,
      outputFormats: tool.robotMode.outputFormats,
      ...(tool.robotMode.envelopeCompliant !== undefined
        ? { envelopeCompliant: tool.robotMode.envelopeCompliant }
        : {}),
    };
  }

  // Derive MCP info from manifest
  if (tool.mcp?.available) {
    result.mcp = {
      available: true,
      ...(tool.mcp.capabilities !== undefined
        ? { capabilities: tool.mcp.capabilities }
        : {}),
      ...(tool.mcp.toolCount !== undefined ? { toolCount: tool.mcp.toolCount } : {}),
    };
  }

  return result;
}

function deriveInstalledCheck(
  tool: ToolDefinition,
): InstalledCheck | undefined {
  if (tool.installedCheck && tool.installedCheck.command.length > 0) {
    const result: InstalledCheck = {
      command: tool.installedCheck.command,
    };
    if (tool.installedCheck.run_as !== undefined) {
      result.run_as = tool.installedCheck.run_as;
    }
    if (tool.installedCheck.timeoutMs !== undefined) {
      result.timeoutMs = tool.installedCheck.timeoutMs;
    }
    if (tool.installedCheck.outputCapBytes !== undefined) {
      result.outputCapBytes = tool.installedCheck.outputCapBytes;
    }
    return result;
  }
  return undefined;
}

function buildCLIDefinition(tool: ToolDefinition): CLIDefinition {
  const fallback = FALLBACK_DEFINITIONS.get(tool.name);
  const { commands, versionFlag } = deriveCommandSpec(tool, fallback);

  const result: CLIDefinition = {
    name: tool.name,
    commands,
    versionFlag,
    capabilities: deriveCapabilities(tool, fallback),
  };

  if (fallback?.authCheckCmd !== undefined) {
    result.authCheckCmd = fallback.authCheckCmd;
  }

  const installedCheck = deriveInstalledCheck(tool);
  if (installedCheck !== undefined) {
    result.installedCheck = installedCheck;
  }

  return result;
}

async function getRegistryDefinitions(): Promise<{
  agents: CLIDefinition[];
  tools: CLIDefinition[];
}> {
  const log = getLogger();

  try {
    const registryTools = await listAllTools();
    if (registryTools.length === 0) {
      const meta = getToolRegistryMetadata();
      log.warn(
        {
          errorCategory: "registry_empty",
          manifestVersion: meta?.schemaVersion ?? null,
          manifestHash: meta?.manifestHash ?? null,
        },
        "ToolRegistry returned empty tools list; using fallback detection list",
      );
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
    const meta = getToolRegistryMetadata();
    log.warn(
      {
        error,
        errorCategory: "registry_load_failed",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Failed to load ToolRegistry; using fallback detection list",
    );
    return {
      agents: FALLBACK_AGENT_CLIS,
      tools: FALLBACK_TOOL_CLIS,
    };
  }
}

// ============================================================================
// Detection Helpers
// ============================================================================

// Default limits for safe execution
const DEFAULT_CHECK_TIMEOUT_MS = 1500;
const DEFAULT_OUTPUT_CAP_BYTES = 4096;
const MAX_SAFE_OUTPUT_BYTES = 1024 * 1024; // 1MB limit for internal checks

async function readStreamSafe(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let totalBytes = 0;
  const drainLimit = maxBytes * 5;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;

      if (content.length < maxBytes) {
        content += decoder.decode(value, { stream: true });
      }

      if (totalBytes > drainLimit) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // Ignore errors
  } finally {
    reader.releaseLock();
  }

  if (content.length < maxBytes) {
    content += decoder.decode();
  }

  if (content.length > maxBytes) {
    content = content.slice(0, maxBytes);
  }

  return content;
}

/**
 * Environment variables considered safe to pass to spawned processes.
 *
 * Security rationale:
 * - PATH: Required for command resolution
 * - HOME: Required by many tools for config lookup
 * - USER, LOGNAME: User identity (non-sensitive)
 * - SHELL: Shell preference
 * - LANG, LC_*: Locale settings for consistent output
 * - TERM: Terminal type (affects output formatting)
 * - TMPDIR, TEMP, TMP: Temp directory paths
 * - XDG_*: Standard config/data directories
 * - NO_COLOR: Disable color output (we set this)
 *
 * Explicitly EXCLUDED (potential secrets):
 * - API keys: *_API_KEY, *_TOKEN, *_SECRET, *_PASSWORD
 * - Database URLs: DATABASE_URL, *_DSN
 * - Cloud credentials: AWS_*, GOOGLE_*, AZURE_*
 * - Authentication: AUTH_*, SESSION_*, JWT_*
 */
const SAFE_ENV_PREFIXES = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_",
];

/**
 * Build a sanitized environment for spawned processes.
 * Only includes non-sensitive variables needed for basic operation.
 */
function buildSafeEnv(): Record<string, string> {
  const safeEnv: Record<string, string> = {
    NO_COLOR: "1", // Always disable color for predictable parsing
  };

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // Check if key starts with any safe prefix
    const isSafe = SAFE_ENV_PREFIXES.some(
      (prefix) => key === prefix || key.startsWith(prefix),
    );

    if (isSafe) {
      safeEnv[key] = value;
    }
  }

  return safeEnv;
}

interface SpawnCaptureResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function spawnCapture(
  command: string[],
  options?: { timeoutMs?: number; outputCapBytes?: number },
): Promise<SpawnCaptureResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const outputCapBytes = options?.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;

  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: buildSafeEnv(),
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const raceResult = await Promise.race([proc.exited, timeoutPromise]);

  if (raceResult === "timeout") {
    proc.kill();
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    };
  }

  clearTimeout(timeoutId);
  const exitCode = raceResult;
  const [stdout, stderr] = await Promise.all([
    readStreamSafe(proc.stdout, outputCapBytes),
    readStreamSafe(proc.stderr, outputCapBytes),
  ]);

  return {
    exitCode,
    stdout,
    stderr,
    timedOut: false,
  };
}

/**
 * Run manifest-defined installed_check command with safety limits.
 * Returns the path/output on success, null on failure.
 *
 * ## Security Properties
 *
 * This function enforces several security constraints:
 *
 * 1. **No shell interpolation**: Commands are passed as arrays to `Bun.spawn()`,
 *    preventing shell metacharacter injection (e.g., `; rm -rf /`).
 *
 * 2. **Timeout enforcement**: Commands are killed after `timeoutMs` (default 1.5s)
 *    to prevent hangs or resource exhaustion attacks.
 *
 * 3. **Output capping**: Only `outputCapBytes` (default 4KB) are captured to
 *    prevent memory exhaustion from malicious output flooding.
 *
 * 4. **Environment sanitization**: Only essential non-sensitive env vars are
 *    passed (PATH, HOME, locale settings). API keys and secrets are excluded.
 *
 * 5. **Privilege restriction**: Commands requesting `run_as: root` are skipped.
 *
 * ## Manifest Author Guidelines
 *
 * When writing `installed_check` commands in ACFS manifests:
 *
 * - Use simple, idiomatic checks like `["command", "-v", "toolname"]`
 * - Avoid shell features (pipes, redirects, subshells) - they won't work
 * - Keep commands fast (< 1.5s by default; or set timeoutMs explicitly) and output minimal (< 4KB)
 * - Don't rely on environment variables beyond PATH/HOME
 * - Test that the command works with minimal privileges
 */
async function runInstalledCheck(
  check: InstalledCheck,
): Promise<{ success: boolean; output: string }> {
  const log = getLogger();
  const timeoutMs = check.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const outputCapBytes = check.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;

  // Validate command is not empty
  if (check.command.length === 0) {
    return { success: false, output: "" };
  }

  // Security: skip if run_as=root is requested (we don't elevate privileges)
  if (check.run_as === "root") {
    log.debug(
      { command: check.command },
      "Skipping installed_check requiring root",
    );
    return { success: false, output: "" };
  }

  try {
    const proc = Bun.spawn(check.command, {
      stdout: "pipe",
      stderr: "pipe",
      env: buildSafeEnv(),
    });

    // Set up timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
    });

    // Wait for exit or timeout
    const raceResult = await Promise.race([proc.exited, timeoutPromise]);

    if (raceResult === "timeout") {
      proc.kill();
      log.debug(
        { command: check.command, timeoutMs },
        "Installed check timed out",
      );
      return { success: false, output: "" };
    }

    clearTimeout(timeoutId);
    const exitCode = raceResult;

    // Read output with cap
    const cappedOutput = (
      await readStreamSafe(proc.stdout, outputCapBytes)
    ).trim();

    if (exitCode === 0) {
      return { success: true, output: cappedOutput };
    }

    return { success: false, output: cappedOutput };
  } catch (error) {
    log.debug(
      { command: check.command, error: String(error) },
      "Installed check failed",
    );
    return { success: false, output: "" };
  }
}

/**
 * Find executable path using 'which' (Unix) or 'where' (Windows).
 * Uses sanitized environment to prevent credential leakage.
 */
async function findExecutable(command: string): Promise<string | null> {
  const isWindows = process.platform === "win32";
  const findCmd = isWindows ? "where" : "which";

  try {
    const result = await spawnCapture([findCmd, command], {
      timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
      outputCapBytes: MAX_SAFE_OUTPUT_BYTES,
    });

    if (!result.timedOut && result.exitCode === 0 && result.stdout.trim()) {
      // Return first line (in case of multiple matches)
      return result.stdout.trim().split("\n")[0]!;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get version from CLI.
 * Uses sanitized environment to prevent credential leakage.
 */
async function getVersion(
  commands: string[],
  versionFlag: string,
): Promise<string | null> {
  try {
    const args = [...commands, versionFlag];
    const result = await spawnCapture(args, {
      timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
      outputCapBytes: MAX_SAFE_OUTPUT_BYTES,
    });
    if (result.timedOut) return null;

    // Some CLIs output version to stderr
    const output = result.stdout.trim() || result.stderr.trim();

    if (result.exitCode === 0 && output) {
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
 * Check authentication status.
 * Uses sanitized environment to prevent credential leakage.
 */
async function checkAuth(
  authCmd: string[],
): Promise<{ authenticated: boolean; error?: string }> {
  try {
    const result = await spawnCapture(authCmd, {
      timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
      outputCapBytes: MAX_SAFE_OUTPUT_BYTES,
    });
    if (result.timedOut) {
      return {
        authenticated: false,
        error: "Auth check timed out",
      };
    }

    // Exit code 0 typically means authenticated
    if (result.exitCode === 0) {
      return { authenticated: true };
    }

    // Check for common auth error patterns
    const output = (result.stdout + result.stderr).toLowerCase();
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
      error: result.stderr.trim() || "Auth check failed",
    };
  } catch (error) {
    return {
      authenticated: false,
      error: error instanceof Error ? error.message : "Auth check failed",
    };
  }
}

/**
 * Detect a single CLI using manifest installed_check with fallback to which/where.
 */
async function detectCLI(def: CLIDefinition): Promise<DetectedCLI> {
  const startTime = performance.now();
  const log = getLogger();

  let path: string | null = null;
  let detectionMethod: "manifest" | "fallback" = "fallback";

  // Priority 1: Use manifest installed_check if available
  if (def.installedCheck) {
    const checkResult = await runInstalledCheck(def.installedCheck);
    if (checkResult.success) {
      // Output from installed_check might be a path or just confirmation
      // If output looks like a path, use it; otherwise find via which/where
      const output = checkResult.output;
      if (output && (output.startsWith("/") || output.includes(":"))) {
        // Looks like a path (Unix absolute or Windows drive letter)
        path = output.split("\n")[0]!;
        detectionMethod = "manifest";
      } else {
        // Check passed but didn't return path - find it via fallback
        const primaryCmd = def.commands[0]!;
        path = await findExecutable(primaryCmd);
        if (path) {
          detectionMethod = "manifest";
        }
      }
    }
    log.debug(
      {
        cli: def.name,
        installedCheck: def.installedCheck.command,
        success: checkResult.success,
      },
      "Manifest installed_check executed",
    );
  }

  // Priority 2: Fallback to which/where if manifest check not available or failed
  if (!path) {
    const primaryCmd = def.commands[0]!;
    path = await findExecutable(primaryCmd);
    detectionMethod = "fallback";
  }

  if (!path) {
    const meta = getToolRegistryMetadata();
    log.debug(
      {
        toolId: def.name,
        method: detectionMethod,
        errorCategory: "cli_not_found",
        unavailabilityReason: "not_installed",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "CLI not found",
    );
    return {
      name: def.name,
      available: false,
      unavailabilityReason: "not_installed",
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
    const primaryCommand = def.commands[0];
    if (primaryCommand && authCmd[0] === primaryCommand) {
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
      detectionMethod,
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
let inFlightDetection: Promise<DetectionResult> | null = null;
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

  if (inFlightDetection) {
    log.debug("Awaiting in-flight CLI detection");
    return inFlightDetection;
  }

  inFlightDetection = (async () => {
    const startTime = performance.now();
    log.info({ bypassCache }, "Starting CLI detection");

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
  })();

  try {
    return await inFlightDetection;
  } finally {
    inFlightDetection = null;
  }
}

/**
 * Detect a specific CLI by name
 */
export async function detectCLIByName(
  name: DetectedType,
): Promise<DetectedCLI | null> {
  const { agents, tools } = await getRegistryDefinitions();
  const def =
    agents.find((d) => d.name === name) || tools.find((d) => d.name === name);

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
