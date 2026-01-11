/**
 * Integration tests for WebSocket Ack Mode.
 *
 * Tests the acknowledgment workflow for critical topic channels:
 * - workspace:conflicts
 * - workspace:reservations
 * - user:notifications
 *
 * These channels require explicit acknowledgment and will replay
 * unacknowledged messages on reconnection.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  type ConnectionData,
  setHub,
  WebSocketHub,
} from "../hub";
import type { Channel } from "../channels";
import type { ServerMessage } from "../messages";

// Helper to create mock WebSocket
function createMockWS(connectionId: string): {
  ws: ServerWebSocket<ConnectionData>;
  sent: string[];
  data: ConnectionData;
} {
  const data: ConnectionData = {
    connectionId,
    connectedAt: new Date(),
    auth: {
      workspaceIds: ["workspace-1"],
      isAdmin: false,
    },
    subscriptions: new Map(),
    lastHeartbeat: new Date(),
    pendingAcks: new Map(),
  };

  const sent: string[] = [];
  const ws = {
    data,
    send: mock((msg: string) => {
      sent.push(msg);
    }),
    close: mock(() => {}),
  } as unknown as ServerWebSocket<ConnectionData>;

  return { ws, sent, data };
}

describe("WebSocket Ack Mode", () => {
  let hub: WebSocketHub;

  beforeEach(() => {
    hub = new WebSocketHub();
    setHub(hub);
  });

  describe("Ack-Required Channels", () => {
    test("messages on workspace:conflicts require ack", () => {
      const { ws, sent } = createMockWS("conn-1");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-1", channel);

      const message = hub.publish(channel, "conflict.detected", { fileId: "file-1" });

      // Should have sent one message
      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]!) as ServerMessage;
      expect(parsed.type).toBe("message");
      expect((parsed as { ackRequired?: boolean }).ackRequired).toBe(true);

      // Should be tracked in pending acks
      const pending = hub.getPendingAcks("conn-1");
      expect(pending.length).toBe(1);
      expect(pending[0]!.message.id).toBe(message.id);
    });

    test("messages on workspace:reservations require ack", () => {
      const { ws, sent } = createMockWS("conn-2");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:reservations", workspaceId: "workspace-1" };
      hub.subscribe("conn-2", channel);

      hub.publish(channel, "reservation.acquired", { path: "/src/file.ts" });

      const parsed = JSON.parse(sent[0]!) as ServerMessage;
      expect((parsed as { ackRequired?: boolean }).ackRequired).toBe(true);
    });

    test("messages on user:notifications require ack", () => {
      const { ws, sent } = createMockWS("conn-3");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "user:notifications", userId: "user-1" };
      hub.subscribe("conn-3", channel);

      hub.publish(channel, "mail.received", { subject: "Test" });

      const parsed = JSON.parse(sent[0]!) as ServerMessage;
      expect((parsed as { ackRequired?: boolean }).ackRequired).toBe(true);
    });

    test("messages on agent:output do NOT require ack", () => {
      const { ws, sent } = createMockWS("conn-4");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "agent:output", agentId: "agent-1" };
      hub.subscribe("conn-4", channel);

      hub.publish(channel, "output.chunk", { text: "Hello" });

      const parsed = JSON.parse(sent[0]!) as ServerMessage;
      expect((parsed as { ackRequired?: boolean }).ackRequired).toBeUndefined();

      // Should NOT be tracked in pending acks
      const pending = hub.getPendingAcks("conn-4");
      expect(pending.length).toBe(0);
    });
  });

  describe("handleAck", () => {
    test("acknowledges pending messages", () => {
      const { ws } = createMockWS("conn-5");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-5", channel);

      const msg1 = hub.publish(channel, "conflict.detected", { fileId: "file-1" });
      const msg2 = hub.publish(channel, "conflict.resolved", { fileId: "file-1" });

      // Both should be pending
      expect(hub.getPendingAcks("conn-5").length).toBe(2);

      // Acknowledge first message
      const result = hub.handleAck("conn-5", [msg1.id]);
      expect(result.acknowledged).toEqual([msg1.id]);
      expect(result.notFound).toEqual([]);

      // Only second message should be pending now
      const pending = hub.getPendingAcks("conn-5");
      expect(pending.length).toBe(1);
      expect(pending[0]!.message.id).toBe(msg2.id);
    });

    test("reports not found for unknown message IDs", () => {
      const { ws } = createMockWS("conn-6");
      hub.addConnection(ws, ws.data.auth);

      const result = hub.handleAck("conn-6", ["unknown-1", "unknown-2"]);
      expect(result.acknowledged).toEqual([]);
      expect(result.notFound).toEqual(["unknown-1", "unknown-2"]);
    });

    test("handles mixed known and unknown IDs", () => {
      const { ws } = createMockWS("conn-7");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-7", channel);

      const msg = hub.publish(channel, "conflict.detected", { fileId: "file-1" });

      const result = hub.handleAck("conn-7", [msg.id, "unknown-1"]);
      expect(result.acknowledged).toEqual([msg.id]);
      expect(result.notFound).toEqual(["unknown-1"]);
    });

    test("returns all not found for unknown connection", () => {
      const result = hub.handleAck("unknown-conn", ["msg-1", "msg-2"]);
      expect(result.acknowledged).toEqual([]);
      expect(result.notFound).toEqual(["msg-1", "msg-2"]);
    });
  });

  describe("replayPendingAcks", () => {
    test("replays all pending ack messages", () => {
      const { ws, sent } = createMockWS("conn-8");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-8", channel);

      hub.publish(channel, "conflict.detected", { fileId: "file-1" });
      hub.publish(channel, "conflict.escalated", { fileId: "file-1" });

      // Clear sent messages to isolate replay
      sent.length = 0;

      // Replay pending
      const replayed = hub.replayPendingAcks("conn-8");
      expect(replayed).toBe(2);

      // Should have sent 2 replay messages
      expect(sent.length).toBe(2);

      // All should have ackRequired flag
      for (const msgStr of sent) {
        const parsed = JSON.parse(msgStr) as ServerMessage;
        expect((parsed as { ackRequired?: boolean }).ackRequired).toBe(true);
      }
    });

    test("increments replay count", () => {
      const { ws } = createMockWS("conn-9");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-9", channel);

      hub.publish(channel, "conflict.detected", { fileId: "file-1" });

      // First replay
      hub.replayPendingAcks("conn-9");
      let pending = hub.getPendingAcks("conn-9");
      expect(pending[0]!.replayCount).toBe(1);

      // Second replay
      hub.replayPendingAcks("conn-9");
      pending = hub.getPendingAcks("conn-9");
      expect(pending[0]!.replayCount).toBe(2);
    });

    test("returns 0 for unknown connection", () => {
      const replayed = hub.replayPendingAcks("unknown-conn");
      expect(replayed).toBe(0);
    });
  });

  describe("handleReconnect with Ack Mode", () => {
    test("replays pending acks after reconnection", () => {
      const { ws, sent } = createMockWS("conn-10");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-10", channel);

      // Publish message that requires ack
      const msg = hub.publish(channel, "conflict.detected", { fileId: "file-1" });

      // Clear sent to simulate reconnection
      sent.length = 0;

      // Simulate reconnection with cursor
      const result = hub.handleReconnect("conn-10", {
        "workspace:conflicts:workspace-1": msg.cursor,
      });

      // Should indicate pending acks were replayed
      expect(result.pendingAcksReplayed).toBe(1);
    });

    test("tracks new messages on reconnect as pending acks", () => {
      const { ws, sent } = createMockWS("conn-11");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      const channelStr = "workspace:conflicts:workspace-1";

      // First, publish a message without the connection subscribed
      hub.publish(channel, "conflict.detected", { fileId: "file-1" });

      // Now subscribe and reconnect with old cursor (from beginning)
      hub.subscribe("conn-11", channel);

      // Clear initial messages
      sent.length = 0;

      // Reconnect should replay missed messages and track as pending
      hub.handleReconnect("conn-11", {
        [channelStr]: "0", // Start from beginning
      });

      // The reconnect should have tracked the replayed messages as pending acks
      const pending = hub.getPendingAcks("conn-11");
      expect(pending.length).toBeGreaterThan(0);
    });
  });

  describe("getConnection pendingAckCount", () => {
    test("includes pending ack count in connection handle", () => {
      const { ws } = createMockWS("conn-12");
      hub.addConnection(ws, ws.data.auth);

      const channel: Channel = { type: "workspace:conflicts", workspaceId: "workspace-1" };
      hub.subscribe("conn-12", channel);

      // Initially no pending acks
      let handle = hub.getConnection("conn-12");
      expect(handle?.pendingAckCount).toBe(0);

      // Publish messages
      hub.publish(channel, "conflict.detected", { fileId: "file-1" });
      hub.publish(channel, "conflict.resolved", { fileId: "file-1" });

      // Should have 2 pending acks
      handle = hub.getConnection("conn-12");
      expect(handle?.pendingAckCount).toBe(2);

      // Acknowledge one
      const pending = hub.getPendingAcks("conn-12");
      hub.handleAck("conn-12", [pending[0]!.message.id]);

      // Should have 1 pending ack
      handle = hub.getConnection("conn-12");
      expect(handle?.pendingAckCount).toBe(1);
    });
  });
});
