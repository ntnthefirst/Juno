CREATE TABLE `document_template_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`template_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`file_hash` text NOT NULL,
	`relative_path` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `document_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_template_assets_template_idx` ON `document_template_assets` (`template_id`);--> statement-breakpoint
CREATE INDEX `document_template_assets_hash_idx` ON `document_template_assets` (`file_hash`);--> statement-breakpoint
CREATE INDEX `document_template_assets_owner_idx` ON `document_template_assets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_template_assets_deleted_idx` ON `document_template_assets` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `document_templates` ADD `canvas_json` text;