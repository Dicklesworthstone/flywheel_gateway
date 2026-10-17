import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  createGuestAuthContext,
  createInternalAuthContext,
} from "../ws/authorization";
import type { Channel } from "../ws/channels";
import { handleWSMessage, handleWSOpen } from "../ws/handlers";
import { type ConnectionData, setHub, WebSocketHub } from "../ws/hub";

function createMockWs(
  auth: ConnectionData["auth"],
  initialSubscriptions: Array<[string, string | undefined]>,
): ServerWebSocket<ConnectionData> {
  return {
    data: {
      connectionId: "ws_test",
      connectedAt: new Date(),
      auth,
      subscriptions: new Map(initialSubscriptions),
      lastHeartbeat: new Date(),
      pendingAcks: new Map(),
    },
    send: mock(() => {}),
    close: mock(() => {}),
  } as unknown as ServerWebSocket<ConnectionData>;
}

describe("ws/handlers handleWSOpen", () => {
  beforeEach(() => {
    setHub(new WebSocketHub());
  });

  test("clears denied initial subscriptions so connection state is consistent", () => {
    const ws = createMockWs(createGuestAuthContext(), [
      ["agent:output:agent-1", "cursor_1"],
    ]);

    handleWSOpen(ws);

    // Guest connections cannot subscribe, so initial subscriptions should be dropped.
    expect(ws.data.subscriptions.size).toBe(0);
  });

  test("re-applies allowed initial subscriptions (admin) and preserves cursor", () => {
    const ws = createMockWs(createInternalAuthContext(), [
      ["agent:output:agent-1", "cursor_1"],
    ]);

    handleWSOpen(ws);

    expect(ws.data.subscriptions.get("agent:output:agent-1")).toBe("cursor_1");
  });

  test("advances stored cursor when subscribing with backfill cursor", () => {
    const hub = new WebSocketHub();
    setHub(hub);

    const ws = createMockWs(createInternalAuthContext(), []);
    handleWSOpen(ws);

    const channel: Channel = { type: "agent:output", agentId: "agent-1" };
    hub.publish(channel, "output.chunk", { text: "a" });
    const last = hub.publish(channel, "output.chunk", { text: "b" });

    handleWSMessage(
      ws,
      JSON.stringify({
        type: "subscribe",
        channel: "agent:output:agent-1",
        cursor: "0",
      }),
    );

    expect(ws.data.subscriptions.get("agent:output:agent-1")).toBe(last.cursor);
  });

  test("advances stored cursor when backfilling on a subscribed channel", () => {
    const hub = new WebSocketHub();
    setHub(hub);

    const ws = createMockWs(createInternalAuthContext(), []);
    handleWSOpen(ws);

    const channel: Channel = { type: "agent:output", agentId: "agent-1" };
    hub.publish(channel, "output.chunk", { text: "a" });
    const last = hub.publish(channel, "output.chunk", { text: "b" });

    handleWSMessage(
      ws,
      JSON.stringify({
        type: "subscribe",
        channel: "agent:output:agent-1",
      }),
    );

    // Subscribe without a cursor does not advance server-side cursors by itself.
    expect(ws.data.subscriptions.has("agent:output:agent-1")).toBe(true);
    expect(ws.data.subscriptions.get("agent:output:agent-1")).toBeUndefined();

    handleWSMessage(
      ws,
      JSON.stringify({
        type: "backfill",
        channel: "agent:output:agent-1",
        fromCursor: "0",
        limit: 100,
      }),
    );

    // Backfill should advance cursors to reflect delivered history.
    expect(ws.data.subscriptions.get("agent:output:agent-1")).toBe(last.cursor);
  });
});
