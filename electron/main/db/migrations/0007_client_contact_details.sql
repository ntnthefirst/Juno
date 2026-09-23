CREATE TABLE `client_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`label` text,
	`address_line1` text NOT NULL,
	`address_line2` text,
	`postal_code` text,
	`city` text,
	`country` text,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_addresses_client_idx` ON `client_addresses` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_addresses_owner_idx` ON `client_addresses` (`owner_id`);--> statement-breakpoint
CREATE INDEX `client_addresses_deleted_idx` ON `client_addresses` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `client_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`email` text NOT NULL,
	`label` text,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_emails_client_idx` ON `client_emails` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_emails_owner_idx` ON `client_emails` (`owner_id`);--> statement-breakpoint
CREATE INDEX `client_emails_email_idx` ON `client_emails` (`email`);--> statement-breakpoint
CREATE INDEX `client_emails_deleted_idx` ON `client_emails` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `client_phones` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
	`phone` text NOT NULL,
	`label` text,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_phones_client_idx` ON `client_phones` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_phones_owner_idx` ON `client_phones` (`owner_id`);--> statement-breakpoint
CREATE INDEX `client_phones_deleted_idx` ON `client_phones` (`deleted_at`);--> statement-breakpoint
INSERT INTO `client_emails` (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`, `client_id`, `email`, `label`, `is_primary`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`owner_id`,
	`created_at`,
	`created_at`,
	NULL,
	`id`,
	`email`,
	NULL,
	1
FROM `clients`
WHERE `email` IS NOT NULL AND trim(`email`) != '';--> statement-breakpoint
INSERT INTO `client_phones` (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`, `client_id`, `phone`, `label`, `is_primary`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`owner_id`,
	`created_at`,
	`created_at`,
	NULL,
	`id`,
	`phone`,
	NULL,
	1
FROM `clients`
WHERE `phone` IS NOT NULL AND trim(`phone`) != '';--> statement-breakpoint
INSERT INTO `client_addresses` (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`, `client_id`, `label`, `address_line1`, `address_line2`, `postal_code`, `city`, `country`, `is_primary`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`owner_id`,
	`created_at`,
	`created_at`,
	NULL,
	`id`,
	NULL,
	coalesce(`address_line1`, ''),
	`address_line2`,
	`postal_code`,
	`city`,
	`country`,
	1
FROM `clients`
WHERE coalesce(trim(`address_line1`), '') != ''
	OR coalesce(trim(`address_line2`), '') != ''
	OR coalesce(trim(`postal_code`), '') != ''
	OR coalesce(trim(`city`), '') != ''
	OR coalesce(trim(`country`), '') != '';--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `phone`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `address_line1`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `address_line2`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `postal_code`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `city`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `country`;
