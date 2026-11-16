CREATE TABLE `document_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`parent_id` text,
	`client_id` text,
	`project_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `document_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_folders_parent_idx` ON `document_folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `document_folders_client_idx` ON `document_folders` (`client_id`);--> statement-breakpoint
CREATE INDEX `document_folders_project_idx` ON `document_folders` (`project_id`);--> statement-breakpoint
CREATE INDEX `document_folders_owner_idx` ON `document_folders` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_folders_deleted_idx` ON `document_folders` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `document_working_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`document_id` text NOT NULL,
	`version_id` text NOT NULL,
	`path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`modified_ms` integer NOT NULL,
	`file_hash` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_working_copies_document_idx` ON `document_working_copies` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_working_copies_version_idx` ON `document_working_copies` (`version_id`);--> statement-breakpoint
CREATE INDEX `document_working_copies_owner_idx` ON `document_working_copies` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_working_copies_deleted_idx` ON `document_working_copies` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `document_versions` ADD `media_type` text;--> statement-breakpoint
ALTER TABLE `document_versions` ADD `byte_size` integer;--> statement-breakpoint
UPDATE `document_versions` SET `media_type` = 'application/pdf' WHERE `media_type` IS NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `folder_id` text REFERENCES document_folders(id);--> statement-breakpoint
CREATE INDEX `documents_folder_idx` ON `documents` (`folder_id`);