CREATE TABLE `mail_outbox_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`outbox_id` text NOT NULL,
	`client_id` text NOT NULL,
	`matched_address` text NOT NULL,
	FOREIGN KEY (`outbox_id`) REFERENCES `mail_outbox`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_clients_outbox_idx` ON `mail_outbox_clients` (`outbox_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_clients_client_idx` ON `mail_outbox_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_clients_deleted_idx` ON `mail_outbox_clients` (`deleted_at`);