/**
 * Tmux Driver - Visual terminal access for power users.
 *
 * This driver creates and manages tmux sessions, allowing users to:
 * - Attach to see live terminal output
 * - Interact with agents visually
 * - Debug complex operations
 *
 * Unlike SDK and ACP drivers, Tmux driver does NOT provide:
 * - Structured events (tool calls, file operations)
 * - Checkpointing
 * - Programmatic tool interception
 *
 * It DOES provide:
 * - Terminal attach capability
 * - Interruption (Ctrl+C)
 * - Streaming text output
 * - Visual debugging
 */

import { spawn, type Subprocess } from "bun";
import { BaseDriver, createDriverOptions, type BaseDriverConfig } from "../base-driver";
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  OutputLine,
  SendResult,
} from "../types";
import type { DriverOptions } from "../interface";

// ============================================================================
// Tmux Configuration
// ============================================================================

/**
 * Configuration specific to Tmux driver.
 */
export interface TmuxDriverOptions extends DriverOptions {
  /** Path to tmux binary */
  tmuxBinary?: string;
  /** Tmux socket name (for isolated sessions) */
  socketName?: string;
  /** Path to agent binary to run in tmux */
  agentBinary?: string;
  /** Arguments for the agent binary */
  agentArgs?: string[];
  /** Environment variables for the agent */
  agentEnv?: Record<string, string>;
  /** Pane history limit */
  historyLimit?: number;
  /** Capture interval for output polling (ms) */
  captureIntervalMs?: number;
}

/**
 * Internal state for a Tmux agent session.
 */
interface TmuxAgentSession {
  config: AgentConfig;
  sessionName: string;
  windowName: string;
  captureInterval?: ReturnType<typeof setInterval>;
  lastCapturedOutput: string;
  outputBuffer: string[];
}

// ============================================================================
// Tmux Driver Implementation
// ============================================================================

/**
 * Tmux Driver implementation for visual terminal access.
 */
export class TmuxDriver extends BaseDriver {
  private tmuxBinary: string;
  private socketName: string;
  private agentBinary: string;
  private agentArgs: string[];
  private agentEnv: Record<string, string>;
  private historyLimit: number;
  private captureIntervalMs: number;
  private sessions = new Map<string, TmuxAgentSession>();

