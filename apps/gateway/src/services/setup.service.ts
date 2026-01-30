/**
 * Setup Service - Manages toolchain readiness and installation.
 *
 * Provides detection, installation, and verification of
 * agent CLIs and developer tools for the Flywheel Gateway setup wizard.
 */

import type {
  InstallSpec,
  ToolDefinition,
  VerifiedInstallerSpec,
} from "@flywheel/shared";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type DetectedCLI,
  type DetectedType,
  getAgentDetectionService,
} from "./agent-detection.service";
import {
  categorizeTools,
  getRequiredTools,
  getToolRegistryMetadata,
  getToolsByPhase,
  loadToolRegistry,
} from "./tool-registry.service";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Timeout for installer script execution in milliseconds.
 * Defaults to 5 minutes (300000ms). Configure via INSTALL_TIMEOUT_MS env var.
 */
const INSTALL_TIMEOUT_MS = Number(process.env["INSTALL_TIMEOUT_MS"]) || 300_000;

// ============================================================================
// Types
// ============================================================================

/**
 * Verified installer info surfaced in API responses.
 * Contains only public-safe fields (no private paths).
 */
export interface VerifiedInstallerInfo {
  /** Install runner command (e.g. "curl", "bash", "npm") */
  runner: string;
  /** Arguments to pass to the runner */
  args?: string[];
  /** Fallback URL for manual installation if automated fails */
  fallbackUrl?: string;
  /** Whether to run the installer in tmux (for interactive installs) */
  runInTmux?: boolean;
}

export interface ToolInfo {
  name: DetectedType;
  displayName: string;
  description: string;
  category: "agent" | "tool";
  tags?: string[];
  optional?: boolean;
  enabledByDefault?: boolean;
  phase?: number;
  manifestVersion?: string;
  installCommand?: string;
  installUrl?: string;
  docsUrl?: string;
  /** Verified installer from ACFS manifest (preferred over installCommand) */
  verifiedInstaller?: VerifiedInstallerInfo;
}

export interface ToolCategories {
  required: string[];
  recommended: string[];
  optional: string[];
}

export interface PhaseOrderEntry {
  phase: number;
  tools: string[];
}

export interface ReadinessStatus {
  ready: boolean;
  agents: DetectedCLI[];
  tools: DetectedCLI[];
  manifest?: {
    schemaVersion: string;
    source?: string;
    generatedAt?: string;
    manifestPath?: string;
    manifestHash?: string;
  };
  summary: {
    agentsAvailable: number;
    agentsTotal: number;
    toolsAvailable: number;
    toolsTotal: number;
    authIssues: string[];
    missingRequired: string[];
  };
  /** Tool categorization: required, recommended, optional */
  toolCategories?: ToolCategories;
  /** Install order by phase (lower phase = install first) */
  installOrder?: PhaseOrderEntry[];
  recommendations: string[];
  detectedAt: string;
  durationMs: number;
}

export type InstallMode = "interactive" | "easy";

export interface InstallRequest {
  tool: DetectedType;
  mode: InstallMode;
  verify: boolean;
}

export type InstallStatus =
  | "pending"
  | "downloading"
  | "installing"
  | "verifying"
  | "completed"
  | "failed";

export interface InstallProgress {
  tool: string;
  status: InstallStatus;
  progress: number;
  message: string;
  timestamp: string;
}

export interface InstallResult {
  tool: string;
  success: boolean;
  version?: string;
  path?: string;
  error?: string;
  durationMs: number;
}

// ============================================================================
// Tool Information Registry
// ============================================================================

