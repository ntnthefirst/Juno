CREATE TABLE `mail_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`label` text NOT NULL,
	`email` text NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer DEFAULT 993 NOT NULL,
	`imap_security` text DEFAULT 'tls' NOT NULL,
	`username` text NOT NULL,
	`credential_key` text NOT NULL,
	`horizon_days` integer DEFAULT 90 NOT NULL,
	`sync_interval_minutes` integer DEFAULT 10 NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` text,
	`last_sync_error` text
);
--> statement-breakpoint
CREATE INDEX `mail_accounts_owner_idx` ON `mail_accounts` (`owner_id`);--> statement-breakpoint
CREATE INDEX `mail_accounts_deleted_idx` ON `mail_accounts` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`file_path` text NOT NULL,
	`content_id` text,
	`is_inline` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `mail_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_attachments_message_idx` ON `mail_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_attachments_deleted_idx` ON `mail_attachments` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`delimiter` text,
	`special_use` text,
	`uid_validity` text,
	`uid_next` integer,
	`sync_enabled` integer DEFAULT false NOT NULL,
	`synced_horizon_days` integer,
	`message_count` integer DEFAULT 0 NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_sync_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_folders_account_path_idx` ON `mail_folders` (`account_id`,`path`);--> statement-breakpoint
CREATE INDEX `mail_folders_deleted_idx` ON `mail_folders` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`folder_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`uid` integer NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`references_json` text DEFAULT '[]' NOT NULL,
	`from_name` text,
	`from_address` text,
	`to_json` text DEFAULT '[]' NOT NULL,
	`cc_json` text DEFAULT '[]' NOT NULL,
	`reply_to_json` text DEFAULT '[]' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`sent_at` text,
	`internal_date` text NOT NULL,
	`size` integer,
	`is_seen` integer DEFAULT false NOT NULL,
	`is_flagged` integer DEFAULT false NOT NULL,
	`is_answered` integer DEFAULT false NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`body_text` text,
	`body_html` text,
	`body_fetched_at` text,
	`body_error` text,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `mail_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `mail_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_folder_uid_idx` ON `mail_messages` (`account_id`,`folder_id`,`uid`);--> statement-breakpoint
CREATE INDEX `mail_messages_thread_idx` ON `mail_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_folder_date_idx` ON `mail_messages` (`folder_id`,`internal_date`);--> statement-breakpoint
CREATE INDEX `mail_messages_account_message_id_idx` ON `mail_messages` (`account_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_from_idx` ON `mail_messages` (`from_address`);--> statement-breakpoint
CREATE INDEX `mail_messages_body_pending_idx` ON `mail_messages` (`folder_id`,`body_fetched_at`);--> statement-breakpoint
CREATE INDEX `mail_messages_deleted_idx` ON `mail_messages` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`subject` text NOT NULL,
	`subject_norm` text NOT NULL,
	`client_id` text,
	`link_source` text,
	`first_message_at` text NOT NULL,
	`last_message_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_threads_account_last_idx` ON `mail_threads` (`account_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `mail_threads_client_idx` ON `mail_threads` (`client_id`);--> statement-breakpoint
CREATE INDEX `mail_threads_deleted_idx` ON `mail_threads` (`deleted_at`);--> statement-breakpoint
CREATE VIRTUAL TABLE `mail_messages_fts` USING fts5(
	`message_id` UNINDEXED,
	`subject`,
	`body_text`,
	`from_name`,
	`from_address`,
	tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `mail_messages_fts_insert` AFTER INSERT ON `mail_messages` BEGIN
	INSERT INTO `mail_messages_fts` (`message_id`, `subject`, `body_text`, `from_name`, `from_address`)
	VALUES (new.`id`, new.`subject`, coalesce(new.`body_text`, ''), coalesce(new.`from_name`, ''), coalesce(new.`from_address`, ''));
END;--> statement-breakpoint
CREATE TRIGGER `mail_messages_fts_update` AFTER UPDATE OF `subject`, `body_text`, `from_name`, `from_address` ON `mail_messages` BEGIN
	DELETE FROM `mail_messages_fts` WHERE `message_id` = old.`id`;
	INSERT INTO `mail_messages_fts` (`message_id`, `subject`, `body_text`, `from_name`, `from_address`)
	VALUES (new.`id`, new.`subject`, coalesce(new.`body_text`, ''), coalesce(new.`from_name`, ''), coalesce(new.`from_address`, ''));
END;--> statement-breakpoint
CREATE TRIGGER `mail_messages_fts_delete` AFTER DELETE ON `mail_messages` BEGIN
	DELETE FROM `mail_messages_fts` WHERE `message_id` = old.`id`;
END;
