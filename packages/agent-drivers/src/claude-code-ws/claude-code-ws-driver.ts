/**
 * Claude Code WebSocket Driver.
 *
 * Runs Claude Code CLI in hidden `--sdk-url` mode and bridges its NDJSON
 * websocket protocol into Flywheel's AgentDriver event model.
 *
 * This is inspired by Companion's transport approach, but implemented as a
 * native AgentDriver so the rest of Gateway stays backend-agnostic.
 */

import { randomUUID } from "node:crypto";
import { type ServerWebSocket, type Subprocess, spawn } from "bun";
import {
  BaseDriver,
  type BaseDriverConfig,
  createDriverOptions,
  generateSecureId,
  logDriver,
} from "../base-driver";
import type { DriverOptions } from "../interface";
import type { Agent, AgentConfig, SendResult, TokenUsage } from "../types";

interface WsSessionData {
  agentId: string;
  token: string;
}

interface ClaudeCodeWsSession {
  config: AgentConfig;
  process: Subprocess;
  token: string;
  websocket: ServerWebSocket<WsSessionData> | null;
  inputBuffer: string;
  pendingOutgoing: string[];
  cliSessionId: string;
}

/**
 * Configuration specific to Claude Code websocket driver.
 */
export interface ClaudeCodeWsDriverOptions extends DriverOptions {
  /** Claude CLI binary path/name. Default: "claude" */
  claudeBinary?: string;
  /** Host for the internal websocket server. Default: "127.0.0.1" */
  host?: string;
  /** Port for the internal websocket server (0 = ephemeral). Default: 0 */
  port?: number;
  /** Extra args to append to Claude CLI launch command */
  claudeArgs?: string[];
  /** Automatically approve tool-use control requests. Default: true */
  autoApproveTools?: boolean;
  /** Mirror CLI stderr into output stream. Default: true */
  captureStderr?: boolean;
}

export class ClaudeCodeWsDriver extends BaseDriver {
  private readonly claudeBinary: string;
  private readonly host: string;
  private readonly port: number;
  private readonly claudeArgs: string[];
  private readonly autoApproveTools: boolean;
  private readonly captureStderr: boolean;
  private server: ReturnType<typeof Bun.serve<WsSessionData>> | undefined;
  private sessions = new Map<string, ClaudeCodeWsSession>();

