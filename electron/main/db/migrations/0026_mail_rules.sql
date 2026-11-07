CREATE TABLE `mail_rule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_name` text NOT NULL,
	`message_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`from_address` text,
	`action` text NOT NULL,
	`detail` text,
	`result` text NOT NULL,
	`error` text,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `mail_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_rule_runs_account_idx` ON `mail_rule_runs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mail_rule_runs_rule_idx` ON `mail_rule_runs` (`rule_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mail_rule_runs_deleted_idx` ON `mail_rule_runs` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_rule_seen` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`message_key` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_rule_seen_key_idx` ON `mail_rule_seen` (`account_id`,`message_key`);--> statement-breakpoint
CREATE INDEX `mail_rule_seen_deleted_idx` ON `mail_rule_seen` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `mail_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`match_mode` text DEFAULT 'all' NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`stop_on_match` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `mail_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mail_rules_list_idx` ON `mail_rules` (`account_id`,`deleted_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `mail_rules_deleted_idx` ON `mail_rules` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `rules_since` text;
--> statement-breakpoint
UPDATE `mail_accounts` SET `rules_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
