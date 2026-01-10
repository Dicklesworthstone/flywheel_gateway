CREATE TABLE `account_pool_members` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `account_pools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `account_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_pool_members_pool_idx` ON `account_pool_members` (`pool_id`);--> statement-breakpoint
CREATE INDEX `account_pool_members_profile_idx` ON `account_pool_members` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_pool_members_unique_idx` ON `account_pool_members` (`pool_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `account_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`rotation_strategy` text DEFAULT 'smart' NOT NULL,
	`cooldown_minutes_default` integer DEFAULT 15 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`active_profile_id` text,
	`last_rotated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_pools_workspace_idx` ON `account_pools` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_pools_workspace_provider_idx` ON `account_pools` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE TABLE `account_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`auth_mode` text NOT NULL,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`status_message` text,
	`health_score` integer,
	`last_verified_at` integer,
	`expires_at` integer,
	`cooldown_until` integer,
	`last_used_at` integer,
	`auth_files_present` integer DEFAULT false NOT NULL,
	`auth_file_hash` text,
	`storage_mode` text,
	`labels` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_profiles_workspace_idx` ON `account_profiles` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `account_profiles_provider_idx` ON `account_profiles` (`provider`);--> statement-breakpoint
CREATE INDEX `account_profiles_status_idx` ON `account_profiles` (`status`);--> statement-breakpoint
CREATE INDEX `account_profiles_workspace_provider_idx` ON `account_profiles` (`workspace_id`,`provider`);