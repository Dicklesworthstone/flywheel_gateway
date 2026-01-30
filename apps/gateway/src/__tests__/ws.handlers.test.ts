import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  createGuestAuthContext,
  createInternalAuthContext,
} from "../ws/authorization";
import { handleWSOpen } from "../ws/handlers";
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
});
