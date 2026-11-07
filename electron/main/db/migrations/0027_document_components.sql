CREATE TABLE `document_component_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`component_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`file_hash` text NOT NULL,
	`relative_path` text NOT NULL,
	FOREIGN KEY (`component_id`) REFERENCES `document_components`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_component_assets_component_idx` ON `document_component_assets` (`component_id`);--> statement-breakpoint
CREATE INDEX `document_component_assets_hash_idx` ON `document_component_assets` (`file_hash`);--> statement-breakpoint
CREATE INDEX `document_component_assets_owner_idx` ON `document_component_assets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_component_assets_deleted_idx` ON `document_component_assets` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `document_components` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`description` text,
	`root_json` text NOT NULL,
	`fonts_json` text,
	`inputs_json` text
);
--> statement-breakpoint
CREATE INDEX `document_components_owner_idx` ON `document_components` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_components_deleted_idx` ON `document_components` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `document_components_name_idx` ON `document_components` (`name`);