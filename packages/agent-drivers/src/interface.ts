/**
 * Agent Driver Interface - The core abstraction for agent backends.
 *
 * This interface defines the contract that all agent drivers must implement,
 * enabling Flywheel Gateway to work with multiple execution backends:
 * - SDK Driver: Direct API calls to Claude/Codex/Gemini SDKs
 * - Claude Code WS Driver: Claude CLI --sdk-url websocket transport
 * - ACP Driver: Agent Client Protocol for IDE-compatible structured events
 * - Tmux Driver: Visual terminal access for power users
 *
 * The abstraction ensures features work consistently regardless of backend.
 */

import type {
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
} from "./types";

/**
 * The core interface that all agent drivers must implement.
 */
export interface AgentDriver {
  /**
   * Unique identifier for this driver instance.
   */
  readonly driverId: string;

  /**
   * The type of this driver (sdk, claude_code_ws, acp, tmux, ntm, mock).
   */
  readonly driverType: AgentDriverType;

  /**
   * Get the capabilities of this driver.
   * Features should check capabilities before attempting operations.
   */
  getCapabilities(): DriverCapabilities;

  /**
   * Check if the driver is healthy and ready to accept requests.
   */
  isHealthy(): Promise<boolean>;

  // ============================================================================
  // Agent Lifecycle
  // ============================================================================

  /**
   * Spawn a new agent with the given configuration.
   *
   * @param config - Agent configuration including model, working directory, etc.
   * @returns The spawned agent instance
   * @throws {DriverInitError} If the driver fails to initialize the agent
   */
  spawn(config: AgentConfig): Promise<SpawnResult>;

  /**
   * Get the current state of an agent.
   *
   * @param agentId - The agent's unique identifier
   * @returns The current agent state
   * @throws {AgentNotFoundError} If the agent doesn't exist
   */
  getState(agentId: string): Promise<AgentState>;

  /**
   * Terminate an agent, cleaning up resources.
   *
   * @param agentId - The agent's unique identifier
   * @param graceful - If true, allow agent to finish current operation
   * @throws {AgentNotFoundError} If the agent doesn't exist
   */
  terminate(agentId: string, graceful?: boolean): Promise<void>;

  // ============================================================================
  // Communication
  // ============================================================================

  /**
   * Send a message/prompt to the agent.
   *
   * @param agentId - The agent's unique identifier
   * @param message - The message to send
   * @returns Result including message ID and whether it was queued
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {AgentBusyError} If the agent is not accepting input
   */
  send(agentId: string, message: string): Promise<SendResult>;

  /**
   * Interrupt the agent's current operation.
   * Only works if the driver supports interruption.
   *
   * @param agentId - The agent's unique identifier
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {NotSupportedError} If the driver doesn't support interruption
   */
  interrupt(agentId: string): Promise<void>;

  // ============================================================================
  // Output Streaming
  // ============================================================================

  /**
   * Get recent output from the agent.
   *
   * @param agentId - The agent's unique identifier
   * @param since - Only return output after this timestamp
   * @param limit - Maximum number of output lines to return
   * @returns Array of output lines
   * @throws {AgentNotFoundError} If the agent doesn't exist
   */
  getOutput(
    agentId: string,
    since?: Date,
    limit?: number,
  ): Promise<OutputLine[]>;

  /**
   * Subscribe to real-time agent events.
   * Returns an async iterable that yields events as they occur.
   *
   * @param agentId - The agent's unique identifier
   * @param signal - Optional AbortSignal to cancel the subscription
   * @returns Async iterable of agent events
   * @throws {AgentNotFoundError} If the agent doesn't exist
   */
  subscribe(agentId: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;

  // ============================================================================
  // Checkpointing (Optional)
  // ============================================================================

  /**
   * Create a checkpoint of the agent's current state.
   * Only available if driver supports checkpointing.
   *
   * @param agentId - The agent's unique identifier
   * @param description - Optional description for the checkpoint
   * @returns Checkpoint metadata
   * @throws {NotSupportedError} If driver doesn't support checkpointing
   */
  createCheckpoint?(
    agentId: string,
    description?: string,
  ): Promise<CheckpointMetadata>;

  /**
   * List available checkpoints for an agent.
   *
   * @param agentId - The agent's unique identifier
   * @returns Array of checkpoint metadata
   */
  listCheckpoints?(agentId: string): Promise<CheckpointMetadata[]>;

  /**
   * Get a specific checkpoint by ID.
   *
   * @param agentId - The agent's unique identifier
   * @param checkpointId - The checkpoint's unique identifier
   * @returns The full checkpoint data
   */
  getCheckpoint?(agentId: string, checkpointId: string): Promise<Checkpoint>;

  /**
   * Restore an agent to a previous checkpoint.
   *
   * @param agentId - The agent's unique identifier
   * @param checkpointId - The checkpoint to restore to
   * @returns The restored agent state
   */
  restoreCheckpoint?(
    agentId: string,
    checkpointId: string,
  ): Promise<AgentState>;
}

/**
 * Options for initializing a driver.
 */
export interface DriverOptions {
  /** Unique identifier for this driver instance */
  driverId?: string;
  /** Timeout for operations in milliseconds */
  timeoutMs?: number;
  /** Maximum concurrent agents this driver can handle */
  maxConcurrentAgents?: number;
  /** Path to store driver state/checkpoints */
  statePath?: string;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

/**
 * Factory function type for creating drivers.
 */
export type DriverFactory = (options?: DriverOptions) => Promise<AgentDriver>;

/**
 * Registry entry for a driver.
 */
export interface DriverRegistryEntry {
  type: AgentDriverType;
  factory: DriverFactory;
  description: string;
  defaultCapabilities: DriverCapabilities;
}

// Re-export types for convenience
export type {
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
} from "./types";
