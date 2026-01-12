CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text,
	`session_id` text,
	`rule_id` text,
	`rule_name` text NOT NULL,
	`operation_type` text NOT NULL,
	`operation_command` text,
	`operation_path` text,
	`operation_description` text NOT NULL,
	`operation_details` blob,
	`task_description` text,
	`recent_actions` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_reason` text,
	`correlation_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `safety_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approval_requests_workspace_idx` ON `approval_requests` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `approval_requests_agent_idx` ON `approval_requests` (`agent_id`);--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`status`);--> statement-breakpoint
CREATE INDEX `approval_requests_priority_idx` ON `approval_requests` (`priority`);--> statement-breakpoint
CREATE INDEX `approval_requests_requested_at_idx` ON `approval_requests` (`requested_at`);--> statement-breakpoint
CREATE INDEX `approval_requests_expires_at_idx` ON `approval_requests` (`expires_at`);--> statement-breakpoint
CREATE INDEX `approval_requests_correlation_idx` ON `approval_requests` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `branch_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`repository_id` text NOT NULL,
	`branch_name` text NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`assigned_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`task_id` text,
	`task_description` text,
	`reserved_patterns` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `branch_assignments_agent_idx` ON `branch_assignments` (`agent_id`);--> statement-breakpoint
CREATE INDEX `branch_assignments_repository_idx` ON `branch_assignments` (`repository_id`);--> statement-breakpoint
CREATE INDEX `branch_assignments_status_idx` ON `branch_assignments` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `branch_assignments_repo_branch_idx` ON `branch_assignments` (`repository_id`,`branch_name`);--> statement-breakpoint
CREATE TABLE `budget_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`dollars_used` real DEFAULT 0 NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer,
	`last_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budget_usage_workspace_idx` ON `budget_usage` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `budget_usage_scope_idx` ON `budget_usage` (`scope`,`scope_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_usage_scope_period_idx` ON `budget_usage` (`scope`,`scope_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `conflict_predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`branch_a` text NOT NULL,
	`branch_b` text NOT NULL,
	`has_conflicts` integer DEFAULT false NOT NULL,
	`conflicting_files` text,
	`severity` text DEFAULT 'none' NOT NULL,
	`recommendation` text,
	`common_ancestor` text,
	`changes_in_a` integer DEFAULT 0 NOT NULL,
	`changes_in_b` integer DEFAULT 0 NOT NULL,
	`overlapping_files` text,
	`predicted_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conflict_predictions_repository_idx` ON `conflict_predictions` (`repository_id`);--> statement-breakpoint
CREATE INDEX `conflict_predictions_branches_idx` ON `conflict_predictions` (`branch_a`,`branch_b`);--> statement-breakpoint
CREATE INDEX `conflict_predictions_predicted_at_idx` ON `conflict_predictions` (`predicted_at`);--> statement-breakpoint
CREATE TABLE `git_sync_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`agent_id` text,
	`operation` text NOT NULL,
	`branch` text NOT NULL,
	`target_branch` text,
	`remote` text,
	`force` integer DEFAULT false,
	`status` text NOT NULL,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`duration_ms` integer,
	`success` integer,
	`from_commit` text,
	`to_commit` text,
	`files_changed` integer,
	`insertions` integer,
	`deletions` integer,
	`conflicts_detected` integer,
	`conflict_files` text,
	`error_code` text,
	`error_message` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`correlation_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `git_sync_operations_repository_idx` ON `git_sync_operations` (`repository_id`);--> statement-breakpoint
CREATE INDEX `git_sync_operations_agent_idx` ON `git_sync_operations` (`agent_id`);--> statement-breakpoint
CREATE INDEX `git_sync_operations_status_idx` ON `git_sync_operations` (`status`);--> statement-breakpoint
CREATE INDEX `git_sync_operations_queued_at_idx` ON `git_sync_operations` (`queued_at`);--> statement-breakpoint
CREATE INDEX `git_sync_operations_correlation_idx` ON `git_sync_operations` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `pipeline_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`approvers` blob NOT NULL,
	`message` text NOT NULL,
	`min_approvals` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decisions` blob,
	`timeout_at` integer,
	`on_timeout` text DEFAULT 'fail' NOT NULL,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_approvals_run_idx` ON `pipeline_approvals` (`run_id`);--> statement-breakpoint
