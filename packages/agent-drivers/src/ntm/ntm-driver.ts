/**
 * NTM Driver - Agent driver backed by NTM (Named Tmux Manager).
 *
 * This driver provides integration with NTM for agent orchestration:
 * - Uses NTM robot commands for session management
 * - Maps agent operations to tmux sessions via NTM
 * - Supports real-time output streaming via tail/snapshot
 * - Provides terminal attach capability for debugging
 */

import {
  BaseDriver,
  type BaseDriverConfig,
  createDriverOptions,
  generateSecureId,
  logDriver,
} from "../base-driver";
import type { DriverOptions } from "../interface";
import {
  createAgentNtmMapping,
  generateNtmPaneId,
  generateNtmSessionName,
} from "../naming";
import type { Agent, AgentConfig, SendResult } from "../types";
import {
  type NtmClient,
  type NtmCommandRunner,
  type NtmSnapshotOutput,
  type NtmTailOutput,
  createBunNtmCommandRunner,
  createNtmClient,
} from "@flywheel/flywheel-clients";

/**
 * Configuration specific to NTM driver.
 */
export interface NtmDriverOptions extends DriverOptions {
  /** Custom command runner (for testing) */
  runner?: NtmCommandRunner;
  /** Working directory for NTM commands */
  cwd?: string;
  /** Poll interval for output streaming in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Number of tail lines to fetch (default: 50) */
  tailLines?: number;
  /** Default timeout for NTM commands in ms (default: 30000) */
  commandTimeoutMs?: number;
}

/**
 * Internal state for an NTM agent session.
 */
interface NtmAgentSession {
  config: AgentConfig;
  sessionName: string;
  paneId: string;
  pollInterval?: ReturnType<typeof setInterval>;
  lastSnapshotTs?: string;
}

/**
 * NTM Driver implementation.
 *
 * This driver delegates agent execution to NTM-managed tmux sessions.
 * It uses NTM's robot-mode commands for structured status and control.
 */
export class NtmDriver extends BaseDriver {
  private client: NtmClient;
  private cwd: string | undefined;
  private pollIntervalMs: number;
  private tailLines: number;
  private sessions = new Map<string, NtmAgentSession>();

