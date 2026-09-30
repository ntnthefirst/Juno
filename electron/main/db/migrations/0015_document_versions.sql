CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`pdf_path` text NOT NULL,
	`file_name` text,
	`file_date` text NOT NULL,
	`file_hash` text,
	`text_content` text,
	`signature_id` text,
	`mail_attachment_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signature_id`) REFERENCES `document_signatures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_versions_document_idx` ON `document_versions` (`document_id`,`file_date`);--> statement-breakpoint
CREATE INDEX `document_versions_signature_idx` ON `document_versions` (`signature_id`);--> statement-breakpoint
CREATE INDEX `document_versions_hash_idx` ON `document_versions` (`file_hash`);--> statement-breakpoint
CREATE INDEX `document_versions_owner_idx` ON `document_versions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_versions_deleted_idx` ON `document_versions` (`deleted_at`);--> statement-breakpoint
INSERT INTO `document_versions` (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`, `document_id`, `kind`, `source`, `pdf_path`, `file_name`, `file_date`, `file_hash`, `text_content`, `signature_id`, `mail_attachment_id`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`owner_id`,
	`created_at`,
	`created_at`,
	NULL,
	`id`,
	CASE WHEN `source_kind` = 'imported' THEN 'imported' ELSE 'generated' END,
	CASE WHEN `source_kind` = 'imported' THEN 'picker' ELSE 'generate' END,
	`pdf_path`,
	NULL,
	`created_at`,
	NULL,
	NULL,
	NULL,
	NULL
FROM `documents`
WHERE `pdf_path` IS NOT NULL;--> statement-breakpoint
INSERT INTO `document_versions` (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`, `document_id`, `kind`, `source`, `pdf_path`, `file_name`, `file_date`, `file_hash`, `text_content`, `signature_id`, `mail_attachment_id`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`owner_id`,
	`created_at`,
	`created_at`,
	NULL,
	`document_id`,
	CASE WHEN json_extract(`audit_json`, '$.digital') IS NOT NULL THEN 'signed' ELSE 'stamped' END,
	'sign',
	`signed_pdf_path`,
	NULL,
	`signed_at`,
	NULL,
	NULL,
	`id`,
	NULL
FROM `document_signatures`
WHERE `signed_pdf_path` IS NOT NULL AND `deleted_at` IS NULL;--> statement-breakpoint
UPDATE `documents`
SET `pdf_path` = (
	SELECT `v`.`pdf_path` FROM `document_versions` AS `v`
	WHERE `v`.`document_id` = `documents`.`id` AND `v`.`deleted_at` IS NULL
	ORDER BY `v`.`file_date` DESC, `v`.`created_at` DESC, `v`.`id` DESC
	LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM `document_versions` AS `v` WHERE `v`.`document_id` = `documents`.`id`);
