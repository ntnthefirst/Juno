CREATE TABLE `mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`to_json` text DEFAULT '[]' NOT NULL,
	`cc_json` text DEFAULT '[]' NOT NULL,
	`bcc_json` text DEFAULT '[]' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body_text` text DEFAULT '' NOT NULL,
	`body_html` text,
	`message_id` text NOT NULL,
	`in_reply_to` text,
	`references_json` text DEFAULT '[]' NOT NULL,
	`reply_to_message_id` text,
	`thread_id` text,
	`client_id` text,
	`project_id` text,
	`template_id` text,
	`requested_by` text DEFAULT 'user' NOT NULL,
	`approved_at` text,
	`queued_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`sent_at` text,
	`appended_to_sent_at` text,
	`append_error` text,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_message_id`) REFERENCES `mail_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `mail_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `mail_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_account_state_idx` ON `mail_outbox` (`account_id`,`state`);--> statement-breakpoint
CREATE INDEX `mail_outbox_state_idx` ON `mail_outbox` (`state`);--> statement-breakpoint
CREATE INDEX `mail_outbox_thread_idx` ON `mail_outbox` (`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_client_idx` ON `mail_outbox` (`client_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_deleted_idx` ON `mail_outbox` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_outbox_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`outbox_id` text NOT NULL,
	`document_id` text NOT NULL,
	`filename` text NOT NULL,
	FOREIGN KEY (`outbox_id`) REFERENCES `mail_outbox`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_attachments_outbox_idx` ON `mail_outbox_attachments` (`outbox_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_attachments_document_idx` ON `mail_outbox_attachments` (`document_id`);--> statement-breakpoint
CREATE TABLE `mail_templates` (
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
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`language` text DEFAULT 'nl-BE' NOT NULL,
	`register` text DEFAULT 'u' NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_templates_key_idx` ON `mail_templates` (`key`);--> statement-breakpoint
CREATE INDEX `mail_templates_deleted_idx` ON `mail_templates` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `smtp_host` text;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `smtp_port` integer DEFAULT 465 NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `smtp_security` text DEFAULT 'tls' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `smtp_username` text;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `from_name` text;