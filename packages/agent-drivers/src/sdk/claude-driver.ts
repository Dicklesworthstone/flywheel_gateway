/**
 * Claude SDK Driver - Primary driver using the Claude Agent SDK.
 *
 * This driver provides direct integration with Anthropic's Claude API,
 * supporting all agent capabilities including:
 * - Structured events (tool calls, file operations)
 * - Real-time streaming
 * - Interruption
 * - Checkpointing
 */

import {
  BaseDriver,
  type BaseDriverConfig,
  createDriverOptions,
  generateSecureId,
  logDriver,
} from "../base-driver";
import type { DriverOptions } from "../interface";
import type {
  Agent,
  AgentConfig,
  Checkpoint,
  CheckpointMetadata,
  SendResult,
  TokenUsage,
} from "../types";

/**
 * Configuration specific to Claude SDK driver.
 */
export interface ClaudeDriverOptions extends DriverOptions {
  /** API key for Claude (or use ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Base URL for API (optional, for proxies) */
  baseUrl?: string;
  /** Default max tokens per request */
  defaultMaxTokens?: number;
  /** Enable streaming by default */
  streaming?: boolean;
  /** Maximum number of messages to retain in conversation history (default: 100) */
  maxHistoryMessages?: number;
}

/**
 * Internal state for a Claude agent session.
 */
interface ClaudeAgentSession {
  config: AgentConfig;
  conversationHistory: ConversationMessage[];
  currentRequestController: AbortController | undefined;
  checkpoints: Map<string, Checkpoint>;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tokenUsage?: TokenUsage;
}

/**
 * Claude SDK Driver implementation.
 */
export class ClaudeSDKDriver extends BaseDriver {
  private apiKey: string;
  private baseUrl: string;
  private defaultMaxTokens: number;
  private streaming: boolean;
  private maxHistoryMessages: number;
  private sessions = new Map<string, ClaudeAgentSession>();

  constructor(config: BaseDriverConfig, options: ClaudeDriverOptions = {}) {
    super(config);
    this.apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
    this.streaming = options.streaming ?? true;
    this.maxHistoryMessages = options.maxHistoryMessages ?? 100;
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  protected async doHealthCheck(): Promise<boolean> {
    // Check if API key is configured
    if (!this.apiKey) {
      return false;
    }

    // TODO: Add actual API health check
    // For now, just verify configuration is present
    return true;
  }

  protected async doSpawn(config: AgentConfig): Promise<Agent> {
    // Validate configuration
    if (config.provider !== "claude") {
      throw new Error(
        `ClaudeSDKDriver only supports 'claude' provider, got: ${config.provider}`,
      );
    }

    const history =
      (config.providerOptions?.[
        "conversationHistory"
      ] as ConversationMessage[]) ?? [];

    // Create session
    const session: ClaudeAgentSession = {
      config,
      conversationHistory: history,
      currentRequestController: undefined,
      checkpoints: new Map(),
    };

    this.sessions.set(config.id, session);

    // Log spawn
    logDriver("info", this.driverType, "action=spawn", {
      agentId: config.id,
      model: config.model,
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

  protected async doSend(
    agentId: string,
    message: string,
  ): Promise<SendResult> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const messageId = generateSecureId("msg");

    // Add user message to history
    session.conversationHistory.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });

    // Prune history to prevent unbounded growth
    this.pruneConversationHistory(session);

    // Create abort controller for interruption
    const controller = new AbortController();
    session.currentRequestController = controller;

    // Start async response processing
    this.processRequest(agentId, session, controller.signal).catch((err) => {
      if (err.name !== "AbortError") {
        logDriver("error", this.driverType, "request_processing_error", {
          agentId,
          error: String(err),
        });
        this.emitEvent(agentId, {
          type: "error",
          agentId,
          timestamp: new Date(),
          error: err,
          recoverable: true,
        });
        this.updateState(agentId, { activityState: "error" });
      }
    });

    return { messageId, queued: false };
  }

  protected async doTerminate(
    agentId: string,
    graceful: boolean,
  ): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;

    // Cancel any pending request
    if (session.currentRequestController) {
      session.currentRequestController.abort();
    }

    // Log termination
    logDriver("info", this.driverType, "action=terminate", {
      agentId,
      graceful,
      historyLength: session.conversationHistory.length,
    });

    // Clean up session
    this.sessions.delete(agentId);
  }

  protected async doInterrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    // Abort current request
    if (session.currentRequestController) {
      session.currentRequestController.abort();
      session.currentRequestController = undefined;
    }

