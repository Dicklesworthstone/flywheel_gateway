/**
 * Context Health Service
 *
 * Proactive system that monitors context window health and takes corrective
 * action before problems occur. Implements graduated interventions:
 * - Warning (75%): Log, emit event, prepare summary
 * - Critical (85%): Summarize, compact, emit event
 * - Emergency (95%): Checkpoint, rotate, transfer, emit event
 */

import { getLogger } from "../middleware/correlation";
import {
  type ContextHealth,
  type ContextHealthConfig,
  ContextHealthStatus,
  type ContextTransfer,
  DEFAULT_CONTEXT_HEALTH_CONFIG,
  type HealthRecommendation,
  type RotationConfig,
  type RotationResult,
  type SummarizationResult,
  type SummaryContent,
  type TokenHistoryEntry,
  type TransferredMessage,
} from "../types/context-health.types";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import { logger as baseLogger, createChildLogger } from "./logger";
import { countTokens } from "./tokenizer.service";

// ============================================================================
// Error Classes
// ============================================================================

export class ContextHealthError extends Error {
  public override name = "ContextHealthError";
  public sessionId: string;

  constructor(sessionId: string, message: string) {
    super(message);
    this.sessionId = sessionId;
  }
}

export class SummarizationError extends ContextHealthError {
  public override name = "SummarizationError";
}

export class RotationError extends ContextHealthError {
  public override name = "RotationError";
}

// ============================================================================
// In-Memory Session State (for demo - would use DB in production)
// ============================================================================

interface SessionState {
  id: string;
  messages: TransferredMessage[];
  currentTokens: number;
  maxTokens: number;
  model: string;
  createdAt: Date;
  lastCompaction: Date | null;
  lastRotation: Date | null;
  rotatedFrom?: string;
  rotatedTo?: string;
  status: "active" | "rotated";
}

// ============================================================================
// Context Health Service
// ============================================================================

export class ContextHealthService {
  private healthCache = new Map<string, ContextHealth>();
  private tokenHistory = new Map<string, TokenHistoryEntry[]>();
  private sessionStates = new Map<string, SessionState>();
  private monitoringIntervals = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private started = false;

  constructor(
    private readonly config: ContextHealthConfig = DEFAULT_CONTEXT_HEALTH_CONFIG,
  ) {}

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Start the health monitoring service.
   */
  start(): void {
    if (this.started) return;
    baseLogger.info("Starting context health service");
    this.started = true;
  }

  /**
   * Stop the health monitoring service.
   */
  stop(): void {
    if (!this.started) return;
    baseLogger.info("Stopping context health service");

    // Clear all monitoring intervals
    for (const interval of this.monitoringIntervals.values()) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();

    this.started = false;
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Register a session for health monitoring.
   */
  registerSession(
    sessionId: string,
    options: {
      model?: string;
      maxTokens?: number;
    } = {},
  ): void {
    // Compute maxTokens with fallback chain, then ensure it's > 0 to prevent division by zero
    const computedMaxTokens =
      options.maxTokens ??
      this.config.modelLimits[options.model ?? ""] ??
      this.config.defaultMaxTokens;
    const maxTokens =
      computedMaxTokens > 0 ? computedMaxTokens : this.config.defaultMaxTokens;

    const state: SessionState = {
      id: sessionId,
      messages: [],
      currentTokens: 0,
      maxTokens,
      model: options.model ?? "default",
      createdAt: new Date(),
      lastCompaction: null,
      lastRotation: null,
      status: "active",
    };

    this.sessionStates.set(sessionId, state);
    this.tokenHistory.set(sessionId, []);

    // Start monitoring
    if (this.started && this.config.autoHealing.enabled) {
      const interval = setInterval(
        () => this.checkHealth(sessionId),
        this.config.monitoring.checkIntervalMs,
      );
      this.monitoringIntervals.set(sessionId, interval);
    }

    baseLogger.info(
      { sessionId, maxTokens },
      "Session registered for health monitoring",
    );
  }

  /**
   * Unregister a session from health monitoring.
   */
  unregisterSession(sessionId: string): void {
    const interval = this.monitoringIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(sessionId);
    }

    this.healthCache.delete(sessionId);
    this.tokenHistory.delete(sessionId);
    this.sessionStates.delete(sessionId);

    baseLogger.info(
      { sessionId },
      "Session unregistered from health monitoring",
    );
  }

