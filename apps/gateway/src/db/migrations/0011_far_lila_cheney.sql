-- NOTE: This migration was superseded by `0011_durable_ws_replay.sql`.
-- It remains in-tree (non-destructive policy), but must be idempotent because
-- some tests run all migrations in lexical order.
CREATE TABLE IF NOT EXISTS `ws_event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`cursor` text NOT NULL,
	`cursor_timestamp` integer NOT NULL,
	`cursor_sequence` integer NOT NULL,
	`message` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ws_event_log_channel_cursor_idx` ON `ws_event_log` (`channel`,`cursor_timestamp`,`cursor_sequence`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ws_event_log_created_at_idx` ON `ws_event_log` (`created_at`);
