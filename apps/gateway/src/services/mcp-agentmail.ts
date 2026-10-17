import {
  AgentMailClientError,
  type AgentMailToolCaller,
} from "@flywheel/flywheel-clients";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  recordFailure,
  recordSuccess,
  shouldCheck,
} from "./circuit-breaker.service";
import { createChildLogger } from "./logger";

export interface McpAgentMailConfig {
  command: string;
  args: string[];
  clientName: string;
  clientVersion: string;
}

export interface QueuedAgentMailMessage {
  id: string;
  input: Record<string, unknown>;
  queuedAt: Date;
}

const MAX_OFFLINE_QUEUE_SIZE = 500;
const offlineMessageQueue: QueuedAgentMailMessage[] = [];
let flushingOfflineQueue = false;

/**
 * Get a snapshot of messages queued while the Agent Mail circuit breaker was OPEN.
 */
export function getAgentMailOfflineQueue(): QueuedAgentMailMessage[] {
  return [...offlineMessageQueue];
}

/**
 * Clear the Agent Mail offline message queue (used in tests).
 */
export function clearAgentMailOfflineQueue(): void {
  offlineMessageQueue.length = 0;
}

/**
 * Flush queued offline messages through the underlying AgentMailToolCaller.
 * Returns the number of messages successfully flushed.
 */
export async function flushAgentMailOfflineQueue(
  caller: AgentMailToolCaller,
): Promise<number> {
  if (flushingOfflineQueue || offlineMessageQueue.length === 0) {
    return 0;
  }

  flushingOfflineQueue = true;
  const log = createChildLogger({ component: "agentmail-offline-queue" });
  let flushed = 0;

  try {
    while (offlineMessageQueue.length > 0) {
      const next = offlineMessageQueue[0];
      if (!next) break;
      try {
        await caller("send_message", next.input);
        offlineMessageQueue.shift();
        flushed++;
        recordSuccess("agentmail");
      } catch (err) {
        log.warn(
          { error: String(err), remaining: offlineMessageQueue.length },
          "Failed to flush offline Agent Mail message; stopping flush",
        );
        break;
      }
    }
    if (flushed > 0) {
      log.info(
        { flushed, remaining: offlineMessageQueue.length },
        "Flushed queued Agent Mail messages after circuit recovery",
      );
    }
  } finally {
    flushingOfflineQueue = false;
  }

  return flushed;
}

/**
 * Wrap an AgentMailToolCaller with the "agentmail" circuit breaker, offline
 * message queue fallback when OPEN, and automatic queue flush upon recovery.
 */
export function withAgentMailCircuitBreaker(
  rawCaller: AgentMailToolCaller,
): AgentMailToolCaller {
  const log = createChildLogger({ component: "agentmail-circuit-breaker" });

  return async (toolName, input, options) => {
    if (!shouldCheck("agentmail")) {
      if (toolName === "send_message") {
        if (offlineMessageQueue.length >= MAX_OFFLINE_QUEUE_SIZE) {
          offlineMessageQueue.shift();
        }
        const entry: QueuedAgentMailMessage = {
          id: `offline_${Date.now()}_${offlineMessageQueue.length + 1}`,
          input: (input as Record<string, unknown>) ?? {},
          queuedAt: new Date(),
        };
        offlineMessageQueue.push(entry);
        log.warn(
          { queueDepth: offlineMessageQueue.length, entryId: entry.id },
          "Agent Mail circuit OPEN — queued send_message for delivery on recovery",
        );
        return {
          deliveries: [],
          count: 0,
          queuedOffline: true,
          queueId: entry.id,
        };
      }

      if (toolName === "fetch_inbox") {
        log.debug("Agent Mail circuit OPEN — returning empty inbox fallback");
        return [];
      }

      throw new AgentMailClientError(
        "transport",
        "Agent Mail circuit breaker is OPEN (degraded mode)",
        { tool: toolName },
      );
    }

    try {
      const result = await rawCaller(toolName, input, options);
      recordSuccess("agentmail");

      if (offlineMessageQueue.length > 0 && !flushingOfflineQueue) {
        await flushAgentMailOfflineQueue(rawCaller);
      }

      return result;
    } catch (error) {
      recordFailure("agentmail");
      // If this was a send_message call and the circuit just opened (or transport failed),
      // queue it for later delivery if the caller opted into circuit breaker protection.
      if (toolName === "send_message" && !shouldCheck("agentmail")) {
        if (offlineMessageQueue.length >= MAX_OFFLINE_QUEUE_SIZE) {
          offlineMessageQueue.shift();
        }
        const entry: QueuedAgentMailMessage = {
          id: `offline_${Date.now()}_${offlineMessageQueue.length + 1}`,
          input: (input as Record<string, unknown>) ?? {},
          queuedAt: new Date(),
        };
        offlineMessageQueue.push(entry);
        log.warn(
          { queueDepth: offlineMessageQueue.length, entryId: entry.id },
          "Agent Mail circuit opened on failure — queued send_message for recovery",
        );
        return {
          deliveries: [],
          count: 0,
          queuedOffline: true,
          queueId: entry.id,
        };
      }
      throw error;
    }
  };
}

