import {
  AgentMailClientError,
  type AgentMailToolCaller,
} from "@flywheel/flywheel-clients";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createChildLogger } from "./logger";

export interface McpAgentMailConfig {
  command: string;
  args: string[];
  clientName: string;
  clientVersion: string;
}

function parseArgs(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
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
  const clientVersion =
    process.env["AGENT_MAIL_MCP_CLIENT_VERSION"] ??
    process.env["GATEWAY_VERSION"] ??
    "0.1.0";

  return { command, args, clientName, clientVersion };
}

function normalizeToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  if (
    "isError" in result &&
    typeof (result as { isError?: unknown }).isError === "boolean" &&
    (result as { isError?: boolean }).isError
  ) {
    throw new Error("MCP tool returned error");
  }

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
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }

  return result;
}

export function createMcpAgentMailToolCaller(
  config: McpAgentMailConfig,
): AgentMailToolCaller {
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

  return async (toolName, input, options) => {
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
    const timeoutPromise =
      timeoutMs && timeoutMs > 0
        ? new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Tool call timed out")),
              timeoutMs,
            ),
          )
        : null;

    const abortPromise = options?.signal
      ? new Promise((_, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("Tool call aborted")),
            { once: true },
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
  key: "agentMailCallTool",
  caller: AgentMailToolCaller,
): void {
  const globalAny = globalThis as {
    agentMailCallTool?: AgentMailToolCaller;
  };

  if (!globalAny.agentMailCallTool) {
    globalAny.agentMailCallTool = caller;
  }
}
