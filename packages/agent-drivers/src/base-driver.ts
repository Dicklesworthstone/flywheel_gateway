/**
 * Base Driver - Abstract base class for agent drivers.
 *
 * Provides common functionality that all drivers share:
 * - Agent state management
 * - Event emission infrastructure
 * - Output buffering
 * - Health check framework
 */

import type { AgentDriver, DriverOptions } from "./interface";
import type {
  Agent,
  AgentConfig,
  AgentDriverType,
  AgentEvent,
  AgentState,
  Checkpoint,
  CheckpointMetadata,
  DriverCapabilities,
  OutputLine,
  SendResult,
  SpawnResult,
  TokenUsage,
} from "./types";

type DriverLogLevel = "debug" | "info" | "warn" | "error";
type DriverLogger = (
  level: DriverLogLevel,
  message: string,
  context?: Record<string, unknown>,
) => void;
const DRIVER_DEBUG_ENABLED = process.env["FLYWHEEL_DRIVER_DEBUG"] === "1";
let driverLogger: DriverLogger | undefined;

export function logDriver(
  level: DriverLogLevel,
  driverType: AgentDriverType,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!DRIVER_DEBUG_ENABLED || !driverLogger) return;
  const formatted = `[DRIVER] ${driverType} ${message}`;
  driverLogger(level, formatted, context);
}

export function setDriverLogger(logger: DriverLogger | undefined): void {
  driverLogger = logger;
}

/**
 * Configuration for base driver.
 */
export interface BaseDriverConfig {
  driverId: string;
  driverType: AgentDriverType;
  capabilities: DriverCapabilities;
  maxConcurrentAgents: number;
  outputBufferSize: number;
  stallThresholdMs: number;
  onEventError?: (error: unknown, event: AgentEvent) => void;
}

/**
 * Internal agent state with additional driver-specific data.
 */
interface InternalAgentState extends AgentState {
  outputBuffer: OutputLine[];
  eventSubscribers: Set<(event: AgentEvent) => void>;
  stallCheckInterval?: ReturnType<typeof setInterval>;
}

/**
 * Abstract base class for agent drivers.
 * Concrete drivers should extend this and implement the abstract methods.
 */
export abstract class BaseDriver implements AgentDriver {
  readonly driverId: string;
  readonly driverType: AgentDriverType;
  protected readonly capabilities: DriverCapabilities;
  protected readonly config: BaseDriverConfig;
  protected agents = new Map<string, InternalAgentState>();

  constructor(config: BaseDriverConfig) {
    this.driverId = config.driverId;
    this.driverType = config.driverType;
    this.capabilities = config.capabilities;
    this.config = config;
  }

  // ============================================================================
  // Abstract methods that concrete drivers must implement
  // ============================================================================

  /**
   * Driver-specific agent spawning logic.
   */
  protected abstract doSpawn(config: AgentConfig): Promise<Agent>;

  /**
   * Driver-specific message sending logic.
   */
  protected abstract doSend(
    agentId: string,
    message: string,
  ): Promise<SendResult>;

  /**
   * Driver-specific termination logic.
   */
  protected abstract doTerminate(
    agentId: string,
    graceful: boolean,
  ): Promise<void>;

  /**
   * Driver-specific interrupt logic.
   */
  protected abstract doInterrupt(agentId: string): Promise<void>;

  /**
   * Driver-specific health check.
   */
  protected abstract doHealthCheck(): Promise<boolean>;

  // ============================================================================
  // Public interface implementation
  // ============================================================================

