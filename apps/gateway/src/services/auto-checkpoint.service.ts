/**
 * Auto-Checkpoint Service - Automatic checkpoint triggers.
 *
 * Provides automatic checkpointing based on:
 * - Time intervals (e.g., every 5 minutes)
 * - Message count thresholds (e.g., every 50 messages)
 * - Token count thresholds (e.g., every 10,000 tokens)
 *
 * Usage:
 *   const autoCheckpoint = new AutoCheckpointService(agentId, config);
 *   autoCheckpoint.start();
 *   // ... later
 *   autoCheckpoint.onMessage(message);  // Track messages
 *   autoCheckpoint.onTokenUsage(usage); // Track tokens
 */

import { getLogger } from "../middleware/correlation";
import {
  type CompressionStats,
  type CreateCheckpointOptions,
  createCheckpoint,
} from "./checkpoint";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for auto-checkpointing.
 */
export interface AutoCheckpointConfig {
  /** Enable auto-checkpointing */
  enabled: boolean;
  /** Interval in minutes between automatic checkpoints (0 = disabled) */
  intervalMinutes: number;
  /** Create checkpoint every N messages (0 = disabled) */
  messageCountThreshold: number;
  /** Create checkpoint when total tokens exceed this value (0 = disabled) */
  tokenThreshold: number;
  /** Minimum time between checkpoints in seconds (cooldown) */
  cooldownSeconds: number;
  /** Enable compression for auto-checkpoints */
  compressAutoCheckpoints: boolean;
  /** Description prefix for auto-checkpoints */
  descriptionPrefix: string;
}

/**
 * Default configuration.
 */
export const DEFAULT_AUTO_CHECKPOINT_CONFIG: AutoCheckpointConfig = {
  enabled: true,
  intervalMinutes: 5,
  messageCountThreshold: 50,
  tokenThreshold: 10000,
  cooldownSeconds: 30,
  compressAutoCheckpoints: true,
  descriptionPrefix: "Auto-checkpoint",
};

/**
 * Trigger type for auto-checkpoints.
 */
export type AutoCheckpointTrigger =
  | "interval"
  | "message_count"
  | "token_threshold"
  | "manual";

/**
 * State tracked by the auto-checkpoint service.
 */
interface AutoCheckpointState {
  messageCount: number;
  totalTokens: number;
  lastCheckpointAt: Date | null;
  lastCheckpointId: string | null;
  checkpointCount: number;
}

/**
 * Result of an auto-checkpoint operation.
 */
export interface AutoCheckpointResult {
  created: boolean;
  checkpointId?: string;
  trigger?: AutoCheckpointTrigger;
  reason?: string;
  compressionStats?: CompressionStats;
}

// ============================================================================
// Auto-Checkpoint Service
// ============================================================================

/**
 * Service for managing automatic checkpoints for an agent.
 */
export class AutoCheckpointService {
  private readonly agentId: string;
  private readonly config: AutoCheckpointConfig;
  private state: AutoCheckpointState;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private stateProvider:
    | (() => Promise<{
        conversationHistory: unknown[];
        toolState: Record<string, unknown>;
        tokenUsage: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        contextPack?: unknown;
      }>)
    | null = null;

  constructor(agentId: string, config: Partial<AutoCheckpointConfig> = {}) {
    this.agentId = agentId;
    this.config = { ...DEFAULT_AUTO_CHECKPOINT_CONFIG, ...config };
    this.state = {
      messageCount: 0,
      totalTokens: 0,
      lastCheckpointAt: null,
      lastCheckpointId: null,
      checkpointCount: 0,
    };
  }

  /**
   * Set the state provider function.
   * This function is called to get the current agent state when creating a checkpoint.
   */
  setStateProvider(provider: typeof this.stateProvider): void {
    this.stateProvider = provider;
  }

  /**
   * Start the auto-checkpoint service.
   */
  start(): void {
    if (!this.config.enabled) {
      return;
    }

    const log = getLogger();
    log.info(
      {
        agentId: this.agentId,
        config: this.config,
      },
      `[AUTO-CHECKPOINT] Started for agent ${this.agentId}`,
    );

    // Start interval timer if configured
    if (this.config.intervalMinutes > 0) {
      const intervalMs = this.config.intervalMinutes * 60 * 1000;
      this.intervalTimer = setInterval(async () => {
        await this.tryCheckpoint("interval");
      }, intervalMs);

      // Ensure the interval doesn't prevent process exit
      if (this.intervalTimer.unref) {
        this.intervalTimer.unref();
      }
    }
  }

