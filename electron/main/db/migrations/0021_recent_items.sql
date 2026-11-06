CREATE TABLE `recent_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recent_items_record_idx` ON `recent_items` (`owner_id`,`kind`,`record_id`);--> statement-breakpoint
CREATE INDEX `recent_items_opened_idx` ON `recent_items` (`owner_id`,`deleted_at`,`opened_at`);