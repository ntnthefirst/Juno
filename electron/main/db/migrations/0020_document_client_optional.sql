CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text,
	`project_id` text,
	`template_id` text,
	`template_version` integer,
	`title` text NOT NULL,
	`status_id` text,
	`body_html` text NOT NULL,
	`variables_json` text,
	`issued_on` text,
	`pdf_path` text,
	`is_specimen` integer DEFAULT true NOT NULL,
	`source_kind` text DEFAULT 'generated' NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `document_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "owner_id", "created_at", "updated_at", "deleted_at", "client_id", "project_id", "template_id", "template_version", "title", "status_id", "body_html", "variables_json", "issued_on", "pdf_path", "is_specimen", "source_kind") SELECT "id", "owner_id", "created_at", "updated_at", "deleted_at", "client_id", "project_id", "template_id", "template_version", "title", "status_id", "body_html", "variables_json", "issued_on", "pdf_path", "is_specimen", "source_kind" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
CREATE INDEX `documents_client_idx` ON `documents` (`client_id`);--> statement-breakpoint
CREATE INDEX `documents_project_idx` ON `documents` (`project_id`);--> statement-breakpoint
CREATE INDEX `documents_template_idx` ON `documents` (`template_id`);--> statement-breakpoint
CREATE INDEX `documents_status_idx` ON `documents` (`status_id`);--> statement-breakpoint
CREATE INDEX `documents_owner_idx` ON `documents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `documents_deleted_idx` ON `documents` (`deleted_at`);