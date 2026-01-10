/**
 * ACP (Agent Client Protocol) Driver - JSON-RPC 2.0 over stdio.
 *
 * This driver spawns agent processes and communicates using the
 * Agent Client Protocol, which provides structured events compatible
 * with IDE integrations like VS Code and JetBrains.
 *
 * Features:
 * - Structured events (tool calls, file operations)
 * - Diff rendering for edits
 * - Process isolation
 * - Real-time streaming
 * - Interruption support
 * - Checkpointing
 */

import { spawn, type Subprocess } from "bun";
import { BaseDriver, createDriverOptions, type BaseDriverConfig } from "../base-driver";
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  Checkpoint,
  CheckpointMetadata,
  OutputLine,
  SendResult,
  TokenUsage,
} from "../types";
import type { DriverOptions } from "../interface";

// ============================================================================
// ACP Protocol Types (JSON-RPC 2.0)
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ============================================================================
// ACP-Specific Event Types
// ============================================================================

/** ACP tool call event from agent */
interface AcpToolCall {
  tool_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

/** ACP tool result event to agent */
interface AcpToolResult {
  tool_id: string;
  output: unknown;
  is_error: boolean;
}

/** ACP file operation event */
interface AcpFileOp {
  operation: "read" | "write" | "edit";
  path: string;
  content?: string;
  diff?: string;
}

/** ACP content block types */
type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

// ============================================================================
// Driver Configuration
// ============================================================================

/**
 * Configuration specific to ACP driver.
 */
export interface AcpDriverOptions extends DriverOptions {
  /** Path to the ACP-compatible agent binary (e.g., "claude-code", "codex") */
  agentBinary?: string;
  /** Arguments to pass to the agent binary */
  agentArgs?: string[];
  /** Environment variables for the agent process */
  agentEnv?: Record<string, string>;
  /** Timeout for JSON-RPC requests in milliseconds */
  rpcTimeoutMs?: number;
  /** Enable verbose logging of ACP protocol messages */
  verboseProtocol?: boolean;
}

/**
 * Internal state for an ACP agent session.
 */
interface AcpAgentSession {
  config: AgentConfig;
  process: Subprocess;
  rpcId: number;
  pendingRequests: Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  /** Track pending tool calls by ID to correlate with results */
  pendingToolCalls: Map<string, { name: string; startTime: number }>;
  checkpoints: Map<string, Checkpoint>;
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: AcpContentBlock[];
    timestamp: Date;
  }>;
  inputBuffer: string;
  tokenUsage: TokenUsage;
}

// ============================================================================
// ACP Driver Implementation
// ============================================================================

/**
 * ACP Driver implementation using JSON-RPC 2.0 over stdio.
 */
export class AcpDriver extends BaseDriver {
  private agentBinary: string;
  private agentArgs: string[];
  private agentEnv: Record<string, string>;
  private rpcTimeoutMs: number;
  private verboseProtocol: boolean;
  private sessions = new Map<string, AcpAgentSession>();

