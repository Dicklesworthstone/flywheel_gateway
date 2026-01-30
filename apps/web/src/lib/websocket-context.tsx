import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMountedRef } from "../hooks/useMountedRef";
import { useUiStore } from "../stores/ui";
import {
  type ConnectionState,
  type ConnectionStatus,
  calculateBackoff,
  createInitialStatus,
  DEFAULT_BACKOFF_CONFIG,
  getStatusHint,
  shouldRetry,
} from "./websocket/reconnect";

const gatewayToken = import.meta.env["VITE_GATEWAY_TOKEN"]?.trim();

// ============================================================================
// Types
// ============================================================================

interface WebSocketContextValue {
  /** Current connection status including state and metadata */
  status: ConnectionStatus;
  /** Send a message over the WebSocket (queued if not connected) */
  send: (message: unknown) => void;
  /** Subscribe to a channel, returns unsubscribe function */
  subscribe: (channel: string, handler: (data: unknown) => void) => () => void;
  /** Manually trigger reconnection (after failed state) */
  reconnect: () => void;
  /** Unsubscribe from all channels (useful for cleanup) */
  unsubscribeAll: () => void;
}

interface QueuedMessage {
  message: unknown;
  timestamp: number;
}

// ============================================================================
// Context
// ============================================================================

const WebSocketContext = createContext<WebSocketContextValue>({
  status: createInitialStatus(),
  send: () => {},
  subscribe: () => () => {},
  reconnect: () => {},
  unsubscribeAll: () => {},
});

// ============================================================================
// Provider
// ============================================================================

interface WebSocketProviderProps {
  children: ReactNode;
  /** WebSocket URL (defaults to auto-detect based on window.location) */
  url?: string;
}

