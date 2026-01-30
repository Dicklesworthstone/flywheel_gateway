/**
 * Tests for Collaboration Graph WebSocket subscription behavior.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useUiStore } from "../../stores/ui";
import { useGraphSubscription } from "../useCollabGraph";

// Wrap in try-catch to avoid errors when running with other test files that already registered
try {
  GlobalRegistrator.register();
} catch {
  // Already registered by another test file
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    // Intentionally do not invoke onclose automatically; the hook registers
    // reconnection timers on close, which we don't want in unit tests.
  }
}

const createWebSocket = (url: string) =>
  new MockWebSocket(url) as unknown as WebSocket;

function SubscriptionProbe({ workspaceId }: { workspaceId?: string }) {
  const subscriptionOptions =
    workspaceId === undefined
      ? {
          wsUrl: "ws://example.test/ws",
          __testCreateWebSocket: createWebSocket,
        }
      : {
          workspaceId,
          wsUrl: "ws://example.test/ws",
          __testCreateWebSocket: createWebSocket,
        };
  const { connected } = useGraphSubscription(subscriptionOptions);
  return (
    <div data-testid="connected">
      {connected ? "connected" : "disconnected"}
    </div>
  );
}

describe("useGraphSubscription", () => {
  beforeEach(() => {
    // Ensure mock mode is disabled for these tests
    useUiStore.getState().setMockMode(false);

    MockWebSocket.instances = [];
  });

  it("connects to /ws and subscribes to workspace channels", async () => {
    const { getByTestId, unmount } = render(<SubscriptionProbe />);

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;

    const url = new URL(ws.url);
    expect(url.protocol).toBe("ws:");
    expect(url.host).toBe("example.test");
    expect(url.pathname).toBe("/ws");
    expect(getByTestId("connected").textContent).toBe("disconnected");

    act(() => {
      ws.onopen?.();
    });

    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "subscribe",
      channel: "workspace:reservations:default",
    });
    expect(JSON.parse(ws.sent[1]!)).toEqual({
      type: "subscribe",
      channel: "workspace:conflicts:default",
    });

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "subscribed",
          channel: "workspace:reservations:default",
        }),
      });
    });

    expect(getByTestId("connected").textContent).toBe("connected");
    unmount();
  });

  it("uses workspaceId override when provided", () => {
    render(<SubscriptionProbe workspaceId="ws-123" />);

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.onopen?.();
    });

    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: "subscribe",
      channel: "workspace:reservations:ws-123",
    });
    expect(JSON.parse(ws.sent[1]!)).toEqual({
      type: "subscribe",
      channel: "workspace:conflicts:ws-123",
    });
  });
});
