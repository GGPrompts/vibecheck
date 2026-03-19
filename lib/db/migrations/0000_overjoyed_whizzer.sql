CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`module_result_id` text,
	`fingerprint` text NOT NULL,
	`severity` text NOT NULL,
	`file_path` text,
	`line` integer,
	`message` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	FOREIGN KEY (`module_result_id`) REFERENCES `module_results`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `module_results` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text,
	`module_id` text NOT NULL,
	`score` integer NOT NULL,
	`confidence` real NOT NULL,
	`summary` text,
	`metrics` text,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text,
	`generated_prompt` text NOT NULL,
	`finding_ids` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`overall_score` integer,
	`last_scan_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_path_unique` ON `repos` (`path`);--> statement-breakpoint
CREATE TABLE `scan_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text,
	`enabled_modules` text,
	`ai_token_budget` integer DEFAULT 100000,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`overall_score` integer,
	`config_snapshot` text,
	`token_usage` integer DEFAULT 0,
	`duration_ms` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action
);