  /**
   * Update session token count (call after each message).
   */
  updateTokens(
    sessionId: string,
    tokens: number,
    event: string = "message",
  ): void {
    const state = this.sessionStates.get(sessionId);
    if (!state) return;

    const delta = tokens - state.currentTokens;
    state.currentTokens = tokens;

    // Record in history
    const history = this.tokenHistory.get(sessionId) ?? [];
    history.push({
      timestamp: new Date(),
      tokens,
      delta,
      event,
    });

    // Trim history if too long
    if (history.length > this.config.monitoring.historyMaxEntries) {
      history.splice(
        0,
        history.length - this.config.monitoring.historyMaxEntries,
      );
    }

    this.tokenHistory.set(sessionId, history);
  }

  /**
   * Add a message to a session.
   */
  addMessage(sessionId: string, message: TransferredMessage): void {
    const state = this.sessionStates.get(sessionId);
    if (!state) return;

    state.messages.push(message);

    // Estimate new token count
    const messageTokens = countTokens(message.content);
    this.updateTokens(
      sessionId,
      state.currentTokens + messageTokens,
      "message",
    );
  }

  // ==========================================================================
  // Health Monitoring
  // ==========================================================================

  /**
   * Check and return the health of a session.
   */
  async checkHealth(sessionId: string): Promise<ContextHealth> {
    const _log = getLogger();

    const state = this.sessionStates.get(sessionId);
    if (!state) {
      throw new ContextHealthError(sessionId, "Session not found");
    }

    const percentUsed = (state.currentTokens / state.maxTokens) * 100;
    const status = this.determineStatus(percentUsed);
    const history = this.tokenHistory.get(sessionId) ?? [];

    const health: ContextHealth = {
      sessionId,
      status,
      currentTokens: state.currentTokens,
      maxTokens: state.maxTokens,
      percentUsed,
      projectedOverflowInMessages: this.projectOverflow(
        history,
        state.maxTokens,
      ),
      estimatedTimeToWarning: this.estimateTimeToThreshold(
        history,
        this.config.thresholds.warning.percentage,
        state.maxTokens,
      ),
      tokenHistory: history.slice(-20), // Return last 20 entries
      lastCompaction: state.lastCompaction,
      lastRotation: state.lastRotation,
      recommendations: this.generateRecommendations(
        status,
        percentUsed,
        history,
      ),
      checkedAt: new Date(),
    };

    this.healthCache.set(sessionId, health);

    // Handle status if auto-healing is enabled
    if (this.config.autoHealing.enabled) {
      await this.handleStatus(health, state);
    }

    return health;
  }

  /**
   * Get cached health without triggering a check.
   */
  getCachedHealth(sessionId: string): ContextHealth | null {
    return this.healthCache.get(sessionId) ?? null;
  }

  /**
   * Determine health status from percentage used.
   */
  private determineStatus(percentUsed: number): ContextHealthStatus {
    if (percentUsed >= this.config.thresholds.emergency.percentage) {
      return ContextHealthStatus.EMERGENCY;
    }
    if (percentUsed >= this.config.thresholds.critical.percentage) {
      return ContextHealthStatus.CRITICAL;
    }
    if (percentUsed >= this.config.thresholds.warning.percentage) {
      return ContextHealthStatus.WARNING;
    }
    return ContextHealthStatus.HEALTHY;
  }

  /**
   * Handle health status with graduated interventions.
   */
  private async handleStatus(
    health: ContextHealth,
    state: SessionState,
  ): Promise<void> {
    const log = createChildLogger({
      sessionId: health.sessionId,
      status: health.status,
      percentUsed: health.percentUsed.toFixed(1),
    });

    switch (health.status) {
      case ContextHealthStatus.WARNING:
        await this.handleWarning(health, state, log);
        break;
      case ContextHealthStatus.CRITICAL:
        await this.handleCritical(health, state, log);
        break;
      case ContextHealthStatus.EMERGENCY:
        await this.handleEmergency(health, state, log);
        break;
    }
  }

  /**
   * Handle warning level (75-84%).
   */
  private async handleWarning(
    health: ContextHealth,
    _state: SessionState,
    log: ReturnType<typeof getLogger>,
  ): Promise<void> {
    log.warn("Context at warning level");

    // Emit warning event
    this.emitHealthEvent("context.warning", {
      sessionId: health.sessionId,
      percentUsed: health.percentUsed,
      currentTokens: health.currentTokens,
      maxTokens: health.maxTokens,
      recommendations: health.recommendations,
    });
  }

