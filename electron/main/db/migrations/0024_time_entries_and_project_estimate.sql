CREATE TABLE `project_status_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`project_id` text NOT NULL,
	`from_status_id` text,
	`to_status_id` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_status_changes_project_idx` ON `project_status_changes` (`project_id`,`deleted_at`,`changed_at`);--> statement-breakpoint
CREATE INDEX `project_status_changes_owner_idx` ON `project_status_changes` (`owner_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`project_id` text NOT NULL,
	`client_id` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_minutes` integer,
	`note` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entries_project_idx` ON `time_entries` (`project_id`,`deleted_at`,`started_at`);--> statement-breakpoint
CREATE INDEX `time_entries_client_idx` ON `time_entries` (`client_id`);--> statement-breakpoint
CREATE INDEX `time_entries_owner_idx` ON `time_entries` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_one_running_idx` ON `time_entries` (`owner_id`) WHERE "time_entries"."ended_at" is null and "time_entries"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE `projects` ADD `estimated_minutes` integer;