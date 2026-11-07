CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`client_id` text,
	`project_id` text,
	`pinned_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notes_owner_idx` ON `notes` (`owner_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notes_client_idx` ON `notes` (`client_id`);--> statement-breakpoint
CREATE INDEX `notes_project_idx` ON `notes` (`project_id`);--> statement-breakpoint
ALTER TABLE `documents` ADD `blocks_json` text;--> statement-breakpoint
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
	`note_id` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `notes_fts_insert` AFTER INSERT ON `notes` BEGIN
	INSERT INTO `notes_fts` (`note_id`, `title`, `body`) VALUES (new.`id`, new.`title`, new.`body`);
END;--> statement-breakpoint
CREATE TRIGGER `notes_fts_update` AFTER UPDATE OF `title`, `body` ON `notes` BEGIN
	DELETE FROM `notes_fts` WHERE `note_id` = old.`id`;
	INSERT INTO `notes_fts` (`note_id`, `title`, `body`) VALUES (new.`id`, new.`title`, new.`body`);
END;--> statement-breakpoint
CREATE TRIGGER `notes_fts_delete` AFTER DELETE ON `notes` BEGIN
	DELETE FROM `notes_fts` WHERE `note_id` = old.`id`;
END;