  /**
   * Stop the auto-checkpoint service.
   */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    const log = getLogger();
    log.info(
      {
        agentId: this.agentId,
        checkpointCount: this.state.checkpointCount,
      },
      `[AUTO-CHECKPOINT] Stopped for agent ${this.agentId}`,
    );
  }

  /**
   * Track a new message and check if checkpoint is needed.
   */
  async onMessage(): Promise<AutoCheckpointResult> {
    this.state.messageCount++;

    if (
      this.config.messageCountThreshold > 0 &&
      this.state.messageCount >= this.config.messageCountThreshold
    ) {
      return await this.tryCheckpoint("message_count");
    }

    return { created: false };
  }

  /**
   * Track token usage and check if checkpoint is needed.
   */
  async onTokenUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): Promise<AutoCheckpointResult> {
    this.state.totalTokens = usage.totalTokens;

    if (
      this.config.tokenThreshold > 0 &&
      this.state.totalTokens >= this.config.tokenThreshold
    ) {
      return await this.tryCheckpoint("token_threshold");
    }

    return { created: false };
  }

  /**
   * Force a checkpoint (manual trigger).
   */
  async forceCheckpoint(): Promise<AutoCheckpointResult> {
    return await this.tryCheckpoint("manual", true);
  }

  /**
   * Get current state for diagnostics.
   */
  getState(): Readonly<AutoCheckpointState> {
    return { ...this.state };
  }

  /**
   * Get configuration.
   */
  getConfig(): Readonly<AutoCheckpointConfig> {
    return { ...this.config };
  }

  /**
   * Try to create a checkpoint if cooldown allows.
   */
  private async tryCheckpoint(
    trigger: AutoCheckpointTrigger,
    force = false,
  ): Promise<AutoCheckpointResult> {
    const log = getLogger();

    // Check cooldown (unless forced)
    if (!force && this.state.lastCheckpointAt) {
      const elapsed = Date.now() - this.state.lastCheckpointAt.getTime();
      const cooldownMs = this.config.cooldownSeconds * 1000;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        log.debug(
          {
            agentId: this.agentId,
            trigger,
            cooldownRemaining: remaining,
          },
          `[AUTO-CHECKPOINT] Skipped - cooldown active (${remaining}s remaining)`,
        );
        return {
          created: false,
          reason: `Cooldown active (${remaining}s remaining)`,
        };
      }
    }

    // Check if state provider is set
    if (!this.stateProvider) {
      log.warn(
        { agentId: this.agentId, trigger },
        "[AUTO-CHECKPOINT] No state provider set - cannot create checkpoint",
      );
      return {
        created: false,
        reason: "No state provider configured",
      };
    }

    try {
      // Get current state
      const currentState = await this.stateProvider();

      // Build checkpoint options
      const options: CreateCheckpointOptions = {
        description: `${this.config.descriptionPrefix}: ${trigger}`,
        tags: ["auto", trigger],
        compress: this.config.compressAutoCheckpoints,
      };

      // Create checkpoint
      const metadata = await createCheckpoint(
        this.agentId,
        currentState,
        options,
      );

      // Update state
      this.state.lastCheckpointAt = new Date();
      this.state.lastCheckpointId = metadata.id;
      this.state.checkpointCount++;

      // Reset counters based on trigger
      if (trigger === "message_count") {
        this.state.messageCount = 0;
      }
      if (trigger === "token_threshold") {
        // Don't reset token count - it's cumulative
      }

      log.info(
        {
          agentId: this.agentId,
          checkpointId: metadata.id,
          trigger,
          checkpointCount: this.state.checkpointCount,
          compressionStats: metadata.compressionStats,
        },
        `[AUTO-CHECKPOINT] Created checkpoint ${metadata.id} (trigger: ${trigger})`,
      );

      // Build result conditionally (for exactOptionalPropertyTypes)
      const result: AutoCheckpointResult = {
        created: true,
        checkpointId: metadata.id,
        trigger,
      };
      if (metadata.compressionStats !== undefined)
        result.compressionStats = metadata.compressionStats;
      return result;
    } catch (error) {
      log.error(
        { error, agentId: this.agentId, trigger },
        "[AUTO-CHECKPOINT] Failed to create checkpoint",
      );
      return {
        created: false,
        reason: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// ============================================================================
// Service Registry
// ============================================================================

/**
 * Registry of active auto-checkpoint services by agent ID.
 */
const autoCheckpointServices = new Map<string, AutoCheckpointService>();

/**
 * Get or create an auto-checkpoint service for an agent.
 */
export function getAutoCheckpointService(
  agentId: string,
  config?: Partial<AutoCheckpointConfig>,
): AutoCheckpointService {
  let service = autoCheckpointServices.get(agentId);
  if (!service) {
    service = new AutoCheckpointService(agentId, config);
    autoCheckpointServices.set(agentId, service);
  }
  return service;
}

/**
 * Remove an auto-checkpoint service for an agent.
 */
export function removeAutoCheckpointService(agentId: string): void {
  const service = autoCheckpointServices.get(agentId);
  if (service) {
    service.stop();
    autoCheckpointServices.delete(agentId);
  }
}

/**
 * Get all active auto-checkpoint services.
 */
export function getAllAutoCheckpointServices(): ReadonlyMap<
  string,
  AutoCheckpointService
> {
  return autoCheckpointServices;
}
