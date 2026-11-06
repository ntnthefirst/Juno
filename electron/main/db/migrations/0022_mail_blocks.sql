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
CREATE INDEX `mail_blocks_list_idx` ON `mail_blocks` (`owner_id`,`deleted_at`,`kind`,`sort_order`);