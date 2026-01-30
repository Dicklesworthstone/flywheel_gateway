/**
 * Tests for Collaboration Graph WebSocket subscription behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

function SubscriptionProbe({ workspaceId }: { workspaceId?: string }) {
  const subscriptionOptions = workspaceId === undefined ? {} : { workspaceId };
  const { connected } = useGraphSubscription(subscriptionOptions);
  return (
    <div data-testid="connected">
      {connected ? "connected" : "disconnected"}
    </div>
  );
}

describe("useGraphSubscription", () => {
  let originalWebSocket: typeof WebSocket;
  let originalLocation: Location;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    originalLocation = window.location;

    // Ensure deterministic location.host/protocol for URL assertions
    Object.defineProperty(window, "location", {
      value: new URL("http://example.test/") as unknown as Location,
      writable: true,
      configurable: true,
    });

    // Ensure mock mode is disabled for these tests
    useUiStore.getState().setMockMode(false);

    // Install WebSocket mock
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("connects to /ws and subscribes to workspace channels", async () => {
    const { getByTestId, unmount } = render(<SubscriptionProbe />);

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;

    expect(ws.url).toBe("ws://example.test/ws");
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