  constructor(config: BaseDriverConfig, options: TmuxDriverOptions = {}) {
    super(config);
    this.tmuxBinary = options.tmuxBinary ?? "tmux";
    this.socketName = options.socketName ?? "flywheel";
    this.agentBinary = options.agentBinary ?? "claude";
    this.agentArgs = options.agentArgs ?? [];
    this.agentEnv = options.agentEnv ?? {};
    this.historyLimit = options.historyLimit ?? 10000;
    this.captureIntervalMs = options.captureIntervalMs ?? 500;
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  protected async doHealthCheck(): Promise<boolean> {
    // Check if tmux is available
    try {
      const result = await Bun.spawn([this.tmuxBinary, "-V"], {
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      return result === 0;
    } catch {
      return false;
    }
  }

  protected async doSpawn(config: AgentConfig): Promise<Agent> {
    const sessionName = `flywheel-${config.id}`;
    const windowName = "agent";

    // Create tmux session with agent command
    const agentCommand = [
      this.agentBinary,
      ...this.agentArgs,
      "--working-directory", config.workingDirectory,
    ];

    if (config.model) {
      agentCommand.push("--model", config.model);
    }

    // Build environment string for tmux (properly quoted)
    const envPairs = Object.entries({
      ...this.agentEnv,
      ...(config.accountId ? { FLYWHEEL_ACCOUNT_ID: config.accountId } : {}),
    }).map(([k, v]) => `${k}=${this.shellQuote(v)}`);

    const envPrefix = envPairs.length > 0 ? `env ${envPairs.join(" ")} ` : "";

    // Build command with proper quoting for each argument
    const quotedArgs = agentCommand.map((arg) => this.shellQuote(arg));
    const fullCommand = envPrefix + quotedArgs.join(" ");

    // Create new tmux session
    const createResult = await this.runTmux([
      "new-session",
      "-d",                           // Detached
      "-s", sessionName,              // Session name
      "-n", windowName,               // Window name
      "-x", "200",                    // Width
      "-y", "50",                     // Height
      fullCommand,                    // Command to run
    ]);

    if (!createResult.success) {
      throw new Error(`Failed to create tmux session: ${createResult.stderr}`);
    }

    // Set history limit
    await this.runTmux([
      "set-option",
      "-t", sessionName,
      "history-limit", String(this.historyLimit),
    ]);

    // Create session state
    const session: TmuxAgentSession = {
      config,
      sessionName,
      windowName,
      lastCapturedOutput: "",
      outputBuffer: [],
    };

    this.sessions.set(config.id, session);

    // Start output capture polling
    session.captureInterval = setInterval(
      () => this.captureOutput(config.id, session),
      this.captureIntervalMs
    );

    // Log spawn
    console.info("[DRIVER] action=spawn driver=tmux", {
      agentId: config.id,
      sessionName,
      workingDirectory: config.workingDirectory,
    });

    // Return agent state
    const now = new Date();
    return {
      id: config.id,
      config,
      driverId: this.driverId,
      driverType: this.driverType,
      activityState: "idle",
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      contextHealth: "healthy",
      startedAt: now,
      lastActivityAt: now,
    };
  }

  protected async doSend(agentId: string, message: string): Promise<SendResult> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Send keys to tmux session using -l flag for literal interpretation
    // This prevents tmux from interpreting special key sequences
    const result = await this.runTmux([
      "send-keys",
      "-l",  // Literal mode - disable special key name lookup
      "-t", `${session.sessionName}:${session.windowName}`,
      message,
    ]);

    // Send Enter separately (not literal, so it's interpreted as the key)
    if (result.success) {
      await this.runTmux([
        "send-keys",
        "-t", `${session.sessionName}:${session.windowName}`,
        "Enter",
      ]);
    }

    if (!result.success) {
      throw new Error(`Failed to send keys to tmux: ${result.stderr}`);
    }

    // Update state to thinking
    this.updateState(agentId, { activityState: "thinking" });

    return { messageId, queued: false };
  }

  protected async doTerminate(agentId: string, graceful: boolean): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;

    // Stop capture interval
    if (session.captureInterval) {
      clearInterval(session.captureInterval);
    }

    // Log termination
    console.info("[DRIVER] action=terminate driver=tmux", {
      agentId,
      sessionName: session.sessionName,
      graceful,
    });

    if (graceful) {
      // Send Ctrl+C first
      await this.runTmux([
        "send-keys",
        "-t", session.sessionName,
        "C-c",
      ]);

      // Wait a bit for graceful shutdown
      await Bun.sleep(1000);
    }

    // Kill the tmux session
    await this.runTmux([
      "kill-session",
      "-t", session.sessionName,
    ]);

    // Clean up session
    this.sessions.delete(agentId);
  }

  protected async doInterrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    // Send Ctrl+C to interrupt
    const result = await this.runTmux([
      "send-keys",
      "-t", session.sessionName,
      "C-c",
    ]);

    if (!result.success) {
      throw new Error(`Failed to send interrupt to tmux: ${result.stderr}`);
    }

    console.info("[DRIVER] action=interrupt driver=tmux", {
      agentId,
      sessionName: session.sessionName,
    });
  }

  // ============================================================================
  // Tmux-specific methods
  // ============================================================================

  /**
   * Get the attach command for a session.
   * Users can run this command to visually attach to the terminal.
   */
  getAttachCommand(agentId: string): string {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    return `${this.tmuxBinary} -L ${this.socketName} attach-session -t ${session.sessionName}`;
  }

  /**
   * Check if a session is still running.
   */
  async isSessionRunning(agentId: string): Promise<boolean> {
    const session = this.sessions.get(agentId);
    if (!session) return false;

    const result = await this.runTmux([
      "has-session",
      "-t", session.sessionName,
    ]);

    return result.success;
  }

