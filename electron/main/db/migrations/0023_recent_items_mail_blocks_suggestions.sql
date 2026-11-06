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
CREATE INDEX `recent_items_opened_idx` ON `recent_items` (`owner_id`,`deleted_at`,`opened_at`);--> statement-breakpoint
CREATE TABLE `mail_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`rule` text DEFAULT 'manual' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_blocks_list_idx` ON `mail_blocks` (`owner_id`,`deleted_at`,`kind`,`sort_order`);--> statement-breakpoint
CREATE TABLE `mail_suggestion_states` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`message_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `mail_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_suggestion_states_message_kind_idx` ON `mail_suggestion_states` (`owner_id`,`message_id`,`kind`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `mail_suggestion_states_message_idx` ON `mail_suggestion_states` (`message_id`);