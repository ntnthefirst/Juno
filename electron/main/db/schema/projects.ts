import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { projects } from "./clients";

/**
 * The workspace around a project: the places it lives, the files that belong to
 * it, and the commands that start it.
 *
 * A project row says what the work is and what it is worth. These three tables
 * say where it is. They are separate rows rather than JSON on the project
 * because each one is a thing the user reorders, opens and deletes on its own,
 * and because a JSON column cannot be indexed or soft-deleted.
 */

/**
 * A place the project lives that is not a file: a repository, a design file, a
 * staging URL, a folder on this machine.
 *
 * `target` is an https URL or an absolute local path, and `kind` decides which.
 * Opening one is the service's job, not the renderer's: a URL goes to the
 * browser after a protocol check, a path goes to the file manager, and neither
 * decision belongs in a component.
 */
export const projectLinks = sqliteTable(
	"project_links",
	{
		...standardColumns,
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		/** github, figma, website, design, docs, folder, other. Drives the icon. */
		kind: text("kind").notNull().default("other"),
		label: text("label").notNull(),
		target: text("target").notNull(),
		notes: text("notes"),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [
		index("project_links_project_idx").on(t.projectId, t.sortOrder),
		index("project_links_owner_idx").on(t.ownerId),
		index("project_links_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A file that belongs to the project: a screenshot, an export, a brief.
 *
 * `storage` is the whole of the decision the user makes in the three-dot menu.
 * A managed file was copied into the project's folder and Juno owns it, so
 * `path` is relative to that folder and moving the folder moves the file. A
 * linked file stays where it was, so `path` is absolute and Juno never writes
 * to it or deletes it. Ten gigabytes of video belong in the second kind.
 */
export const projectAssets = sqliteTable(
	"project_assets",
	{
		...standardColumns,
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		/** What to call it on screen. Starts as the file name and can be renamed. */
		fileName: text("file_name").notNull(),
		/** managed: Juno copied it in and owns it. linked: it stays where it is. */
		storage: text("storage").notNull().default("managed"),
		/** Relative to the project's folder when managed, absolute when linked. */
		path: text("path").notNull(),
		byteSize: integer("byte_size"),
		mimeType: text("mime_type"),
		/** image, pdf, video, audio, archive, file. Decides whether it previews. */
		kind: text("kind").notNull().default("file"),
		caption: text("caption"),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [
		index("project_assets_project_idx").on(t.projectId, t.sortOrder),
		index("project_assets_owner_idx").on(t.ownerId),
		index("project_assets_kind_idx").on(t.kind),
		index("project_assets_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A command that starts the project: `npm run dev`, `docker compose up`.
 *
 * It runs in a real shell with the user's own privileges, which is exactly as
 * powerful as typing it in a terminal. That is why nothing here is reachable
 * from an agent: decision 35, and .claude/rules/mcp.md section 7 on tools that
 * take a raw statement.
 */
export const projectCommands = sqliteTable(
	"project_commands",
	{
		...standardColumns,
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		label: text("label").notNull(),
		command: text("command").notNull(),
		/** Null falls back to the project's local folder. */
		workingDir: text("working_dir"),
		/** shell or docker. An icon and nothing else: both run the same way. */
		kind: text("kind").notNull().default("shell"),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [
		index("project_commands_project_idx").on(t.projectId, t.sortOrder),
		index("project_commands_owner_idx").on(t.ownerId),
		index("project_commands_deleted_idx").on(t.deletedAt),
	],
);
