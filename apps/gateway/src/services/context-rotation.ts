/**
 * Context Rotation Service
 *
 * Manages context window health and implements rotation strategies
 * when context fills up. Prevents agents from running out of context
 * and losing state.
 */

import type { Agent, TokenUsage } from "@flywheel/agent-drivers";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import { createCheckpoint, restoreCheckpoint } from "./checkpoint";

// ============================================================================
// Types
// ============================================================================

/**
 * Context health levels based on token usage percentage.
 */
export type ContextHealthLevel =
  | "healthy"
  | "warning"
  | "critical"
  | "emergency";

/**
 * Rotation strategies for handling context window limits.
 */
export type RotationStrategy =
  | "summarize_and_continue" // Summarize history, continue same agent
  | "fresh_start" // New agent with context pack
  | "checkpoint_and_restart" // Checkpoint, terminate, new agent
  | "graceful_handoff"; // New agent picks up from summary

/**
 * Threshold configuration for context health levels.
 */
export interface RotationThresholds {
  warning: number; // Default 75%
  critical: number; // Default 85%
  emergency: number; // Default 95%
}

/**
 * Configuration for context rotation.
 */
export interface RotationConfig {
  /** Strategy to use for rotation */
  strategy: RotationStrategy;
  /** Threshold percentages for health levels */
  thresholds: RotationThresholds;
  /** Whether to auto-rotate on emergency */
  autoRotate: boolean;
  /** Custom summarization prompt */
  summarizationPrompt?: string;
}

/**
 * Partial configuration for updating rotation settings.
 * Allows partial thresholds unlike Partial<RotationConfig>.
 */
export interface RotationConfigUpdate {
  strategy?: RotationStrategy;
  thresholds?: Partial<RotationThresholds>;
  autoRotate?: boolean;
  summarizationPrompt?: string;
}

/**
 * Result of a rotation operation.
 */
export interface RotationResult {
  success: boolean;
  strategy: RotationStrategy;
  /** ID of new agent (if applicable) */
  newAgentId: string | undefined;
  /** ID of checkpoint created (if applicable) */
  checkpointId: string | undefined;
  /** Summary of context (if summarize strategy) */
  summary: string | undefined;
  /** Error message if failed */
  error: string | undefined;
}

/**
 * Context health status for an agent.
 */
export interface ContextHealthStatus {
  agentId: string;
  level: ContextHealthLevel;
  tokenUsage: TokenUsage;
  usagePercent: number;
  maxTokens: number;
  suggestion: string;
}

/**
 * Handler callbacks for rotation operations.
 */