/**
 * ACFS manifest mapping note (bd-2k5b)
 * Source: acfs.manifest.yaml modules[] in agentic_coding_flywheel_setup.
 *
 * Mapping → ToolInfo (Gateway setup registry):
 * - module.id: agents.<name> → ToolInfo.name (agent), stack.<name>/tools.<name> → ToolInfo.name (tool)
 * - module.description → ToolInfo.description
 * - module.category + tags: agents → category="agent"; stack/tools → category="tool"
 * - module.optional / enabled_by_default / tags (critical/recommended) → readiness + required tool policy
 * - module.verified_installer or install[]: prefer ACFS-managed install over raw multi-step scripts;
 *   if install is complex, omit installCommand and keep installUrl/docsUrl instead.
 *
 * Known omissions (still curated here until ACFS adds fields):
 * - displayName, docsUrl, authCheckCmd, capability flags, versionFlag nuances.
 */
const TOOL_INFO: Record<string, ToolInfo> = {
  // Agent CLIs
  claude: {
    name: "claude",
    displayName: "Claude Code",
    description: "Anthropic's official CLI for Claude",
    category: "agent",
    installUrl: "https://docs.anthropic.com/claude-code",
    docsUrl: "https://docs.anthropic.com/claude-code",
  },
  codex: {
    name: "codex",
    displayName: "Codex CLI",
    description: "OpenAI Codex CLI for code generation",
    category: "agent",
    installCommand: "npm install -g @openai/codex",
    docsUrl: "https://github.com/openai/codex",
  },
  gemini: {
    name: "gemini",
    displayName: "Gemini CLI",
    description: "Google Gemini CLI for AI assistance",
    category: "agent",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
  },
  aider: {
    name: "aider",
    displayName: "Aider",
    description: "AI pair programming in your terminal",
    category: "agent",
    installCommand: "pip install aider-chat",
    docsUrl: "https://aider.chat",
  },
  "gh-copilot": {
    name: "gh-copilot",
    displayName: "GitHub Copilot",
    description: "GitHub Copilot CLI extension",
    category: "agent",
    installCommand: "gh extension install github/gh-copilot",
    docsUrl: "https://docs.github.com/en/copilot",
  },

  // Developer Tools
  dcg: {
    name: "dcg",
    displayName: "DCG",
    description: "Destructive Command Guard - safety guardrails",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/dcg/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/dcg",
  },
  ubs: {
    name: "ubs",
    displayName: "UBS",
    description: "Ultimate Bug Scanner - code quality analysis",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/ubs/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/ubs",
  },
  cass: {
    name: "cass",
    displayName: "CASS",
    description: "Cross-Agent Session Search",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/cass/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/cass",
  },
  cm: {
    name: "cm",
    displayName: "CM",
    description: "Context Memory for persistent agent memory",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/cm/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/cm",
  },
  br: {
    name: "br",
    displayName: "br (Beads)",
    description: "Beads issue tracker with dependency graphs",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/beads_rust/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/beads_rust",
  },
  bv: {
    name: "bv",
    displayName: "bv",
    description: "Graph-aware issue triage engine",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/bv/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/bv",
  },
  ru: {
    name: "ru",
    displayName: "RU",
    description: "Repository management utilities",
    category: "tool",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/ru/main/install.sh | bash",
    docsUrl: "https://github.com/Dicklesworthstone/ru",
  },
};

// Required tools for basic functionality
const REQUIRED_TOOLS: DetectedType[] = ["dcg", "br"];

function buildInstallCommand(install?: InstallSpec[]): string | undefined {
  if (!install || install.length === 0) return undefined;
  const [primary] = install;
  if (!primary) return undefined;
  const args = primary.args?.length ? ` ${primary.args.join(" ")}` : "";
  return `${primary.command}${args}`.trim();
}

/**
 * Convert VerifiedInstallerSpec from manifest to VerifiedInstallerInfo for API.
 * Maps snake_case to camelCase and ensures public-safe output.
 */
function toVerifiedInstallerInfo(
  spec: VerifiedInstallerSpec,
): VerifiedInstallerInfo {
  return {
    runner: spec.runner,
    ...(spec.args && { args: spec.args }),
    ...(spec.fallback_url && { fallbackUrl: spec.fallback_url }),
    ...(spec.run_in_tmux !== undefined && { runInTmux: spec.run_in_tmux }),
  };
}