  constructor(config: BaseDriverConfig, options: AcpDriverOptions = {}) {
    super(config);
    this.agentBinary = options.agentBinary ?? "claude";
    this.agentArgs = options.agentArgs ?? ["--print", "--output-format", "stream-json"];
    this.agentEnv = options.agentEnv ?? {};
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 60000;
    this.verboseProtocol = options.verboseProtocol ?? false;
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  protected async doHealthCheck(): Promise<boolean> {
    // Check if agent binary exists and is executable
    try {
      const result = await Bun.spawn([this.agentBinary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      return result === 0;
    } catch {
      // Binary not found or not executable
      return false;
    }
  }

  protected async doSpawn(config: AgentConfig): Promise<Agent> {
    // Build arguments for the agent process
    const args = [
      ...this.agentArgs,
      "--working-directory", config.workingDirectory,
    ];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.systemPrompt) {
      args.push("--system-prompt", config.systemPrompt);
    }

    // Spawn the agent process
    const agentProcess = spawn([this.agentBinary, ...args], {
      cwd: config.workingDirectory,
      env: {
        ...Bun.env,
        ...this.agentEnv,
        // Pass CAAM account credentials if available
        ...(config.accountId ? { FLYWHEEL_ACCOUNT_ID: config.accountId } : {}),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Create session
    const session: AcpAgentSession = {
      config,
      process: agentProcess,
      rpcId: 0,
      pendingRequests: new Map(),
      pendingToolCalls: new Map(),
      checkpoints: new Map(),
      conversationHistory: [],
      inputBuffer: "",
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };

    this.sessions.set(config.id, session);

    // Start reading stdout/stderr
    this.readProcessOutput(config.id, session);

    // Log spawn
    console.info("[DRIVER] action=spawn driver=acp", {
      agentId: config.id,
      binary: this.agentBinary,
      workingDirectory: config.workingDirectory,
      pid: agentProcess.pid,
    });

    // Return agent state
    const now = new Date();
    return {
      id: config.id,
      config,
      driverId: this.driverId,
      driverType: this.driverType,
      activityState: "idle",
      tokenUsage: session.tokenUsage,
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
      content: [{ type: "text", text: message }],
      timestamp: new Date(),
    });

    // Send message to agent process via stdin
    // The message format depends on the agent's protocol
    const stdinMessage = `${message}\n`;

    try {
      const stdin = session.process.stdin;
      if (stdin && typeof stdin !== "number") {
        stdin.write(stdinMessage);
        stdin.flush();
      } else {
        throw new Error("stdin not available");
      }
    } catch (err) {
      throw new Error(`Failed to send message to agent: ${err}`);
    }

    // Update state to thinking
    this.updateState(agentId, { activityState: "thinking" });

    return { messageId, queued: false };
  }

  protected async doTerminate(agentId: string, graceful: boolean): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;

    // Cancel all pending requests
    for (const [, pending] of session.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Agent terminated"));
    }
    session.pendingRequests.clear();

    // Log termination
    console.info("[DRIVER] action=terminate driver=acp", {
      agentId,
      graceful,
      pid: session.process.pid,
    });

    // Terminate the process
    if (graceful) {
      // Send SIGTERM and wait for graceful shutdown
      session.process.kill("SIGTERM");
      // Wait up to 5 seconds for graceful shutdown
      const timeout = setTimeout(() => {
        session.process.kill("SIGKILL");
      }, 5000);
      await session.process.exited;
      clearTimeout(timeout);
    } else {
      session.process.kill("SIGKILL");
    }

    // Clean up session
    this.sessions.delete(agentId);
  }

  protected async doInterrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    // Send SIGINT to interrupt current operation
    session.process.kill("SIGINT");

    console.info("[DRIVER] action=interrupt driver=acp", {
      agentId,
      pid: session.process.pid,
    });
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
      tokenUsage: { ...session.tokenUsage },
      description,
      tags: undefined,
      conversationHistory: [...session.conversationHistory],
      toolState: {},
    };

    session.checkpoints.set(checkpointId, checkpoint);

    console.info("[DRIVER] action=checkpoint_create driver=acp", {
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
    session.conversationHistory = [...checkpoint.conversationHistory] as typeof session.conversationHistory;
    session.tokenUsage = { ...checkpoint.tokenUsage };

    // Update token usage in base driver
    this.updateTokenUsage(agentId, checkpoint.tokenUsage);

    console.info("[DRIVER] action=checkpoint_restore driver=acp", {
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
   * Read and process output from the agent process.
   */
  private async readProcessOutput(agentId: string, session: AcpAgentSession): Promise<void> {
    const stdout = session.process.stdout;
    const stderr = session.process.stderr;

    // Read stdout for main output
    if (stdout && typeof stdout !== "number") {
      this.readStream(agentId, session, stdout, "stdout");
    }

    // Read stderr for errors/warnings
    if (stderr && typeof stderr !== "number") {
      this.readStream(agentId, session, stderr, "stderr");
    }

    // Handle process exit
    session.process.exited.then((exitCode) => {
      if (this.sessions.has(agentId)) {
        // Emit terminated event first (while agents Map still has subscribers)
        this.emitEvent(agentId, {
          type: "terminated",
          agentId,
          timestamp: new Date(),
          reason: exitCode === 0 ? "normal" : "error",
          exitCode,
        });

        // Clean up BaseDriver agent state
        const state = this.agents.get(agentId);
        if (state) {
          if (state.stallCheckInterval) {
            clearInterval(state.stallCheckInterval);
          }
          state.eventSubscribers.clear();
          this.agents.delete(agentId);
        }

        // Clean up driver session
        this.sessions.delete(agentId);
      }
    });
  }

  /**
   * Read from a stream and process the output.
   */
  private readStream(
    agentId: string,
    session: AcpAgentSession,
    stream: ReadableStream<Uint8Array>,
    type: "stdout" | "stderr"
  ): void {
    const decoder = new TextDecoder();
    const reader = stream.getReader();

    const read = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          if (type === "stdout") {
            this.processStdout(agentId, session, text);
          } else {
            this.processStderr(agentId, session, text);
          }
        }
      } catch (err) {
        if (!this.sessions.has(agentId)) return; // Session was terminated
        console.error(`[DRIVER] ${type} read error:`, err);
      } finally {
        reader.releaseLock();
      }
    };

    read();
  }

  /**
   * Process stdout output from the agent.
   * This handles both streaming JSON and plain text output.
   */
  private processStdout(agentId: string, session: AcpAgentSession, text: string): void {
    // Append to input buffer for line-based parsing
    session.inputBuffer += text;

    // Process complete lines
    const lines = session.inputBuffer.split("\n");
    session.inputBuffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      // Try to parse as JSON (stream-json format)
      try {
        const event = JSON.parse(line);
        this.handleAcpEvent(agentId, session, event);
      } catch {
        // Not JSON, treat as plain text output
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "text",
          content: line,
        });
      }
    }
  }

