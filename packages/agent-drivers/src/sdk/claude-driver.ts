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

import { BaseDriver, createDriverOptions, logDriver, type BaseDriverConfig } from "../base-driver";
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  Checkpoint,
  CheckpointMetadata,
  OutputLine,
  SendResult,
  SpawnResult,
  TokenUsage,
} from "../types";
import type { DriverOptions } from "../interface";

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
  private sessions = new Map<string, ClaudeAgentSession>();

  constructor(config: BaseDriverConfig, options: ClaudeDriverOptions = {}) {
    super(config);
    this.apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
    this.streaming = options.streaming ?? true;
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
      throw new Error(`ClaudeSDKDriver only supports 'claude' provider, got: ${config.provider}`);
    }

    // Create session
    const session: ClaudeAgentSession = {
      config,
      conversationHistory: [],
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

  protected async doSend(agentId: string, message: string): Promise<SendResult> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Add user message to history
    session.conversationHistory.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });

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

  protected async doTerminate(agentId: string, graceful: boolean): Promise<void> {
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

  async createCheckpoint(agentId: string, description?: string): Promise<CheckpointMetadata> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent state not found: ${agentId}`);
    }

    const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

  async getCheckpoint(agentId: string, checkpointId: string): Promise<Checkpoint> {
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

  async restoreCheckpoint(agentId: string, checkpointId: string): Promise<Agent> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    const checkpoint = session.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Restore conversation history
    session.conversationHistory = [...(checkpoint.conversationHistory as ConversationMessage[])];

    // Update token usage
    this.updateTokenUsage(agentId, checkpoint.tokenUsage);

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
    signal: AbortSignal
  ): Promise<void> {
    try {
      // Build messages for API
      const messages = session.conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // TODO: Replace with actual Claude Agent SDK call
      // For now, simulate a response for testing purposes
      // In production, this would use @anthropic-ai/claude-agent-sdk

      // Simulate thinking state
      this.updateState(agentId, { activityState: "thinking" });
      await this.delay(100, signal);

      // Simulate streaming output
      this.updateState(agentId, { activityState: "working" });

      // Add simulated response output
      const lastMessage = messages[messages.length - 1];
      const messagePreview = lastMessage?.content?.slice(0, 50) ?? "(no message)";
      const responseText = `[Simulated Claude response to: "${messagePreview}..."]`;

      this.addOutput(agentId, {
        timestamp: new Date(),
        type: "text",
        content: responseText,
      });

      // Add assistant message to history
      session.conversationHistory.push({
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      // Update token usage
      this.updateTokenUsage(agentId, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });

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
}

/**
 * Factory function to create a Claude SDK driver.
 */
export async function createClaudeDriver(options?: ClaudeDriverOptions): Promise<ClaudeSDKDriver> {
  const config = createDriverOptions("sdk", options);
  const driver = new ClaudeSDKDriver(config, options);

  // Verify health
  if (!(await driver.isHealthy())) {
    logDriver("warn", "sdk", "driver_unhealthy", { reason: "missing_api_key" });
  }

  return driver;
}
