/**
 * Unit tests for the Agent WebSocket Service.
 */

import { describe, expect, mock, test } from "bun:test";
import {
  createWSData,
  getConnectionCount,
  handleWSClose,
  handleWSMessage,
  handleWSOpen,
} from "../services/agent-ws";

interface MockWebSocket {
  data: ReturnType<typeof createWSData>;
  send: ReturnType<typeof mock>;
  sent: string[];
  close: ReturnType<typeof mock>;
}

// Mock WebSocket
function createMockWS(): MockWebSocket {
  const data = createWSData();
  const sent: string[] = [];
  return {
    data,
    send: mock((msg: string) => sent.push(msg)),
    sent,
    close: mock(() => {}),
  };
}

interface WSMessage {
  type: string;
  connectionId?: string;
  timestamp?: string;
  agentIds?: string[];
  message?: string;
}

// Helper to safely parse first message
function parseFirstMessage(ws: MockWebSocket): WSMessage {
  const msg = ws.sent[0];
  if (!msg) throw new Error("No message sent");
  return JSON.parse(msg) as WSMessage;
}

describe("Agent WebSocket Service", () => {
  describe("createWSData", () => {
    test("creates data with empty subscriptions", () => {
      const data = createWSData();
      expect(data.subscriptions).toBeInstanceOf(Set);
      expect(data.subscriptions.size).toBe(0);
    });

    test("generates unique connection IDs", () => {
      const data1 = createWSData();
      const data2 = createWSData();
      expect(data1.connectionId).not.toBe(data2.connectionId);
    });

    test("connection ID has expected format", () => {
      const data = createWSData();
      expect(data.connectionId).toMatch(/^ws_\d+_[a-z0-9]+$/);
    });
  });

  describe("handleWSOpen", () => {
    test("sends welcome message on open", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as Parameters<typeof handleWSOpen>[0]);

      expect(ws.sent.length).toBe(1);
      const message = parseFirstMessage(ws);
      expect(message.type).toBe("connected");
      expect(message.connectionId).toBe(ws.data.connectionId);
      expect(message.timestamp).toBeDefined();
    });

    test("increments connection count", () => {
      const initialCount = getConnectionCount();
      const ws = createMockWS();
      handleWSOpen(ws as unknown as Parameters<typeof handleWSOpen>[0]);
      expect(getConnectionCount()).toBe(initialCount + 1);
    });
  });

  describe("handleWSMessage", () => {
    type WSType = Parameters<typeof handleWSOpen>[0];
    type MsgType = Parameters<typeof handleWSMessage>[1];

    test("handles subscribe message", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.sent.length = 0; // Clear welcome message

      handleWSMessage(
        ws as unknown as WSType,
        JSON.stringify({
          type: "subscribe",
          agentId: "agent-123",
        }) as MsgType,
      );

      expect(ws.data.subscriptions.has("agent-123")).toBe(true);
      expect(ws.sent.length).toBe(1);
      const response = parseFirstMessage(ws);
      expect(response.type).toBe("subscribed");
      expect(response.agentIds).toContain("agent-123");
    });

    test("handles subscribe with multiple agents", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.sent.length = 0;

      handleWSMessage(
        ws as unknown as WSType,
        JSON.stringify({
          type: "subscribe",
          agentIds: ["agent-1", "agent-2", "agent-3"],
        }) as MsgType,
      );

      expect(ws.data.subscriptions.size).toBe(3);
      expect(ws.data.subscriptions.has("agent-1")).toBe(true);
      expect(ws.data.subscriptions.has("agent-2")).toBe(true);
      expect(ws.data.subscriptions.has("agent-3")).toBe(true);
    });

    test("handles unsubscribe message", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.data.subscriptions.add("agent-123");
      ws.sent.length = 0;

      handleWSMessage(
        ws as unknown as WSType,
        JSON.stringify({
          type: "unsubscribe",
          agentId: "agent-123",
        }) as MsgType,
      );

      expect(ws.data.subscriptions.has("agent-123")).toBe(false);
      const response = parseFirstMessage(ws);
      expect(response.type).toBe("unsubscribed");
    });

    test("handles subscribe_all message", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.data.subscriptions.add("agent-1");
      ws.data.subscriptions.add("agent-2");
      ws.sent.length = 0;

      handleWSMessage(
        ws as unknown as WSType,
        JSON.stringify({
          type: "subscribe_all",
        }) as MsgType,
      );

      expect(ws.data.subscriptions.size).toBe(0);
      const response = parseFirstMessage(ws);
      expect(response.type).toBe("subscribed_all");
    });

    test("handles ping message", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.sent.length = 0;

      handleWSMessage(
        ws as unknown as WSType,
        JSON.stringify({ type: "ping" }) as MsgType,
      );

      const response = parseFirstMessage(ws);
      expect(response.type).toBe("pong");
    });

    test("handles unknown message type", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.sent.length = 0;

      handleWSMessage(
        ws as unknown as WSType,
        JSON.stringify({ type: "unknown" }) as MsgType,
      );

      const response = parseFirstMessage(ws);
      expect(response.type).toBe("error");
      expect(response.message).toContain("Unknown message type");
    });

    test("handles invalid JSON", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.sent.length = 0;

      handleWSMessage(ws as unknown as WSType, "not valid json" as MsgType);

      const response = parseFirstMessage(ws);
      expect(response.type).toBe("error");
      expect(response.message).toBe("Invalid JSON message");
    });

    test("handles Buffer messages", () => {
      const ws = createMockWS();
      handleWSOpen(ws as unknown as WSType);
      ws.sent.length = 0;

      const buffer = Buffer.from(JSON.stringify({ type: "ping" }));
      handleWSMessage(ws as unknown as WSType, buffer as MsgType);

      const response = parseFirstMessage(ws);
      expect(response.type).toBe("pong");
    });
  });

  describe("handleWSClose", () => {
    test("decrements connection count on close", () => {
      const ws = createMockWS();
      type WSType = Parameters<typeof handleWSOpen>[0];
      handleWSOpen(ws as unknown as WSType);
      const countAfterOpen = getConnectionCount();

      handleWSClose(ws as unknown as WSType);
      expect(getConnectionCount()).toBe(countAfterOpen - 1);
    });
  });
});