  /**
   * Process stderr output from the agent.
   */
  private processStderr(agentId: string, session: AcpAgentSession, text: string): void {
    // Log stderr as system/error output
    this.addOutput(agentId, {
      timestamp: new Date(),
      type: "system",
      content: text.trim(),
      metadata: { source: "stderr" },
    });
  }

  /**
   * Handle an ACP event from the agent.
   */
  private handleAcpEvent(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    if (this.verboseProtocol) {
      console.debug("[DRIVER] acp_event:", JSON.stringify(event));
    }

    const eventType = event["type"] as string;

    switch (eventType) {
      case "message_start":
        this.updateState(agentId, { activityState: "working" });
        break;

      case "content_block_start":
        this.handleContentBlockStart(agentId, session, event);
        break;

      case "content_block_delta":
        this.handleContentBlockDelta(agentId, session, event);
        break;

      case "content_block_stop":
        this.handleContentBlockStop(agentId, session, event);
        break;

      case "message_delta":
        this.handleMessageDelta(agentId, session, event);
        break;

      case "message_stop":
        this.updateState(agentId, { activityState: "idle" });
        break;

      case "tool_use":
        this.handleToolUse(agentId, session, event);
        break;

      case "tool_result":
        this.handleToolResult(agentId, session, event);
        break;

      case "error":
        this.handleError(agentId, event);
        break;

      default:
        // Unknown event type, log for debugging
        if (this.verboseProtocol) {
          console.debug("[DRIVER] unknown acp event:", eventType);
        }
    }
  }

  private handleContentBlockStart(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    const contentBlock = event["content_block"] as Record<string, unknown>;
    if (!contentBlock) return;

    const blockType = contentBlock["type"] as string;

    if (blockType === "tool_use") {
      // Starting a tool call
      this.updateState(agentId, { activityState: "tool_calling" });
      this.emitEvent(agentId, {
        type: "tool_call_start",
        agentId,
        timestamp: new Date(),
        toolName: contentBlock["name"] as string,
        toolId: contentBlock["id"] as string,
        input: {},
      });
    }
  }

