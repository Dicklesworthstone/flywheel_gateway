CREATE TABLE `agent_sweep_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`plan_id` text,
	`repo_id` text,
	`phase` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` blob,
	`timestamp` integer NOT NULL,
	`duration_ms` integer,
	`action_type` text,
	`action_index` integer,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sweep_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `agent_sweep_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `fleet_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_sweep_logs_session_idx` ON `agent_sweep_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_sweep_logs_timestamp_idx` ON `agent_sweep_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `agent_sweep_logs_level_idx` ON `agent_sweep_logs` (`level`);--> statement-breakpoint
CREATE TABLE `agent_sweep_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`repo_id` text,
	`repo_full_name` text NOT NULL,
	`plan_json` text NOT NULL,
	`plan_version` integer DEFAULT 1 NOT NULL,
	`action_count` integer,
	`estimated_duration_ms` integer,
	`risk_level` text,
	`commit_actions` integer DEFAULT 0 NOT NULL,
	`release_actions` integer DEFAULT 0 NOT NULL,
	`branch_actions` integer DEFAULT 0 NOT NULL,
	`pr_actions` integer DEFAULT 0 NOT NULL,
	`other_actions` integer DEFAULT 0 NOT NULL,
	`validated_at` integer,
	`validation_result` text,
	`validation_errors` text,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`rejected_reason` text,
	`execution_status` text,
	`executed_at` integer,
	`execution_result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sweep_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `fleet_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_sweep_plans_session_idx` ON `agent_sweep_plans` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_sweep_plans_repo_idx` ON `agent_sweep_plans` (`repo_id`);--> statement-breakpoint
CREATE INDEX `agent_sweep_plans_approval_idx` ON `agent_sweep_plans` (`approval_status`);--> statement-breakpoint
CREATE TABLE `agent_sweep_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_repos` text NOT NULL,
	`repo_count` integer NOT NULL,
	`config` blob,
	`parallelism` integer DEFAULT 1 NOT NULL,
	`current_phase` text,
	`phase1_completed_at` integer,
	`phase2_completed_at` integer,
	`phase3_completed_at` integer,
	`status` text NOT NULL,
	`repos_analyzed` integer DEFAULT 0 NOT NULL,
	`repos_planned` integer DEFAULT 0 NOT NULL,
	`repos_executed` integer DEFAULT 0 NOT NULL,
	`repos_failed` integer DEFAULT 0 NOT NULL,
	`repos_skipped` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`total_duration_ms` integer,
	`slb_approval_required` integer DEFAULT true NOT NULL,
	`slb_approval_id` text,
	`slb_approved_by` text,
	`slb_approved_at` integer,
	`triggered_by` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `agent_sweep_sessions_status_idx` ON `agent_sweep_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `agent_sweep_sessions_phase_idx` ON `agent_sweep_sessions` (`current_phase`);--> statement-breakpoint
CREATE INDEX `agent_sweep_sessions_created_at_idx` ON `agent_sweep_sessions` (`created_at`);--> statement-breakpoint
CREATE TABLE `fleet_sync_ops` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text,
	`repo_full_name` text NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`duration_ms` integer,
	`from_commit` text,
	`to_commit` text,
	`commit_count` integer,
	`files_changed` integer,
	`error` text,
	`error_code` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`triggered_by` text,
	`correlation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `fleet_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fleet_sync_ops_repo_idx` ON `fleet_sync_ops` (`repo_id`);--> statement-breakpoint
CREATE INDEX `fleet_sync_ops_status_idx` ON `fleet_sync_ops` (`status`);--> statement-breakpoint
CREATE INDEX `fleet_sync_ops_created_at_idx` ON `fleet_sync_ops` (`created_at`);--> statement-breakpoint
CREATE INDEX `fleet_sync_ops_correlation_idx` ON `fleet_sync_ops` (`correlation_id`);--> statement-breakpoint
DROP TABLE `agent_sweeps`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fleet_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`url` text NOT NULL,
	`ssh_url` text,
	`local_path` text,
	`is_cloned` integer DEFAULT false NOT NULL,
	`current_branch` text,
	`default_branch` text,
	`last_commit` text,
	`last_commit_date` integer,
	`last_commit_author` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`has_uncommitted_changes` integer DEFAULT false NOT NULL,
	`has_unpushed_commits` integer DEFAULT false NOT NULL,
	`ahead_by` integer DEFAULT 0 NOT NULL,
	`behind_by` integer DEFAULT 0 NOT NULL,
	`description` text,
	`language` text,
	`stars` integer,
	`is_private` integer,
	`is_archived` integer,
	`ru_group` text,
	`ru_config` blob,
	`agentsmd_path` text,
	`last_scan_date` integer,
	`added_at` integer NOT NULL,
	`updated_at` integer,
	`last_sync_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_fleet_repos`("id", "owner", "name", "full_name", "url", "ssh_url", "local_path", "is_cloned", "current_branch", "default_branch", "last_commit", "last_commit_date", "last_commit_author", "status", "has_uncommitted_changes", "has_unpushed_commits", "ahead_by", "behind_by", "description", "language", "stars", "is_private", "is_archived", "ru_group", "ru_config", "agentsmd_path", "last_scan_date", "added_at", "updated_at", "last_sync_at") SELECT "id", "owner", "name", "full_name", "url", "ssh_url", "local_path", "is_cloned", "current_branch", "default_branch", "last_commit", "last_commit_date", "last_commit_author", "status", "has_uncommitted_changes", "has_unpushed_commits", "ahead_by", "behind_by", "description", "language", "stars", "is_private", "is_archived", "ru_group", "ru_config", "agentsmd_path", "last_scan_date", "added_at", "updated_at", "last_sync_at" FROM `fleet_repos`;--> statement-breakpoint
DROP TABLE `fleet_repos`;--> statement-breakpoint
ALTER TABLE `__new_fleet_repos` RENAME TO `fleet_repos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `fleet_repos_owner_idx` ON `fleet_repos` (`owner`);--> statement-breakpoint
CREATE INDEX `fleet_repos_status_idx` ON `fleet_repos` (`status`);--> statement-breakpoint
CREATE INDEX `fleet_repos_group_idx` ON `fleet_repos` (`ru_group`);--> statement-breakpoint
CREATE UNIQUE INDEX `fleet_repos_full_name_idx` ON `fleet_repos` (`full_name`);--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `health_status` text;--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `last_error_at` integer;--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `error_count_1h` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `penalty_score` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `penalty_updated_at` integer;--> statement-breakpoint
ALTER TABLE `account_profiles` ADD `plan_type` text;--> statement-breakpoint
ALTER TABLE `dcg_allowlist` ADD `reason` text;