export function WebSocketProvider({ children, url }: WebSocketProviderProps) {
  const mockMode = useUiStore((state) => state.mockMode);
  const [status, setStatus] = useState<ConnectionStatus>(createInitialStatus());

  // Track component mount status to prevent setState after unmount
  const isMounted = useMountedRef();

  // Refs for mutable state that shouldn't trigger re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const subscriptionsRef = useRef<Map<string, Set<(data: unknown) => void>>>(
    new Map(),
  );
  const messageQueueRef = useRef<QueuedMessage[]>([]);

  // Build WebSocket URL
  const wsUrlBase =
    url ??
    (typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
      : "ws://localhost:3000/ws");
  const wsUrl =
    gatewayToken && wsUrlBase
      ? (() => {
          try {
            const u = new URL(wsUrlBase);
            u.searchParams.set("token", gatewayToken);
            return u.toString();
          } catch {
            return wsUrlBase;
          }
        })()
      : wsUrlBase;

  // Update status helper (guarded against unmount)
  const updateStatus = useCallback(
    (state: ConnectionState, attempt: number = attemptRef.current) => {
      // Guard against setState after unmount
      if (!isMounted.current) return;

      setStatus((prev) => {
        const now = Date.now();
        const nextRetryInMs =
          state === "reconnecting"
            ? calculateBackoff(attempt, DEFAULT_BACKOFF_CONFIG)
            : null;

        return {
          state,
          attempt,
          lastConnectedAt: state === "connected" ? now : prev.lastConnectedAt,
          lastDisconnectedAt:
            state === "disconnected" || state === "reconnecting"
              ? now
              : prev.lastDisconnectedAt,
          nextRetryInMs,
          hint: getStatusHint(
            state,
            attempt,
            DEFAULT_BACKOFF_CONFIG.maxAttempts,
          ),
        };
      });
    },
    [isMounted],
  );

  // Flush queued messages when connected
  const flushQueue = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    const queue = messageQueueRef.current;
    messageQueueRef.current = [];

    for (const { message } of queue) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch {
        // Re-queue on failure
        messageQueueRef.current.push({ message, timestamp: Date.now() });
      }
    }
  }, []);

  // Resubscribe to all channels after reconnect
  const resubscribeAll = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    for (const channel of subscriptionsRef.current.keys()) {
      try {
        wsRef.current.send(JSON.stringify({ type: "subscribe", channel }));
      } catch {
        // Will be handled by message queue
      }
    }
  }, []);

  // Connect function
  const connect = useCallback(() => {
    // Guard against connecting after unmount
    if (!isMounted.current) return;

    if (mockMode) {
      updateStatus("connected", 0);
      return;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent triggering reconnect
      wsRef.current.close();
      wsRef.current = null;
    }

    updateStatus("connecting");

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Guard against setState after unmount
        if (!isMounted.current) return;
        // Guard against stale socket callbacks after reconnect
        if (wsRef.current !== ws) return;

        attemptRef.current = 0;
        updateStatus("connected", 0);

        // Re-subscribe and flush queued messages
        resubscribeAll();
        flushQueue();
      };

      ws.onmessage = (event) => {
        // Guard against callbacks after unmount
        if (!isMounted.current) return;
        // Guard against stale socket callbacks after reconnect
        if (wsRef.current !== ws) return;

        try {
          const data = JSON.parse(event.data) as {
            type?: unknown;
            channel?: unknown;
            payload?: unknown;
            id?: unknown;
            ackRequired?: unknown;
            message?: {
              id?: unknown;
              channel?: unknown;
              payload?: unknown;
            };
          };

          // Handle heartbeat
          if (data.type === "heartbeat") {
            return;
          }

          // Hub envelope: { type: "message", message: HubMessage, ackRequired? }
          const hubMessage = data.message;
          if (
            data.type === "message" &&
            hubMessage &&
            typeof hubMessage.channel === "string"
          ) {
            const channel = hubMessage.channel;

            if (subscriptionsRef.current.has(channel)) {
              const handlers = subscriptionsRef.current.get(channel);
              handlers?.forEach((handler) => {
                try {
                  handler(hubMessage.payload ?? hubMessage);
                } catch {
                  // Handler error, don't propagate
                }
              });
            }

            if (
              data.ackRequired === true &&
              typeof hubMessage.id === "string"
            ) {
              ws.send(
                JSON.stringify({ type: "ack", messageIds: [hubMessage.id] }),
              );
            }

            return;
          }

          // Route message to subscribers
          if (
            typeof data.channel === "string" &&
            subscriptionsRef.current.has(data.channel)
          ) {
            const handlers = subscriptionsRef.current.get(data.channel);
            handlers?.forEach((handler) => {
              try {
                handler(data.payload ?? data);
              } catch {
                // Handler error, don't propagate
              }
            });
          }

          // Handle ack requirement
          if (data.ackRequired === true && typeof data.id === "string") {
            ws.send(JSON.stringify({ type: "ack", messageIds: [data.id] }));
          }
        } catch {
          // Invalid message format, ignore
        }
      };

      ws.onclose = (event) => {
        // Guard against stale socket callbacks after reconnect
        if (wsRef.current !== ws) return;
        wsRef.current = null;

        // Guard against callbacks after unmount
        if (!isMounted.current) return;

        // Don't reconnect on clean close
        if (event.code === 1000) {
          updateStatus("disconnected", 0);
          return;
        }

        // Check if we should retry
        if (shouldRetry(attemptRef.current, DEFAULT_BACKOFF_CONFIG)) {
          updateStatus("reconnecting", attemptRef.current);
          const delay = calculateBackoff(
            attemptRef.current,
            DEFAULT_BACKOFF_CONFIG,
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            attemptRef.current++;
            connect();
          }, delay);
        } else {
          updateStatus("failed", attemptRef.current);
        }
      };

      ws.onerror = () => {
        // Guard against stale socket callbacks after reconnect
        if (wsRef.current !== ws) return;
        // Error handling is done in onclose
      };

      wsRef.current = ws;
    } catch {
      updateStatus("failed", attemptRef.current);
    }
  }, [isMounted, mockMode, wsUrl, updateStatus, resubscribeAll, flushQueue]);

  // Manual reconnect (from failed state)
  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    connect();
  }, [connect]);

  // Send message
  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        return;
      } catch {
        // Fall through to queue
      }
    }

    // Queue message for later
    messageQueueRef.current.push({ message, timestamp: Date.now() });
  }, []);

  // Subscribe to channel
  const subscribe = useCallback(
    (channel: string, handler: (data: unknown) => void) => {
      // Add to subscriptions
      if (!subscriptionsRef.current.has(channel)) {
        subscriptionsRef.current.set(channel, new Set());
      }
      subscriptionsRef.current.get(channel)?.add(handler);

      // Send subscribe message if connected
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "subscribe", channel }));
        } catch {
          // Will be handled on reconnect
        }
      }

      // Return unsubscribe function
      return () => {
        const handlers = subscriptionsRef.current.get(channel);
        handlers?.delete(handler);

        // Unsubscribe from channel if no more handlers
        if (handlers?.size === 0) {
          subscriptionsRef.current.delete(channel);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            try {
              wsRef.current.send(
                JSON.stringify({ type: "unsubscribe", channel }),
              );
            } catch {
              // Ignore unsubscribe errors
            }
          }
        }
      };
    },
    [],
  );

  // Unsubscribe from all channels
  const unsubscribeAll = useCallback(() => {
    const channels = Array.from(subscriptionsRef.current.keys());
    subscriptionsRef.current.clear();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      for (const channel of channels) {
        try {
          wsRef.current.send(JSON.stringify({ type: "unsubscribe", channel }));
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }, []);

  // Initialize connection on mount
  useEffect(() => {
    connect();

    return () => {
      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Close connection
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect
        wsRef.current.close();
        wsRef.current = null;
      }

      // Clear subscriptions
      subscriptionsRef.current.clear();
      messageQueueRef.current = [];
    };
  }, [connect]);

  const value: WebSocketContextValue = {
    status,
    send,
    subscribe,
    reconnect,
    unsubscribeAll,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the full WebSocket context including send/subscribe functions.
 */
export function useWebSocket() {
  return useContext(WebSocketContext);
}

/**
 * Get just the WebSocket connection status (for UI indicators).
 * @deprecated Use useWebSocket().status instead for new code.
 */
export function useWebSocketState() {
  const { status } = useContext(WebSocketContext);
  return {
    connected: status.state === "connected",
    connectionHint: status.hint,
    state: status.state,
    attempt: status.attempt,
    nextRetryInMs: status.nextRetryInMs,
  };
}