export type RotationHandlers = {
  spawnAgent?: (config: unknown) => Promise<{ agentId: string }>;
  terminateAgent?: (agentId: string) => Promise<void>;
  sendMessage?: (
    agentId: string,
    type: "user" | "system",
    message: string,
  ) => Promise<void>;
  getConversationHistory?: (agentId: string) => Promise<unknown[]>;
  getToolState?: (agentId: string) => Promise<Record<string, unknown>>;
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RotationConfig = {
  strategy: "checkpoint_and_restart",
  thresholds: {
    warning: 75,
    critical: 85,
    emergency: 95,
  },
  autoRotate: true,
};

const DEFAULT_MAX_TOKENS = 100000;

/** Agent rotation configs */
const agentConfigs = new Map<string, RotationConfig>();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Set rotation configuration for an agent.
 */
export function setRotationConfig(
  agentId: string,
  config: RotationConfigUpdate,
): void {
  const existing = agentConfigs.get(agentId) || { ...DEFAULT_CONFIG };
  agentConfigs.set(agentId, {
    ...existing,
    ...config,
    thresholds: {
      ...existing.thresholds,
      ...config.thresholds,
    },
  });
}

/**
 * Get rotation configuration for an agent.
 */
export function getRotationConfig(agentId: string): RotationConfig {
  return agentConfigs.get(agentId) || DEFAULT_CONFIG;
}

// ============================================================================
// Context Health Monitoring
// ============================================================================

/**
 * Calculate context health level from token usage.
 */
export function calculateHealthLevel(
  tokenUsage: TokenUsage,
  maxTokens: number,
  thresholds = DEFAULT_CONFIG.thresholds,
): ContextHealthLevel {
  const safeMaxTokens = maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;
  const usagePercent = (tokenUsage.totalTokens / safeMaxTokens) * 100;

  if (usagePercent >= thresholds.emergency) {
    return "emergency";
  } else if (usagePercent >= thresholds.critical) {
    return "critical";
  } else if (usagePercent >= thresholds.warning) {
    return "warning";
  }
  return "healthy";
}

/**
 * Get context health status for an agent.
 */
export function getContextHealth(agent: Agent): ContextHealthStatus {
  const configuredMaxTokens = agent.config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTokens =
    configuredMaxTokens > 0 ? configuredMaxTokens : DEFAULT_MAX_TOKENS;
  if (configuredMaxTokens <= 0) {
    const log = getLogger();
    log.warn(
      { agentId: agent.id, maxTokens: configuredMaxTokens },
      "Invalid maxTokens; using default",
    );
  }
  const config = getRotationConfig(agent.id);
  const level = calculateHealthLevel(
    agent.tokenUsage,
    maxTokens,
    config.thresholds,
  );
  const usagePercent = (agent.tokenUsage.totalTokens / maxTokens) * 100;

  let suggestion: string;
  switch (level) {
    case "emergency":
      suggestion = "Immediate rotation required. Context at capacity.";
      break;
    case "critical":
      suggestion = "Consider rotating soon. Context nearing limit.";
      break;
    case "warning":
      suggestion = "Context usage elevated. Monitor closely.";
      break;
    default:
      suggestion = "Context usage healthy.";
  }

  return {
    agentId: agent.id,
    level,
    tokenUsage: agent.tokenUsage,
    usagePercent,
    maxTokens,
    suggestion,
  };
}

/**
 * Check if rotation is needed based on context health.
 */
export function needsRotation(agent: Agent): boolean {
  const config = getRotationConfig(agent.id);
  const health = getContextHealth(agent);

  if (config.autoRotate && health.level === "emergency") {
    return true;
  }

  return false;
}

// ============================================================================
// Rotation Strategies
// ============================================================================

/**
 * Execute context rotation for an agent.
 *
 * @param agent - The agent to rotate
 * @param strategy - Override strategy (uses agent config if not specified)
 * @param handlers - Callbacks for agent operations
 * @returns Rotation result
 */
export async function executeRotation(
  agent: Agent,
  strategy?: RotationStrategy,
  handlers?: RotationHandlers,
): Promise<RotationResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const config = getRotationConfig(agent.id);
  const rotationStrategy = strategy || config.strategy;

  log.info(
    {
      type: "rotation",
      agentId: agent.id,
      strategy: rotationStrategy,
      tokenUsage: agent.tokenUsage.totalTokens,
      correlationId,
    },
    `[ROTATION] Starting ${rotationStrategy} rotation for agent ${agent.id}`,
  );

  try {
    switch (rotationStrategy) {
      case "summarize_and_continue":
        return await rotateSummarizeAndContinue(agent, handlers);

      case "fresh_start":
        return await rotateFreshStart(agent, handlers);

      case "checkpoint_and_restart":
        return await rotateCheckpointAndRestart(agent, handlers);

      case "graceful_handoff":
        return await rotateGracefulHandoff(agent, handlers);

      default:
        throw new Error(`Unknown rotation strategy: ${rotationStrategy}`);
    }
  } catch (error) {
    log.error(
      { error, agentId: agent.id, strategy: rotationStrategy },
      `[ROTATION] Failed to rotate agent`,
    );

    return {
      success: false,
      strategy: rotationStrategy,
      newAgentId: undefined,
      checkpointId: undefined,
      summary: undefined,
      error: String(error),
    };
  }
}

/**
 * Strategy: Summarize conversation and continue with same agent.
 * Keeps the agent running but compacts the conversation history.
 */
async function rotateSummarizeAndContinue(
  agent: Agent,
  handlers?: RotationHandlers,
): Promise<RotationResult> {
  const log = getLogger();

  // Create checkpoint before summarization
  const checkpointId = await createPreRotationCheckpoint(agent, handlers);

  // Request summarization from the agent
  const summarizationPrompt =
    getRotationConfig(agent.id).summarizationPrompt ||
    `Please provide a concise summary of our conversation so far, including:
1. The main task or goal we were working on
2. Key decisions made
3. Current state and next steps
4. Any important context that should be preserved

This summary will be used to refresh your context.`;

  if (handlers?.sendMessage) {
    await handlers.sendMessage(agent.id, "system", summarizationPrompt);
    // Note: In a real implementation, we'd wait for the response
    // and inject it as the new context start
  }

  log.info(
    { agentId: agent.id, checkpointId },
    `[ROTATION] Summarize and continue completed`,
  );

  return {
    success: true,
    strategy: "summarize_and_continue",
    checkpointId,
    summary: "Summarization requested from agent",
    newAgentId: undefined,
    error: undefined,
  };
}

/**
 * Strategy: Start a new agent with fresh context and context pack.
 * Creates a new agent with essential context from the old one.
 */
