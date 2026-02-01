/**
 * WebSocket behavior for maintenance/drain mode.
 *
 * Verifies:
 * - publishing a deterministic `system:maintenance` event
 * - closing active connections with stable close codes + reasons
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  _resetMaintenanceStateForTests,
  enterMaintenance,
  startDraining,
} from "../../services/maintenance.service";
import type { Channel } from "../channels";
import { type ConnectionData, setHub, WebSocketHub } from "../hub";
import type { ServerMessage } from "../messages";

function createMockWS(connectionId: string): {
  ws: ServerWebSocket<ConnectionData>;
  sent: string[];
  closed: Array<{ code: number; reason?: string }>;
} {
  const sent: string[] = [];
  const closed: Array<{ code: number; reason?: string }> = [];

  const data: ConnectionData = {
    connectionId,
    connectedAt: new Date(),
    auth: {
      workspaceIds: [],
      isAdmin: true,
    },
    subscriptions: new Map(),
    lastHeartbeat: new Date(),
    pendingAcks: new Map(),
    activeReplays: 0,
  };

  const ws = {
    data,
    send: mock((msg: string) => {
      sent.push(msg);
    }),
    close: mock((code?: number, reason?: string) => {
      if (typeof code === "number") {
        if (reason === undefined) {
          closed.push({ code });
          return;
        }
        closed.push({ code, reason });
      }
    }),
  } as unknown as ServerWebSocket<ConnectionData>;

  return { ws, sent, closed };
}

describe("maintenance WS behavior", () => {
  let hub: WebSocketHub;

  beforeEach(() => {
    _resetMaintenanceStateForTests();
    hub = new WebSocketHub();
    setHub(hub);
  });

  test("enterMaintenance publishes system:maintenance and closes sockets with 1013", () => {
    const { ws, sent, closed } = createMockWS("conn-1");
    hub.addConnection(ws, ws.data.auth);

    const channel: Channel = { type: "system:maintenance" };
    hub.subscribe("conn-1", channel);

    enterMaintenance({ reason: "deploy" });

    expect(sent.length).toBe(1);
    const parsed = JSON.parse(sent[0]!) as ServerMessage;
    expect(parsed.type).toBe("message");
    const msg = (parsed as { message: { channel: string; type: string } })
      .message;
    expect(msg.channel).toBe("system:maintenance");
    expect(msg.type).toBe("maintenance.state_changed");

    expect(closed).toEqual([{ code: 1013, reason: "maintenance" }]);
    expect(hub.getStats().activeConnections).toBe(0);
  });

  test("startDraining publishes system:maintenance and closes sockets with 1012", () => {
    const { ws, sent, closed } = createMockWS("conn-2");
    hub.addConnection(ws, ws.data.auth);

    const channel: Channel = { type: "system:maintenance" };
    hub.subscribe("conn-2", channel);

    startDraining({ deadlineSeconds: 30, reason: "shutdown" });

    expect(sent.length).toBe(1);
    const parsed = JSON.parse(sent[0]!) as ServerMessage;
    expect(parsed.type).toBe("message");
    const msg = (parsed as { message: { channel: string; type: string } })
      .message;
    expect(msg.channel).toBe("system:maintenance");
    expect(msg.type).toBe("maintenance.state_changed");

    expect(closed).toEqual([{ code: 1012, reason: "draining" }]);
    expect(hub.getStats().activeConnections).toBe(0);
  });
});
