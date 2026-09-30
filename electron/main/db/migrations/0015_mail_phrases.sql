CREATE TABLE `mail_phrase_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`message_kind` text DEFAULT 'any' NOT NULL,
	`recipient_kind` text DEFAULT 'any' NOT NULL,
	`account_id` text,
	`greeting_id` text,
	`signoff_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`greeting_id`) REFERENCES `mail_phrases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signoff_id`) REFERENCES `mail_phrases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_phrase_rules_owner_idx` ON `mail_phrase_rules` (`owner_id`);--> statement-breakpoint
CREATE INDEX `mail_phrase_rules_deleted_idx` ON `mail_phrase_rules` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `mail_phrase_rules_order_idx` ON `mail_phrase_rules` (`sort_order`);--> statement-breakpoint
CREATE INDEX `mail_phrase_rules_account_idx` ON `mail_phrase_rules` (`account_id`);--> statement-breakpoint
CREATE INDEX `mail_phrase_rules_greeting_idx` ON `mail_phrase_rules` (`greeting_id`);--> statement-breakpoint
CREATE INDEX `mail_phrase_rules_signoff_idx` ON `mail_phrase_rules` (`signoff_id`);--> statement-breakpoint
CREATE TABLE `mail_phrases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_phrases_owner_idx` ON `mail_phrases` (`owner_id`);--> statement-breakpoint
CREATE INDEX `mail_phrases_deleted_idx` ON `mail_phrases` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `mail_phrases_kind_order_idx` ON `mail_phrases` (`kind`,`sort_order`);