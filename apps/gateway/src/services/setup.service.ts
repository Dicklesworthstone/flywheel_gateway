/**
 * Setup Service - Manages toolchain readiness and installation.
 *
 * Provides detection, installation, and verification of
 * agent CLIs and developer tools for the Flywheel Gateway setup wizard.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type DetectedCLI,
  type DetectedType,
  getAgentDetectionService,
} from "./agent-detection.service";

// ============================================================================
// Types
// ============================================================================

export interface ToolInfo {
  name: DetectedType;
  displayName: string;
  description: string;
  category: "agent" | "tool";
  installCommand?: string;
  installUrl?: string;
  docsUrl?: string;
}

export interface ReadinessStatus {
  ready: boolean;
  agents: DetectedCLI[];
  tools: DetectedCLI[];
  summary: {
    agentsAvailable: number;
    agentsTotal: number;
    toolsAvailable: number;
    toolsTotal: number;
    authIssues: string[];
    missingRequired: string[];
  };
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

  // Calculate missing required tools
  const missingRequired: string[] = [];
  for (const tool of REQUIRED_TOOLS) {
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
    summary: {
      ...detection.summary,
      missingRequired,
    },
    recommendations,
    detectedAt: detection.detectedAt.toISOString(),
    durationMs,
  };
}

/**
 * Get information about a specific tool.
 */
export function getToolInfo(name: DetectedType): ToolInfo | undefined {
  return TOOL_INFO[name];
}

/**
 * Get all tool information.
 */
export function getAllToolInfo(): ToolInfo[] {
  return Object.values(TOOL_INFO);
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

  const toolInfo = TOOL_INFO[request.tool];
  if (!toolInfo) {
    return {
      tool: request.tool,
      success: false,
      error: `Unknown tool: ${request.tool}`,
      durationMs: 0,
    };
  }

  if (!toolInfo.installCommand) {
    return {
      tool: request.tool,
      success: false,
      error: `No automated install available for ${request.tool}. Visit: ${toolInfo.docsUrl}`,
      durationMs: 0,
    };
  }

  log.info(
    {
      tool: request.tool,
      mode: request.mode,
      verify: request.verify,
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

    const _stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

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
