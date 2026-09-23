ALTER TABLE `document_templates` ADD `layout_json` text;--> statement-breakpoint
ALTER TABLE `document_templates` ADD `inputs_json` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_kind` text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_templates` ADD `inputs_json` text;