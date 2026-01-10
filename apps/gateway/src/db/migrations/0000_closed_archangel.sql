CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`api_key_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_idx` ON `accounts` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_api_key_hash_idx` ON `accounts` (`api_key_hash`);--> statement-breakpoint
CREATE TABLE `agent_sweeps` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`affected_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_sweeps_status_idx` ON `agent_sweeps` (`status`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_url` text NOT NULL,
	`task` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`model` text DEFAULT 'sonnet-4' NOT NULL,
	`account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agents_status_idx` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `agents_account_idx` ON `agents` (`account_id`);--> statement-breakpoint
CREATE INDEX `agents_created_at_idx` ON `agents` (`created_at`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_severity_idx` ON `alerts` (`severity`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`resource_type` text NOT NULL,
	`outcome` text NOT NULL,
	`correlation_id` text,
	`metadata` blob,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_account_idx` ON `audit_logs` (`account_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`state` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkpoints_agent_idx` ON `checkpoints` (`agent_id`);--> statement-breakpoint
CREATE INDEX `checkpoints_created_at_idx` ON `checkpoints` (`created_at`);--> statement-breakpoint
CREATE TABLE `dcg_allowlist` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`pattern` text NOT NULL,
	`approved_by` text,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dcg_allowlist_rule_id_idx` ON `dcg_allowlist` (`rule_id`);--> statement-breakpoint
CREATE TABLE `dcg_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dcg_blocks_created_at_idx` ON `dcg_blocks` (`created_at`);--> statement-breakpoint
CREATE TABLE `fleet_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`branch` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fleet_repos_path_idx` ON `fleet_repos` (`path`);--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`command` text NOT NULL,
	`input` blob,
	`output` blob,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `history_agent_idx` ON `history` (`agent_id`);--> statement-breakpoint
CREATE INDEX `history_command_idx` ON `history` (`command`);--> statement-breakpoint
CREATE INDEX `history_created_at_idx` ON `history` (`created_at`);