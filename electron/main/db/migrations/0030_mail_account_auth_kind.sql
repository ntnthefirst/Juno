ALTER TABLE `mail_accounts` ADD `auth_kind` text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `auth_expired_at` text;