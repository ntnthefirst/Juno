-- There are no folders any more (decision 81). Every document that sits in
-- one is kept under that folder's place instead: a folder of a project gives
-- the document that project and the project's client, a folder of a client
-- gives it that client. The folders stay as rows, soft deleted, so nothing an
-- older install had is lost from the file.
UPDATE `documents`
SET `project_id` = (SELECT `f`.`project_id` FROM `document_folders` AS `f` WHERE `f`.`id` = `documents`.`folder_id`)
WHERE `folder_id` IS NOT NULL
	AND (SELECT `f`.`project_id` FROM `document_folders` AS `f` WHERE `f`.`id` = `documents`.`folder_id`) IS NOT NULL;
--> statement-breakpoint
UPDATE `documents`
SET `client_id` = (SELECT `p`.`client_id` FROM `projects` AS `p` WHERE `p`.`id` = `documents`.`project_id`)
WHERE `folder_id` IS NOT NULL
	AND (SELECT `f`.`project_id` FROM `document_folders` AS `f` WHERE `f`.`id` = `documents`.`folder_id`) IS NOT NULL;
--> statement-breakpoint
UPDATE `documents`
SET `client_id` = (SELECT `f`.`client_id` FROM `document_folders` AS `f` WHERE `f`.`id` = `documents`.`folder_id`)
WHERE `folder_id` IS NOT NULL
	AND (SELECT `f`.`project_id` FROM `document_folders` AS `f` WHERE `f`.`id` = `documents`.`folder_id`) IS NULL
	AND (SELECT `f`.`client_id` FROM `document_folders` AS `f` WHERE `f`.`id` = `documents`.`folder_id`) IS NOT NULL;
--> statement-breakpoint
UPDATE `documents`
SET `folder_id` = NULL, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `folder_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `document_folders`
SET `deleted_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL;
