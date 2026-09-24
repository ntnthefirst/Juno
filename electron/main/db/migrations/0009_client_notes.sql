CREATE TABLE `client_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`happened_at` text NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_notes_client_idx` ON `client_notes` (`client_id`,`happened_at`);--> statement-breakpoint
CREATE INDEX `client_notes_owner_idx` ON `client_notes` (`owner_id`);--> statement-breakpoint
CREATE INDEX `client_notes_deleted_idx` ON `client_notes` (`deleted_at`);