  /**
   * Handle critical level (85-94%).
   */
  private async handleCritical(
    health: ContextHealth,
    state: SessionState,
    log: ReturnType<typeof getLogger>,
  ): Promise<void> {
    log.warn("Context at critical level, attempting compaction");

    if (!this.config.autoHealing.summarizationEnabled) {
      log.info("Auto-summarization disabled, skipping compaction");
      return;
    }

    try {
      const result = await this.compact(health.sessionId);
      log.info(
        {
          reduction: result.reduction,
          reductionPercent: result.reductionPercent,
        },
        "Context compacted",
      );
    } catch (error) {
      log.error({ error }, "Compaction failed");
      // Continue to emergency handling if compaction fails and we're close to overflow
      if (health.percentUsed >= 93) {
        await this.handleEmergency(health, state, log);
      }
    }
  }

  /**
   * Handle emergency level (95%+).
   */
  private async handleEmergency(
    health: ContextHealth,
    state: SessionState,
    log: ReturnType<typeof getLogger>,
  ): Promise<void> {
    log.error("Context at emergency level, initiating rotation");

    if (!this.config.autoHealing.rotationEnabled) {
      log.info("Auto-rotation disabled, cannot prevent overflow");
      return;
    }

    // Check cooldown
    if (state.lastRotation) {
      const timeSinceRotation = Date.now() - state.lastRotation.getTime();
      if (timeSinceRotation < this.config.rotation.cooldownMs) {
        log.warn(
          {
            cooldownRemainingMs:
              this.config.rotation.cooldownMs - timeSinceRotation,
          },
          "Rotation cooldown active, cannot rotate yet",
        );
        return;
      }
    }

    try {
      const result = await this.rotate(health.sessionId);
      log.info(
        {
          newSessionId: result.newSessionId,
          compressionRatio: result.transfer.compressionRatio,
        },
        "Session rotated",
      );
    } catch (error) {
      log.error({ error }, "Rotation failed, context overflow imminent");
    }
  }

  // ==========================================================================
  // Compaction / Summarization
  // ==========================================================================

  /**
   * Compact a session's context through summarization.
   */
  async compact(
    sessionId: string,
    options: {
      strategy?: "summarize" | "prune" | "both";
      targetReduction?: number;
    } = {},
  ): Promise<SummarizationResult> {
    const log = getLogger();
    const state = this.sessionStates.get(sessionId);

    if (!state) {
      throw new SummarizationError(sessionId, "Session not found");
    }

    const strategy = options.strategy ?? "both";
    const targetReduction =
      options.targetReduction ?? this.config.summarization.targetReduction;

    log.info({ sessionId, strategy, targetReduction }, "Starting compaction");

    const beforeTokens = state.currentTokens;
    const summaries: SummaryContent[] = [];
    const summarizedSections: string[] = [];
    const preservedSections: string[] = [];

    // Determine what to preserve
    const preserveConfig = this.config.summarization.preserve;
    const recentCutoff = new Date(
      Date.now() - preserveConfig.recentMinutes * 60 * 1000,
    );

    // Split messages into preservable and summarizable
    const messagesToPreserve: TransferredMessage[] = [];
    const messagesToSummarize: TransferredMessage[] = [];

    const messages = state.messages;
    const preserveCount = preserveConfig.lastNMessages;

    for (const [index, msg] of messages.entries()) {
      const isRecent =
        index >= messages.length - preserveCount ||
        msg.timestamp >= recentCutoff;

      if (isRecent) {
        messagesToPreserve.push(msg);
      } else {
        messagesToSummarize.push(msg);
      }
    }

    // Summarize older messages
    if (
      messagesToSummarize.length > 0 &&
      (strategy === "summarize" || strategy === "both")
    ) {
      const summaryContent = await this.summarizeMessages(messagesToSummarize);
      summaries.push(summaryContent);
      summarizedSections.push("conversation_history");
    }

    // Prune if requested
    if (strategy === "prune" || strategy === "both") {
      // Prune by keeping only preserved messages plus summaries
      const prunedMessages = messagesToPreserve;

      // Add summary as a system message at the start
      if (summaries.length > 0) {
        const summaryMessage: TransferredMessage = {
          role: "system",
          content: `[Context Summary]\n${summaries.map((s) => s.summary).join("\n\n")}`,
          timestamp: new Date(),
        };
        state.messages = [summaryMessage, ...prunedMessages];
      } else {
        state.messages = prunedMessages;
      }
    }

    // Recalculate token count
    const newTokenCount = state.messages.reduce(
      (sum, msg) => sum + countTokens(msg.content),
      0,
    );
    state.currentTokens = newTokenCount;
    state.lastCompaction = new Date();

    const afterTokens = newTokenCount;
    const reduction = beforeTokens - afterTokens;
    const reductionPercent =
      beforeTokens > 0 ? (reduction / beforeTokens) * 100 : 0;

    // Update history
    this.updateTokens(sessionId, afterTokens, "compaction");

    // Emit event
    this.emitHealthEvent("context.compacted", {
      sessionId,
      beforeTokens,
      afterTokens,
      reduction,
      reductionPercent,
      method: strategy,
    });

    const result: SummarizationResult = {
      beforeTokens,
      afterTokens,
      reduction,
      reductionPercent,
      summarizedSections,
      preservedSections,
      summaries,
      appliedAt: new Date(),
    };

    log.info(
      { sessionId, beforeTokens, afterTokens, reduction, reductionPercent },
      "Compaction complete",
    );

    return result;
  }

