CREATE TABLE `client_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`kind` text DEFAULT 'website' NOT NULL,
	`label` text,
	`url` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_links_client_idx` ON `client_links` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_links_owner_idx` ON `client_links` (`owner_id`);--> statement-breakpoint
CREATE INDEX `client_links_deleted_idx` ON `client_links` (`deleted_at`);