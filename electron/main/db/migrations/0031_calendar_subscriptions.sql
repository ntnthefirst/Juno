CREATE TABLE `calendar_subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`subscription_id` text NOT NULL,
	`ical_uid` text NOT NULL,
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
	`exceptions_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `calendar_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_subscription_events_uid_idx` ON `calendar_subscription_events` (`subscription_id`,`ical_uid`);--> statement-breakpoint
CREATE INDEX `calendar_subscription_events_range_idx` ON `calendar_subscription_events` (`deleted_at`,`start_utc`);--> statement-breakpoint
CREATE INDEX `calendar_subscription_events_series_end_idx` ON `calendar_subscription_events` (`series_end_utc`);--> statement-breakpoint
CREATE INDEX `calendar_subscription_events_owner_idx` ON `calendar_subscription_events` (`owner_id`);--> statement-breakpoint
CREATE TABLE `calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`url_hash` text NOT NULL,
	`credential_key` text NOT NULL,
	`colour` text NOT NULL,
	`refresh_minutes` integer DEFAULT 60 NOT NULL,
	`shown` integer DEFAULT true NOT NULL,
	`last_fetched_at` text,
	`last_attempt_at` text,
	`last_error` text,
	`etag` text,
	`last_modified` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	`mail_account_id` text,
	FOREIGN KEY (`mail_account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_subscriptions_owner_idx` ON `calendar_subscriptions` (`owner_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `calendar_subscriptions_account_idx` ON `calendar_subscriptions` (`mail_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_subscriptions_url_idx` ON `calendar_subscriptions` (`owner_id`,`url_hash`) WHERE deleted_at IS NULL;