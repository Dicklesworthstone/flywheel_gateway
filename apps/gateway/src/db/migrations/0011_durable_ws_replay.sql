-- Migration: Durable WebSocket Event Replay
-- Issue: bd-jk8ct
-- Description: Adds tables for persisting WebSocket events for reliable replay

-- WebSocket event log for durable event storage
CREATE TABLE IF NOT EXISTS ws_event_log (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  cursor TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  correlation_id TEXT,
  agent_id TEXT,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ws_event_log_channel_cursor_idx ON ws_event_log(channel, cursor);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_event_log_channel_sequence_idx ON ws_event_log(channel, sequence);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_event_log_created_at_idx ON ws_event_log(created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_event_log_expires_at_idx ON ws_event_log(expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_event_log_correlation_idx ON ws_event_log(correlation_id);
--> statement-breakpoint

-- WebSocket replay audit log for authorization and rate limiting
CREATE TABLE IF NOT EXISTS ws_replay_audit_log (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  user_id TEXT,
  channel TEXT NOT NULL,
  from_cursor TEXT,
  to_cursor TEXT,
  messages_replayed INTEGER NOT NULL,
  cursor_expired INTEGER NOT NULL DEFAULT 0,
  used_snapshot INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  duration_ms INTEGER,
  correlation_id TEXT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ws_replay_audit_log_connection_idx ON ws_replay_audit_log(connection_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_replay_audit_log_user_idx ON ws_replay_audit_log(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_replay_audit_log_channel_idx ON ws_replay_audit_log(channel);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ws_replay_audit_log_requested_at_idx ON ws_replay_audit_log(requested_at);
--> statement-breakpoint

-- WebSocket channel configuration for per-channel settings
CREATE TABLE IF NOT EXISTS ws_channel_config (
  id TEXT PRIMARY KEY,
  channel_pattern TEXT NOT NULL UNIQUE,
  persist_events INTEGER NOT NULL DEFAULT 1,
  retention_ms INTEGER NOT NULL DEFAULT 300000,
  max_events INTEGER NOT NULL DEFAULT 10000,
  snapshot_enabled INTEGER NOT NULL DEFAULT 0,
  snapshot_interval_ms INTEGER,
  max_replay_requests_per_minute INTEGER NOT NULL DEFAULT 10,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ws_channel_config_pattern_idx ON ws_channel_config(channel_pattern);
