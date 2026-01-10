/**
 * WebSocket Infrastructure Module.
 *
 * Provides real-time communication with:
 * - Durable ring buffers for message history
 * - Cursor-based replay for reconnection
 * - Channel-based pub/sub
 * - Heartbeat and connection management
 * - Authorization per channel
 */

// Authorization
export {
  type AuthorizationResult,
  canPublish,
  canSubscribe,
  createGuestAuthContext,
  createInternalAuthContext,
  validateAuthContext,
} from "./authorization";
// Channel types
export {
  type AgentChannel,
  type Channel,
  type ChannelTypePrefix,
  channelMatchesPattern,
  channelsEqual,
  channelToString,
  getChannelResourceId,
  getChannelScope,
  getChannelTypePrefix,
  parseChannel,
  type SystemChannel,
  type UserChannel,
  type WorkspaceChannel,
} from "./channels";
// Cursor utilities
export {
  type CursorData,
  compareCursors,
  createCursor,
  decodeCursor,
  encodeCursor,
  isCursorExpired,
} from "./cursor";
// Heartbeat management
export {
  CONNECTION_TIMEOUT_MS,
  getHeartbeatManager,
  HEARTBEAT_INTERVAL_MS,
  HeartbeatManager,
  startHeartbeat,
  stopHeartbeat,
} from "./heartbeat";

// WebSocket Hub
export {
  type AuthContext,
  type ConnectionData,
  type ConnectionHandle,
  getHub,
  type HubStats,
  setHub,
  WebSocketHub,
} from "./hub";
// Message types
export {
  type BackfillMessage,
  type BackfillResponse,
  type ChannelMessage,
  type ClientMessage,
  type ConnectedMessage,
  createHubMessage,
  type ErrorMessage,
  type HeartbeatMessage,
  type HubMessage,
  type MessageMetadata,
  type MessageType,
  type PingMessage,
  type PongMessage,
  parseClientMessage,
  type ReconnectAckMessage,
  type ReconnectMessage,
  type ServerMessage,
  type SubscribedMessage,
  type SubscribeMessage,
  serializeServerMessage,
  type UnsubscribedMessage,
  type UnsubscribeMessage,
} from "./messages";
// Ring buffer
export {
  BUFFER_CONFIGS,
  getBufferConfig,
  RingBuffer,
  type RingBufferConfig,
} from "./ring-buffer";