/**
 * Build install command from verified installer spec.
 * Constructs a shell command from runner + args.
 */
function buildVerifiedInstallerCommand(
  spec: VerifiedInstallerSpec,
): string | undefined {
  if (!spec.runner) return undefined;
  const args = spec.args?.length ? ` ${spec.args.join(" ")}` : "";
  return `${spec.runner}${args}`.trim();
}

/**
 * Convert a ToolDefinition from the registry into a ToolInfo for setup endpoints.
 * Uses hardcoded TOOL_INFO as fallback for missing fields only.
 * Prefers verifiedInstaller over install array when present.
 */
function toToolInfo(tool: ToolDefinition, manifestVersion?: string): ToolInfo {
  const fallback = TOOL_INFO[tool.name];

  // Prefer verified installer command over install array
  const installCommand =
    (tool.verifiedInstaller
      ? buildVerifiedInstallerCommand(tool.verifiedInstaller)
      : buildInstallCommand(tool.install)) ?? fallback?.installCommand;

  // Use verified installer fallback_url, then install url, then fallback
  const installUrl =
    tool.verifiedInstaller?.fallback_url ??
    tool.install?.[0]?.url ??
    fallback?.installUrl;

  const docsUrl = tool.docsUrl ?? fallback?.docsUrl;

  // Map verified installer if present
  const verifiedInstaller = tool.verifiedInstaller
    ? toVerifiedInstallerInfo(tool.verifiedInstaller)
    : undefined;

  return {
    name: tool.name as DetectedType,
    displayName: tool.displayName ?? fallback?.displayName ?? tool.name,
    description: tool.description ?? fallback?.description ?? "",
    category: tool.category,
    ...(tool.tags && { tags: tool.tags }),
    ...(tool.optional !== undefined && { optional: tool.optional }),
    ...(tool.enabledByDefault !== undefined && {
      enabledByDefault: tool.enabledByDefault,
    }),
    ...(tool.phase !== undefined && { phase: tool.phase }),
    ...(manifestVersion && { manifestVersion }),
    ...(installCommand && { installCommand }),
    ...(installUrl && { installUrl }),
    ...(docsUrl && { docsUrl }),
    ...(verifiedInstaller && { verifiedInstaller }),
  };
}

/**
 * Load tool info from the registry. Returns all tools from the manifest,
 * using hardcoded TOOL_INFO only for field fallbacks when registry data is incomplete.
 */