  constructor(config: BaseDriverConfig, options: NtmDriverOptions = {}) {
    super(config);
    const runner = options.runner ?? createBunNtmCommandRunner();
    // Build client options, only including cwd if defined
    const clientOpts: {
      runner: NtmCommandRunner;
      cwd?: string;
      timeout?: number;
    } = {
      runner,
      timeout: options.commandTimeoutMs ?? 30000,
    };
    if (options.cwd !== undefined) {
      clientOpts.cwd = options.cwd;
    }
    this.client = createNtmClient(clientOpts);
    this.cwd = options.cwd;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.tailLines = options.tailLines ?? 50;
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  protected async doHealthCheck(): Promise<boolean> {
    try {
      const available = await this.client.isAvailable();
      if (!available) {
        logDriver("warn", this.driverType, "ntm_not_available");
        return false;
      }

      // Check if we can get status
      const statusOpts = this.cwd !== undefined ? { cwd: this.cwd } : undefined;
      const status = await this.client.status(statusOpts);
      logDriver("debug", this.driverType, "health_check_passed", {
        totalSessions: status.sessions.length,
        totalAgents: status.summary.total_agents,
      });
      return true;
    } catch (err) {
      logDriver("error", this.driverType, "health_check_failed", {
        error: String(err),
      });
      return false;
    }
  }

  protected async doSpawn(config: AgentConfig): Promise<Agent> {
    // Generate deterministic session name using naming utility
    // Format: fw-<project>-<agent>-<hash6>
    // See naming.ts for full documentation on end-to-end tracing
    const sessionName = generateNtmSessionName({ config });
    const mapping = createAgentNtmMapping(config);

    // For NTM driver, we expect the session to already exist or be created
    // via NTM spawn commands. The driver maps to existing NTM sessions.
    // In a full implementation, this would call ntm spawn to create the session.

    // Generate default pane ID using naming utility
    let paneId = generateNtmPaneId(sessionName);

    try {
      const spawnStatusOpts =
        this.cwd !== undefined ? { cwd: this.cwd } : undefined;
      const status = await this.client.status(spawnStatusOpts);
      const existingSession = status.sessions.find(
        (s) => s.name === sessionName,
      );

      if (
        existingSession &&
        existingSession.agents &&
        existingSession.agents.length > 0
      ) {
        // Use existing agent's pane
        paneId = existingSession.agents[0]!.pane;
        logDriver("info", this.driverType, "action=spawn found_existing", {
          agentId: config.id,
          sessionName,
          paneId,
        });
      } else {
        // Session doesn't exist - in production, we would spawn it
        // For now, log that we're creating a virtual session
        logDriver("info", this.driverType, "action=spawn new_session", {
          agentId: config.id,
          sessionName,
          note: "Session will be created on first send",
        });
      }
    } catch (err) {
      logDriver("warn", this.driverType, "spawn_status_check_failed", {
        agentId: config.id,
        error: String(err),
      });
    }

    // Create session state
    const session: NtmAgentSession = {
      config,
      sessionName,
      paneId,
    };

    this.sessions.set(config.id, session);

    // Start output polling
    this.startOutputPolling(config.id);

    // Log spawn with full mapping info for end-to-end tracing
    // Operators can correlate Gateway agentId with NTM sessionName/paneId
    logDriver("info", this.driverType, "action=spawn", {
      agentId: config.id,
      sessionName,
      paneId,
      model: config.model,
      workingDirectory: config.workingDirectory,
      // Include mapping details for tracing documentation
      ntmMapping: {
        project: mapping.project,
        agentLabel: mapping.agentLabel,
        suffix: mapping.suffix,
      },
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

  protected async doSend(
    agentId: string,
    message: string,
  ): Promise<SendResult> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const messageId = generateSecureId("msg");

    // In a full implementation, this would send keys to the tmux pane
    // via ntm send-keys or similar command. For now, we log the action.
    logDriver("info", this.driverType, "action=send", {
      agentId,
      sessionName: session.sessionName,
      paneId: session.paneId,
      messageLength: message.length,
      messageId,
    });

    // Update state to indicate we're processing
    this.updateState(agentId, { activityState: "working" });

    // After sending, poll for output
    this.pollOutput(agentId).catch((err) => {
      logDriver("error", this.driverType, "poll_after_send_failed", {
        agentId,
        error: String(err),
      });
    });

    return { messageId, queued: false };
  }

  protected async doTerminate(
    agentId: string,
    graceful: boolean,
  ): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;

    // Stop output polling
    if (session.pollInterval) {
      clearInterval(session.pollInterval);
    }

    // Log termination
    logDriver("info", this.driverType, "action=terminate", {
      agentId,
      sessionName: session.sessionName,
      graceful,
    });

    // In a full implementation, this would kill the tmux session
    // via ntm kill-session or similar command

    // Clean up session
    this.sessions.delete(agentId);
  }

  protected async doInterrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    // In a full implementation, this would send Ctrl+C to the pane
    // via ntm send-keys -t <pane> C-c
    logDriver("info", this.driverType, "action=interrupt", {
      agentId,
      sessionName: session.sessionName,
      paneId: session.paneId,
    });
  }

  // ============================================================================
  // NTM-specific methods
  // ============================================================================

  /**
   * Start polling for output from the NTM session.
   */
  private startOutputPolling(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (!session) return;

    session.pollInterval = setInterval(() => {
      this.pollOutput(agentId).catch((err) => {
        logDriver("error", this.driverType, "output_poll_error", {
          agentId,
          error: String(err),
        });
      });
    }, this.pollIntervalMs);
  }

  /**
   * Poll NTM for output updates.
   */
  private async pollOutput(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;

    try {
      // Build tail options
      const tailOpts: { lines: number; cwd?: string } = {
        lines: this.tailLines,
      };
      if (this.cwd !== undefined) {
        tailOpts.cwd = this.cwd;
      }

      // Use tail to get recent output
      const tail = await this.client.tail(session.sessionName, tailOpts);

      this.processOutputFromTail(agentId, tail);

      // Build snapshot options
      const snapshotOpts: { since?: string; cwd?: string } = {};
      if (session.lastSnapshotTs !== undefined) {
        snapshotOpts.since = session.lastSnapshotTs;
      }
      if (this.cwd !== undefined) {
        snapshotOpts.cwd = this.cwd;
      }

      // Also get snapshot for state detection
      const snapshot = await this.client.snapshot(
        Object.keys(snapshotOpts).length > 0 ? snapshotOpts : undefined,
      );

      this.processStateFromSnapshot(agentId, snapshot);

      // Update last snapshot timestamp for delta queries
      if ("ts" in snapshot) {
        session.lastSnapshotTs = snapshot.ts;
      }
    } catch (err) {
      // Don't throw - polling errors are non-fatal
      logDriver("debug", this.driverType, "poll_output_skipped", {
        agentId,
        error: String(err),
      });
    }
  }

  /**
   * Process output lines from NTM tail command.
   */
  private processOutputFromTail(agentId: string, tail: NtmTailOutput): void {
    const session = this.sessions.get(agentId);
    if (!session) return;

    // Find the pane output for this agent
    // The panes field is a record of pane outputs
    const paneOutput = tail.panes[session.paneId] as
      | { type: string; state: string; lines: string[]; truncated: boolean }
      | undefined;
    if (!paneOutput) return;

    // Process output lines
    for (const line of paneOutput.lines) {
      this.addOutput(agentId, {
        timestamp: new Date(),
        type: "text",
        content: line,
        metadata: {
          source: "ntm_tail",
          pane: session.paneId,
        },
      });
    }

    // Update state based on pane state
    const ntmState = paneOutput.state;
    let activityState = this.agents.get(agentId)?.activityState;

    if (ntmState === "idle" || ntmState === "waiting") {
      activityState = "idle";
    } else if (ntmState === "working" || ntmState === "thinking") {
      activityState = "working";
    } else if (ntmState === "error") {
      activityState = "error";
    }

    if (activityState) {
      this.updateState(agentId, { activityState });
    }
  }

  /**
   * Process state from NTM snapshot.
   */
  private processStateFromSnapshot(
    agentId: string,
    snapshot:
      | NtmSnapshotOutput
      | { ts: string; since: string; changes: unknown[] },
  ): void {
    const session = this.sessions.get(agentId);
    if (!session) return;

    // Handle full snapshot
    if ("sessions" in snapshot) {
      const fullSnapshot = snapshot as NtmSnapshotOutput;
      const sessionData = fullSnapshot.sessions.find(
        (s) => s.name === session.sessionName,
      );

      if (sessionData) {
        const agent = sessionData.agents.find((a) => a.pane === session.paneId);
        if (agent) {
          // Update activity state based on NTM agent state
          let activityState = this.agents.get(agentId)?.activityState;

          switch (agent.state) {
            case "idle":
            case "waiting":
              activityState = "idle";
              break;
            case "working":
            case "thinking":
              activityState = "working";
              break;
            case "tool_calling":
              activityState = "tool_calling";
              break;
            case "error":
              activityState = "error";
              break;
            case "stalled":
              activityState = "stalled";
              break;
          }

          if (activityState) {
            this.updateState(agentId, { activityState });
          }
        }
      }
    }
  }

  /**
   * Get NTM context for an agent (token usage estimation).
   */
  async getContext(agentId: string): Promise<{
    estimatedTokens: number;
    usagePercent: number;
    contextLimit: number;
  }> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    try {
      const contextOpts: { cwd?: string } = {};
      if (this.cwd !== undefined) {
        contextOpts.cwd = this.cwd;
      }
      const context = await this.client.context(
        session.sessionName,
        Object.keys(contextOpts).length > 0 ? contextOpts : undefined,
      );

      const agentContext = context.agents.find(
        (a) => a.pane === session.paneId,
      );

      if (agentContext) {
        return {
          estimatedTokens: agentContext.estimated_tokens,
          usagePercent: agentContext.usage_percent,
          contextLimit: agentContext.context_limit,
        };
      }

      return {
        estimatedTokens: 0,
        usagePercent: 0,
        contextLimit: 100000,
      };
    } catch (err) {
      logDriver("warn", this.driverType, "get_context_failed", {
        agentId,
        error: String(err),
      });
      return {
        estimatedTokens: 0,
        usagePercent: 0,
        contextLimit: 100000,
      };
    }
  }

