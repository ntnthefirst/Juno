CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`sort_name` text NOT NULL,
	`status_id` text,
	`email` text,
	`phone` text,
	`website` text,
	`vat_number` text,
	`address_line1` text,
	`address_line2` text,
	`postal_code` text,
	`city` text,
	`country` text,
	`notes` text,
	FOREIGN KEY (`status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clients_owner_idx` ON `clients` (`owner_id`);--> statement-breakpoint
CREATE INDEX `clients_sort_name_idx` ON `clients` (`sort_name`);--> statement-breakpoint
CREATE INDEX `clients_status_idx` ON `clients` (`status_id`);--> statement-breakpoint
CREATE INDEX `clients_deleted_idx` ON `clients` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`email` text,
	`phone` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_client_idx` ON `contacts` (`client_id`);--> statement-breakpoint
CREATE INDEX `contacts_owner_idx` ON `contacts` (`owner_id`);--> statement-breakpoint
CREATE INDEX `contacts_email_idx` ON `contacts` (`email`);--> statement-breakpoint
CREATE INDEX `contacts_deleted_idx` ON `contacts` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`status_id` text,
	`description` text,
	`starts_on` text,
	`due_on` text,
	`agreed_value_cents` integer,
	`notes` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_client_idx` ON `projects` (`client_id`);--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status_id`);--> statement-breakpoint
CREATE INDEX `projects_due_idx` ON `projects` (`due_on`);--> statement-breakpoint
CREATE INDEX `projects_deleted_idx` ON `projects` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `reference_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`seed_key` text,
	`is_system` integer DEFAULT false NOT NULL,
	`hidden_at` text,
	`customised_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`set_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`tone` text,
	FOREIGN KEY (`set_id`) REFERENCES `reference_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reference_items_set_idx` ON `reference_items` (`set_id`);--> statement-breakpoint
CREATE INDEX `reference_items_hidden_idx` ON `reference_items` (`hidden_at`);--> statement-breakpoint
CREATE TABLE `reference_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`allows_custom_items` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reference_sets_key_idx` ON `reference_sets` (`key`);