  constructor(
    config: BaseDriverConfig,
    options: ClaudeCodeWsDriverOptions = {},
  ) {
    super(config);
    this.claudeBinary = options.claudeBinary ?? "claude";
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    this.claudeArgs = options.claudeArgs ?? [];
    this.autoApproveTools = options.autoApproveTools ?? true;
    this.captureStderr = options.captureStderr ?? true;
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      const proc = Bun.spawn([this.claudeBinary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  protected async doSpawn(config: AgentConfig): Promise<Agent> {
    if (config.provider !== "claude") {
      throw new Error(
        `ClaudeCodeWsDriver only supports 'claude' provider, got: ${config.provider}`,
      );
    }

    const wsServer = this.ensureServer();
    const token = randomUUID();
    const sdkHost = this.getSdkConnectHost();
    const sdkUrl = `ws://${sdkHost}:${wsServer.port}/cli/${encodeURIComponent(config.id)}?token=${encodeURIComponent(token)}`;

    const args = [
      "--sdk-url",
      sdkUrl,
      "--print",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      ...this.claudeArgs,
    ];

    if (config.model) {
      args.push("--model", config.model);
    }

    // CLI waits for NDJSON user messages on websocket; empty -p keeps it headless.
    args.push("-p", "");

    const proc = spawn([this.claudeBinary, ...args], {
      cwd: config.workingDirectory,
      env: {
        ...Bun.env,
        CLAUDECODE: "1",
        ...(config.accountId ? { FLYWHEEL_ACCOUNT_ID: config.accountId } : {}),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const session: ClaudeCodeWsSession = {
      config,
      process: proc,
      token,
      websocket: null,
      inputBuffer: "",
      pendingOutgoing: [],
      cliSessionId: "",
    };
    this.sessions.set(config.id, session);

    if (this.captureStderr) {
      this.readStderr(config.id, session).catch((error: unknown) => {
        logDriver("warn", this.driverType, "stderr_read_failed", {
          agentId: config.id,
          error: String(error),
        });
      });
    }

    proc.exited.then((exitCode) => {
      // Avoid firing before BaseDriver has inserted the agent state.
      queueMicrotask(() => {
        this.handleProcessExit(config.id, exitCode);
      });
    });

    logDriver("info", this.driverType, "action=spawn", {
      agentId: config.id,
      model: config.model,
      workingDirectory: config.workingDirectory,
      pid: proc.pid,
      sdkUrl,
    });

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
    const queued = this.sendToCli(session, {
      type: "user",
      message: {
        role: "user",
        content: message,
      },
      parent_tool_use_id: null,
      session_id: session.cliSessionId,
    });

    return { messageId, queued };
  }

  protected async doTerminate(
    agentId: string,
    graceful: boolean,
  ): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;

    logDriver("info", this.driverType, "action=terminate", {
      agentId,
      graceful,
      pid: session.process.pid,
    });

    try {
      session.websocket?.close();
    } catch {
      // Ignore socket close errors; process termination is primary.
    }

    if (graceful) {
      session.process.kill("SIGTERM");
      const exited = await Promise.race([
        session.process.exited.then(() => true),
        Bun.sleep(5000).then(() => false),
      ]);
      if (!exited) {
        session.process.kill("SIGKILL");
      }
    } else {
      session.process.kill("SIGKILL");
    }

    this.sessions.delete(agentId);
  }

  protected async doInterrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Session not found for agent: ${agentId}`);
    }

    this.sendToCli(session, {
      type: "control_request",
      request_id: randomUUID(),
      request: { subtype: "interrupt" },
    });

    logDriver("info", this.driverType, "action=interrupt", { agentId });
  }

  private ensureServer(): ReturnType<typeof Bun.serve<WsSessionData>> {
    if (this.server) {
      return this.server;
    }

    this.server = Bun.serve<WsSessionData>({
      hostname: this.host,
      port: this.port,
      fetch: (request, server) => {
        const url = new URL(request.url);
        const match = url.pathname.match(/^\/cli\/([^/]+)$/);
        if (!match) {
          return new Response("Not Found", { status: 404 });
        }

        const agentId = decodeURIComponent(match[1] ?? "");
        const token = url.searchParams.get("token") ?? "";
        const session = this.sessions.get(agentId);
        if (!session) {
          return new Response("Unknown session", { status: 404 });
        }

        if (!token || token !== session.token) {
          return new Response("Unauthorized", { status: 401 });
        }

        const upgraded = server.upgrade(request, {
          data: { agentId, token },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      },
      websocket: {
        open: (ws) => {
          const session = this.sessions.get(ws.data.agentId);
          if (!session) {
            ws.close();
            return;
          }

          session.websocket = ws;
          if (session.pendingOutgoing.length > 0) {
            const queued = [...session.pendingOutgoing];
            session.pendingOutgoing = [];
            for (const payload of queued) {
              this.sendRawToCli(session, payload);
            }
          }
        },
        message: (ws, message) => {
          const text = this.decodeWsMessage(message);
          if (!text) return;
          this.handleWsText(ws.data.agentId, text);
        },
        close: (ws) => {
          const session = this.sessions.get(ws.data.agentId);
          if (!session) return;
          if (session.websocket === ws) {
            session.websocket = null;
          }
        },
      },
    });

    return this.server;
  }

  private getSdkConnectHost(): string {
    if (this.host === "0.0.0.0" || this.host === "::") {
      return "127.0.0.1";
    }
    return this.host;
  }

  private decodeWsMessage(message: unknown): string | null {
    if (typeof message === "string") {
      return message;
    }
    if (message instanceof Uint8Array) {
      return new TextDecoder().decode(message);
    }
    if (message instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(message));
    }
    return null;
  }

  private sendToCli(session: ClaudeCodeWsSession, payload: unknown): boolean {
    const serialized = this.safeStringify(payload);
    if (!serialized) return false;

    if (!session.websocket) {
      session.pendingOutgoing.push(serialized);
      return true;
    }

    return this.sendRawToCli(session, serialized);
  }

  private sendRawToCli(session: ClaudeCodeWsSession, payload: string): boolean {
    if (!session.websocket) {
      session.pendingOutgoing.push(payload);
      return true;
    }

    try {
      session.websocket.send(`${payload}\n`);
      return false;
    } catch {
      session.pendingOutgoing.push(payload);
      return true;
    }
  }

  private handleWsText(agentId: string, text: string): void {
    const session = this.sessions.get(agentId);
    if (!session) return;

    session.inputBuffer += text;
    const lines = session.inputBuffer.split("\n");
    session.inputBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "system",
          content: trimmed,
          metadata: { source: "ws_unparsed" },
        });
        continue;
      }

      this.routeCliMessage(agentId, session, parsed);
    }
  }

  private routeCliMessage(
    agentId: string,
    session: ClaudeCodeWsSession,
    raw: unknown,
  ): void {
    const message = asRecord(raw);
    if (!message) return;

    const type = asString(message["type"]);
    if (!type) return;

    switch (type) {
      case "system":
        this.handleSystemMessage(agentId, session, message);
        break;
      case "assistant":
        this.handleAssistantMessage(agentId, message);
        break;
      case "stream_event":
        this.handleStreamEvent(agentId, message);
        break;
      case "result":
        this.handleResultMessage(agentId, message);
        break;
      case "control_request":
        this.handleControlRequest(agentId, session, message);
        break;
      case "auth_status":
        this.handleAuthStatus(agentId, message);
        break;
      case "keep_alive":
        break;
      default:
        logDriver("debug", this.driverType, "unhandled_cli_message", {
          agentId,
          type,
        });
    }
  }

  private handleSystemMessage(
    agentId: string,
    session: ClaudeCodeWsSession,
    message: Record<string, unknown>,
  ): void {
    const subtype = asString(message["subtype"]);
    if (subtype !== "init") {
      return;
    }

    const cliSessionId = asString(message["session_id"]);
    if (cliSessionId) {
      session.cliSessionId = cliSessionId;
    }

    this.addOutput(agentId, {
      timestamp: new Date(),
      type: "system",
      content: "Claude Code websocket session initialized",
      metadata: {
        model: asString(message["model"]),
        cwd: asString(message["cwd"]),
        cliSessionId,
      },
    });

    this.updateState(agentId, { activityState: "idle" });
  }

  private handleAssistantMessage(
    agentId: string,
    message: Record<string, unknown>,
  ): void {
    const payload = asRecord(message["message"]);
    const content = payload ? payload["content"] : message["content"];
    const chunks = extractTextChunks(content);

    if (chunks.length === 0) {
      this.addOutput(agentId, {
        timestamp: new Date(),
        type: "markdown",
        content: this.safeStringify(message) ?? "",
        metadata: { source: "assistant_raw" },
      });
      return;
    }

    for (const chunk of chunks) {
      this.addOutput(agentId, {
        timestamp: new Date(),
        type: "markdown",
        content: chunk,
      });
    }
  }

  private handleStreamEvent(
    agentId: string,
    message: Record<string, unknown>,
  ): void {
    const event = asRecord(message["event"]);
    if (!event) return;

    const eventType = asString(event["type"]);
    if (eventType === "content_block_delta") {
      const delta = asRecord(event["delta"]);
      const deltaType = delta ? asString(delta["type"]) : undefined;
      if (deltaType === "text_delta") {
        const text = delta ? asString(delta["text"]) : undefined;
        if (text) {
          this.addOutput(agentId, {
            timestamp: new Date(),
            type: "text",
            content: text,
            metadata: { source: "stream_event" },
          });
        }
        return;
      }
      if (deltaType === "thinking_delta") {
        const thinking = delta ? asString(delta["thinking"]) : undefined;
        if (thinking) {
          this.addOutput(agentId, {
            timestamp: new Date(),
            type: "thinking",
            content: thinking,
            metadata: { source: "stream_event" },
          });
        }
      }
    }
  }

  private handleResultMessage(
    agentId: string,
    message: Record<string, unknown>,
  ): void {
    const usage = extractTokenUsage(message);
    if (usage) {
      this.updateTokenUsage(agentId, usage);
    }

    this.updateState(agentId, { activityState: "idle" });
  }

  private handleControlRequest(
    agentId: string,
    session: ClaudeCodeWsSession,
    message: Record<string, unknown>,
  ): void {
    const requestId = asString(message["request_id"]);
    const request = asRecord(message["request"]);
    const subtype = request ? asString(request["subtype"]) : undefined;
    if (!requestId || !subtype) return;

    if (subtype === "can_use_tool") {
      const toolName = request ? asString(request["tool_name"]) : undefined;
      if (this.autoApproveTools) {
        const input = request ? asRecord(request["input"]) : null;
        this.sendToCli(session, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: {
              behavior: "allow",
              updatedInput: input ?? {},
            },
          },
        });

        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "system",
          content: `Auto-approved tool request: ${toolName ?? "unknown tool"}`,
          metadata: { requestId, subtype, toolName },
        });
      } else {
        this.updateState(agentId, { activityState: "waiting_input" });
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "system",
          content: `Tool request awaiting approval: ${toolName ?? "unknown tool"}`,
          metadata: { requestId, subtype, toolName, pendingApproval: true },
        });
      }
      return;
    }

    if (subtype === "hook_callback") {
      this.sendToCli(session, {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: {},
        },
      });
    }
  }

  private handleAuthStatus(
    agentId: string,
    message: Record<string, unknown>,
  ): void {
    const error = asString(message["error"]);
    if (!error) return;
    this.addOutput(agentId, {
      timestamp: new Date(),
      type: "error",
      content: error,
      metadata: {
        source: "auth_status",
      },
    });
  }

  private async readStderr(
    agentId: string,
    session: ClaudeCodeWsSession,
  ): Promise<void> {
    const stderr = session.process.stderr;
    if (!stderr || typeof stderr === "number") return;

    const reader = stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const tail = decoder.decode();
          if (tail.trim()) {
            this.addOutput(agentId, {
              timestamp: new Date(),
              type: "system",
              content: tail.trim(),
              metadata: { source: "stderr" },
            });
          }
          break;
        }

        const text = decoder.decode(value, { stream: true }).trim();
        if (!text) continue;
        this.addOutput(agentId, {
          timestamp: new Date(),
          type: "system",
          content: text,
          metadata: { source: "stderr" },
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleProcessExit(agentId: string, exitCode: number): void {
    const session = this.sessions.get(agentId);
    if (!session) {
      return;
    }

    this.sessions.delete(agentId);

    if (!this.agents.has(agentId)) {
      return;
    }

    this.emitEvent(agentId, {
      type: "terminated",
      agentId,
      timestamp: new Date(),
      reason: exitCode === 0 ? "normal" : "error",
      exitCode,
    });

    const state = this.agents.get(agentId);
    if (state) {
      if (state.stallCheckInterval) {
        clearInterval(state.stallCheckInterval);
      }
      state.eventSubscribers.clear();
      this.agents.delete(agentId);
    }
  }

  private safeStringify(value: unknown): string | null {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
}

/**
 * Factory function to create a Claude Code websocket driver.
 */
export async function createClaudeCodeWsDriver(
  options?: ClaudeCodeWsDriverOptions,
): Promise<ClaudeCodeWsDriver> {
  const config = createDriverOptions("claude_code_ws", options);
  const driver = new ClaudeCodeWsDriver(config, options);

  if (!(await driver.isHealthy())) {
    logDriver("warn", "claude_code_ws", "driver_unhealthy", {
      reason: "claude_binary_unavailable",
      binary: options?.claudeBinary ?? "claude",
    });
  }

  return driver;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractTextChunks(content: unknown): string[] {
  if (typeof content === "string") {
    return content ? [content] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const chunks: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;

    const type = asString(record["type"]);
    if (type === "text") {
      const text = asString(record["text"]);
      if (text) chunks.push(text);
      continue;
    }
    if (type === "thinking") {
      const thinking = asString(record["thinking"]);
      if (thinking) chunks.push(thinking);
    }
  }

  return chunks;
}

function extractTokenUsage(
  result: Record<string, unknown>,
): Partial<TokenUsage> | null {
  let promptTokens = 0;
  let completionTokens = 0;
  let found = false;

  const usage = asRecord(result["usage"]);
  if (usage) {
    const prompt =
      asNumber(usage["input_tokens"]) ??
      asNumber(usage["inputTokens"]) ??
      asNumber(usage["promptTokens"]);
    const completion =
      asNumber(usage["output_tokens"]) ??
      asNumber(usage["outputTokens"]) ??
      asNumber(usage["completionTokens"]);
    if (prompt !== undefined || completion !== undefined) {
      promptTokens += prompt ?? 0;
      completionTokens += completion ?? 0;
      found = true;
    }
  }

  const modelUsage = asRecord(result["modelUsage"]);
  if (modelUsage) {
    for (const value of Object.values(modelUsage)) {
      const usageByModel = asRecord(value);
      if (!usageByModel) continue;

      const prompt =
        asNumber(usageByModel["inputTokens"]) ??
        asNumber(usageByModel["promptTokens"]);
      const completion =
        asNumber(usageByModel["outputTokens"]) ??
        asNumber(usageByModel["completionTokens"]);

      if (prompt !== undefined || completion !== undefined) {
        promptTokens += prompt ?? 0;
        completionTokens += completion ?? 0;
        found = true;
      }
    }
  }

  if (!found) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}