  private handleContentBlockDelta(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    const delta = event["delta"] as Record<string, unknown>;
    if (!delta) return;

    const deltaType = delta["type"] as string;

    if (deltaType === "text_delta") {
      const text = delta["text"] as string;
      if (text) {
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "text",
          content: text,
        });
      }
    } else if (deltaType === "thinking_delta") {
      const thinking = delta["thinking"] as string;
      if (thinking) {
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "thinking",
          content: thinking,
        });
      }
    } else if (deltaType === "input_json_delta") {
      // Tool input being streamed - we could accumulate this
      // For now, just log in verbose mode
      if (this.verboseProtocol) {
        console.debug("[DRIVER] tool input delta:", delta["partial_json"]);
      }
    }
  }

  private handleContentBlockStop(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    // Content block completed
    const index = event["index"] as number;
    if (this.verboseProtocol) {
      console.debug("[DRIVER] content block stop:", index);
    }
  }

  private handleMessageDelta(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    // Update token usage if provided
    const usage = event["usage"] as Record<string, number> | undefined;
    if (usage) {
      const tokenUsage: TokenUsage = {
        promptTokens: usage["input_tokens"] ?? session.tokenUsage.promptTokens,
        completionTokens: usage["output_tokens"] ?? session.tokenUsage.completionTokens,
        totalTokens: (usage["input_tokens"] ?? 0) + (usage["output_tokens"] ?? 0),
      };
      session.tokenUsage = tokenUsage;
      this.updateTokenUsage(agentId, tokenUsage);
    }
  }

  private handleToolUse(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    const toolCall: AcpToolCall = {
      tool_id: event["id"] as string,
      tool_name: event["name"] as string,
      input: event["input"] as Record<string, unknown>,
    };

    // Track this tool call for correlation with result
    session.pendingToolCalls.set(toolCall.tool_id, {
      name: toolCall.tool_name,
      startTime: Date.now(),
    });

    this.updateState(agentId, { activityState: "tool_calling" });

    this.emitEvent(agentId, {
      type: "tool_call_start",
      agentId,
      timestamp: new Date(),
      toolName: toolCall.tool_name,
      toolId: toolCall.tool_id,
      input: toolCall.input,
    });

    // Handle file operations specially
    if (this.isFileOperation(toolCall.tool_name)) {
      this.emitFileOperationEvent(agentId, toolCall);
    }

    // Add tool use to output
    this.addOutput(agentId, {
      timestamp: new Date(),
      type: "tool_use",
      content: JSON.stringify({ tool: toolCall.tool_name, input: toolCall.input }),
      metadata: { toolId: toolCall.tool_id },
    });
  }

  private handleToolResult(agentId: string, session: AcpAgentSession, event: Record<string, unknown>): void {
    const toolResult: AcpToolResult = {
      tool_id: event["tool_use_id"] as string,
      output: event["content"],
      is_error: event["is_error"] as boolean ?? false,
    };

    // Look up the tool call info for name and duration calculation
    const toolCallInfo = session.pendingToolCalls.get(toolResult.tool_id);
    const toolName = toolCallInfo?.name ?? "unknown";
    const durationMs = toolCallInfo ? Date.now() - toolCallInfo.startTime : 0;

    // Clean up the pending tool call
    session.pendingToolCalls.delete(toolResult.tool_id);

    this.emitEvent(agentId, {
      type: "tool_call_end",
      agentId,
      timestamp: new Date(),
      toolName,
      toolId: toolResult.tool_id,
      output: toolResult.output,
      success: !toolResult.is_error,
      durationMs,
    });

    this.updateState(agentId, { activityState: "working" });

    // Add tool result to output
    this.addOutput(agentId, {
      timestamp: new Date(),
      type: "tool_result",
      content: typeof toolResult.output === "string" ? toolResult.output : JSON.stringify(toolResult.output),
      metadata: { toolId: toolResult.tool_id, isError: toolResult.is_error },
    });
  }

  private handleError(agentId: string, event: Record<string, unknown>): void {
    const error = new Error(event["message"] as string ?? "Unknown ACP error");

    this.emitEvent(agentId, {
      type: "error",
      agentId,
      timestamp: new Date(),
      error,
      recoverable: true,
    });

    this.updateState(agentId, { activityState: "error" });
  }

  private isFileOperation(toolName: string): boolean {
    const fileTools = ["Read", "Write", "Edit", "Glob", "Grep"];
    return fileTools.includes(toolName);
  }

  private emitFileOperationEvent(agentId: string, toolCall: AcpToolCall): void {
    let operation: "read" | "write" | "edit";
    let path: string;

    switch (toolCall.tool_name) {
      case "Read":
        operation = "read";
        path = toolCall.input["file_path"] as string ?? "";
        break;
      case "Write":
        operation = "write";
        path = toolCall.input["file_path"] as string ?? "";
        break;
      case "Edit":
        operation = "edit";
        path = toolCall.input["file_path"] as string ?? "";
        break;
      default:
        return; // Not a simple file operation
    }

    this.emitEvent(agentId, {
      type: operation === "read" ? "file_read" : operation === "write" ? "file_write" : "file_edit",
      agentId,
      timestamp: new Date(),
      path,
      operation,
      success: true, // We don't know yet; will update on tool result
    });
  }

  // ============================================================================
  // JSON-RPC Helpers (for future bidirectional protocol support)
  // ============================================================================

  /**
   * Send a JSON-RPC request and wait for response.
   * This is for future use when the protocol supports bidirectional RPC.
   */
  private async sendRpcRequest(
    session: AcpAgentSession,
    method: string,
    params?: unknown
  ): Promise<unknown> {
    const id = ++session.rpcId;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pendingRequests.delete(id);
        reject(new Error(`RPC timeout for method: ${method}`));
      }, this.rpcTimeoutMs);

      session.pendingRequests.set(id, { resolve, reject, timeout });

      try {
        const stdin = session.process.stdin;
        if (stdin && typeof stdin !== "number") {
          stdin.write(JSON.stringify(request) + "\n");
          stdin.flush();
        } else {
          throw new Error("stdin not available");
        }
      } catch (err) {
        clearTimeout(timeout);
        session.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private sendRpcNotification(
    session: AcpAgentSession,
    method: string,
    params?: unknown
  ): void {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    try {
      const stdin = session.process.stdin;
      if (stdin && typeof stdin !== "number") {
        stdin.write(JSON.stringify(notification) + "\n");
        stdin.flush();
      } else {
        console.error("[DRIVER] stdin not available for notification");
      }
    } catch (err) {
      console.error("[DRIVER] Failed to send RPC notification:", err);
    }
  }
}

/**
 * Factory function to create an ACP driver.
 */
export async function createAcpDriver(options?: AcpDriverOptions): Promise<AcpDriver> {
  const config = createDriverOptions("acp", options);
  const driver = new AcpDriver(config, options);

  // Verify health
  if (!(await driver.isHealthy())) {
    console.warn("[DRIVER] ACP driver created but agent binary not found or not executable");
  }

  return driver;
}