  /**
   * Capture current pane contents.
   */
  async capturePaneContents(agentId: string, lines?: number): Promise<string> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const args = [
      "capture-pane",
      "-t", session.sessionName,
      "-p",             // Print to stdout
      "-J",             // Join wrapped lines
    ];

    if (lines !== undefined) {
      args.push("-S", `-${lines}`);  // Start from -N lines
    }

    const result = await this.runTmux(args);

    if (!result.success) {
      throw new Error(`Failed to capture pane contents: ${result.stderr}`);
    }

    return result.stdout;
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Run a tmux command.
   */
  private async runTmux(args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
    try {
      const proc = spawn([this.tmuxBinary, "-L", this.socketName, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      return {
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (err) {
      return {
        success: false,
        stdout: "",
        stderr: String(err),
      };
    }
  }

  /**
   * Quote a string for safe use in shell commands.
   * Uses single quotes and escapes any embedded single quotes.
   */
  private shellQuote(str: string): string {
    // If string contains no special characters, return as-is
    if (/^[a-zA-Z0-9._\-/=]+$/.test(str)) {
      return str;
    }
    // Use single quotes and escape embedded single quotes
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Capture output from tmux session and emit events for new content.
   */
  private async captureOutput(agentId: string, session: TmuxAgentSession): Promise<void> {
    try {
      const output = await this.capturePaneContents(agentId, 100);

      // Only emit if there's new content
      if (output !== session.lastCapturedOutput) {
        // Find the new lines
        const oldLines = session.lastCapturedOutput.split("\n");
        const newLines = output.split("\n");

        // Simple diff: find lines that are new
        const startIndex = Math.max(0, oldLines.length - 1);
        const newContent = newLines.slice(startIndex);

        for (const line of newContent) {
          if (line.trim()) {
            this.addOutput(agentId, {
              timestamp: new Date(),
              type: "text",
              content: line,
            });
          }
        }

        session.lastCapturedOutput = output;

        // Detect activity state from output
        this.detectActivityState(agentId, output);
      }
    } catch (err) {
      // Session might have ended
      if (!(await this.isSessionRunning(agentId))) {
        // Emit terminated event first (while agents Map still has subscribers)
        this.emitEvent(agentId, {
          type: "terminated",
          agentId,
          timestamp: new Date(),
          reason: "normal",
          exitCode: 0,
        });

        // Clean up capture interval
        if (session.captureInterval) {
          clearInterval(session.captureInterval);
        }

        // Clean up BaseDriver agent state
        const state = this.agents.get(agentId);
        if (state) {
          if (state.stallCheckInterval) {
            clearInterval(state.stallCheckInterval);
          }
          state.eventSubscribers.clear();
          this.agents.delete(agentId);
        }

        // Clean up driver session
        this.sessions.delete(agentId);
      }
    }
  }

  /**
   * Detect activity state from terminal output.
   * This is heuristic-based since we don't have structured events.
   */
  private detectActivityState(agentId: string, output: string): void {
    const lines = output.split("\n");
    const lastLines = lines.slice(-10).join("\n").toLowerCase();

    // Heuristic: look for common patterns
    if (lastLines.includes("$ ") || lastLines.includes("> ")) {
      // Looks like a shell prompt - likely idle
      this.updateState(agentId, { activityState: "idle" });
    } else if (lastLines.includes("thinking") || lastLines.includes("...")) {
      this.updateState(agentId, { activityState: "thinking" });
    } else if (lastLines.includes("error:") || lastLines.includes("Error:")) {
      this.updateState(agentId, { activityState: "error" });
    } else {
      // Assume working if there's recent output
      const state = this.agents.get(agentId);
      if (state && state.activityState === "thinking") {
        this.updateState(agentId, { activityState: "working" });
      }
    }
  }
}

/**
 * Factory function to create a Tmux driver.
 */
export async function createTmuxDriver(options?: TmuxDriverOptions): Promise<TmuxDriver> {
  const config = createDriverOptions("tmux", options);
  const driver = new TmuxDriver(config, options);

  // Verify health
  if (!(await driver.isHealthy())) {
    console.warn("[DRIVER] Tmux driver created but tmux binary not found");
  }

  return driver;
}
