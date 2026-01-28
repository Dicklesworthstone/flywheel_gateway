/**
 * NTM Ingest Service
 *
 * Polls NTM robot status and updates the agent state machine.
 * Maps NTM health/degraded states to agent lifecycle states.
 *
 * Key features:
 * - Configurable polling interval with backoff
 * - Maps NTM agent health states to LifecycleState
 * - Emits events for state changes
 * - Graceful handling when NTM is unavailable
 */

import {
  createBunNtmCommandRunner,
  createNtmClient,
  type NtmClient,
  type NtmIsWorkingOutput,
  type NtmSessionHealthOutput,
  type NtmSnapshotOutput,
  type NtmStatusOutput,
} from "@flywheel/flywheel-clients";
import { getLogger } from "../middleware/correlation";
import { LifecycleState } from "../models/agent-state";
import { incrementCounter, setGauge, recordHistogram } from "./metrics";
import {
  getAgentState,
  initializeAgentState,
  transitionState,
} from "./agent-state-machine";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the NTM ingest service.
 */
export interface NtmIngestConfig {
  /** Base polling interval in milliseconds (default: 5000) */
  pollIntervalMs?: number;
  /** Maximum backoff multiplier (default: 6, i.e., 30s max with 5s base) */
  maxBackoffMultiplier?: number;
  /** Working directory for NTM commands */
  cwd?: string;
  /** Command timeout in milliseconds (default: 10000) */
  commandTimeoutMs?: number;
}

/**
 * NTM agent state as reported by snapshot.
 */
export type NtmAgentState =
  | "idle"
  | "working"
  | "thinking"
  | "tool_calling"
  | "waiting"
  | "error"
  | "stalled"
  | "rate_limited"
  | "context_low";

/**
 * NTM agent health status.
 */
export type NtmHealthStatus = "healthy" | "degraded" | "unhealthy";

/**
 * Tracked agent info from NTM.
 */
export interface TrackedNtmAgent {
  pane: string;
  sessionName: string;
  agentType: string;
  lastState: NtmAgentState;
  lastHealth: NtmHealthStatus;
  lastSeenAt: Date;
  lastWorkStatus?: {
    isWorking: boolean;
    isIdle: boolean;
    isRateLimited: boolean;
    isContextLow: boolean;
    confidence: number;
    recommendation: string;
    recommendationReason: string;
    checkedAt: Date;
  };
  gatewayAgentId?: string;
}

/**
 * State change event emitted by the ingest service.
 */
export interface NtmStateChangeEvent {
  type: "ntm.agent.state_changed" | "ntm.agent.health_changed";
  pane: string;
  sessionName: string;
  agentType: string;
  previousValue: string;
  newValue: string;
  timestamp: Date;
}

// =============================================================================
// State Mapping
// =============================================================================

/**
 * Map NTM agent state to LifecycleState.
 * Not all NTM states map directly - some just indicate activity within EXECUTING.
 */
export function mapNtmStateToLifecycle(
  ntmState: NtmAgentState,
  currentLifecycleState?: LifecycleState,
): LifecycleState | null {
  switch (ntmState) {
    case "idle":
    case "waiting":
      return LifecycleState.READY;
    case "working":
    case "thinking":
    case "tool_calling":
      return LifecycleState.EXECUTING;
    case "error":
      return LifecycleState.FAILED;
    case "stalled":
      // Stalled could be PAUSED or FAILED depending on context
      // For now, treat as PAUSED to allow recovery
      return LifecycleState.PAUSED;
    case "rate_limited":
    case "context_low":
      // These are warnings but agent may still be operational
      // Don't change lifecycle state for these
      return null;
    default:
      return null;
  }
}

/**
 * Map NTM health status to potential state transitions.
 */
export function mapNtmHealthToLifecycle(
  health: NtmHealthStatus,
  currentState?: LifecycleState,
): LifecycleState | null {
  if (health === "unhealthy") {
    // If agent is unhealthy, transition to FAILED
    if (currentState && currentState !== LifecycleState.FAILED) {
      return LifecycleState.FAILED;
    }
  }
  // degraded and healthy don't trigger state changes
  return null;
}

