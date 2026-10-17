import { afterEach, describe, expect, it } from "bun:test";
import type { AgentMailToolCaller } from "@flywheel/flywheel-clients";
import { createAgentMailServiceFromEnv } from "../services/agentmail";

type ToolCall = { tool: string; input: unknown };

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function clearEnv(key: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  delete process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
}

function setGlobalAgentMailToolCaller(
  callTool: AgentMailToolCaller,
): () => void {
  const globalAny = globalThis as {
    agentMailCallTool?: AgentMailToolCaller;
  };
  const previous = globalAny.agentMailCallTool;
  globalAny.agentMailCallTool = callTool;
  return () => {
    if (previous === undefined) delete globalAny.agentMailCallTool;
    else globalAny.agentMailCallTool = previous;
  };
}

afterEach(() => {
  restoreEnv();
});

describe("createAgentMailServiceFromEnv", () => {
  it("falls back to the client default TTL when AGENT_MAIL_DEFAULT_TTL_SECONDS is invalid", async () => {
    const calls: ToolCall[] = [];
    const restoreGlobal = setGlobalAgentMailToolCaller((async (
      tool: string,
      input: unknown,
    ) => {
      calls.push({ tool, input });
      return { messageId: "msg-1", delivered: true };
    }) satisfies AgentMailToolCaller);

    try {
      clearEnv("AGENT_MAIL_TOOL_PREFIX");
      setEnv("AGENT_MAIL_DEFAULT_TTL_SECONDS", "not-a-number");

      const service = createAgentMailServiceFromEnv();
      await service.client.sendMessage({
        projectId: "proj-1",
        to: "agent-1",
        subject: "Hello",
        body: "hi",
      });
    } finally {
      restoreGlobal();
    }

    expect(calls[0]?.tool).toBe("agentmail_send_message");
    const input = calls[0]?.input as { ttl?: number } | undefined;
    expect(input?.ttl).toBe(3600);
  });

  it("falls back to the client default TTL when AGENT_MAIL_DEFAULT_TTL_SECONDS is non-positive", async () => {
    const calls: ToolCall[] = [];
    const restoreGlobal = setGlobalAgentMailToolCaller((async (
      tool: string,
      input: unknown,
    ) => {
      calls.push({ tool, input });
      return { messageId: "msg-1", delivered: true };
    }) satisfies AgentMailToolCaller);

    try {
      clearEnv("AGENT_MAIL_TOOL_PREFIX");
      setEnv("AGENT_MAIL_DEFAULT_TTL_SECONDS", "0");

      const service = createAgentMailServiceFromEnv();
      await service.client.sendMessage({
        projectId: "proj-1",
        to: "agent-1",
        subject: "Hello",
        body: "hi",
      });
    } finally {
      restoreGlobal();
    }

    const input = calls[0]?.input as { ttl?: number } | undefined;
    expect(input?.ttl).toBe(3600);
  });

  it("uses AGENT_MAIL_DEFAULT_TTL_SECONDS when it is a positive integer", async () => {
    const calls: ToolCall[] = [];
    const restoreGlobal = setGlobalAgentMailToolCaller((async (
      tool: string,
      input: unknown,
    ) => {
      calls.push({ tool, input });
      return { messageId: "msg-1", delivered: true };
    }) satisfies AgentMailToolCaller);

    try {
      clearEnv("AGENT_MAIL_TOOL_PREFIX");
      setEnv("AGENT_MAIL_DEFAULT_TTL_SECONDS", "1200");

      const service = createAgentMailServiceFromEnv();
      await service.client.sendMessage({
        projectId: "proj-1",
        to: "agent-1",
        subject: "Hello",
        body: "hi",
      });
    } finally {
      restoreGlobal();
    }

    const input = calls[0]?.input as { ttl?: number } | undefined;
    expect(input?.ttl).toBe(1200);
  });
});
