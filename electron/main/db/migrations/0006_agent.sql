CREATE TABLE `agent_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tool_name` text NOT NULL,
	`args_json` text DEFAULT '{}' NOT NULL,
	`summary` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'mcp' NOT NULL,
	`automation_run_id` text,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`executed_at` text,
	`result_json` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `agent_actions_state_idx` ON `agent_actions` (`state`);--> statement-breakpoint
CREATE INDEX `agent_actions_run_idx` ON `agent_actions` (`automation_run_id`);--> statement-breakpoint
CREATE INDEX `agent_actions_owner_idx` ON `agent_actions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `agent_actions_deleted_idx` ON `agent_actions` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`actor` text NOT NULL,
	`tool_name` text NOT NULL,
	`args_digest` text NOT NULL,
	`summary` text NOT NULL,
	`result` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`action_id` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor`);--> statement-breakpoint
CREATE INDEX `audit_events_tool_idx` ON `audit_events` (`tool_name`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_deleted_idx` ON `audit_events` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`automation_id` text NOT NULL,
	`started_by` text DEFAULT 'manual' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`log_json` text DEFAULT '[]' NOT NULL,
	`stopped_at_step` integer,
	`error` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `automation_runs_automation_idx` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_deleted_idx` ON `automation_runs` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`description` text,
	`trigger_json` text DEFAULT '{"kind":"manual"}' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_run_on` text
);
--> statement-breakpoint
CREATE INDEX `automations_enabled_idx` ON `automations` (`enabled`);--> statement-breakpoint
CREATE INDEX `automations_owner_idx` ON `automations` (`owner_id`);--> statement-breakpoint
CREATE INDEX `automations_deleted_idx` ON `automations` (`deleted_at`);