function parseArgs(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch (error) {
      // Create a temporary logger since we don't have the context logger yet
      const log = createChildLogger({ component: "agentmail-mcp-config" });
      log.warn(
        { error, value },
        "Failed to parse AGENT_MAIL_MCP_ARGS as JSON, falling back to empty args",
      );
      return [];
    }
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function getAgentMailConfigFromEnv(): McpAgentMailConfig | undefined {
  const enabled =
    process.env["AGENT_MAIL_MCP_ENABLED"] === "true" ||
    process.env["AGENT_MAIL_MCP_COMMAND"];

  if (!enabled) return undefined;

  const command = process.env["AGENT_MAIL_MCP_COMMAND"] ?? "mcp-agent-mail";
  const args = parseArgs(process.env["AGENT_MAIL_MCP_ARGS"] ?? "serve");
  const clientName =
    process.env["AGENT_MAIL_MCP_CLIENT_NAME"] ?? "flywheel-gateway";

  const envVersion =
    process.env["AGENT_MAIL_MCP_CLIENT_VERSION"] ??
    process.env["GATEWAY_VERSION"];

  if (!envVersion) {
    const log = createChildLogger({ component: "agentmail-mcp-config" });
    log.debug(
      "No client version specified in env (AGENT_MAIL_MCP_CLIENT_VERSION or GATEWAY_VERSION), using default 0.1.0",
    );
  }

  const clientVersion = envVersion ?? "0.1.0";

  return { command, args, clientName, clientVersion };
}

function normalizeToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  // We do NOT check isError here because if the tool failed, we want to return
  // the error details (which are in the content) to the agent so it can handle it.

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) {
    return result;
  }

  const first = content[0] as
    | { type?: string; text?: string; json?: unknown }
    | undefined;
  if (!first) return result;

  if (first.type === "json" && "json" in first) {
    return first.json;
  }

  if (first.type === "text" && typeof first.text === "string") {
    const text = first.text.trim();
    // Only attempt to parse if it looks like a JSON object or array
    if (
      (text.startsWith("{") && text.endsWith("}")) ||
      (text.startsWith("[") && text.endsWith("]"))
    ) {
      try {
        return JSON.parse(text);
      } catch {
        return first.text;
      }
    }
    return first.text;
  }

  return result;
}

export function createMcpAgentMailToolCaller(
  config: McpAgentMailConfig,
): AgentMailToolCaller {
  if (!config.command || config.command.trim() === "") {
    throw new Error(
      "Invalid Agent Mail configuration: command must be a non-empty string",
    );
  }

  const log = createChildLogger({
    component: "agentmail-mcp",
    command: config.command,
  });
  let clientPromise: Promise<Client> | null = null;

  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
        });
        const client = new Client({
          name: config.clientName,
          version: config.clientVersion,
        });
        await client.connect(transport);
        log.info({ args: config.args }, "Agent Mail MCP client connected");
        return client;
      })().catch((error) => {
        clientPromise = null;
        log.error({ error }, "Failed to connect Agent Mail MCP client");
        throw error;
      });
    }
    return clientPromise;
  };

  const rawCaller: AgentMailToolCaller = async (toolName, input, options) => {
    if (options?.signal?.aborted) {
      throw new AgentMailClientError("transport", "Tool call aborted", {
        tool: toolName,
      });
    }

    const client = await getClient();
    const start = performance.now();

    const callPromise = client.callTool({
      name: toolName,
      arguments: input as Record<string, unknown> | undefined,
    });

    const timeoutMs = options?.timeoutMs;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise =
      timeoutMs && timeoutMs > 0
        ? new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Tool call timed out")),
              timeoutMs,
            );
          })
        : null;

    const abortPromise = options?.signal
      ? new Promise((_, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("Tool call aborted")),
            {
              once: true,
            },
          );
        })
      : null;

    let result: unknown;
    try {
      result = (await Promise.race(
        [callPromise, timeoutPromise, abortPromise].filter(
          Boolean,
        ) as Promise<unknown>[],
      )) as unknown;
    } catch (error) {
      // Invalidate client on error to force reconnection next time
      clientPromise = null;
      log.error(
        { toolName, correlationId: options?.correlationId, error },
        "Agent Mail MCP tool call failed",
      );
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      log.debug(
        {
          toolName,
          correlationId: options?.correlationId,
          latencyMs: Math.round(performance.now() - start),
        },
        "Agent Mail MCP tool call completed",
      );
    }

    return normalizeToolResult(result);
  };

  return withAgentMailCircuitBreaker(rawCaller);
}

export function registerAgentMailToolCallerFromEnv(): boolean {
  const config = getAgentMailConfigFromEnv();
  if (!config) {
    return false;
  }

  registerGlobalToolCaller(
    "agentMailCallTool",
    createMcpAgentMailToolCaller(config),
  );

  return true;
}

export function registerGlobalToolCaller(
  _key: "agentMailCallTool",
  caller: AgentMailToolCaller,
): void {
  const globalAny = globalThis as {
    agentMailCallTool?: AgentMailToolCaller;
  };

  if (!globalAny.agentMailCallTool) {
    globalAny.agentMailCallTool = caller;
  }
}
