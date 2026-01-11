/**
 * Auto-Checkpoint Service
 *
 * Automatically creates checkpoints based on configurable triggers:
 * - Time interval (e.g., every 5 minutes)
 * - Message count threshold (e.g., every 50 messages)
 * - Token usage threshold (e.g., every 10,000 tokens)
 * - Pre-error state capture
 *
 * Implements PLAN.md §7.3 Auto-checkpoint requirements.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import { createCheckpoint } from "./checkpoint";
import { incrementCounter, setGauge } from "./metrics";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";

// ============================================================================
// Types
// ============================================================================

/**
 * Auto-checkpoint configuration per agent.
 */
export interface AutoCheckpointConfig {
  /** Enable auto-checkpointing */
  enabled: boolean;
  /** Create checkpoint every N minutes (0 = disabled) */
  intervalMinutes: number;
  /** Create checkpoint every N messages received (0 = disabled) */
  messageCountThreshold: number;
  /** Create checkpoint when token usage exceeds this value (0 = disabled) */
  tokenThreshold: number;
  /** Minimum seconds between any auto-checkpoints (cooldown) */
  minIntervalSeconds: number;
  /** Force full checkpoint every N checkpoints (for delta mode) */
  fullCheckpointInterval: number;
}

/**
 * Auto-checkpoint tracking state per agent.
 */
interface AgentCheckpointState {
  config: AutoCheckpointConfig;
  /** Timestamp of last auto-checkpoint */
  lastCheckpointAt: number;
  /** Message count since last checkpoint */
  messagesSinceCheckpoint: number;
  /** Token count at last checkpoint */
  tokensAtLastCheckpoint: number;
  /** Total checkpoints created (for full/delta decision) */
  checkpointSequence: number;
  /** Interval timer handle */
  intervalTimer?: ReturnType<typeof setInterval>;
}

// ============================================================================
// State
// ============================================================================

/** Per-agent auto-checkpoint state */
const agentStates = new Map<string, AgentCheckpointState>();

