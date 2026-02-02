import {
  context as otelContext,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { ServerWebSocket } from "bun";
import { logger } from "../services/logger";
import { replayEvents } from "../services/ws-event-log.service";
import { canSubscribe } from "./authorization";
import { channelRequiresAck, channelToString, parseChannel } from "./channels";
import { type ConnectionData, getHub } from "./hub";
import {
  createWSError,
  type HubMessage,
  parseClientMessage,
  type ServerMessage,
  type SubscribedMessage,
  serializeServerMessage,
} from "./messages";

const MAX_CONCURRENT_REPLAYS_PER_CONNECTION = 2;

function getTracer() {
  return trace.getTracer("flywheel-gateway");
}

function sendMissedMessages(
  ws: ServerWebSocket<ConnectionData>,
  channel: ReturnType<typeof parseChannel>,
  messages: HubMessage[],
): void {
  if (!channel) return;
  const channelStr = channelToString(channel);
  const requiresAck = channelRequiresAck(channel);
  for (const msg of messages) {
    const serverMsg: ServerMessage = {
      type: "message",
      message: msg,
      ...(requiresAck && { ackRequired: true }),
    };
    try {
      ws.send(serializeServerMessage(serverMsg));
    } catch (err) {
      logger.warn(
        { connectionId: ws.data.connectionId, channel: channelStr, error: err },
        "Failed to send missed message, connection may be closed",
      );
      return; // Stop sending if connection is dead
    }
    ws.data.subscriptions.set(channelStr, msg.cursor);
    if (requiresAck) {
      ws.data.pendingAcks.set(msg.id, {
        message: msg,
        sentAt: new Date(),
        replayCount: 1,
      });
    }
  }
}

/**
 * Handle WebSocket connection open event.
 * Adds the connection to the hub and registers initial subscriptions.
 */
export function handleWSOpen(ws: ServerWebSocket<ConnectionData>): void {
  const startedAt = performance.now();
  const hub = getHub();
  const connectionId = ws.data.connectionId;

  const span = getTracer().startSpan("WS open", {
    kind: SpanKind.SERVER,
    attributes: {
      "ws.connection_id": connectionId,
      ...(ws.data.auth.userId !== undefined && {
        "enduser.id": ws.data.auth.userId,
      }),
      "flywheel.is_admin": ws.data.auth.isAdmin,
    },
  });
  const spanContext = trace.setSpan(otelContext.active(), span);

  ws.data.activeReplays = ws.data.activeReplays ?? 0;

  try {
    otelContext.with(spanContext, () => {
      hub.addConnection(ws, ws.data.auth);

      // Register pre-existing subscriptions (e.g. from upgrade)
      // These are considered "system-assigned" but still must pass authorization
      if (ws.data.subscriptions.size > 0) {
        // Clone entries to avoid iterator invalidation issues as hub.subscribe modifies the map
        const initialSubs = Array.from(ws.data.subscriptions.entries());
        // Treat upgrade-time subscriptions as "requested"; clear and re-add only those that pass auth.
        // This ensures `ws.data.subscriptions` reflects actual hub subscriptions (e.g. for ping reporting).
        ws.data.subscriptions.clear();

        for (const [channelStr, cursor] of initialSubs) {
          const channel = parseChannel(channelStr);
          if (channel) {
            // Enforce authorization even for system-assigned subscriptions
            // This prevents unauthorized access via URL parameters (e.g. /agents/:id/ws)
            const authResult = canSubscribe(ws.data.auth, channel);
            if (!authResult.allowed) {
              logger.warn(
                {
                  connectionId,
                  channel: channelStr,
                  reason: authResult.reason,
                },
                "Skipping unauthorized initial subscription",
              );
              continue;
            }

            const result = hub.subscribe(connectionId, channel, cursor);

            // Send missed messages immediately
            if (result.missedMessages && result.missedMessages.length > 0) {
              sendMissedMessages(ws, channel, result.missedMessages);
            }
          }
        }
      }

      // Send welcome message with server info and capabilities
      const connectedMsg: ServerMessage = {
        type: "connected",
        connectionId: connectionId,
        serverTime: new Date().toISOString(),
        serverVersion: process.env["GATEWAY_VERSION"] ?? "dev",
        capabilities: {
          backfill: true,
          compression: false,
          acknowledgment: true,
        },
        heartbeatIntervalMs: 30000,
        docs: "https://docs.flywheel.dev/websocket",
      };
      ws.send(serializeServerMessage(connectedMsg));
    });
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    const error = err instanceof Error ? err : new Error(String(err));
    span.recordException(error);
    throw err;
  } finally {
    span.setAttribute(
      "ws.duration_ms",
      Math.round(performance.now() - startedAt),
    );
    span.end();
  }
}

/**
 * Handle WebSocket message event.
 * Parses the message and delegates to the hub.
 */
export function handleWSMessage(
  ws: ServerWebSocket<ConnectionData>,
  message: string | Buffer,
): void {
  const tracer = getTracer();
  const hub = getHub();
  const connectionId = ws.data.connectionId;
  const startedAt = performance.now();
  let span: Span | undefined;
  let deferSpanEnd = false;
  let caughtError: unknown | undefined;

  try {
    const text = typeof message === "string" ? message : message.toString();
    const clientMsg = parseClientMessage(text);

    if (!clientMsg) {
      logger.warn({ connectionId, text }, "Invalid WebSocket message format");
      ws.send(
        serializeServerMessage(
          createWSError("INVALID_FORMAT", "Invalid message format"),
        ),
      );
      return;
    }

    span = tracer.startSpan(`WS message ${clientMsg.type}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "ws.connection_id": connectionId,
        "ws.message_type": clientMsg.type,
        ...(ws.data.auth.userId !== undefined && {
          "enduser.id": ws.data.auth.userId,
        }),
        "flywheel.is_admin": ws.data.auth.isAdmin,
      },
    });

    const spanContext = trace.setSpan(otelContext.active(), span);

    // Any valid client message indicates the connection is alive
    hub.updateHeartbeat(connectionId);

    otelContext.with(spanContext, () => {
      switch (clientMsg.type) {
        case "subscribe": {
          const channelStr = clientMsg.channel;
          span?.setAttribute("ws.channel", channelStr);
          const channel = parseChannel(channelStr);
          if (channel) {
            span?.setAttribute("ws.channel_type", channel.type);
            if ("agentId" in channel) {
              span?.setAttribute("ws.agent_id", channel.agentId);
            }
          }
          if (!channel) {
            ws.send(
              serializeServerMessage(
                createWSError(
                  "INVALID_CHANNEL",
                  "Invalid channel format",
                  channelStr,
                ),
              ),
            );
            break;
          }

          // Check authorization
          const authResult = canSubscribe(ws.data.auth, channel);
          if (!authResult.allowed) {
            ws.send(
              serializeServerMessage(
                createWSError(
                  "WS_SUBSCRIPTION_DENIED",
                  `Subscription denied: ${authResult.reason}`,
                  channelStr,
                ),
              ),
            );
            break;
          }

          const cursor = clientMsg.cursor;

          // Subscribe and get missed messages
          const result = hub.subscribe(connectionId, channel, cursor);

          // Replay missed messages FIRST (so client state is consistent)
          if (result.missedMessages && result.missedMessages.length > 0) {
            sendMissedMessages(ws, channel, result.missedMessages);
          }

          // THEN send acknowledgement with the latest cursor
          const subMsg: SubscribedMessage = {
            type: "subscribed",
            channel: channelStr,
          };
          if (result.cursor !== undefined) subMsg.cursor = result.cursor;
          ws.send(serializeServerMessage(subMsg));
          break;
        }

        case "unsubscribe": {
          const channelStr = clientMsg.channel;
          span?.setAttribute("ws.channel", channelStr);
          const channel = parseChannel(channelStr);
          if (channel) {
            span?.setAttribute("ws.channel_type", channel.type);
            if ("agentId" in channel) {
              span?.setAttribute("ws.agent_id", channel.agentId);
            }
          }
          if (!channel) {
            ws.send(
              serializeServerMessage(
                createWSError(
                  "INVALID_CHANNEL",
                  "Invalid channel format",
                  channelStr,
                ),
              ),
            );
            break;
          }

          hub.unsubscribe(connectionId, channel);
          const unsubMsg: ServerMessage = {
            type: "unsubscribed",
            channel: channelStr,
          };
          ws.send(serializeServerMessage(unsubMsg));
          break;
        }

        case "ping": {
          const pongMsg: ServerMessage = {
            type: "pong",
            timestamp: clientMsg.timestamp,
            serverTime: Date.now(),
            subscriptions: Array.from(ws.data.subscriptions.keys()),
            cursors: Object.fromEntries(
              Array.from(ws.data.subscriptions.entries()).filter(
                ([_, v]) => v !== undefined,
              ) as [string, string][],
            ),
          };
          ws.send(serializeServerMessage(pongMsg));
          hub.updateHeartbeat(connectionId);
          break;
        }

        case "reconnect": {
          span?.setAttribute(
            "ws.reconnect.cursors_count",
            Object.keys(clientMsg.cursors).length,
          );
          const allowedCursors: Record<string, string> = {};

          for (const [channelStr, cursor] of Object.entries(
            clientMsg.cursors,
          )) {
            const channel = parseChannel(channelStr);
            if (!channel) {
              ws.send(
                serializeServerMessage(
                  createWSError(
                    "INVALID_CHANNEL",
                    "Invalid channel format",
                    channelStr,
                  ),
                ),
              );
              continue;
            }

            const authResult = canSubscribe(ws.data.auth, channel);
            if (!authResult.allowed) {
              ws.send(
                serializeServerMessage(
                  createWSError(
                    "WS_SUBSCRIPTION_DENIED",
                    `Reconnect denied: ${authResult.reason}`,
                    channelStr,
                  ),
                ),
              );
              continue;
            }

            allowedCursors[channelStr] = cursor;
          }

          // Handle reconnection logic for authorized channels only
          const result = hub.handleReconnect(connectionId, allowedCursors);
          ws.send(serializeServerMessage(result));
          break;
        }

        case "backfill": {
          const channelStr = clientMsg.channel;
          span?.setAttribute("ws.channel", channelStr);
          const channel = parseChannel(channelStr);
          if (channel) {
            span?.setAttribute("ws.channel_type", channel.type);
            if ("agentId" in channel) {
              span?.setAttribute("ws.agent_id", channel.agentId);
            }
          }
          if (!channel) {
            ws.send(
              serializeServerMessage(
                createWSError(
                  "INVALID_CHANNEL",
                  "Invalid channel format",
                  channelStr,
                ),
              ),
            );
            break;
          }

          // Check authorization
          const authResult = canSubscribe(ws.data.auth, channel);
          if (!authResult.allowed) {
            ws.send(
              serializeServerMessage(
                createWSError(
                  "WS_SUBSCRIPTION_DENIED",
                  `Backfill denied: ${authResult.reason}`,
                  channelStr,
                ),
              ),
            );
            break;
          }

          const replayResult = hub.replay(
            channel,
            clientMsg.fromCursor,
            clientMsg.limit,
          );

          const shouldUseDbReplay =
            replayResult.expired && replayResult.messages.length === 0;

          if (shouldUseDbReplay) {
            if (
              ws.data.activeReplays >= MAX_CONCURRENT_REPLAYS_PER_CONNECTION
            ) {
              ws.send(
                serializeServerMessage({
                  type: "throttled",
                  message: "Too many concurrent replay requests",
                  resumeAfterMs: 1000,
                  currentCount: ws.data.activeReplays,
                  limit: MAX_CONCURRENT_REPLAYS_PER_CONNECTION,
                }),
              );
              break;
            }

            deferSpanEnd = true;
            ws.data.activeReplays++;
            void (async () => {
              try {
                const dbReplay = await replayEvents(
                  {
                    connectionId,
                    ...(ws.data.auth.userId !== undefined && {
                      userId: ws.data.auth.userId,
                    }),
                    channel: channelStr,
                    fromCursor: clientMsg.fromCursor,
                  },
                  clientMsg.limit ?? 100,
                );

                const backfillResponse: ServerMessage = {
                  type: "backfill_response",
                  channel: channelStr,
                  messages: dbReplay.messages,
                  hasMore: dbReplay.hasMore,
                  ...(dbReplay.lastCursor !== undefined && {
                    lastCursor: dbReplay.lastCursor,
                  }),
                  cursorExpired: dbReplay.cursorExpired,
                };

                ws.send(serializeServerMessage(backfillResponse));

                if (
                  dbReplay.lastCursor !== undefined &&
                  ws.data.subscriptions.has(channelStr)
                ) {
                  ws.data.subscriptions.set(channelStr, dbReplay.lastCursor);
                }

                span?.setStatus({ code: SpanStatusCode.OK });
              } catch (error) {
                span?.setStatus({ code: SpanStatusCode.ERROR });
                const err =
                  error instanceof Error ? error : new Error(String(error));
                span?.recordException(err);

                logger.error(
                  { connectionId, channel: channelStr, error },
                  "WS backfill DB replay failed",
                );
                ws.send(
                  serializeServerMessage(
                    createWSError(
                      "INTERNAL_ERROR",
                      "Backfill replay failed",
                      channelStr,
                    ),
                  ),
                );
              } finally {
                ws.data.activeReplays = Math.max(0, ws.data.activeReplays - 1);
                if (span) {
                  span.setAttribute(
                    "ws.duration_ms",
                    Math.round(performance.now() - startedAt),
                  );
                  span.end();
                }
              }
            })();
            break;
          }

          const backfillResponse: ServerMessage = {
            type: "backfill_response",
            channel: channelStr,
            messages: replayResult.messages,
            hasMore: replayResult.hasMore,
            ...(replayResult.lastCursor !== undefined && {
              lastCursor: replayResult.lastCursor,
            }),
            ...(replayResult.expired && { cursorExpired: true }),
          };
          ws.send(serializeServerMessage(backfillResponse));

          if (
            replayResult.lastCursor !== undefined &&
            ws.data.subscriptions.has(channelStr)
          ) {
            ws.data.subscriptions.set(channelStr, replayResult.lastCursor);
          }
          break;
        }

        case "ack": {
          span?.setAttribute(
            "ws.ack.message_ids_count",
            clientMsg.messageIds.length,
          );
          // Handle acknowledgment of messages
          const ackResponse = hub.handleAck(connectionId, clientMsg.messageIds);
          ws.send(serializeServerMessage(ackResponse));
          break;
        }

        default:
          logger.warn(
            { connectionId, type: (clientMsg as { type: string }).type },
            "Unknown message type",
          );
      }
    });
  } catch (err) {
    caughtError = err;
    logger.error({ err, connectionId }, "Error handling WebSocket message");
    ws.send(
      serializeServerMessage(
        createWSError("INTERNAL_ERROR", "Internal server error"),
      ),
    );
  } finally {
    if (span && !deferSpanEnd) {
      span.setAttribute(
        "ws.duration_ms",
        Math.round(performance.now() - startedAt),
      );
      if (caughtError) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        const error =
          caughtError instanceof Error
            ? caughtError
            : new Error(String(caughtError));
        span.recordException(error);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    }
  }
}

/**
 * Handle WebSocket close event.
 * Removes the connection from the hub.
 */
export function handleWSClose(ws: ServerWebSocket<ConnectionData>): void {
  const startedAt = performance.now();
  const hub = getHub();
  const span = getTracer().startSpan("WS close", {
    kind: SpanKind.SERVER,
    attributes: {
      "ws.connection_id": ws.data.connectionId,
    },
  });
  try {
    hub.removeConnection(ws.data.connectionId);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    const error = err instanceof Error ? err : new Error(String(err));
    span.recordException(error);
    throw err;
  } finally {
    span.setAttribute(
      "ws.duration_ms",
      Math.round(performance.now() - startedAt),
    );
    span.end();
  }
}

/**
 * Handle WebSocket error event.
 */
export function handleWSError(
  ws: ServerWebSocket<ConnectionData>,
  error: Error,
): void {
  const startedAt = performance.now();
  const span = getTracer().startSpan("WS error", {
    kind: SpanKind.SERVER,
    attributes: {
      "ws.connection_id": ws.data.connectionId,
    },
  });
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR });
  logger.error(
    { connectionId: ws.data.connectionId, error },
    "WebSocket error",
  );
  // Connection removal is handled by close event usually,
  // but we can ensure cleanup here if needed.
  // Bun emits close after error typically.
  span.setAttribute(
    "ws.duration_ms",
    Math.round(performance.now() - startedAt),
  );
  span.end();
}