  /**
   * Get NTM health for an agent.
   */
  async getHealth(agentId: string): Promise<{
    healthy: boolean;
    idleSinceSeconds: number;
    restarts: number;
  }> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    try {
      const healthOpts: { cwd?: string } = {};
      if (this.cwd !== undefined) {
        healthOpts.cwd = this.cwd;
      }
      const health = await this.client.health(
        session.sessionName,
        Object.keys(healthOpts).length > 0 ? healthOpts : undefined,
      );

      const agentHealth = health.agents.find(
        (a) => a.agent_type === session.config.provider,
      );

      if (agentHealth) {
        return {
          healthy: agentHealth.health === "healthy",
          idleSinceSeconds: agentHealth.idle_since_seconds,
          restarts: agentHealth.restarts,
        };
      }

      return {
        healthy: true,
        idleSinceSeconds: 0,
        restarts: 0,
      };
    } catch (err) {
      logDriver("warn", this.driverType, "get_health_failed", {
        agentId,
        error: String(err),
      });
      return {
        healthy: false,
        idleSinceSeconds: 0,
        restarts: 0,
      };
    }
  }
}

/**
 * Factory function to create an NTM driver.
 */
export async function createNtmDriver(
  options?: NtmDriverOptions,
): Promise<NtmDriver> {
  const config = createDriverOptions("ntm", options);
  const driver = new NtmDriver(config, options);

  // Verify health
  if (!(await driver.isHealthy())) {
    logDriver("warn", "ntm", "driver_unhealthy", {
      reason: "ntm_not_available_or_check_failed",
    });
  }

  return driver;
}