/** Default configuration */
export const DEFAULT_AUTO_CHECKPOINT_CONFIG: AutoCheckpointConfig = {
  enabled: true,
  intervalMinutes: 5,
  messageCountThreshold: 50,
  tokenThreshold: 10000,
  minIntervalSeconds: 30,
  fullCheckpointInterval: 5,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Initialize auto-checkpointing for an agent.
 *
 * @param agentId - Agent to track
 * @param config - Optional custom configuration
 */
export function initializeAutoCheckpoint(
  agentId: string,
  config?: Partial<AutoCheckpointConfig>,
): void {
  const log = getLogger();

  // Clean up any existing state
  stopAutoCheckpoint(agentId);

  const finalConfig: AutoCheckpointConfig = {
    ...DEFAULT_AUTO_CHECKPOINT_CONFIG,
    ...config,
  };

  const state: AgentCheckpointState = {
    config: finalConfig,
    lastCheckpointAt: Date.now(),
    messagesSinceCheckpoint: 0,
    tokensAtLastCheckpoint: 0,
    checkpointSequence: 0,
  };

  // Start interval timer if configured
  if (finalConfig.enabled && finalConfig.intervalMinutes > 0) {
    state.intervalTimer = setInterval(
      () => checkIntervalTrigger(agentId),
      finalConfig.intervalMinutes * 60 * 1000,
    );
  }

  agentStates.set(agentId, state);

  // Update gauge for tracked agents
  setGauge("flywheel_auto_checkpoint_tracked_agents", agentStates.size, {});

  log.debug(
    {
      type: "auto_checkpoint",
      action: "initialized",
      agentId,
      config: finalConfig,
    },
    `[AUTO-CHECKPOINT] Initialized for agent ${agentId}`,
  );
}

/**
 * Stop auto-checkpointing for an agent and clean up resources.
 *
 * @param agentId - Agent to stop tracking
 */
export function stopAutoCheckpoint(agentId: string): void {
  const state = agentStates.get(agentId);
  if (state) {
    if (state.intervalTimer) {
      clearInterval(state.intervalTimer);
    }
    agentStates.delete(agentId);

    // Update gauge for tracked agents
    setGauge("flywheel_auto_checkpoint_tracked_agents", agentStates.size, {});

    const log = getLogger();
    log.debug(
      { type: "auto_checkpoint", action: "stopped", agentId },
      `[AUTO-CHECKPOINT] Stopped for agent ${agentId}`,
    );
  }
}

/**
 * Get auto-checkpoint state for an agent.
 *
 * @param agentId - Agent ID
 * @returns Current state or undefined if not tracked
 */
export function getAutoCheckpointState(
  agentId: string,
): AgentCheckpointState | undefined {
  return agentStates.get(agentId);
}

/**
 * Update auto-checkpoint configuration for an agent.
 *
 * @param agentId - Agent to update
 * @param config - Partial configuration to merge
 */
export function updateAutoCheckpointConfig(
  agentId: string,
  config: Partial<AutoCheckpointConfig>,
): void {
  const state = agentStates.get(agentId);
  if (!state) {
    throw new AutoCheckpointError(
      "AGENT_NOT_TRACKED",
      `Agent ${agentId} is not being tracked for auto-checkpoints`,
    );
  }

  // Update config
  state.config = { ...state.config, ...config };

  // Restart interval timer if interval changed
  if (config.intervalMinutes !== undefined) {
    if (state.intervalTimer) {
      clearInterval(state.intervalTimer);
      state.intervalTimer = undefined;
    }
    if (state.config.enabled && state.config.intervalMinutes > 0) {
      state.intervalTimer = setInterval(
        () => checkIntervalTrigger(agentId),
        state.config.intervalMinutes * 60 * 1000,
      );
    }
  }

  const log = getLogger();
  log.debug(
    { type: "auto_checkpoint", action: "config_updated", agentId, config },
    `[AUTO-CHECKPOINT] Config updated for agent ${agentId}`,
  );
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Notify auto-checkpoint system of a new message.
 * Called when an agent receives a message.
 *
 * @param agentId - Agent that received the message
 */
export async function onAgentMessage(agentId: string): Promise<void> {
  const state = agentStates.get(agentId);
  if (!state || !state.config.enabled) return;

  state.messagesSinceCheckpoint++;

  // Check message threshold trigger
  if (
    state.config.messageCountThreshold > 0 &&
    state.messagesSinceCheckpoint >= state.config.messageCountThreshold
  ) {
    await maybeCreateCheckpoint(agentId, "message_threshold");
  }
}

/**
 * Notify auto-checkpoint system of token usage update.
 * Called when token usage is updated.
 *
 * @param agentId - Agent with updated token usage
 * @param currentTokens - Current total token count
 */
export async function onTokenUpdate(
  agentId: string,
  currentTokens: number,
): Promise<void> {
  const state = agentStates.get(agentId);
  if (!state || !state.config.enabled) return;

  // Check token threshold trigger
  if (state.config.tokenThreshold > 0) {
    const tokensSinceCheckpoint = currentTokens - state.tokensAtLastCheckpoint;
    if (tokensSinceCheckpoint >= state.config.tokenThreshold) {
      await maybeCreateCheckpoint(agentId, "token_threshold");
    }
  }
}

/**
 * Create an error checkpoint before an error is propagated.
 * This captures state for debugging and recovery.
 *
 * @param agentId - Agent experiencing the error
 * @param errorInfo - Error details to include in metadata
 */
export async function createErrorCheckpoint(
  agentId: string,
  errorInfo: { code: string; message: string },
): Promise<void> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  try {
    // Always create a full checkpoint for errors
    await createAutoCheckpoint(agentId, "error", true);

    log.info(
      {
        type: "auto_checkpoint",
        trigger: "error",
        agentId,
        errorCode: errorInfo.code,
        correlationId,
      },
      `[AUTO-CHECKPOINT] Created error checkpoint for agent ${agentId}`,
    );
  } catch (error) {
    // Don't fail the error propagation if checkpoint fails
    log.warn(
      {
        type: "auto_checkpoint",
        action: "error_checkpoint_failed",
        agentId,
        error,
        correlationId,
      },
      `[AUTO-CHECKPOINT] Failed to create error checkpoint for agent ${agentId}`,
    );
  }
}

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Check if interval trigger should create a checkpoint.
 */
async function checkIntervalTrigger(agentId: string): Promise<void> {
  const state = agentStates.get(agentId);
  if (!state || !state.config.enabled) return;

  await maybeCreateCheckpoint(agentId, "interval");
}

/**
 * Check cooldown and create checkpoint if allowed.
 *
 * @param agentId - Agent to checkpoint
 * @param trigger - What triggered the checkpoint
 * @returns Whether a checkpoint was created
 */
async function maybeCreateCheckpoint(
  agentId: string,
  trigger: "interval" | "message_threshold" | "token_threshold",
): Promise<boolean> {
  const state = agentStates.get(agentId);
  if (!state || !state.config.enabled) return false;

  // Check cooldown
  const timeSinceLastCheckpoint = Date.now() - state.lastCheckpointAt;
  const minIntervalMs = state.config.minIntervalSeconds * 1000;
  if (timeSinceLastCheckpoint < minIntervalMs) {
    const log = getLogger();
    incrementCounter("flywheel_auto_checkpoint_skipped_total", 1, {
      reason: "cooldown",
      trigger,
    });
    log.debug(
      {
        type: "auto_checkpoint",
        action: "skipped_cooldown",
        agentId,
        trigger,
        cooldownRemainingMs: minIntervalMs - timeSinceLastCheckpoint,
      },
      `[AUTO-CHECKPOINT] Skipped due to cooldown`,
    );
    return false;
  }

  // Determine if this should be a full checkpoint
  const shouldBeFull =
    (state.checkpointSequence + 1) % state.config.fullCheckpointInterval === 0;

  return createAutoCheckpoint(agentId, trigger, shouldBeFull);
}

/**
 * Create an auto-checkpoint.
 *
 * @param agentId - Agent to checkpoint
 * @param trigger - What triggered the checkpoint
 * @param forceFull - Force a full checkpoint instead of delta
 * @returns Whether the checkpoint was created successfully
 */
async function createAutoCheckpoint(
  agentId: string,
  trigger: "interval" | "message_threshold" | "token_threshold" | "error",
  forceFull: boolean,
): Promise<boolean> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const state = agentStates.get(agentId);
  if (!state) return false;

  try {
    // Get current agent state
    // Note: In a full implementation, this would fetch actual conversation history
    // and tool state from the agent driver. For now, we create a placeholder.
    const checkpointState = {
      conversationHistory: [],
      toolState: {},
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };

    const metadata = await createCheckpoint(agentId, checkpointState, {
      description: `Auto-checkpoint: ${trigger}`,
      tags: ["auto", trigger],
      delta: !forceFull,
    });

    // Update state
    state.lastCheckpointAt = Date.now();
    state.messagesSinceCheckpoint = 0;
    state.tokensAtLastCheckpoint = checkpointState.tokenUsage.totalTokens;
    state.checkpointSequence++;

    // Record metrics for auto-checkpoint trigger
    incrementCounter("flywheel_auto_checkpoint_triggers_total", 1, {
      trigger,
      type: forceFull ? "full" : "delta",
    });

    // Publish WebSocket event
    const hub = getHub();
    const channel: Channel = { type: "agent:checkpoints", agentId };
    hub.publish(
      channel,
      "checkpoint.auto_created",
      {
        checkpointId: metadata.id,
        agentId,
        trigger,
        type: forceFull ? "full" : "delta",
        sequence: state.checkpointSequence,
      },
      { agentId },
    );

    log.info(
      {
        type: "auto_checkpoint",
        action: "created",
        agentId,
        checkpointId: metadata.id,
        trigger,
        checkpointType: forceFull ? "full" : "delta",
        sequence: state.checkpointSequence,
        correlationId,
      },
      `[AUTO-CHECKPOINT] Created ${forceFull ? "full" : "delta"} checkpoint (${trigger})`,
    );

    return true;
  } catch (error) {
    incrementCounter("flywheel_auto_checkpoint_failures_total", 1, {
      trigger,
    });
    log.error(
      {
        type: "auto_checkpoint",
        action: "create_failed",
        agentId,
        trigger,
        error,
        correlationId,
      },
      `[AUTO-CHECKPOINT] Failed to create checkpoint`,
    );
    return false;
  }
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Custom error class for auto-checkpoint operations.
 */
export class AutoCheckpointError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AutoCheckpointError";
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get statistics about auto-checkpoint tracking.
 */
export function getAutoCheckpointStats(): {
  trackedAgents: number;
  totalCheckpoints: number;
  configSummary: {
    withInterval: number;
    withMessageThreshold: number;
    withTokenThreshold: number;
  };
} {
  let totalCheckpoints = 0;
  let withInterval = 0;
  let withMessageThreshold = 0;
  let withTokenThreshold = 0;

  for (const state of agentStates.values()) {
    totalCheckpoints += state.checkpointSequence;
    if (state.config.intervalMinutes > 0) withInterval++;
    if (state.config.messageCountThreshold > 0) withMessageThreshold++;
    if (state.config.tokenThreshold > 0) withTokenThreshold++;
  }

  return {
    trackedAgents: agentStates.size,
    totalCheckpoints,
    configSummary: {
      withInterval,
      withMessageThreshold,
      withTokenThreshold,
    },
  };
}

/**
 * Clear all auto-checkpoint state (for testing).
 */
export function clearAutoCheckpointState(): void {
  for (const [agentId] of agentStates) {
    stopAutoCheckpoint(agentId);
  }
}
