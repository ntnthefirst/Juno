-- There are no document templates any more (decision 82). The templates,
-- the pictures they carried, the components and the components' pictures
-- stay as rows, soft deleted, so nothing an older install had is lost from
-- the file. A document made from a template keeps its template_id: the row
-- it names still exists, and nothing reads it.
UPDATE `document_templates`
SET `deleted_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL;
--> statement-breakpoint
UPDATE `document_template_assets`
SET `deleted_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL;
--> statement-breakpoint
UPDATE `document_components`
SET `deleted_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL;
--> statement-breakpoint
UPDATE `document_component_assets`
SET `deleted_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL;
