ALTER TABLE module_results ADD COLUMN state TEXT NOT NULL DEFAULT 'completed';
--> statement-breakpoint
ALTER TABLE module_results ADD COLUMN state_reason TEXT;
