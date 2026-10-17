/**
 * Maintenance & Drain Mode Unit + Integration Tests (bd-38tzj / bd-1vdtm)
 *
 * Covers:
 * - ShutdownCoordinator state transitions, deadlines, and Retry-After calculation
 * - HTTP maintenanceMiddleware route guard (read-only allowed, mutating 503 + Retry-After)
 * - WebSocket system:maintenance broadcast and deterministic close codes (1013 / 1012)
 * - End-to-end API flow: POST /system/maintenance -> block POST /agents (503) -> exit maintenance
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { maintenanceMiddleware } from "../middleware/maintenance";
import { system } from "../routes/system";
import {
  _resetMaintenanceStateForTests,
  enterMaintenance,
  exitMaintenance,
  getMaintenanceSnapshot,
  getMaintenanceState,
  getRetryAfterSeconds,
  isMaintenanceActive,
  startDraining,
  trackHttpRequestEnd,
  trackHttpRequestStart,
} from "../services/maintenance.service";
import {
  type AuthContext,
  type ConnectionData,
  resetHub,
  setHub,
  WebSocketHub,
} from "../ws/hub";

function createMockWs(connectionId: string): {
  ws: ServerWebSocket<ConnectionData>;
  sentMessages: string[];
  closedWith: { code?: number; reason?: string } | null;
} {
  const sentMessages: string[] = [];
  let closedWith: { code?: number; reason?: string } | null = null;

  const auth: AuthContext = {
    userId: "user-1",
    workspaceIds: ["ws-1"],
    isAdmin: true,
  };

  const ws = {
    data: {
      connectionId,
      connectedAt: new Date(),
      auth,
      subscriptions: new Map(),
      lastHeartbeat: new Date(),
      pendingAcks: new Map(),
      activeReplays: 0,
    },
    send(msg: string) {
      sentMessages.push(msg);
      return msg.length;
    },
    close(code?: number, reason?: string) {
      closedWith = {
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
    },
  } as unknown as ServerWebSocket<ConnectionData>;

  return {
    ws,
    sentMessages,
    get closedWith() {
      return closedWith;
    },
  };
}

beforeEach(() => {
  _resetMaintenanceStateForTests();
  resetHub();
});

afterEach(() => {
  _resetMaintenanceStateForTests();
  resetHub();
});

describe("ShutdownCoordinator / maintenance.service unit tests", () => {
  test("starts in running mode with no deadline", () => {
    const state = getMaintenanceState();
    expect(state.mode).toBe("running");
    expect(state.startedAt).toBeNull();
    expect(state.deadlineAt).toBeNull();
    expect(isMaintenanceActive()).toBe(false);
    expect(getRetryAfterSeconds()).toBeNull();
  });

  test("transitions running -> maintenance -> running", () => {
    const entered = enterMaintenance({
      reason: "Database migration",
      actor: { userId: "admin-1" },
    });
    expect(entered.mode).toBe("maintenance");
    expect(entered.reason).toBe("Database migration");
    expect(entered.updatedBy?.userId).toBe("admin-1");
    expect(isMaintenanceActive()).toBe(true);

    exitMaintenance({ actor: { userId: "admin-1" } });
    const exited = getMaintenanceState();
    expect(exited.mode).toBe("running");
    expect(exited.reason).toBeNull();
    expect(isMaintenanceActive()).toBe(false);
  });

  test("transitions running -> draining with deadline and computes retryAfterSeconds", () => {
    const state = startDraining({
      deadlineSeconds: 30,
      reason: "Rolling deploy",
      actor: { actor: "sigterm" },
    });

    expect(state.mode).toBe("draining");
    expect(state.deadlineAt).not.toBeNull();
    expect(isMaintenanceActive()).toBe(true);

    const startedMs = state.startedAt!.getTime();
    expect(getRetryAfterSeconds(startedMs + 5_000)).toBe(25);
    expect(getRetryAfterSeconds(startedMs + 35_000)).toBe(0);
  });

  test("tracks in-flight HTTP requests and clamps negative values to 0", () => {
    trackHttpRequestStart();
    trackHttpRequestStart();
    expect(getMaintenanceSnapshot().http.inflightRequests).toBe(2);

    trackHttpRequestEnd();
    expect(getMaintenanceSnapshot().http.inflightRequests).toBe(1);

    trackHttpRequestEnd();
    trackHttpRequestEnd(); // extra end call should clamp to 0
    expect(getMaintenanceSnapshot().http.inflightRequests).toBe(0);
  });
});

describe("maintenanceMiddleware route guard", () => {
  function createGuardedApp() {
    const app = new Hono();
    app.use(
      "*",
      maintenanceMiddleware({ allowPaths: ["/health", "/system/*"] }),
    );
    app.get("/agents", (c) => c.json({ agents: [] }));
    app.post("/agents", (c) => c.json({ created: true }, 201));
    app.post("/health", (c) => c.json({ ok: true }));
    app.route("/system", system);
    return app;
  }

  test("allows GET and blocks POST with 503 MAINTENANCE_MODE when in maintenance", async () => {
    const app = createGuardedApp();
    enterMaintenance({ reason: "Scheduled upgrade" });

    const getRes = await app.request("/agents", { method: "GET" });
    expect(getRes.status).toBe(200);

    const postRes = await app.request("/agents", { method: "POST" });
    expect(postRes.status).toBe(503);
    const body = (await postRes.json()) as {
      error: { code: string; details: { mode: string } };
    };
    expect(body.error.code).toBe("MAINTENANCE_MODE");
    expect(body.error.details.mode).toBe("maintenance");
  });

  test("blocks POST with 503 DRAINING and sets Retry-After header when draining", async () => {
    const app = createGuardedApp();
    startDraining({ deadlineSeconds: 45, reason: "Pod eviction" });

    const postRes = await app.request("/agents", { method: "POST" });
    expect(postRes.status).toBe(503);
    const retryAfter = Number(postRes.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(45);

    const body = (await postRes.json()) as {
      error: {
        code: string;
        details: { mode: string; retryAfterSeconds: number };
      };
    };
    expect(body.error.code).toBe("DRAINING");
    expect(body.error.details.mode).toBe("draining");
  });
});

describe("WebSocket drain + system:maintenance integration", () => {
  test("entering maintenance broadcasts system:maintenance event and closes WS with 1013", () => {
    const hub = new WebSocketHub();
    setHub(hub);

    const mock = createMockWs("conn-maint-1");
    hub.addConnection(mock.ws, mock.ws.data.auth);
    hub.subscribe("conn-maint-1", { type: "system:maintenance" });

    enterMaintenance({ reason: "Upgrading schema" });

    expect(mock.sentMessages.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse(mock.sentMessages[0]!) as {
      type: string;
      message: { type: string; payload: { mode: string; reason: string } };
    };
    expect(event.message.type).toBe("maintenance.state_changed");
    expect(event.message.payload.mode).toBe("maintenance");
    expect(event.message.payload.reason).toBe("Upgrading schema");

    expect(mock.closedWith).toEqual({ code: 1013, reason: "maintenance" });
    expect(hub.getStats().activeConnections).toBe(0);
  });

  test("POST /system/maintenance enters drain mode, closes WS with 1012, blocks agent spawn, and recovers on disable", async () => {
    const hub = new WebSocketHub();
    setHub(hub);

    const mock = createMockWs("conn-drain-1");
    hub.addConnection(mock.ws, mock.ws.data.auth);
    hub.subscribe("conn-drain-1", { type: "system:maintenance" });

    const app = new Hono();
    app.use("*", maintenanceMiddleware({ allowPaths: ["/system/*"] }));
    app.route("/system", system);
    app.post("/agents", (c) => c.json({ id: "agent_1" }, 201));

    // 1. Enable drain mode via API
    const enableRes = await app.request("/system/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        deadlineSeconds: 60,
        reason: "Canary rollout",
      }),
    });
    expect(enableRes.status).toBe(200);
    const enableBody = (await enableRes.json()) as {
      data: { mode: string; retryAfterSeconds: number; reason: string };
    };
    expect(enableBody.data.mode).toBe("draining");
    expect(enableBody.data.reason).toBe("Canary rollout");
    expect(mock.closedWith).toEqual({ code: 1012, reason: "draining" });

    // 2. Attempt to spawn agent while draining -> 503
    const spawnBlocked = await app.request("/agents", { method: "POST" });
    expect(spawnBlocked.status).toBe(503);

    // 3. Disable maintenance via API -> 200
    const disableRes = await app.request("/system/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disableRes.status).toBe(200);

    // 4. Spawn agent succeeds -> 201
    const spawnOk = await app.request("/agents", { method: "POST" });
    expect(spawnOk.status).toBe(201);
  });
});
