ALTER TABLE `mail_threads` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `mail_threads_project_idx` ON `mail_threads` (`project_id`);--> statement-breakpoint
ALTER TABLE `mail_outbox_files` ADD `source_asset_id` text REFERENCES project_assets(id);--> statement-breakpoint
ALTER TABLE `mail_outbox_files` ADD `kept_asset_id` text REFERENCES project_assets(id);--> statement-breakpoint
CREATE INDEX `mail_outbox_message_id_idx` ON `mail_outbox` (`message_id`);