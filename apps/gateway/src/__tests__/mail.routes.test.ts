import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMailRoutes } from "../routes/mail";
import { createAgentMailService } from "../services/agentmail";

type ToolCall = { tool: string; input: unknown };

function createMockService() {
  const calls: ToolCall[] = [];
  const callTool = async (tool: string, input: unknown) => {
    calls.push({ tool, input });
    switch (tool) {
      case "agentmail_ensure_project":
        return { projectId: "proj-1", created: true };
      case "agentmail_register_agent":
        return { registered: true, mailboxId: "mb-1" };
      case "agentmail_send_message":
        return { messageId: "msg-1", delivered: true };
      case "agentmail_reply":
        return { replyId: "reply-1", delivered: true };
      case "agentmail_fetch_inbox":
        return { messages: [], hasMore: false };
      case "agentmail_request_file_reservation":
        return { reservationId: "res-1", granted: true };
      case "agentmail_health":
        return { status: "ok", timestamp: "2025-01-01T00:00:00.000Z" };
      default:
        throw new Error(`Unexpected tool: ${tool}`);
    }
  };

  return {
    calls,
    service: createAgentMailService({ callTool }),
  };
}

function createTestApp() {
  const { service, calls } = createMockService();
  const app = new Hono();
  app.route("/mail", createMailRoutes(service));
  return { app, calls };
}

describe("mail routes", () => {
  test("POST /mail/projects creates project", async () => {
    const { app } = createTestApp();
    const res = await app.request("/mail/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "proj-1", name: "Project One" }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("project");
    expect(data.data.projectId).toBe("proj-1");
    expect(data.data.created).toBe(true);
    expect(data.requestId).toBeDefined();
  });

  test("POST /mail/messages sends message", async () => {
    const { app, calls } = createTestApp();
    const res = await app.request("/mail/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        to: "agent-2",
        subject: "Hello",
        body: { ok: true },
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("message");
    expect(data.data.messageId).toBe("msg-1");
    expect(data.requestId).toBeDefined();
    expect(calls[0]?.tool).toBe("agentmail_send_message");
  });

  test("GET /mail/messages/inbox returns inbox", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      "/mail/messages/inbox?projectId=proj-1&agentId=agent-1",
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format - list response
    expect(data.object).toBe("list");
    // The result contains the inbox object(s), not raw messages
    expect(data.data).toEqual([{ messages: [], hasMore: false }]);
    expect(data.requestId).toBeDefined();
  });

  test("POST /mail/reservations requests reservations", async () => {
    const { app } = createTestApp();
    const res = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**"],
        exclusive: true,
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("reservation");
    expect(data.data.reservationId).toBe("res-1");
    expect(data.requestId).toBeDefined();
  });

  test("POST /mail/sessions composes ensure/register", async () => {
    const { app, calls } = createTestApp();
    const res = await app.request("/mail/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        name: "Project One",
        agentId: "agent-1",
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("session");
    expect(data.data.project.projectId).toBe("proj-1");
    expect(data.data.agent.mailboxId).toBe("mb-1");
    expect(data.requestId).toBeDefined();
    expect(calls.map((call) => call.tool)).toEqual([
      "agentmail_ensure_project",
      "agentmail_register_agent",
    ]);
  });

  test("GET /mail/health proxies to MCP health tool", async () => {
    const { app, calls } = createTestApp();
    const res = await app.request("/mail/health?probe=liveness");

    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("health");
    expect(data.data.status).toBe("ok");
    expect(data.requestId).toBeDefined();
    expect(calls[0]?.tool).toBe("agentmail_health");
  });

  test("transport errors map to SYSTEM_UNAVAILABLE", async () => {
    const callTool = async () => {
      throw new Error("down");
    };
    const service = createAgentMailService({ callTool });
    const app = new Hono();
    app.route("/mail", createMailRoutes(service));

    const res = await app.request("/mail/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        to: "agent-2",
        subject: "Hello",
        body: "hi",
      }),
    });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
  });

  test("invalid request payload returns 400", async () => {
    const { app } = createTestApp();
    const res = await app.request("/mail/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        to: "agent-2",
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("VALIDATION_FAILED");
  });
});
