ALTER TABLE `mail_folders` ADD `sync_choice_at` text;--> statement-breakpoint
UPDATE `mail_folders` SET `sync_enabled` = 1 WHERE `sync_choice_at` IS NULL;
