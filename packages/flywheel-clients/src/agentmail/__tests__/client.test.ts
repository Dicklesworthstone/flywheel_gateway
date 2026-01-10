import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  AgentMailClientError,
  createAgentMailClient,
  mapAgentMailError,
} from "../index";

type ToolCall = { tool: string; input: unknown };

function createMockCaller(resolver: (tool: string, input: unknown) => unknown) {
  const calls: ToolCall[] = [];
  const callTool = async (toolName: string, input: unknown) => {
    calls.push({ tool: toolName, input });
    return resolver(toolName, input);
  };
  return { callTool, calls };
}

describe("Agent Mail client", () => {
  test("ensureProject validates input and returns output", async () => {
    const { callTool, calls } = createMockCaller(() => ({
      projectId: "proj-1",
      created: true,
    }));
    const client = createAgentMailClient({ callTool });

    const result = await client.ensureProject({
      projectId: "proj-1",
      name: "Project One",
    });

    expect(result.projectId).toBe("proj-1");
    expect(result.created).toBe(true);
    expect(calls[0]?.tool).toBe("agentmail_ensure_project");
  });

  test("sendMessage applies default ttl and priority", async () => {
    const { callTool, calls } = createMockCaller(() => ({
      messageId: "msg-1",
      delivered: true,
    }));
    const client = createAgentMailClient({ callTool });

    await client.sendMessage({
      projectId: "proj-1",
      to: "agent-2",
      subject: "Hello",
      body: { ok: true },
    });

    const input = calls[0]?.input as { ttl?: number; priority?: string };
    expect(input.ttl).toBe(3600);
    expect(input.priority).toBe("normal");
  });

  test("fetchInbox accepts Date and serializes since", async () => {
    const { callTool, calls } = createMockCaller(() => ({
      messages: [],
      hasMore: false,
    }));
    const client = createAgentMailClient({ callTool });

    await client.fetchInbox({
      projectId: "proj-1",
      agentId: "agent-1",
      since: new Date("2025-01-01T00:00:00.000Z"),
    });

    const input = calls[0]?.input as { since?: unknown };
    expect(typeof input.since).toBe("string");
  });

  test("requestFileReservation applies default duration", async () => {
    const { callTool, calls } = createMockCaller(() => ({
      reservationId: "res-1",
      granted: true,
    }));
    const client = createAgentMailClient({
      callTool,
      defaultTtlSeconds: 1200,
    });

    await client.requestFileReservation({
      projectId: "proj-1",
      requesterId: "agent-1",
      patterns: ["src/**"],
      exclusive: true,
    });

    const input = calls[0]?.input as { duration?: number };
    expect(input.duration).toBe(1200);
  });

  test("throws validation error on bad response", async () => {
    const { callTool } = createMockCaller(() => ({}));
    const client = createAgentMailClient({ callTool });

    let thrown: unknown;
    try {
      await client.ensureProject({ projectId: "proj-1", name: "Test" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentMailClientError);
    expect((thrown as AgentMailClientError).kind).toBe("response_validation");
  });

  test("throws transport error when tool call fails", async () => {
    const { callTool } = createMockCaller(() => {
      throw new Error("network down");
    });
    const client = createAgentMailClient({ callTool });

    let thrown: unknown;
    try {
      await client.sendMessage({
        projectId: "proj-1",
        to: "agent-2",
        subject: "Hello",
        body: "hi",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentMailClientError);
    expect((thrown as AgentMailClientError).kind).toBe("transport");
  });

  test("maps agent mail errors to gateway errors", () => {
    const error = new AgentMailClientError("transport", "boom", {
      tool: "agentmail_send_message",
      cause: new Error("down"),
    });

    const mapped = mapAgentMailError(error);
    expect(mapped.code).toBe("SYSTEM_UNAVAILABLE");
    expect(mapped.details?.["tool"]).toBe("agentmail_send_message");
  });

  test("maps input validation errors into INVALID_REQUEST", () => {
    const result = z.string().min(2).safeParse("a");
    if (result.success) {
      throw new Error("Expected validation to fail");
    }

    const error = new AgentMailClientError("input_validation", "bad input", {
      tool: "agentmail_fetch_inbox",
      issues: result.error.issues,
    });

    const mapped = mapAgentMailError(error);
    expect(mapped.code).toBe("INVALID_REQUEST");
    expect(mapped.details?.["tool"]).toBe("agentmail_fetch_inbox");
  });

  test("maps response validation errors into SYSTEM_INTERNAL_ERROR", () => {
    const error = new AgentMailClientError(
      "response_validation",
      "bad output",
      {
        tool: "agentmail_register_agent",
      },
    );

    const mapped = mapAgentMailError(error);
    expect(mapped.code).toBe("SYSTEM_INTERNAL_ERROR");
    expect(mapped.details?.["tool"]).toBe("agentmail_register_agent");
  });

  test("startSession composes ensureProject and registerAgent", async () => {
    const { callTool, calls } = createMockCaller((tool) => {
      if (tool === "agentmail_ensure_project") {
        return { projectId: "proj-1", created: true };
      }
      if (tool === "agentmail_register_agent") {
        return { registered: true, mailboxId: "mb-1" };
      }
      return {};
    });
    const client = createAgentMailClient({ callTool });

    const result = await client.startSession({
      projectId: "proj-1",
      name: "Project One",
      agentId: "agent-1",
      capabilities: ["send"],
    });

    expect(calls.map((call) => call.tool)).toEqual([
      "agentmail_ensure_project",
      "agentmail_register_agent",
    ]);
    expect(result.project.projectId).toBe("proj-1");
    expect(result.registration.mailboxId).toBe("mb-1");
  });

  test("reservationCycle delegates to request_file_reservation", async () => {
    const { callTool, calls } = createMockCaller(() => ({
      reservationId: "res-2",
      granted: false,
      conflicts: ["src/**"],
    }));
    const client = createAgentMailClient({ callTool });

    const result = await client.reservationCycle({
      projectId: "proj-1",
      requesterId: "agent-1",
      patterns: ["src/**"],
      exclusive: true,
    });

    expect(calls[0]?.tool).toBe("agentmail_request_file_reservation");
    expect(result.granted).toBe(false);
    expect(result.conflicts).toEqual(["src/**"]);
  });

  test("healthCheck calls health tool", async () => {
    const { callTool, calls } = createMockCaller(() => ({
      status: "ok",
      timestamp: "2025-01-01T00:00:00.000Z",
    }));
    const client = createAgentMailClient({ callTool });

    const result = await client.healthCheck();

    expect(calls[0]?.tool).toBe("agentmail_health");
    expect(result.status).toBe("ok");
  });
});
