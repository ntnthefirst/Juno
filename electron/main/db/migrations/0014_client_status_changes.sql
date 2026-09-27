CREATE TABLE `client_status_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`from_status_id` text,
	`to_status_id` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_status_changes_client_idx` ON `client_status_changes` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_status_changes_deleted_idx` ON `client_status_changes` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `client_status_changes_client_deleted_changed_idx` ON `client_status_changes` (`client_id`,`deleted_at`,`changed_at`);