async function getRegistryToolInfo(): Promise<ToolInfo[] | null> {
  const log = getLogger();
  try {
    const registry = await loadToolRegistry();
    if (registry.tools.length === 0) {
      log.debug("ToolRegistry returned empty tools list");
      return null;
    }
    const mapped = registry.tools.map((tool) =>
      toToolInfo(tool, registry.schemaVersion),
    );
    log.debug({ count: mapped.length }, "Loaded tool info from registry");
    return mapped;
  } catch (error) {
    const meta = getToolRegistryMetadata();
    log.warn(
      {
        error,
        errorCategory: "registry_load_failed",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Failed to load ToolRegistry; using fallback",
    );
    return null;
  }
}

/**
 * Get required tool names from the registry.
 * Returns tool names without filtering by hardcoded TOOL_INFO.
 */
async function getRequiredToolNames(): Promise<DetectedType[]> {
  const log = getLogger();
  try {
    const required = await getRequiredTools();
    if (required.length === 0) {
      log.debug("ToolRegistry returned no required tools; using fallback");
      return REQUIRED_TOOLS;
    }
    const names = required.map((tool) => tool.name as DetectedType);
    log.debug({ required: names }, "Loaded required tools from registry");
    return names;
  } catch (error) {
    const meta = getToolRegistryMetadata();
    log.warn(
      {
        error,
        errorCategory: "registry_required_failed",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Failed to load ToolRegistry required tools",
    );
    return REQUIRED_TOOLS;
  }
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get readiness status by detecting all installed CLIs.
 */
export async function getReadinessStatus(
  bypassCache = false,
): Promise<ReadinessStatus> {
  const log = getLogger();
  const startTime = performance.now();

  log.info({ bypassCache }, "Checking setup readiness");

  const service = getAgentDetectionService();
  const detection = await service.detectAll(bypassCache);
  let manifest: ReadinessStatus["manifest"];
  try {
    const registry = await loadToolRegistry();
    const meta = getToolRegistryMetadata();
    manifest = {
      schemaVersion: registry.schemaVersion,
      ...(registry.source && { source: registry.source }),
      ...(registry.generatedAt && { generatedAt: registry.generatedAt }),
      ...(meta?.manifestPath && { manifestPath: meta.manifestPath }),
      ...(meta?.manifestHash && { manifestHash: meta.manifestHash }),
    };
  } catch (error) {
    const meta = getToolRegistryMetadata();
    log.debug(
      {
        error,
        errorCategory: "registry_metadata_unavailable",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Tool registry metadata unavailable",
    );
  }

  // Calculate missing required tools
  const missingRequired: string[] = [];
  const requiredTools = await getRequiredToolNames();
  for (const tool of requiredTools) {
    const found =
      detection.tools.find((t) => t.name === tool)?.available ||
      detection.agents.find((a) => a.name === tool)?.available;
    if (!found) {
      missingRequired.push(tool);
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (missingRequired.length > 0) {
    recommendations.push(
      `Install required tools: ${missingRequired.join(", ")}`,
    );
  }

  if (detection.summary.authIssues.length > 0) {
    recommendations.push(
      `Resolve authentication issues: ${detection.summary.authIssues.length} tool(s) need auth`,
    );
  }

  if (detection.summary.agentsAvailable === 0) {
    recommendations.push(
      "Install at least one agent CLI (claude, codex, gemini) to use Flywheel Gateway",
    );
  }

  const ready =
    missingRequired.length === 0 &&
    detection.summary.agentsAvailable > 0 &&
    detection.summary.authIssues.length === 0;

  // Compute tool categories (required/recommended/optional)
  let toolCategories: ToolCategories | undefined;
  let installOrder: PhaseOrderEntry[] | undefined;
  try {
    const categorization = await categorizeTools();
    toolCategories = {
      required: categorization.required.map((t) => t.name),
      recommended: categorization.recommended.map((t) => t.name),
      optional: categorization.optional.map((t) => t.name),
    };

    // Compute install order by phase
    const phaseGroups = await getToolsByPhase();
    installOrder = phaseGroups.map((group) => ({
      phase: group.phase,
      tools: group.tools.map((t) => t.name),
    }));

    log.debug(
      {
        required: toolCategories.required.length,
        recommended: toolCategories.recommended.length,
        optional: toolCategories.optional.length,
        phases: installOrder.length,
      },
      "Tool categorization computed",
    );
  } catch (error) {
    const meta = getToolRegistryMetadata();
    log.warn(
      {
        error,
        errorCategory: "categorization_failed",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Failed to compute tool categories",
    );
  }

  const durationMs = Math.round(performance.now() - startTime);

  log.info(
    {
      ready,
      agentsAvailable: detection.summary.agentsAvailable,
      toolsAvailable: detection.summary.toolsAvailable,
      missingRequired,
      durationMs,
    },
    "Readiness check complete",
  );

  return {
    ready,
    agents: detection.agents,
    tools: detection.tools,
    ...(manifest && { manifest }),
    summary: {
      ...detection.summary,
      missingRequired,
    },
    ...(toolCategories && { toolCategories }),
    ...(installOrder && { installOrder }),
    recommendations,
    detectedAt: detection.detectedAt.toISOString(),
    durationMs,
  };
}

/**
 * Get information about a specific tool.
 */
export async function getToolInfo(
  name: DetectedType,
): Promise<ToolInfo | undefined> {
  const tools = await getAllToolInfo();
  return tools.find((tool) => tool.name === name);
}

/**
 * Get all tool information.
 */
export async function getAllToolInfo(): Promise<ToolInfo[]> {
  const registryTools = await getRegistryToolInfo();
  return registryTools ?? Object.values(TOOL_INFO);
}

/**
 * Install a tool with progress events.
 */
export async function installTool(
  request: InstallRequest,
  sessionId?: string,
): Promise<InstallResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const startTime = performance.now();

  const toolInfo = await getToolInfo(request.tool);
  if (!toolInfo) {
    const meta = getToolRegistryMetadata();
    log.warn(
      {
        toolId: request.tool,
        errorCategory: "tool_not_found",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Install requested for unknown tool",
    );
    return {
      tool: request.tool,
      success: false,
      error: `Unknown tool: ${request.tool}`,
      durationMs: 0,
    };
  }

  if (!toolInfo.installCommand) {
    const meta = getToolRegistryMetadata();
    log.warn(
      {
        toolId: request.tool,
        errorCategory: "install_missing_command",
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Tool install requested without install command",
    );
    return {
      tool: request.tool,
      success: false,
      error: `No automated install available for ${request.tool}. Visit: ${toolInfo.docsUrl}`,
      durationMs: 0,
    };
  }

  // Check if verified installer requires tmux (interactive install)
  if (toolInfo.verifiedInstaller?.runInTmux && request.mode !== "interactive") {
    const meta = getToolRegistryMetadata();
    log.info(
      {
        toolId: request.tool,
        verifiedInstaller: toolInfo.verifiedInstaller,
        manifestVersion: meta?.schemaVersion ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      "Tool requires interactive tmux install",
    );
    return {
      tool: request.tool,
      success: false,
      error: `${request.tool} requires interactive installation in tmux. Use mode: "interactive" or visit: ${toolInfo.verifiedInstaller.fallbackUrl || toolInfo.docsUrl}`,
      durationMs: 0,
    };
  }

  // Determine install source for logging
  const installSource = toolInfo.verifiedInstaller
    ? "verified_installer"
    : "install_spec";

  log.info(
    {
      tool: request.tool,
      mode: request.mode,
      verify: request.verify,
      installSource,
      ...(toolInfo.verifiedInstaller && {
        verifiedInstaller: {
          runner: toolInfo.verifiedInstaller.runner,
          hasArgs: !!toolInfo.verifiedInstaller.args,
          runInTmux: toolInfo.verifiedInstaller.runInTmux,
        },
      }),
      correlationId,
    },
    "Starting tool installation",
  );

  // Emit progress via WebSocket if session provided
  // Note: WebSocket session broadcasting is a future enhancement.
  // For now, progress is logged and HTTP polling handles status.
  const emitProgress = (progress: InstallProgress) => {
    if (sessionId) {
      log.debug({ sessionId, progress }, "Install progress");
    }
  };

  emitProgress({
    tool: request.tool,
    status: "pending",
    progress: 0,
    message: "Starting installation...",
    timestamp: new Date().toISOString(),
  });

  try {
    // Check if already installed
    const service = getAgentDetectionService();
    const existing = await service.detect(request.tool);

    if (existing?.available) {
      log.info(
        { tool: request.tool, version: existing.version },
        "Tool already installed",
      );

      emitProgress({
        tool: request.tool,
        status: "completed",
        progress: 100,
        message: `Already installed (version: ${existing.version || "unknown"})`,
        timestamp: new Date().toISOString(),
      });

      return {
        tool: request.tool,
        success: true,
        ...(existing.version && { version: existing.version }),
        ...(existing.path && { path: existing.path }),
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    emitProgress({
      tool: request.tool,
      status: "downloading",
      progress: 25,
      message: "Downloading installer...",
      timestamp: new Date().toISOString(),
    });

    // Run installer
    const installCmd =
      request.mode === "easy"
        ? `${toolInfo.installCommand} --easy`
        : toolInfo.installCommand;

    emitProgress({
      tool: request.tool,
      status: "installing",
      progress: 50,
      message: "Running installer...",
      timestamp: new Date().toISOString(),
    });

    const proc = Bun.spawn(["bash", "-c", installCmd], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NO_COLOR: "1",
        NONINTERACTIVE: request.mode === "easy" ? "1" : undefined,
      },
    });

    // Set up timeout with cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // Process may have already exited
        }
        reject(
          new Error(`Installation timed out after ${INSTALL_TIMEOUT_MS}ms`),
        );
      }, INSTALL_TIMEOUT_MS);
    });

    // Wait for command or timeout
    let _stdout: string;
    let stderr: string;
    let exitCode: number;

    try {
      const resultPromise = (async () => {
        const stdout = await new Response(proc.stdout).text();
        const stderrOutput = await new Response(proc.stderr).text();
        const code = await proc.exited;
        return { stdout, stderr: stderrOutput, exitCode: code };
      })();

      const result = await Promise.race([resultPromise, timeoutPromise]);
      _stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (timedOut) {
        log.error(
          {
            tool: request.tool,
            timeoutMs: INSTALL_TIMEOUT_MS,
          },
          "Installation timed out",
        );

        emitProgress({
          tool: request.tool,
          status: "failed",
          progress: 0,
          message: `Installation timed out after ${Math.round(INSTALL_TIMEOUT_MS / 1000)}s`,
          timestamp: new Date().toISOString(),
        });

        return {
          tool: request.tool,
          success: false,
          error: `Installation timed out after ${Math.round(INSTALL_TIMEOUT_MS / 1000)} seconds`,
          durationMs: Math.round(performance.now() - startTime),
        };
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    if (exitCode !== 0) {
      log.error(
        {
          tool: request.tool,
          exitCode,
          stderr,
        },
        "Installation failed",
      );

      emitProgress({
        tool: request.tool,
        status: "failed",
        progress: 0,
        message: `Installation failed: ${stderr || "unknown error"}`,
        timestamp: new Date().toISOString(),
      });

      return {
        tool: request.tool,
        success: false,
        error: stderr || "Installation failed with unknown error",
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    // Verify installation if requested
    if (request.verify) {
      emitProgress({
        tool: request.tool,
        status: "verifying",
        progress: 75,
        message: "Verifying installation...",
        timestamp: new Date().toISOString(),
      });

      // Clear cache and re-detect
      service.clearCache();
      const verified = await service.detect(request.tool);

      if (!verified?.available) {
        log.warn({ tool: request.tool }, "Verification failed");

        emitProgress({
          tool: request.tool,
          status: "failed",
          progress: 0,
          message: "Installation completed but verification failed",
          timestamp: new Date().toISOString(),
        });

        return {
          tool: request.tool,
          success: false,
          error: "Installation completed but tool not found in PATH",
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      const durationMs = Math.round(performance.now() - startTime);

      log.info(
        {
          tool: request.tool,
          version: verified.version,
          path: verified.path,
          durationMs,
        },
        "Installation verified",
      );

      emitProgress({
        tool: request.tool,
        status: "completed",
        progress: 100,
        message: `Installed successfully (version: ${verified.version || "unknown"})`,
        timestamp: new Date().toISOString(),
      });

      return {
        tool: request.tool,
        success: true,
        ...(verified.version && { version: verified.version }),
        ...(verified.path && { path: verified.path }),
        durationMs,
      };
    }

    const durationMs = Math.round(performance.now() - startTime);

    emitProgress({
      tool: request.tool,
      status: "completed",
      progress: 100,
      message: "Installation completed (not verified)",
      timestamp: new Date().toISOString(),
    });

    return {
      tool: request.tool,
      success: true,
      durationMs,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);

    log.error({ tool: request.tool, error }, "Installation error");

    emitProgress({
      tool: request.tool,
      status: "failed",
      progress: 0,
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });

    return {
      tool: request.tool,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs,
    };
  }
}
