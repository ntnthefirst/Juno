ALTER TABLE `mail_messages` ADD `seen_pending` integer;--> statement-breakpoint
CREATE INDEX `mail_messages_seen_pending_idx` ON `mail_messages` (`account_id`,`seen_pending`);