/**
 * Unit tests for WebSocket event loss telemetry (bd-2gkx.2).
 *
 * Tests ring buffer drop stats (capacity evictions, TTL expirations)
 * and verifies the telemetry is exposed through the buffer API.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { RingBuffer } from "../ws/ring-buffer";

describe("RingBuffer Drop Stats", () => {
  describe("capacity evictions", () => {
    test("tracks evictions when buffer overflows", () => {
      const buf = new RingBuffer<string>({ capacity: 3, ttlMs: 0 });

      buf.push("a");
      buf.push("b");
      buf.push("c");
      expect(buf.dropStats.capacityEvictions).toBe(0);

      buf.push("d"); // evicts "a"
      expect(buf.dropStats.capacityEvictions).toBe(1);
      expect(buf.dropStats.lastEvictionAt).not.toBeNull();

      buf.push("e"); // evicts "b"
      buf.push("f"); // evicts "c"
      expect(buf.dropStats.capacityEvictions).toBe(3);
    });

    test("no evictions when under capacity", () => {
      const buf = new RingBuffer<string>({ capacity: 100, ttlMs: 0 });

      buf.push("a");
      buf.push("b");
      buf.push("c");

      expect(buf.dropStats.capacityEvictions).toBe(0);
      expect(buf.dropStats.lastEvictionAt).toBeNull();
    });
  });

  describe("TTL expirations", () => {
    test("tracks expirations during prune", async () => {
      const buf = new RingBuffer<string>({ capacity: 100, ttlMs: 5 });

      buf.push("a");
      buf.push("b");

      // Wait for TTL to expire
      await Bun.sleep(10);

      const pruned = buf.prune();
      expect(pruned).toBe(2);
      expect(buf.dropStats.ttlExpirations).toBe(2);
      expect(buf.dropStats.lastExpirationAt).not.toBeNull();
    });

    test("no expirations when items are fresh", () => {
      const buf = new RingBuffer<string>({ capacity: 100, ttlMs: 60000 });

      buf.push("a");
      buf.push("b");

      const pruned = buf.prune();
      expect(pruned).toBe(0);
      expect(buf.dropStats.ttlExpirations).toBe(0);
    });

    test("no expirations when ttlMs is 0", () => {
      const buf = new RingBuffer<string>({ capacity: 100, ttlMs: 0 });

      buf.push("a");
      const pruned = buf.prune();
      expect(pruned).toBe(0);
      expect(buf.dropStats.ttlExpirations).toBe(0);
    });
  });

  describe("combined tracking", () => {
    test("tracks both evictions and expirations independently", async () => {
      const buf = new RingBuffer<string>({ capacity: 2, ttlMs: 5 });

      buf.push("a");
      buf.push("b");
      buf.push("c"); // evicts "a"
      expect(buf.dropStats.capacityEvictions).toBe(1);

      await Bun.sleep(10);
      buf.prune(); // expires "b" and "c"

      expect(buf.dropStats.capacityEvictions).toBe(1);
      expect(buf.dropStats.ttlExpirations).toBe(2);
    });
  });

  describe("drop stats are readonly", () => {
    test("dropStats returns consistent snapshot", () => {
      const buf = new RingBuffer<string>({ capacity: 1, ttlMs: 0 });

      buf.push("a");
      buf.push("b"); // evicts "a"

      const stats = buf.dropStats;
      expect(stats.capacityEvictions).toBe(1);
      expect(stats.ttlExpirations).toBe(0);
      expect(stats.lastEvictionAt).not.toBeNull();
      expect(stats.lastExpirationAt).toBeNull();
    });
  });
});

// ============================================================================
// Per-Connection Backpressure, Queue Limits & Replay Stress Tests (bd-3mnr9 / bd-u7j2f)
// ============================================================================

import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { ws as wsRoutes } from "../routes/ws";
import {
  type AuthContext,
  type ConnectionData,
  resetHub,
  setHub,
  WebSocketHub,
} from "../ws/hub";

function createControllableWs(connectionId: string): {
  ws: ServerWebSocket<ConnectionData>;
  delivered: string[];
  setBackpressured: (bp: boolean) => void;
  closedWith: { code?: number; reason?: string } | null;
} {
  const delivered: string[] = [];
  let isBackpressured = false;
  let closedWith: { code?: number; reason?: string } | null = null;

  const auth: AuthContext = {
    userId: "user-bp",
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
      if (isBackpressured) {
        return -1; // Simulate Bun socket backpressure
      }
      delivered.push(msg);
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
    delivered,
    setBackpressured(bp: boolean) {
      isBackpressured = bp;
    },
    get closedWith() {
      return closedWith;
    },
  };
}

describe("WebSocketHub Slow-Client Backpressure & Replay Stress Tests", () => {
  afterEach(() => {
    resetHub();
  });

  test("caps per-connection outbound queue under stress (drop-oldest) and recovers via replay", () => {
    const hub = new WebSocketHub({
      maxOutboundQueueSize: 5,
      overflowPolicy: "drop-oldest",
    });
    const client = createControllableWs("conn-slow-1");
    hub.addConnection(client.ws, client.ws.data.auth);
    hub.subscribe("conn-slow-1", { type: "agent:output", agentId: "agent-bp" });

    // Deliver 2 messages normally
    const msg1 = hub.publish(
      { type: "agent:output", agentId: "agent-bp" },
      "output.chunk",
      { seq: 1 },
    );
    const msg2 = hub.publish(
      { type: "agent:output", agentId: "agent-bp" },
      "output.chunk",
      { seq: 2 },
    );
    expect(client.delivered.length).toBe(2);

    // Client becomes slow (socket backpressured) while 20 more events are published
    client.setBackpressured(true);
    for (let seq = 3; seq <= 22; seq++) {
      hub.publish(
        { type: "agent:output", agentId: "agent-bp" },
        "output.chunk",
        { seq },
      );
      // Queue must NEVER exceed maxOutboundQueueSize (5)
      expect(hub.getOutboundQueueSize("conn-slow-1")).toBeLessThanOrEqual(5);
    }

    expect(hub.getOutboundQueueSize("conn-slow-1")).toBe(5);
    const stats = hub.getStats();
    // 20 backpressured events with max queue 5 => 15 dropped events
    expect(stats.eventLoss.droppedEvents).toBe(15);
    expect(stats.eventLoss.lastDropAt).not.toBeNull();

    // Reconnect from msg2.cursor recovers all 20 missed events (seq 3..22) from ring buffer!
    const clientReconnected = createControllableWs("conn-reconnect-1");
    hub.addConnection(clientReconnected.ws, clientReconnected.ws.data.auth);
    const ack = hub.handleReconnect("conn-reconnect-1", {
      "agent:output:agent-bp": msg2.cursor,
    });
    expect(ack.replayed["agent:output:agent-bp"]).toBe(20);
    expect(ack.expired).toEqual([]);
    expect(msg1.cursor).not.toBe(msg2.cursor);
  });

  test("supports drop-newest policy and drainConnection()", () => {
    const hub = new WebSocketHub({
      maxOutboundQueueSize: 3,
      overflowPolicy: "drop-newest",
    });
    const client = createControllableWs("conn-slow-newest");
    hub.addConnection(client.ws, client.ws.data.auth);
    hub.subscribe("conn-slow-newest", { type: "system:health" });

    client.setBackpressured(true);
    for (let seq = 1; seq <= 6; seq++) {
      hub.publish({ type: "system:health" }, "health.score", { seq });
    }

    expect(hub.getOutboundQueueSize("conn-slow-newest")).toBe(3);
    expect(hub.getStats().eventLoss.droppedEvents).toBe(3);

    // Clear backpressure and drain queued messages
    client.setBackpressured(false);
    const flushed = hub.drainConnection("conn-slow-newest");
    expect(flushed).toBe(3);
    expect(hub.getOutboundQueueSize("conn-slow-newest")).toBe(0);

    const seqs = client.delivered.map((raw) => {
      const parsed = JSON.parse(raw) as {
        message: { payload: { seq: number } };
      };
      return parsed.message.payload.seq;
    });
    // drop-newest retains the first 3 queued messages (1, 2, 3)
    expect(seqs).toEqual([1, 2, 3]);
  });

  test("disconnects slow client when disconnectOnSlowClient threshold is reached", () => {
    const hub = new WebSocketHub({
      maxOutboundQueueSize: 2,
      overflowPolicy: "drop-oldest",
      disconnectOnSlowClient: true,
      slowClientDropThreshold: 3,
    });
    const client = createControllableWs("conn-slow-disconnect");
    hub.addConnection(client.ws, client.ws.data.auth);
    hub.subscribe("conn-slow-disconnect", { type: "system:health" });

    client.setBackpressured(true);
    // 2 queued + 3 dropped => triggers disconnect on the 5th event
    for (let seq = 1; seq <= 5; seq++) {
      hub.publish({ type: "system:health" }, "health.score", { seq });
    }

    expect(client.closedWith).toEqual({
      code: 1008,
      reason: "slow_client_backpressure",
    });
    expect(hub.getStats().activeConnections).toBe(0);
    expect(hub.getStats().eventLoss.slowClientDisconnects).toBe(1);
    expect(hub.getStats().eventLoss.droppedEvents).toBe(3);
  });

  test("GET /ws/stats exposes hub eventLoss and eventLog statistics", async () => {
    const hub = new WebSocketHub({ maxOutboundQueueSize: 1 });
    setHub(hub);

    const app = new Hono().route("/ws", wsRoutes);
    const res = await app.request("/ws/stats");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        hub: {
          eventLoss: { droppedEvents: number; slowClientDisconnects: number };
        };
        eventLog: { totalEvents: number };
      };
    };
    expect(body.data.hub.eventLoss.droppedEvents).toBe(0);
    expect(body.data.hub.eventLoss.slowClientDisconnects).toBe(0);
    expect(typeof body.data.eventLog.totalEvents).toBe("number");
  });
});
