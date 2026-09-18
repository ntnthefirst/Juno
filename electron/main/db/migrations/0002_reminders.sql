CREATE TABLE `reminder_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`reminder_id` text NOT NULL,
	`due_on` text NOT NULL,
	`completed_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminder_completions_reminder_idx` ON `reminder_completions` (`reminder_id`);--> statement-breakpoint
CREATE INDEX `reminder_completions_due_idx` ON `reminder_completions` (`due_on`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`seed_key` text,
	`is_system` integer DEFAULT false NOT NULL,
	`hidden_at` text,
	`customised_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_on` text NOT NULL,
	`pattern` text DEFAULT 'once' NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`anchor_day` integer,
	`lead_days` integer DEFAULT 0 NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`client_id` text,
	`project_id` text,
	`document_id` text,
	`snoozed_until` text,
	`completed_at` text,
	`last_completed_on` text,
	`action_url` text,
	`action_label` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`due_on`);--> statement-breakpoint
CREATE INDEX `reminders_client_idx` ON `reminders` (`client_id`);--> statement-breakpoint
CREATE INDEX `reminders_project_idx` ON `reminders` (`project_id`);--> statement-breakpoint
CREATE INDEX `reminders_owner_idx` ON `reminders` (`owner_id`);--> statement-breakpoint
CREATE INDEX `reminders_completed_idx` ON `reminders` (`completed_at`);--> statement-breakpoint
CREATE INDEX `reminders_deleted_idx` ON `reminders` (`deleted_at`);