  getCapabilities(): DriverCapabilities {
    return { ...this.capabilities };
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.doHealthCheck();
    } catch {
      return false;
    }
  }

  async spawn(config: AgentConfig): Promise<SpawnResult> {
    // Check capacity
    if (this.agents.size >= this.config.maxConcurrentAgents) {
      throw new Error(
        `Driver ${this.driverId} at capacity (${this.config.maxConcurrentAgents} agents)`,
      );
    }

    // Check for duplicate ID
    if (this.agents.has(config.id)) {
      throw new Error(`Agent with ID ${config.id} already exists`);
    }

    // Spawn via concrete implementation
    const agent = await this.doSpawn(config);

    // Initialize internal state
    const internalState: InternalAgentState = {
      ...agent,
      outputBuffer: [],
      eventSubscribers: new Set(),
    };

    // Set up stall detection
    if (this.config.stallThresholdMs > 0) {
      internalState.stallCheckInterval = setInterval(
        () => this.checkStall(config.id),
        this.config.stallThresholdMs / 2,
      );
    }

    this.agents.set(config.id, internalState);

    return { agent };
  }

  async getState(agentId: string): Promise<AgentState> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    // Return state without internal fields
    const {
      outputBuffer,
      eventSubscribers,
      stallCheckInterval,
      ...agentState
    } = state;
    return agentState;
  }

  async terminate(agentId: string, graceful = true): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Clean up stall check
    if (state.stallCheckInterval) {
      clearInterval(state.stallCheckInterval);
    }

    // Terminate via concrete implementation
    await this.doTerminate(agentId, graceful);

    // Emit terminated event
    this.emitEvent(agentId, {
      type: "terminated",
      agentId,
      timestamp: new Date(),
      reason: "user_requested",
      exitCode: undefined,
    });

    // Clean up subscribers
    state.eventSubscribers.clear();
    this.agents.delete(agentId);
  }

  async send(agentId: string, message: string): Promise<SendResult> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Agent is busy if it's processing (thinking), actively working, or calling tools
    if (
      state.activityState === "thinking" ||
      state.activityState === "working" ||
      state.activityState === "tool_calling"
    ) {
      throw new Error(`Agent ${agentId} is busy`);
    }

    // Update state
    this.updateState(agentId, { activityState: "thinking" });

    try {
      // Send via concrete implementation
      return await this.doSend(agentId, message);
    } catch (err) {
      this.emitEvent(agentId, {
        type: "error",
        agentId,
        timestamp: new Date(),
        error: err instanceof Error ? err : new Error(String(err)),
        recoverable: true,
      });
      this.updateState(agentId, { activityState: "error" });
      throw err;
    }
  }

  async interrupt(agentId: string): Promise<void> {
    if (!this.capabilities.interrupt) {
      throw new Error(
        `Driver ${this.driverType} does not support interruption`,
      );
    }

    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    await this.doInterrupt(agentId);

    // Emit interrupt event
    this.emitEvent(agentId, {
      type: "interrupt",
      agentId,
      timestamp: new Date(),
      reason: "user",
    });

    this.updateState(agentId, { activityState: "idle" });
  }

  async getOutput(
    agentId: string,
    since?: Date,
    limit = 100,
  ): Promise<OutputLine[]> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    let output = state.outputBuffer;
    if (since) {
      output = output.filter((line) => line.timestamp > since);
    }
    return output.slice(-limit);
  }

  async *subscribe(agentId: string): AsyncIterable<AgentEvent> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Create an async queue for events
    const queue: AgentEvent[] = [];
    let resolveWaiting: ((value: IteratorResult<AgentEvent>) => void) | null =
      null;
    let done = false;

    const subscriber = (event: AgentEvent) => {
      if (event.type === "terminated") {
        done = true;
      }
      if (resolveWaiting) {
        resolveWaiting({ value: event, done: false });
        resolveWaiting = null;
      } else {
        queue.push(event);
      }
    };

    state.eventSubscribers.add(subscriber);

    try {
      while (!done) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const event = await new Promise<IteratorResult<AgentEvent>>(
            (resolve) => {
              resolveWaiting = resolve;
            },
          );
          if (!event.done) {
            yield event.value;
          }
        }
      }
      // Drain any remaining queued events after done is set
      // This handles the case where terminated arrives while we're processing a previous event
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      state.eventSubscribers.delete(subscriber);
    }
  }

  // ============================================================================
  // Protected helper methods for concrete drivers
  // ============================================================================

  /**
   * Update agent state and emit state change event.
   */
  protected updateState(agentId: string, updates: Partial<AgentState>): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const previousState = state.activityState;
    Object.assign(state, updates, { lastActivityAt: new Date() });

    if (updates.activityState && updates.activityState !== previousState) {
      this.emitEvent(agentId, {
        type: "state_change",
        agentId,
        timestamp: new Date(),
        previousState,
        newState: updates.activityState,
      });
    }
  }

  /**
   * Add output line to buffer and emit output event.
   */
  protected addOutput(agentId: string, output: OutputLine): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    // Add to buffer with size limit
    state.outputBuffer.push(output);
    if (state.outputBuffer.length > this.config.outputBufferSize) {
      state.outputBuffer.shift();
    }

    // Emit output event
    this.emitEvent(agentId, {
      type: "output",
      agentId,
      timestamp: output.timestamp,
      output,
    });

    // Update activity
    state.lastActivityAt = new Date();
    if (state.activityState === "thinking") {
      this.updateState(agentId, { activityState: "working" });
    }
  }

  /**
   * Update token usage for an agent.
   */
  protected updateTokenUsage(
    agentId: string,
    usage: Partial<TokenUsage>,
  ): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const nextUsage: TokenUsage = { ...state.tokenUsage, ...usage };
    if (usage.totalTokens === undefined) {
      const promptTokens = nextUsage.promptTokens ?? 0;
      const completionTokens = nextUsage.completionTokens ?? 0;
      nextUsage.totalTokens = promptTokens + completionTokens;
    }
    state.tokenUsage = nextUsage;

    // Calculate context health
    const maxTokens = state.config.maxTokens ?? 100000;
    const usagePercent = (state.tokenUsage.totalTokens / maxTokens) * 100;

    let contextHealth: AgentState["contextHealth"];
    if (usagePercent > 95) {
      contextHealth = "emergency";
    } else if (usagePercent > 85) {
      contextHealth = "critical";
    } else if (usagePercent > 75) {
      contextHealth = "warning";
    } else {
      contextHealth = "healthy";
    }

    if (contextHealth !== state.contextHealth) {
      state.contextHealth = contextHealth;
      if (contextHealth !== "healthy") {
        this.emitEvent(agentId, {
          type: "context_warning",
          agentId,
          timestamp: new Date(),
          level:
            contextHealth === "emergency"
              ? "emergency"
              : contextHealth === "critical"
                ? "critical"
                : "warning",
          usagePercent,
          suggestion: this.getContextSuggestion(contextHealth),
        });
      }
    }
  }

  /**
   * Emit an event to all subscribers.
   */
  protected emitEvent(agentId: string, event: AgentEvent): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    for (const subscriber of state.eventSubscribers) {
      try {
        subscriber(event);
      } catch (err) {
        this.config.onEventError?.(err, event);
      }
    }
  }

  /**
   * Check if agent has stalled.
   */
  private checkStall(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const timeSinceActivity = Date.now() - state.lastActivityAt.getTime();
    if (
      timeSinceActivity > this.config.stallThresholdMs &&
      state.activityState !== "idle" &&
      state.activityState !== "stalled"
    ) {
      this.updateState(agentId, { activityState: "stalled" });
    }
  }

  /**
   * Get suggestion for context health level.
   */
  private getContextSuggestion(level: AgentState["contextHealth"]): string {
    switch (level) {
      case "warning":
        return "Consider creating a checkpoint soon";
      case "critical":
        return "Recommend summarizing and rotating context";
      case "emergency":
        return "Context nearly full - immediate rotation needed";
      default:
        return "";
    }
  }
}

