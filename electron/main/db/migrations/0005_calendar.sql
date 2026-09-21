CREATE TABLE `calendar_event_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`event_id` text NOT NULL,
	`occurrence_start_local` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	`title` text,
	`notes` text,
	`location` text,
	`start_local` text,
	`end_local` text,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_event_exceptions_event_idx` ON `calendar_event_exceptions` (`event_id`,`occurrence_start_local`);--> statement-breakpoint
CREATE INDEX `calendar_event_exceptions_deleted_idx` ON `calendar_event_exceptions` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`title` text NOT NULL,
	`notes` text,
	`location` text,
	`all_day` integer DEFAULT false NOT NULL,
	`start_local` text NOT NULL,
	`end_local` text NOT NULL,
	`timezone` text NOT NULL,
	`rrule` text,
	`start_utc` text NOT NULL,
	`end_utc` text NOT NULL,
	`series_end_utc` text,
	`ical_uid` text NOT NULL,
	`client_id` text,
	`project_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_events_owner_idx` ON `calendar_events` (`owner_id`);--> statement-breakpoint
CREATE INDEX `calendar_events_start_idx` ON `calendar_events` (`start_utc`);--> statement-breakpoint
CREATE INDEX `calendar_events_series_end_idx` ON `calendar_events` (`series_end_utc`);--> statement-breakpoint
CREATE INDEX `calendar_events_uid_idx` ON `calendar_events` (`owner_id`,`ical_uid`);--> statement-breakpoint
CREATE INDEX `calendar_events_client_idx` ON `calendar_events` (`client_id`);--> statement-breakpoint
CREATE INDEX `calendar_events_project_idx` ON `calendar_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `calendar_events_deleted_idx` ON `calendar_events` (`deleted_at`);