// =============================================================================
// Service Implementation
// =============================================================================

/** Event listener type */
type NtmEventListener = (event: NtmStateChangeEvent) => void;

/**
 * NTM Ingest Service - polls NTM and updates agent state machine.
 */
export class NtmIngestService {
  private client: NtmClient;
  private config: Required<NtmIngestConfig>;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private backoffMultiplier = 1;
  private trackedAgents = new Map<string, TrackedNtmAgent>();
  private listeners: NtmEventListener[] = [];
  private lastPollTime: Date | null = null;
  private consecutiveErrors = 0;
  private lastIsWorkingSnapshot: {
    output: NtmIsWorkingOutput;
    checkedAt: Date;
  } | null = null;

  constructor(config: NtmIngestConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 5000,
      maxBackoffMultiplier: config.maxBackoffMultiplier ?? 6,
      cwd: config.cwd ?? process.cwd(),
      commandTimeoutMs: config.commandTimeoutMs ?? 10000,
    };

    const runner = createBunNtmCommandRunner();
    this.client = createNtmClient({
      runner,
      cwd: this.config.cwd,
      timeout: this.config.commandTimeoutMs,
    });
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.running) {
      return;
    }

    const log = getLogger();
    this.running = true;
    this.backoffMultiplier = 1;
    this.consecutiveErrors = 0;

    log.info(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        cwd: this.config.cwd,
      },
      "[NTM-INGEST] Starting NTM ingest service",
    );

    // Initial poll
    this.poll();

    // Schedule regular polling
    this.schedulePoll();
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    const log = getLogger();
    this.running = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    log.info("[NTM-INGEST] Stopped NTM ingest service");
  }

  /**
   * Register a listener for state change events.
   */
  onStateChange(listener: NtmEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get all tracked agents.
   */
  getTrackedAgents(): Map<string, TrackedNtmAgent> {
    return new Map(this.trackedAgents);
  }

  /**
   * Get the most recent NTM is-working snapshot, if available.
   */
  getIsWorkingSnapshot(): {
    output: NtmIsWorkingOutput;
    checkedAt: Date;
  } | null {
    if (!this.lastIsWorkingSnapshot) return null;
    return {
      output: this.lastIsWorkingSnapshot.output,
      checkedAt: this.lastIsWorkingSnapshot.checkedAt,
    };
  }

  /**
   * Associate a gateway agent ID with an NTM pane.
   */
  registerGatewayAgent(pane: string, gatewayAgentId: string): void {
    const tracked = this.trackedAgents.get(pane);
    if (tracked) {
      tracked.gatewayAgentId = gatewayAgentId;
    }
  }

  /**
   * Get service status.
   */
  getStatus(): {
    running: boolean;
    lastPollTime: Date | null;
    backoffMultiplier: number;
    consecutiveErrors: number;
    trackedAgentCount: number;
  } {
    return {
      running: this.running,
      lastPollTime: this.lastPollTime,
      backoffMultiplier: this.backoffMultiplier,
      consecutiveErrors: this.consecutiveErrors,
      trackedAgentCount: this.trackedAgents.size,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private schedulePoll(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    const interval = this.config.pollIntervalMs * this.backoffMultiplier;

    this.pollInterval = setInterval(() => {
      if (this.running) {
        this.poll();
      }
    }, interval);

    // Don't prevent process exit
    if (this.pollInterval.unref) {
      this.pollInterval.unref();
    }
  }

  private async poll(): Promise<void> {
    const log = getLogger();
    const pollStart = performance.now();

    try {
      // Check if NTM is available
      const isAvailable = await this.client.isAvailable();
      if (!isAvailable) {
        this.handleUnavailable("NTM not available on PATH");
        return;
      }

      // Get status to discover sessions
      const status = await this.client.status();
      await this.processStatus(status);

      // Get snapshot for detailed agent states
      const snapshot = await this.client.snapshot();
      if ("sessions" in snapshot) {
        await this.processSnapshot(snapshot as NtmSnapshotOutput);
      }

      // Get health for each session
      for (const session of status.sessions) {
        if (!session.exists) continue;
        try {
          const health = await this.client.health(session.name);
          await this.processHealth(session.name, health);
        } catch (err) {
          log.debug(
            { sessionName: session.name, error: String(err) },
            "[NTM-INGEST] Failed to get health for session",
          );
        }
      }

      // Get is-working signal for stuck detection
      try {
        const isWorking = await this.client.isWorking();
        await this.processIsWorking(isWorking);
      } catch (err) {
        log.debug(
          { error: String(err) },
          "[NTM-INGEST] Failed to get is-working signal",
        );
      }

      // Success - reset backoff
      this.consecutiveErrors = 0;
      if (this.backoffMultiplier > 1) {
        this.backoffMultiplier = 1;
        this.schedulePoll(); // Reschedule with normal interval
        log.info("[NTM-INGEST] Backoff reset, resuming normal polling");
      }

      this.lastPollTime = new Date();

      // Emit success metrics
      const pollDurationMs = Math.round(performance.now() - pollStart);
      recordHistogram("flywheel_ntm_poll_duration_ms", pollDurationMs);
      setGauge("flywheel_ntm_agents_tracked", this.trackedAgents.size);
      setGauge("flywheel_ntm_consecutive_errors", 0);
    } catch (err) {
      // Emit error metrics
      const pollDurationMs = Math.round(performance.now() - pollStart);
      recordHistogram("flywheel_ntm_poll_duration_ms", pollDurationMs);
      setGauge("flywheel_ntm_consecutive_errors", this.consecutiveErrors + 1);

      this.handleError(err);
    }
  }

  private handleUnavailable(reason: string): void {
    const log = getLogger();
    this.consecutiveErrors++;

    // Emit error metric
    incrementCounter("flywheel_ntm_poll_errors_total", 1, {
      error_type: "unavailable",
    });
    setGauge("flywheel_ntm_consecutive_errors", this.consecutiveErrors);

    // Increase backoff
    if (this.backoffMultiplier < this.config.maxBackoffMultiplier) {
      this.backoffMultiplier = Math.min(
        this.backoffMultiplier * 2,
        this.config.maxBackoffMultiplier,
      );
      this.schedulePoll();
    }

    log.warn(
      {
        reason,
        backoffMultiplier: this.backoffMultiplier,
        nextPollMs: this.config.pollIntervalMs * this.backoffMultiplier,
      },
      "[NTM-INGEST] NTM unavailable, backing off",
    );
  }

  private handleError(err: unknown): void {
    const log = getLogger();
    this.consecutiveErrors++;

    // Emit error metric
    incrementCounter("flywheel_ntm_poll_errors_total", 1, {
      error_type: "poll_error",
    });
    setGauge("flywheel_ntm_consecutive_errors", this.consecutiveErrors);

    // Increase backoff on repeated errors
    if (
      this.consecutiveErrors >= 3 &&
      this.backoffMultiplier < this.config.maxBackoffMultiplier
    ) {
      this.backoffMultiplier = Math.min(
        this.backoffMultiplier * 2,
        this.config.maxBackoffMultiplier,
      );
      this.schedulePoll();
    }

    log.error(
      {
        error: String(err),
        consecutiveErrors: this.consecutiveErrors,
        backoffMultiplier: this.backoffMultiplier,
      },
      "[NTM-INGEST] Poll error",
    );
  }

  private async processStatus(status: NtmStatusOutput): Promise<void> {
    const log = getLogger();

    log.debug(
      {
        totalSessions: status.sessions.length,
        totalAgents: status.summary.total_agents,
      },
      "[NTM-INGEST] Processing status",
    );

    // Track new agents, mark missing agents
    const seenPanes = new Set<string>();

    for (const session of status.sessions) {
      if (!session.exists || !session.agents) continue;

      for (const agent of session.agents) {
        seenPanes.add(agent.pane);

        if (!this.trackedAgents.has(agent.pane)) {
          // New agent discovered
          const tracked: TrackedNtmAgent = {
            pane: agent.pane,
            sessionName: session.name,
            agentType: agent.type,
            lastState: "idle",
            lastHealth: "healthy",
            lastSeenAt: new Date(),
          };
          this.trackedAgents.set(agent.pane, tracked);

          log.info(
            {
              pane: agent.pane,
              sessionName: session.name,
              agentType: agent.type,
            },
            "[NTM-INGEST] Discovered new agent",
          );
        }
      }
    }

    // Remove agents no longer present
    for (const [pane, tracked] of this.trackedAgents.entries()) {
      if (!seenPanes.has(pane)) {
        this.trackedAgents.delete(pane);
        log.info(
          { pane, sessionName: tracked.sessionName },
          "[NTM-INGEST] Agent no longer present",
        );
      }
    }
  }

  private async processSnapshot(snapshot: NtmSnapshotOutput): Promise<void> {
    const log = getLogger();

    for (const session of snapshot.sessions) {
      for (const agent of session.agents) {
        const tracked = this.trackedAgents.get(agent.pane);
        if (!tracked) continue;

        const newState = agent.state as NtmAgentState;
        if (tracked.lastState !== newState) {
          const previousState = tracked.lastState;
          tracked.lastState = newState;
          tracked.lastSeenAt = new Date();

          // Emit state transition metric
          incrementCounter("flywheel_ntm_state_transitions_total", 1, {
            from_state: previousState,
            to_state: newState,
          });

          // Emit event
          this.emitEvent({
            type: "ntm.agent.state_changed",
            pane: agent.pane,
            sessionName: session.name,
            agentType: agent.type,
            previousValue: previousState,
            newValue: newState,
            timestamp: new Date(),
          });

          // Update gateway agent state if registered
          if (tracked.gatewayAgentId) {
            this.updateGatewayAgentState(
              tracked.gatewayAgentId,
              previousState,
              newState,
            );
          }

          log.info(
            {
              pane: agent.pane,
              sessionName: session.name,
              previousState,
              newState,
              gatewayAgentId: tracked.gatewayAgentId,
            },
            "[NTM-INGEST] Agent state changed",
          );
        }
      }
    }
  }

  private async processHealth(
    sessionName: string,
    health: NtmSessionHealthOutput,
  ): Promise<void> {
    const log = getLogger();

    for (const agentHealth of health.agents) {
      // Find by pane number
      const paneKey = `${sessionName}:0.${agentHealth.pane}`;
      let tracked = this.trackedAgents.get(paneKey);

      // Try alternate pane format
      if (!tracked) {
        for (const [key, agent] of this.trackedAgents.entries()) {
          if (
            agent.sessionName === sessionName &&
            key.includes(`.${agentHealth.pane}`)
          ) {
            tracked = agent;
            break;
          }
        }
      }

      if (!tracked) continue;

      const newHealth = agentHealth.health as NtmHealthStatus;
      if (tracked.lastHealth !== newHealth) {
        const previousHealth = tracked.lastHealth;
        tracked.lastHealth = newHealth;
        tracked.lastSeenAt = new Date();

        // Emit event
        this.emitEvent({
          type: "ntm.agent.health_changed",
          pane: tracked.pane,
          sessionName,
          agentType: agentHealth.agent_type,
          previousValue: previousHealth,
          newValue: newHealth,
          timestamp: new Date(),
        });

        // Update gateway agent state if health is unhealthy
        if (tracked.gatewayAgentId && newHealth === "unhealthy") {
          this.markGatewayAgentFailed(tracked.gatewayAgentId, "ntm_unhealthy");
        }

        log.info(
          {
            pane: tracked.pane,
            sessionName,
            previousHealth,
            newHealth,
            gatewayAgentId: tracked.gatewayAgentId,
          },
          "[NTM-INGEST] Agent health changed",
        );
      }
    }
  }

  private async processIsWorking(output: NtmIsWorkingOutput): Promise<void> {
    const checkedAt = new Date();
    this.lastIsWorkingSnapshot = { output, checkedAt };

    for (const [agentId, status] of Object.entries(output.agents)) {
      const tracked = this.trackedAgents.get(agentId);
      if (!tracked) continue;

      tracked.lastWorkStatus = {
        isWorking: status.is_working,
        isIdle: status.is_idle,
        isRateLimited: status.is_rate_limited,
        isContextLow: status.is_context_low,
        confidence: status.confidence,
        recommendation: status.recommendation,
        recommendationReason: status.recommendation_reason,
        checkedAt,
      };
      tracked.lastSeenAt = checkedAt;
    }
  }

  private updateGatewayAgentState(
    agentId: string,
    previousNtmState: NtmAgentState,
    newNtmState: NtmAgentState,
  ): void {
    const log = getLogger();

    try {
      let agentRecord = getAgentState(agentId);
      if (!agentRecord) {
        // Agent not in state machine - initialize it
        agentRecord = initializeAgentState(agentId);
      }

      const currentState = agentRecord.currentState;
      const targetState = mapNtmStateToLifecycle(newNtmState, currentState);

      if (targetState && targetState !== currentState) {
        // Determine reason based on state transition
        let reason: string;
        if (targetState === LifecycleState.READY) {
          reason = "ntm_idle";
        } else if (targetState === LifecycleState.EXECUTING) {
          reason = "ntm_working";
        } else if (targetState === LifecycleState.FAILED) {
          reason = "ntm_error";
        } else if (targetState === LifecycleState.PAUSED) {
          reason = "ntm_stalled";
        } else {
          reason = "ntm_state_change";
        }

        transitionState(
          agentId,
          targetState,
          reason as Parameters<typeof transitionState>[2],
          undefined,
          { ntmPreviousState: previousNtmState, ntmNewState: newNtmState },
        );

        log.debug(
          {
            agentId,
            previousLifecycleState: currentState,
            newLifecycleState: targetState,
            ntmState: newNtmState,
          },
          "[NTM-INGEST] Updated gateway agent state",
        );
      }
    } catch (err) {
      log.warn(
        { agentId, error: String(err) },
        "[NTM-INGEST] Failed to update gateway agent state",
      );
    }
  }

  private markGatewayAgentFailed(agentId: string, reason: string): void {
    const log = getLogger();

    try {
      const agentRecord = getAgentState(agentId);
      if (!agentRecord) return;

      if (agentRecord.currentState !== LifecycleState.FAILED) {
        transitionState(
          agentId,
          LifecycleState.FAILED,
          reason as Parameters<typeof transitionState>[2],
          { code: "NTM_UNHEALTHY", message: "NTM reported agent as unhealthy" },
        );

        log.warn(
          { agentId, reason },
          "[NTM-INGEST] Marked gateway agent as failed",
        );
      }
    } catch (err) {
      log.warn(
        { agentId, error: String(err) },
        "[NTM-INGEST] Failed to mark gateway agent as failed",
      );
    }
  }

  private emitEvent(event: NtmStateChangeEvent): void {
    const log = getLogger();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        log.error(
          { error: String(err), event },
          "[NTM-INGEST] Event listener threw error",
        );
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultInstance: NtmIngestService | null = null;

/**
 * Get the default NTM ingest service instance.
 */
export function getNtmIngestService(): NtmIngestService {
  if (!defaultInstance) {
    defaultInstance = new NtmIngestService();
  }
  return defaultInstance;
}

/**
 * Set the default NTM ingest service instance (for testing).
 */
export function setNtmIngestService(service: NtmIngestService | null): void {
  defaultInstance = service;
}

/**
 * Start the default NTM ingest service.
 */
export function startNtmIngest(config?: NtmIngestConfig): NtmIngestService {
  if (defaultInstance) {
    defaultInstance.stop();
  }
  defaultInstance = new NtmIngestService(config);
  defaultInstance.start();
  return defaultInstance;
}

/**
 * Stop the default NTM ingest service.
 */
export function stopNtmIngest(): void {
  if (defaultInstance) {
    defaultInstance.stop();
  }
}
