/**
 * WebSocket Client with Automatic Reconnection
 *
 * Features:
 * - Exponential backoff with jitter for reconnection
 * - Max retry threshold with manual reconnect option
 * - Status events emitted for UI feedback
 * - Structured logging for debugging
 */

import {
  type BackoffConfig,
  type ConnectionStatus,
  calculateBackoff,
  createInitialStatus,
  DEFAULT_BACKOFF_CONFIG,
  getStatusHint,
  shouldRetry,
} from "./reconnect";

export interface WebSocketClientConfig {
  /** WebSocket server URL */
  url: string;
  /** Reconnection backoff configuration */
  backoff?: Partial<BackoffConfig>;
  /** Protocols to use (optional) */
  protocols?: string | string[];
  /** Enable debug logging */
  debug?: boolean;
}

export type WebSocketClientEvent =
  | { type: "open" }
  | { type: "close"; code: number; reason: string; wasClean: boolean }
  | { type: "error"; error: Event }
  | { type: "message"; data: unknown }
  | { type: "status"; status: ConnectionStatus };

export type WebSocketClientListener = (event: WebSocketClientEvent) => void;

/**
 * WebSocket client with automatic reconnection and status tracking.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<WebSocketClientListener> = new Set();
  private config: WebSocketClientConfig;
  private backoffConfig: BackoffConfig;
  private manualDisconnect = false;

  constructor(config: WebSocketClientConfig) {
    this.config = config;
    this.backoffConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config.backoff };
    this.status = createInitialStatus();
  }

  /**
   * Connect to the WebSocket server.
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log("Already connected");
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.log("Already connecting");
      return;
    }

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    this.updateStatus({ state: "connecting", attempt: 0 });

    try {
      this.ws = new WebSocket(this.config.url, this.config.protocols);
      this.setupEventHandlers();
    } catch (error) {
      this.log("Failed to create WebSocket", error);
      this.handleConnectionFailure();
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.updateStatus({
      state: "disconnected",
      attempt: 0,
      lastDisconnectedAt: Date.now(),
      nextRetryInMs: null,
    });
  }

  /**
   * Send a message to the server.
   */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.log("Cannot send: not connected");
      return false;
    }

    try {
      this.ws.send(data);
      return true;
    } catch (error) {
      this.log("Send failed", error);
      return false;
    }
  }

  /**
   * Send JSON data to the server.
   */
  sendJson(data: unknown): boolean {
    return this.send(JSON.stringify(data));
  }

  /**
   * Manually trigger reconnection (useful after max retries reached).
   */
  reconnect(): void {
    if (
      this.status.state === "failed" ||
      this.status.state === "disconnected"
    ) {
      this.status.attempt = 0;
      this.connect();
    }
  }

  /**
   * Subscribe to WebSocket events.
   */
  subscribe(listener: WebSocketClientListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.log("Connected");
      this.updateStatus({
        state: "connected",
        attempt: 0,
        lastConnectedAt: Date.now(),
        nextRetryInMs: null,
      });
      this.emit({ type: "open" });
    };

    this.ws.onclose = (event) => {
      this.log(
        `Closed: code=${event.code} reason=${event.reason} clean=${event.wasClean}`,
      );
      this.updateStatus({ lastDisconnectedAt: Date.now() });
      this.emit({
        type: "close",
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });

      if (!this.manualDisconnect) {
        this.handleConnectionFailure();
      }
    };

    this.ws.onerror = (error) => {
      this.log("Error", error);
      this.emit({ type: "error", error });
    };

    this.ws.onmessage = (event) => {
      let data: unknown = event.data;

      // Try to parse JSON if it's a string
      if (typeof event.data === "string") {
        try {
          data = JSON.parse(event.data);
        } catch {
          // Keep as string if not valid JSON
        }
      }

      this.emit({ type: "message", data });
    };
  }

  private handleConnectionFailure(): void {
    const currentAttempt = this.status.attempt;

    if (!shouldRetry(currentAttempt, this.backoffConfig)) {
      this.log(`Max retries (${this.backoffConfig.maxAttempts}) reached`);
      this.updateStatus({ state: "failed", nextRetryInMs: null });
      return;
    }

    const delay = calculateBackoff(currentAttempt, this.backoffConfig);
    this.log(
      `Reconnecting in ${delay}ms (attempt ${currentAttempt + 1}/${this.backoffConfig.maxAttempts})`,
    );

    this.updateStatus({
      state: "reconnecting",
      attempt: currentAttempt + 1,
      nextRetryInMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.updateStatus({ nextRetryInMs: null });
      this.attemptReconnect();
    }, delay);
  }

  private attemptReconnect(): void {
    if (this.manualDisconnect) {
      return;
    }

    this.log(`Reconnect attempt ${this.status.attempt}`);

    try {
      this.ws = new WebSocket(this.config.url, this.config.protocols);
      this.setupEventHandlers();
    } catch (error) {
      this.log("Reconnect failed", error);
      this.handleConnectionFailure();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private updateStatus(updates: Partial<ConnectionStatus>): void {
    const newState = updates.state ?? this.status.state;
    const newAttempt = updates.attempt ?? this.status.attempt;

    this.status = {
      ...this.status,
      ...updates,
      hint: getStatusHint(newState, newAttempt, this.backoffConfig.maxAttempts),
    };

    this.emit({ type: "status", status: this.getStatus() });
  }

  private emit(event: WebSocketClientEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        this.log("Listener error", error);
      }
    });
  }

  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[WebSocketClient] ${message}`, ...args);
    }
  }
}

/**
 * Create a WebSocket client instance.
 */
export function createWebSocketClient(
  config: WebSocketClientConfig,
): WebSocketClient {
  return new WebSocketClient(config);
}
