-- Projects gain a workspace: the links, files and commands that say where a
-- project lives, plus an optional client, because the work a one-person
-- business does for itself takes the same shape as the work it does for a
-- client and inventing a client for it helps nobody.
--
-- The projects table is rebuilt rather than altered because SQLite cannot drop
-- a NOT NULL. The four new columns take their defaults for every existing row.
CREATE TABLE `project_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`project_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage` text DEFAULT 'managed' NOT NULL,
	`path` text NOT NULL,
	`byte_size` integer,
	`mime_type` text,
	`kind` text DEFAULT 'file' NOT NULL,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_assets_project_idx` ON `project_assets` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `project_assets_owner_idx` ON `project_assets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `project_assets_kind_idx` ON `project_assets` (`kind`);--> statement-breakpoint
CREATE INDEX `project_assets_deleted_idx` ON `project_assets` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `project_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`command` text NOT NULL,
	`working_dir` text,
	`kind` text DEFAULT 'shell' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_commands_project_idx` ON `project_commands` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `project_commands_owner_idx` ON `project_commands` (`owner_id`);--> statement-breakpoint
CREATE INDEX `project_commands_deleted_idx` ON `project_commands` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `project_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`project_id` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`label` text NOT NULL,
	`target` text NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_links_project_idx` ON `project_links` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `project_links_owner_idx` ON `project_links` (`owner_id`);--> statement-breakpoint
CREATE INDEX `project_links_deleted_idx` ON `project_links` (`deleted_at`);--> statement-breakpoint
-- No pragma here. The runner turns foreign keys off around every migration and
-- runs `PRAGMA foreign_key_check` inside the transaction instead, which is what
-- makes this drop and rename safe while the documents, reminders and calendar
-- rows that point at a project are still there. See db/migrate.ts.
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text,
	`name` text NOT NULL,
	`status_id` text,
	`description` text,
	`starts_on` text,
	`due_on` text,
	`agreed_value_cents` integer,
	`notes` text,
	`local_path` text,
	`storage_mode` text DEFAULT 'app' NOT NULL,
	`storage_path` text,
	`cover_asset_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "owner_id", "created_at", "updated_at", "deleted_at", "client_id", "name", "status_id", "description", "starts_on", "due_on", "agreed_value_cents", "notes", "local_path", "storage_mode", "storage_path", "cover_asset_id") SELECT "id", "owner_id", "created_at", "updated_at", "deleted_at", "client_id", "name", "status_id", "description", "starts_on", "due_on", "agreed_value_cents", "notes", NULL, 'app', NULL, NULL FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE INDEX `projects_client_idx` ON `projects` (`client_id`);--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status_id`);--> statement-breakpoint
CREATE INDEX `projects_due_idx` ON `projects` (`due_on`);--> statement-breakpoint
CREATE INDEX `projects_deleted_idx` ON `projects` (`deleted_at`);