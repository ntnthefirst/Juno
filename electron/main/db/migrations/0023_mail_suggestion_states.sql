CREATE TABLE `mail_suggestion_states` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`message_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `mail_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_suggestion_states_message_kind_idx` ON `mail_suggestion_states` (`owner_id`,`message_id`,`kind`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `mail_suggestion_states_message_idx` ON `mail_suggestion_states` (`message_id`);