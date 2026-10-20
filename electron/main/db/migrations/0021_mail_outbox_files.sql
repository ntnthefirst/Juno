CREATE TABLE `mail_outbox_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`outbox_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`file_date` text NOT NULL,
	`relative_path` text,
	`keep_as_document` integer DEFAULT false NOT NULL,
	`document_id` text,
	`keep_error` text,
	FOREIGN KEY (`outbox_id`) REFERENCES `mail_outbox`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_files_outbox_idx` ON `mail_outbox_files` (`outbox_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_files_document_idx` ON `mail_outbox_files` (`document_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_files_deleted_idx` ON `mail_outbox_files` (`deleted_at`);