/**
 * Tests for WebSocketProvider stale callback guards.
 *
 * Regression: bd-26wr9 — ensure callbacks from a replaced WebSocket instance
 * (e.g. late onopen) do not mutate provider state or interfere with the
 * active connection.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useUiStore } from "../../stores/ui";
import { useWebSocket, WebSocketProvider } from "../websocket-context";

// Wrap in try-catch to avoid errors when running with other test files that already registered
try {
  GlobalRegistrator.register();
} catch {
  // Already registered by another test file
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    // Intentionally do not invoke onclose automatically; the provider registers
    // reconnection timers on close, which we don't want in unit tests.
    this.readyState = MockWebSocket.CLOSED;
  }
}

describe("WebSocketProvider", () => {
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

  it("ignores stale onopen callbacks after reconnect", () => {
    let api: ReturnType<typeof useWebSocket> | null = null;

    function Probe() {
      api = useWebSocket();
      return <div data-testid="state">{api.status.state}</div>;
    }

    const { getByTestId, unmount } = render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>,
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws1 = MockWebSocket.instances[0]!;

    act(() => {
      api?.reconnect();
    });

    expect(getByTestId("state").textContent).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances[1]!;

    // Stale socket opens late; should not flip provider state to connected.
    ws1.readyState = MockWebSocket.OPEN;
    act(() => {
      ws1.onopen?.();
    });
    expect(getByTestId("state").textContent).toBe("connecting");

    // Active socket opens; should connect and be used for sends.
    ws2.readyState = MockWebSocket.OPEN;
    act(() => {
      ws2.onopen?.();
    });
    expect(getByTestId("state").textContent).toBe("connected");

    act(() => {
      api?.send({ type: "ping" });
    });

    expect(ws2.sent.map((m) => JSON.parse(m))).toContainEqual({ type: "ping" });
    unmount();
  });
});

