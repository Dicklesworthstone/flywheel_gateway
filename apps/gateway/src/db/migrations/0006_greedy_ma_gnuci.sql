CREATE TABLE `job_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` blob,
	`timestamp` integer NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_logs_job_idx` ON `job_logs` (`job_id`);--> statement-breakpoint
CREATE INDEX `job_logs_timestamp_idx` ON `job_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `job_logs_level_idx` ON `job_logs` (`level`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`session_id` text,
	`agent_id` text,
	`user_id` text,
	`input` blob,
	`output` blob,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 100 NOT NULL,
	`progress_message` text,
	`progress_stage` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`estimated_duration_ms` integer,
	`actual_duration_ms` integer,
	`error_code` text,
	`error_message` text,
	`error_stack` text,
	`error_retryable` integer,
	`retry_attempts` integer DEFAULT 0 NOT NULL,
	`retry_max_attempts` integer DEFAULT 3 NOT NULL,
	`retry_backoff_ms` integer DEFAULT 1000 NOT NULL,
	`retry_next_at` integer,
	`cancel_requested_at` integer,
	`cancel_requested_by` text,
	`cancel_reason` text,
	`checkpoint_state` blob,
	`checkpoint_at` integer,
	`metadata` blob,
	`correlation_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_type_idx` ON `jobs` (`type`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_priority_idx` ON `jobs` (`priority`);--> statement-breakpoint
CREATE INDEX `jobs_session_idx` ON `jobs` (`session_id`);--> statement-breakpoint
CREATE INDEX `jobs_agent_idx` ON `jobs` (`agent_id`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_correlation_idx` ON `jobs` (`correlation_id`);