/**
 * Create default driver options with sensible defaults.
 */
export function createDriverOptions(
  type: AgentDriverType,
  options?: Partial<DriverOptions>,
): BaseDriverConfig {
  return {
    driverId: options?.driverId ?? `${type}-${Date.now()}`,
    driverType: type,
    capabilities: getDefaultCapabilities(type),
    maxConcurrentAgents: options?.maxConcurrentAgents ?? 10,
    outputBufferSize: 1000,
    stallThresholdMs: 5 * 60 * 1000, // 5 minutes
  };
}

/**
 * Get default capabilities for a driver type.
 */
function getDefaultCapabilities(type: AgentDriverType): DriverCapabilities {
  switch (type) {
    case "sdk":
      return {
        structuredEvents: true,
        toolCalls: true,
        fileOperations: true,
        terminalAttach: false,
        diffRendering: false,
        checkpoint: true,
        interrupt: true,
        streaming: true,
      };
    case "acp":
      return {
        structuredEvents: true,
        toolCalls: true,
        fileOperations: true,
        terminalAttach: false,
        diffRendering: true,
        checkpoint: true,
        interrupt: true,
        streaming: true,
      };
    case "tmux":
      return {
        structuredEvents: false,
        toolCalls: false,
        fileOperations: false,
        terminalAttach: true,
        diffRendering: false,
        checkpoint: false,
        interrupt: true,
        streaming: true,
      };
    case "mock":
      return {
        structuredEvents: true,
        toolCalls: true,
        fileOperations: true,
        terminalAttach: false,
        diffRendering: false,
        checkpoint: true,
        interrupt: true,
        streaming: true,
      };
  }
}
