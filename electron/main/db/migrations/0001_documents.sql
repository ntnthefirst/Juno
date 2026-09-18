CREATE TABLE `document_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`document_id` text NOT NULL,
	`signer_name` text NOT NULL,
	`signer_role` text,
	`signed_at` text NOT NULL,
	`signature_image_path` text,
	`document_hash` text NOT NULL,
	`signed_pdf_path` text,
	`audit_json` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_signatures_document_idx` ON `document_signatures` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_signatures_owner_idx` ON `document_signatures` (`owner_id`);--> statement-breakpoint
CREATE TABLE `document_templates` (
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
	`body_html` text NOT NULL,
	`reviewed_at` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_templates_key_idx` ON `document_templates` (`key`);--> statement-breakpoint
CREATE INDEX `document_templates_owner_idx` ON `document_templates` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_templates_deleted_idx` ON `document_templates` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`client_id` text NOT NULL,
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
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `document_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `reference_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_client_idx` ON `documents` (`client_id`);--> statement-breakpoint
CREATE INDEX `documents_project_idx` ON `documents` (`project_id`);--> statement-breakpoint
CREATE INDEX `documents_template_idx` ON `documents` (`template_id`);--> statement-breakpoint
CREATE INDEX `documents_status_idx` ON `documents` (`status_id`);--> statement-breakpoint
CREATE INDEX `documents_owner_idx` ON `documents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `documents_deleted_idx` ON `documents` (`deleted_at`);