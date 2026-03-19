CREATE TABLE `audits` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text,
	`provider` text NOT NULL,
	`model` text,
	`status` text DEFAULT 'running' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_results` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text,
	`module_id` text NOT NULL,
	`summary` text NOT NULL,
	`findings` text NOT NULL,
	`tokens_used` integer,
	`duration_ms` integer,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE no action
);