async function rotateFreshStart(
  agent: Agent,
  handlers?: RotationHandlers,
): Promise<RotationResult> {
  const log = getLogger();

  // Create checkpoint
  const checkpointId = await createPreRotationCheckpoint(agent, handlers);

  // Spawn new agent with same config
  let newAgentId: string | undefined;
  if (handlers?.spawnAgent) {
    const result = await handlers.spawnAgent({
      ...agent.config,
      id: undefined, // Generate new ID
      // Include context pack from checkpoint
    });
    newAgentId = result.agentId;
  }

  // Terminate old agent
  if (handlers?.terminateAgent) {
    await handlers.terminateAgent(agent.id);
  }

  log.info(
    { oldAgentId: agent.id, newAgentId, checkpointId },
    `[ROTATION] Fresh start completed`,
  );

  return {
    success: true,
    strategy: "fresh_start",
    newAgentId,
    checkpointId,
    summary: undefined,
    error: undefined,
  };
}

/**
 * Strategy: Checkpoint, terminate, and restart with restored state.
 * Full state preservation with clean restart.
 */
async function rotateCheckpointAndRestart(
  agent: Agent,
  handlers?: RotationHandlers,
): Promise<RotationResult> {
  const log = getLogger();

  // Create full checkpoint
  const checkpointId = await createPreRotationCheckpoint(agent, handlers);

  // Spawn new agent
  let newAgentId: string | undefined;
  if (handlers?.spawnAgent) {
    // Fail if checkpoint creation failed to prevent data loss
    if (!checkpointId) {
      throw new Error(
        "Checkpoint creation failed, aborting restart to preserve state",
      );
    }

    // Restore from checkpoint to prepare state for new agent
    const checkpoint = await restoreCheckpoint(checkpointId);

    const result = await handlers.spawnAgent({
      ...agent.config,
      id: undefined, // Generate new ID
      conversationHistory: checkpoint.conversationHistory,
      toolState: checkpoint.toolState,
    });
    newAgentId = result.agentId;

    log.debug(
      {
        newAgentId,
        checkpointId,
        historyLength: checkpoint.conversationHistory.length,
      },
      "Restored checkpoint state passed to new agent",
    );
  }

  // Terminate old agent
  if (handlers?.terminateAgent) {
    await handlers.terminateAgent(agent.id);
  }

  log.info(
    { oldAgentId: agent.id, newAgentId, checkpointId },
    `[ROTATION] Checkpoint and restart completed`,
  );

  return {
    success: true,
    strategy: "checkpoint_and_restart",
    newAgentId,
    checkpointId,
    summary: undefined,
    error: undefined,
  };
}

/**
 * Strategy: Graceful handoff to new agent with summary.
 * New agent picks up from a handoff summary.
 */
async function rotateGracefulHandoff(
  agent: Agent,
  handlers?: RotationHandlers,
): Promise<RotationResult> {
  const log = getLogger();

  // Create checkpoint
  const checkpointId = await createPreRotationCheckpoint(agent, handlers);

  // Request handoff summary from current agent
  const handoffPrompt = `You are about to hand off this conversation to a fresh instance of yourself.
Please prepare a handoff summary that includes:
1. Current task state and progress
2. Important context and decisions
3. Files being worked on
4. Immediate next steps

Format this as a clear handoff document.`;

  if (handlers?.sendMessage) {
    await handlers.sendMessage(agent.id, "system", handoffPrompt);
    // Note: Would wait for response in real implementation
  }

  // Spawn new agent with handoff context
  let newAgentId: string | undefined;
  if (handlers?.spawnAgent) {
    const result = await handlers.spawnAgent({
      ...agent.config,
      id: undefined,
      systemPrompt: `${agent.config.systemPrompt || ""}

[HANDOFF CONTEXT]
You are continuing work from a previous session. Review the handoff summary provided.`,
    });
    newAgentId = result.agentId;
  }

  // Terminate old agent after new one is ready
  if (handlers?.terminateAgent) {
    await handlers.terminateAgent(agent.id);
  }

  log.info(
    { oldAgentId: agent.id, newAgentId, checkpointId },
    `[ROTATION] Graceful handoff completed`,
  );

  return {
    success: true,
    strategy: "graceful_handoff",
    newAgentId,
    checkpointId,
    summary: "Handoff summary requested from agent",
    error: undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a checkpoint before rotation.
 */
async function createPreRotationCheckpoint(
  agent: Agent,
  handlers?: RotationHandlers,
): Promise<string | undefined> {
  try {
    // Get current state from handlers
    const conversationHistory = handlers?.getConversationHistory
      ? await handlers.getConversationHistory(agent.id)
      : [];
    const toolState = handlers?.getToolState
      ? await handlers.getToolState(agent.id)
      : {};

    const metadata = await createCheckpoint(
      agent.id,
      {
        conversationHistory,
        toolState,
        tokenUsage: agent.tokenUsage,
      },
      {
        description: "Pre-rotation checkpoint",
        tags: ["rotation", "auto"],
      },
    );

    return metadata.id;
  } catch (error) {
    // Log but don't fail rotation if checkpoint fails
    const log = getLogger();
    log.warn(
      { error, agentId: agent.id },
      "Failed to create pre-rotation checkpoint",
    );
    return undefined;
  }
}