  /**
   * Summarize a list of messages into a concise summary.
   */
  private async summarizeMessages(
    messages: TransferredMessage[],
  ): Promise<SummaryContent> {
    // Build content for summarization
    const content = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");

    const originalTokens = countTokens(content);

    // For now, use a simple extractive summarization
    // In production, this would use an LLM
    const keyPoints = this.extractKeyPoints(messages);
    const summary = keyPoints.join("\n- ");
    const summaryTokens = countTokens(summary);

    return {
      section: "conversation_history",
      originalTokens,
      summaryTokens,
      summary: `Key points from previous conversation:\n- ${summary}`,
      keyPoints,
    };
  }

  /**
   * Extract key points from messages (simple heuristic).
   */
  private extractKeyPoints(messages: TransferredMessage[]): string[] {
    const keyPoints: string[] = [];

    for (const msg of messages) {
      // Look for decision-like patterns
      const lines = msg.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith("- ") ||
          trimmed.startsWith("* ") ||
          trimmed.match(/^[\d]+\.\s/) ||
          trimmed.includes("TODO:") ||
          trimmed.includes("IMPORTANT:") ||
          trimmed.includes("Decision:") ||
          trimmed.includes("Conclusion:")
        ) {
          if (trimmed.length > 10 && trimmed.length < 200) {
            keyPoints.push(trimmed.replace(/^[-*\d.]+\s*/, ""));
          }
        }
      }
    }

    // Deduplicate and limit
    const unique = [...new Set(keyPoints)];
    return unique.slice(0, 10);
  }

  // ==========================================================================
  // Agent Rotation
  // ==========================================================================

  /**
   * Rotate to a new session with context transfer.
   */
  async rotate(
    sessionId: string,
    options: {
      config?: Partial<RotationConfig>;
      reason?: "context_overflow" | "manual" | "scheduled";
    } = {},
  ): Promise<RotationResult> {
    const log = getLogger();
    const state = this.sessionStates.get(sessionId);

    if (!state) {
      throw new RotationError(sessionId, "Session not found");
    }

    if (state.status === "rotated") {
      throw new RotationError(sessionId, "Session already rotated");
    }

    const rotationConfig = { ...this.config.rotation, ...options.config };
    const reason = options.reason ?? "context_overflow";

    log.info({ sessionId, reason }, "Starting session rotation");

    // 1. Create checkpoint (simulated)
    const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 2. Build context transfer
    const transfer = await this.buildTransfer(sessionId, state, rotationConfig);

    // 3. Create new session
    const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.registerSession(newSessionId, {
      model: rotationConfig.newAgent.model ?? state.model,
      maxTokens: state.maxTokens,
    });

    const newState = this.sessionStates.get(newSessionId)!;
    newState.rotatedFrom = sessionId;

    // 4. Initialize new session with transferred context
    const transferMessage: TransferredMessage = {
      role: "system",
      content: this.formatTransferForPrompt(transfer),
      timestamp: new Date(),
    };
    this.addMessage(newSessionId, transferMessage);

    // 5. Mark old session as rotated
    state.status = "rotated";
    state.rotatedTo = newSessionId;
    state.lastRotation = new Date();

    // 6. Update transfer with actual session ID
    transfer.targetSessionId = newSessionId;
    transfer.checkpointId = checkpointId;

    // 7. Emit event
    this.emitHealthEvent("context.emergency_rotated", {
      sourceSessionId: sessionId,
      targetSessionId: newSessionId,
      checkpointId,
      reason,
      transfer: {
        sourceTokens: transfer.sourceTokens,
        transferTokens: transfer.transferTokens,
        compressionRatio: transfer.compressionRatio,
      },
    });

    const result: RotationResult = {
      newSessionId,
      checkpointId,
      transfer,
      reason,
      rotatedAt: new Date(),
    };

    log.info(
      {
        sessionId,
        newSessionId,
        compressionRatio: transfer.compressionRatio,
      },
      "Session rotation complete",
    );

    return result;
  }

  /**
   * Build the context transfer for rotation.
   */
  private async buildTransfer(
    sessionId: string,
    state: SessionState,
    config: RotationConfig,
  ): Promise<ContextTransfer> {
    const transferConfig = config.transfer;

    // Generate summary
    let summary = "";
    if (transferConfig.includeFullSummary && state.messages.length > 0) {
      const summaryContent = await this.summarizeMessages(state.messages);
      summary = summaryContent.summary;
    }

    // Get recent messages
    const recentMessages = state.messages.slice(
      -transferConfig.includeRecentMessages,
    );

    // Get active beads (placeholder)
    const activeBeads: string[] = transferConfig.includeActiveBeads ? [] : [];

    // Get memory rules (placeholder)
    const memoryRules: string[] = transferConfig.includeMemoryRules ? [] : [];

    const sourceTokens = state.currentTokens;
    const transferContent = this.formatTransferForPrompt({
      sourceSessionId: sessionId,
      targetSessionId: "",
      checkpointId: "",
      summary,
      recentMessages,
      activeBeads,
      memoryRules,
      sourceTokens,
      transferTokens: 0,
      compressionRatio: 0,
      transferredAt: new Date(),
    });
    const transferTokens = countTokens(transferContent);

    return {
      sourceSessionId: sessionId,
      targetSessionId: "",
      checkpointId: "",
      summary,
      recentMessages,
      activeBeads,
      memoryRules,
      sourceTokens,
      transferTokens,
      compressionRatio: sourceTokens / Math.max(1, transferTokens),
      transferredAt: new Date(),
    };
  }

  /**
   * Format transfer content for the new session's prompt.
   */
  private formatTransferForPrompt(transfer: ContextTransfer): string {
    const parts: string[] = [];

    parts.push("## Session Context (Transferred from Previous Session)\n");

    if (transfer.summary) {
      parts.push("### Summary\n");
      parts.push(transfer.summary);
      parts.push("\n");
    }

    if (transfer.recentMessages.length > 0) {
      parts.push("### Recent Conversation\n");
      for (const msg of transfer.recentMessages) {
        parts.push(`**${msg.role}**: ${msg.content}\n`);
      }
    }

    if (transfer.activeBeads.length > 0) {
      parts.push("### Active Work Items\n");
      for (const bead of transfer.activeBeads) {
        parts.push(`- ${bead}\n`);
      }
    }

    if (transfer.memoryRules.length > 0) {
      parts.push("### Relevant Guidelines\n");
      for (const rule of transfer.memoryRules) {
        parts.push(`- ${rule}\n`);
      }
    }

    return parts.join("\n");
  }

  // ==========================================================================
  // Projection / Estimation
  // ==========================================================================

  /**
   * Project when context will overflow based on history.
   */
  private projectOverflow(
    history: TokenHistoryEntry[],
    maxTokens: number,
  ): number | null {
    if (history.length < 3) return null;

    // Calculate average token increase per message
    const recentHistory = history.slice(-10);
    const messageDeltas = recentHistory
      .filter((h) => h.event === "message" && h.delta > 0)
      .map((h) => h.delta);

    if (messageDeltas.length === 0) return null;

    const avgDelta =
      messageDeltas.reduce((a, b) => a + b, 0) / messageDeltas.length;
    const lastEntry = history[history.length - 1];
    if (!lastEntry) return null;
    const currentTokens = lastEntry.tokens;
    const remaining = maxTokens - currentTokens;

    if (avgDelta <= 0) return null;

    return Math.ceil(remaining / avgDelta);
  }

  /**
   * Estimate time until a threshold is reached.
   */
  private estimateTimeToThreshold(
    history: TokenHistoryEntry[],
    thresholdPercent: number,
    maxTokens: number,
  ): number | null {
    if (history.length < 3) return null;

    const currentTokens = history[history.length - 1]?.tokens ?? 0;
    const currentPercent = (currentTokens / maxTokens) * 100;

    if (currentPercent >= thresholdPercent) return 0;

    // Calculate token velocity (tokens per millisecond)
    const recentHistory = history.slice(-10);
    if (recentHistory.length < 2) return null;

    const firstEntry = recentHistory[0];
    const lastEntry = recentHistory[recentHistory.length - 1];
    if (!firstEntry || !lastEntry) return null;

    const timeSpan =
      lastEntry.timestamp.getTime() - firstEntry.timestamp.getTime();
    const tokenIncrease = lastEntry.tokens - firstEntry.tokens;

    if (timeSpan <= 0 || tokenIncrease <= 0) return null;

    const velocity = tokenIncrease / timeSpan;
    const targetTokens = (thresholdPercent / 100) * maxTokens;
    const tokensToGo = targetTokens - currentTokens;

    return Math.ceil(tokensToGo / velocity);
  }

  /**
   * Generate recommendations based on health status.
   */
  private generateRecommendations(
    status: ContextHealthStatus,
    _percentUsed: number,
    history: TokenHistoryEntry[],
  ): HealthRecommendation[] {
    const recommendations: HealthRecommendation[] = [];

    if (status === ContextHealthStatus.HEALTHY) {
      recommendations.push({
        action: "none",
        urgency: "low",
        reason: "Context utilization is healthy",
        estimatedTokenSavings: 0,
      });
      return recommendations;
    }

    const lastTokens = history[history.length - 1]?.tokens ?? 0;

    if (status === ContextHealthStatus.WARNING) {
      recommendations.push({
        action: "summarize",
        urgency: "medium",
        reason: "Context approaching critical level, summarization recommended",
        estimatedTokenSavings: Math.floor(lastTokens * 0.2),
      });
    }

    if (status === ContextHealthStatus.CRITICAL) {
      recommendations.push({
        action: "compact",
        urgency: "high",
        reason: "Context at critical level, immediate compaction needed",
        estimatedTokenSavings: Math.floor(lastTokens * 0.3),
      });
    }

    if (status === ContextHealthStatus.EMERGENCY) {
      recommendations.push({
        action: "rotate",
        urgency: "critical",
        reason: "Context overflow imminent, rotation required",
        estimatedTokenSavings: Math.floor(lastTokens * 0.8),
      });
    }

    return recommendations;
  }

  // ==========================================================================
  // WebSocket Events
  // ==========================================================================

  /**
   * Emit a health event via WebSocket.
   */
  private emitHealthEvent(
    type: "context.warning" | "context.compacted" | "context.emergency_rotated",
    data: Record<string, unknown>,
  ): void {
    try {
      const channel: Channel = { type: "system:context" };
      getHub().publish(channel, type, {
        timestamp: new Date().toISOString(),
        ...data,
      });

      // Also publish to session-specific channel
      const sessionId = data["sessionId"] ?? data["sourceSessionId"];
      if (sessionId) {
        const sessionChannel: Channel = {
          type: "session:health",
          id: sessionId as string,
        };
        getHub().publish(sessionChannel, type, {
          timestamp: new Date().toISOString(),
          ...data,
        });
      }
    } catch {
      // Hub may not be initialized yet
    }
  }

  // ==========================================================================
  // History Queries
  // ==========================================================================

  /**
   * Get token history for a session.
   */
  getHistory(
    sessionId: string,
    options: {
      since?: Date;
      limit?: number;
    } = {},
  ): TokenHistoryEntry[] {
    let history = this.tokenHistory.get(sessionId) ?? [];

    if (options.since) {
      history = history.filter((h) => h.timestamp >= options.since!);
    }

    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  /**
   * Get session state.
   */
  getSessionState(sessionId: string): SessionState | null {
    return this.sessionStates.get(sessionId) ?? null;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let contextHealthServiceInstance: ContextHealthService | null = null;

/**
 * Get the context health service singleton.
 */
export function getContextHealthService(): ContextHealthService {
  if (!contextHealthServiceInstance) {
    contextHealthServiceInstance = new ContextHealthService();
  }
  return contextHealthServiceInstance;
}

/**
 * Initialize context health service with custom config (for testing).
 */
export function initializeContextHealthService(
  config?: ContextHealthConfig,
): ContextHealthService {
  contextHealthServiceInstance = new ContextHealthService(config);
  return contextHealthServiceInstance;
}

/**
 * Clear the context health service singleton (for testing).
 */
export function _clearContextHealthService(): void {
  if (contextHealthServiceInstance) {
    contextHealthServiceInstance.stop();
  }
  contextHealthServiceInstance = null;
}