    logDriver("info", this.driverType, "action=interrupt", { agentId });
  }

  // ============================================================================
  // Checkpointing (optional methods)
  // ============================================================================

  async createCheckpoint(
    agentId: string,
    description?: string,
  ): Promise<CheckpointMetadata> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent state not found: ${agentId}`);
    }

    const checkpointId = generateSecureId("chk");
    const now = new Date();

    const checkpoint: Checkpoint = {
      id: checkpointId,
      agentId,
      createdAt: now,
      tokenUsage: { ...state.tokenUsage },
      description,
      tags: undefined,
      conversationHistory: [...session.conversationHistory],
      toolState: {},
    };

    session.checkpoints.set(checkpointId, checkpoint);

    logDriver("info", this.driverType, "action=checkpoint_create", {
      agentId,
      checkpointId,
      historyLength: session.conversationHistory.length,
    });

    this.emitEvent(agentId, {
      type: "checkpoint_created",
      agentId,
      timestamp: now,
      checkpointId,
    });

    return {
      id: checkpointId,
      agentId,
      createdAt: now,
      tokenUsage: checkpoint.tokenUsage,
      description,
      tags: undefined,
    };
  }

  async listCheckpoints(agentId: string): Promise<CheckpointMetadata[]> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    return Array.from(session.checkpoints.values()).map((cp) => ({
      id: cp.id,
      agentId: cp.agentId,
      createdAt: cp.createdAt,
      tokenUsage: cp.tokenUsage,
      description: cp.description,
      tags: cp.tags,
    }));
  }

  async getCheckpoint(
    agentId: string,
    checkpointId: string,
  ): Promise<Checkpoint> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const checkpoint = session.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    return checkpoint;
  }

  async restoreCheckpoint(
    agentId: string,
    checkpointId: string,
  ): Promise<Agent> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const checkpoint = session.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Restore conversation history
    session.conversationHistory = [
      ...(checkpoint.conversationHistory as ConversationMessage[]),
    ];

    // Set token usage (replace, not accumulate for checkpoint restore)
    this.setTokenUsage(agentId, checkpoint.tokenUsage);

    logDriver("info", this.driverType, "action=checkpoint_restore", {
      agentId,
      checkpointId,
      historyLength: session.conversationHistory.length,
    });

    // Return current state
    const state = await this.getState(agentId);
    return {
      ...state,
      driverId: this.driverId,
      driverType: this.driverType,
    };
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Process a request to the Claude API.
   * This is where the actual API call happens.
   */
  private async processRequest(
    agentId: string,
    session: ClaudeAgentSession,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      // Build messages for API
      const messages = session.conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      this.updateState(agentId, { activityState: "thinking" });

      if (this.apiKey) {
        // Real API Call
        const response = await fetch(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: session.config.model,
            max_tokens: this.defaultMaxTokens,
            messages: messages,
          }),
          signal,
        });

        if (!response.ok) {
          throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
        }

        this.updateState(agentId, { activityState: "working" });

        const data = await response.json();
        const content = data.content?.[0]?.text ?? "";
        
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "text",
          content: content,
        });

        // Add assistant message to history
        session.conversationHistory.push({
          role: "assistant",
          content: content,
          timestamp: new Date(),
          tokenUsage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
          },
        });

        // Prune history to prevent unbounded growth
        this.pruneConversationHistory(session);

        // Update token usage
        this.updateTokenUsage(agentId, {
          promptTokens: data.usage?.input_tokens ?? 0,
          completionTokens: data.usage?.output_tokens ?? 0,
          totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        });

      } else {
        // Fallback: Simulation for testing/dev without API key
        await this.delay(100, signal);
        this.updateState(agentId, { activityState: "working" });

        const lastMessage = messages[messages.length - 1];
        const messagePreview = lastMessage?.content?.slice(0, 50) ?? "(no message)";
        const responseText = `[Simulated Claude response to: "${messagePreview}..."]`;

        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "text",
          content: responseText,
        });

        session.conversationHistory.push({
          role: "assistant",
          content: responseText,
          timestamp: new Date(),
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        });

        // Prune history to prevent unbounded growth
        this.pruneConversationHistory(session);

        this.updateTokenUsage(agentId, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      }

      // Return to idle
      this.updateState(agentId, { activityState: "idle" });
    } finally {
      session.currentRequestController = undefined;
    }
  }

  /**
   * Delay helper that respects abort signal.
   */
  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const abortHandler = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abortHandler);
        reject(new DOMException("Aborted", "AbortError"));
      };

      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", abortHandler);
        resolve();
      }, ms);

      signal.addEventListener("abort", abortHandler);
    });
  }

  /**
   * Prune conversation history to prevent unbounded memory growth.
   * Preserves the first message (typically system prompt) and keeps
   * the most recent messages up to maxHistoryMessages.
   */
  private pruneConversationHistory(session: ClaudeAgentSession): void {
    const history = session.conversationHistory;
    const max = this.maxHistoryMessages;

    if (history.length <= max) {
      return;
    }

    // Keep first message (system prompt) + most recent (max - 1) messages
    const firstMessage = history[0];
    if (!firstMessage) {
      // Edge case: empty history, nothing to prune
      return;
    }
    const recentMessages = history.slice(-(max - 1));
    session.conversationHistory = [firstMessage, ...recentMessages];

    logDriver("debug", this.driverType, "history_pruned", {
      previousLength: history.length,
      newLength: session.conversationHistory.length,
      maxHistoryMessages: max,
    });
  }
}

/**
 * Factory function to create a Claude SDK driver.
 */
export async function createClaudeDriver(
  options?: ClaudeDriverOptions,
): Promise<ClaudeSDKDriver> {
  const config = createDriverOptions("sdk", options);
  const driver = new ClaudeSDKDriver(config, options);

  // Verify health
  if (!(await driver.isHealthy())) {
    logDriver("warn", "sdk", "driver_unhealthy", { reason: "missing_api_key" });
  }

  return driver;
}
