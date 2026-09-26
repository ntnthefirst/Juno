ALTER TABLE `mail_templates` ADD `layout_json` text;--> statement-breakpoint
CREATE INDEX `mail_templates_hidden_idx` ON `mail_templates` (`hidden_at`);