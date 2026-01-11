import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMailRoutes } from "../routes/mail";
import { createAgentMailService } from "../services/agentmail";
import { createReservationConflictEngine } from "../services/reservation-conflicts";

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

describe("mail routes - conflict engine integration", () => {
  function createTestAppWithConflictEngine() {
    const { service, calls } = createMockService();
    const conflictEngine = createReservationConflictEngine();
    const app = new Hono();
    app.route("/mail", createMailRoutes(service, conflictEngine));
    return { app, calls, conflictEngine };
  }

  test("POST /mail/reservations detects conflicts with exclusive reservations", async () => {
    const { app } = createTestAppWithConflictEngine();

    // First reservation should succeed
    const res1 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });
    expect(res1.status).toBe(201);

    // Second conflicting reservation should fail with 409
    const res2 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-2",
        patterns: ["src/index.ts"],
        exclusive: true,
      }),
    });
    expect(res2.status).toBe(409);

    const data = await res2.json();
    expect(data.error.code).toBe("RESERVATION_CONFLICT");
    expect(data.error.details.conflicts).toHaveLength(1);
    expect(data.error.details.conflicts[0].existingReservation.requesterId).toBe("agent-1");
  });

  test("POST /mail/reservations allows non-overlapping patterns", async () => {
    const { app } = createTestAppWithConflictEngine();

    const res1 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });
    expect(res1.status).toBe(201);

    // Different directory should not conflict
    const res2 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-2",
        patterns: ["tests/**/*.ts"],
        exclusive: true,
      }),
    });
    expect(res2.status).toBe(201);
  });

  test("POST /mail/reservations allows same agent to extend reservations", async () => {
    const { app } = createTestAppWithConflictEngine();

    const res1 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });
    expect(res1.status).toBe(201);

    // Same agent can extend to overlapping patterns
    const res2 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/index.ts"],
        exclusive: true,
      }),
    });
    expect(res2.status).toBe(201);
  });

  test("POST /mail/reservations allows shared access when neither is exclusive", async () => {
    const { app } = createTestAppWithConflictEngine();

    const res1 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: false,
      }),
    });
    expect(res1.status).toBe(201);

    // Non-exclusive can coexist with non-exclusive
    const res2 = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-2",
        patterns: ["src/index.ts"],
        exclusive: false,
      }),
    });
    expect(res2.status).toBe(201);
  });

  test("GET /mail/reservations lists active reservations", async () => {
    const { app } = createTestAppWithConflictEngine();

    // Create a reservation
    await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });

    // List reservations
    const res = await app.request("/mail/reservations?projectId=proj-1");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.object).toBe("list");
    expect(data.data).toHaveLength(1);
    expect(data.data[0].requesterId).toBe("agent-1");
    expect(data.data[0].patterns).toEqual(["src/**/*.ts"]);
    expect(data.data[0].exclusive).toBe(true);
  });

  test("GET /mail/reservations requires projectId", async () => {
    const { app } = createTestAppWithConflictEngine();
    const res = await app.request("/mail/reservations");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("MISSING_PARAMETERS");
  });

  test("GET /mail/reservations/conflicts checks potential conflicts", async () => {
    const { app } = createTestAppWithConflictEngine();

    // Create a reservation
    await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });

    // Check for conflicts before creating another
    const res = await app.request(
      "/mail/reservations/conflicts?projectId=proj-1&requesterId=agent-2&patterns=src/index.ts&exclusive=true",
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.object).toBe("conflict_check");
    expect(data.data.hasConflicts).toBe(true);
    expect(data.data.canProceed).toBe(false);
    expect(data.data.conflicts).toHaveLength(1);
  });

  test("GET /mail/reservations/conflicts shows no conflicts for non-overlapping", async () => {
    const { app } = createTestAppWithConflictEngine();

    // Create a reservation
    await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });

    // Check for non-overlapping patterns
    const res = await app.request(
      "/mail/reservations/conflicts?projectId=proj-1&requesterId=agent-2&patterns=tests/**/*.ts&exclusive=true",
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.data.hasConflicts).toBe(false);
    expect(data.data.canProceed).toBe(true);
    expect(data.data.conflicts).toHaveLength(0);
  });

  test("GET /mail/reservations/conflicts requires parameters", async () => {
    const { app } = createTestAppWithConflictEngine();
    const res = await app.request("/mail/reservations/conflicts");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("MISSING_PARAMETERS");
  });

  test("DELETE /mail/reservations/:id releases reservation", async () => {
    const { app, conflictEngine } = createTestAppWithConflictEngine();

    // Create a reservation
    const createRes = await app.request("/mail/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const reservationId = createData.data.reservationId;

    // Verify it's registered
    expect(conflictEngine.getActiveReservations("proj-1")).toHaveLength(1);

    // Delete it
    const deleteRes = await app.request(
      `/mail/reservations/${reservationId}?projectId=proj-1`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);

    const deleteData = await deleteRes.json();
    expect(deleteData.object).toBe("reservation");
    expect(deleteData.data.released).toBe(true);

    // Verify it's removed
    expect(conflictEngine.getActiveReservations("proj-1")).toHaveLength(0);
  });

  test("DELETE /mail/reservations/:id returns 404 for unknown id", async () => {
    const { app } = createTestAppWithConflictEngine();
    const res = await app.request(
      "/mail/reservations/unknown-id?projectId=proj-1",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });

  test("DELETE /mail/reservations/:id requires projectId", async () => {
    const { app } = createTestAppWithConflictEngine();
    const res = await app.request("/mail/reservations/res-1", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("MISSING_PARAMETERS");
  });
});