CREATE INDEX `pipeline_approvals_status_idx` ON `pipeline_approvals` (`status`);--> statement-breakpoint
CREATE INDEX `pipeline_approvals_timeout_idx` ON `pipeline_approvals` (`timeout_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_approvals_run_step_idx` ON `pipeline_approvals` (`run_id`,`step_id`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`pipeline_version` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_step_index` integer DEFAULT 0 NOT NULL,
	`executed_step_ids` blob NOT NULL,
	`context` blob NOT NULL,
	`trigger_params` blob,
	`triggered_by_type` text NOT NULL,
	`triggered_by_id` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`duration_ms` integer,
	`error_code` text,
	`error_message` text,
	`error_step_id` text,
	`correlation_id` text,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_pipeline_idx` ON `pipeline_runs` (`pipeline_id`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_status_idx` ON `pipeline_runs` (`status`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_started_at_idx` ON `pipeline_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_correlation_idx` ON `pipeline_runs` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `pipeline_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`start_date` integer,
	`end_date` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_run_id` text,
	`run_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_schedules_pipeline_idx` ON `pipeline_schedules` (`pipeline_id`);--> statement-breakpoint
CREATE INDEX `pipeline_schedules_enabled_idx` ON `pipeline_schedules` (`enabled`);--> statement-breakpoint
CREATE INDEX `pipeline_schedules_next_run_idx` ON `pipeline_schedules` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `pipeline_step_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`step_name` text NOT NULL,
	`step_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`success` integer,
	`output` blob,
	`error_code` text,
	`error_message` text,
	`error_details` blob,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`duration_ms` integer,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_step_results_run_idx` ON `pipeline_step_results` (`run_id`);--> statement-breakpoint
CREATE INDEX `pipeline_step_results_step_idx` ON `pipeline_step_results` (`step_id`);--> statement-breakpoint
CREATE INDEX `pipeline_step_results_status_idx` ON `pipeline_step_results` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_step_results_run_step_idx` ON `pipeline_step_results` (`run_id`,`step_id`);--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`version` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_config` blob NOT NULL,
	`trigger_enabled` integer DEFAULT true NOT NULL,
	`next_trigger_at` integer,
	`last_triggered_at` integer,
	`steps` blob NOT NULL,
	`context_defaults` blob,
	`retry_policy` blob,
	`tags` blob,
	`owner_id` text,
	`total_runs` integer DEFAULT 0 NOT NULL,
	`successful_runs` integer DEFAULT 0 NOT NULL,
	`failed_runs` integer DEFAULT 0 NOT NULL,
	`average_duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_run_at` integer
);
--> statement-breakpoint
CREATE INDEX `pipelines_name_idx` ON `pipelines` (`name`);--> statement-breakpoint
CREATE INDEX `pipelines_enabled_idx` ON `pipelines` (`enabled`);--> statement-breakpoint
CREATE INDEX `pipelines_owner_idx` ON `pipelines` (`owner_id`);--> statement-breakpoint
CREATE INDEX `pipelines_trigger_type_idx` ON `pipelines` (`trigger_type`);--> statement-breakpoint
CREATE INDEX `pipelines_next_trigger_idx` ON `pipelines` (`next_trigger_at`);--> statement-breakpoint
CREATE INDEX `pipelines_created_at_idx` ON `pipelines` (`created_at`);--> statement-breakpoint
CREATE TABLE `safety_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`category_enables` text NOT NULL,
	`rate_limits` text NOT NULL,
	`budget` text NOT NULL,
	`approval_workflow` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `safety_configs_workspace_idx` ON `safety_configs` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `safety_configs_workspace_name_idx` ON `safety_configs` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `safety_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`conditions` text NOT NULL,
	`condition_logic` text DEFAULT 'and' NOT NULL,
	`action` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`alternatives` text,
	`priority` integer DEFAULT 100 NOT NULL,
	`metadata` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`config_id`) REFERENCES `safety_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `safety_rules_config_idx` ON `safety_rules` (`config_id`);--> statement-breakpoint
CREATE INDEX `safety_rules_workspace_idx` ON `safety_rules` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `safety_rules_category_idx` ON `safety_rules` (`category`);--> statement-breakpoint
CREATE INDEX `safety_rules_enabled_idx` ON `safety_rules` (`enabled`);--> statement-breakpoint
CREATE INDEX `safety_rules_priority_idx` ON `safety_rules` (`priority`);--> statement-breakpoint
CREATE TABLE `safety_violations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text,
	`session_id` text,
	`rule_id` text,
	`rule_name` text NOT NULL,
	`rule_category` text NOT NULL,
	`rule_severity` text NOT NULL,
	`operation_type` text NOT NULL,
	`operation_details` blob,
	`action_taken` text NOT NULL,
	`task_description` text,
	`recent_history` text,
	`correlation_id` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `safety_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_violations_workspace_idx` ON `safety_violations` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `safety_violations_agent_idx` ON `safety_violations` (`agent_id`);--> statement-breakpoint
CREATE INDEX `safety_violations_rule_idx` ON `safety_violations` (`rule_id`);--> statement-breakpoint
CREATE INDEX `safety_violations_severity_idx` ON `safety_violations` (`rule_severity`);--> statement-breakpoint
CREATE INDEX `safety_violations_timestamp_idx` ON `safety_violations` (`timestamp`);--> statement-breakpoint
CREATE INDEX `safety_violations_correlation_idx` ON `safety_violations` (`correlation_id`);