/**
 * What each right-click menu offers.
 *
 * One registry for every kind, in the main process, built from the record the
 * menu was opened on. The renderer names a kind and an id and nothing else, so
 * a page cannot invent an item, and the rule "an item that does not apply is
 * left out, not greyed" is decided here once: a finished reminder offers
 * Reopen where an open one offers Mark done.
 *
 * This file only decides what is on the menu. Choosing an item either hands
 * a named action back to the screen, or is done by `menu-actions.ts`.
 *
 * Accelerators are listed only where the key really does that thing today.
 * A shortcut printed on a menu that does nothing is worse than none.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { BlankArea, MenuEntry, MenuRequest } from "../../shared/menu";
import { BLANK_AREAS, BLOCK_KINDS } from "../../shared/menu";
import { getDb, type Db } from "../db";
import { referenceItems } from "../db/schema";
import * as calendar from "./calendar";
import * as clientEmails from "./client-emails";
import * as clients from "./clients";
import * as documents from "./documents";
import * as outbox from "./mail-outbox";
import * as mailTemplates from "./mail-templates";
import * as notes from "./notes";
import * as threads from "./mail-threads";
import * as commands from "./project-commands";
import * as runner from "./project-runner";
import * as projects from "./projects";
import * as reminders from "./reminders";

/** What a blank area offers first, because it is what that screen is for. */
const OWN_NEW: Record<BlankArea, MenuEntry | null> = {
	overview: null,
	reminders: { id: "new-reminder", label: "New reminder", icon: "reminders" },
	calendar: { id: "new-event", label: "New event", icon: "calendar" },
	clients: { id: "new-client", label: "New client", icon: "clients" },
	projects: { id: "new-project", label: "New project", icon: "projects" },
	mail: { id: "new-message", label: "New message", icon: "mail" },
	notes: { id: "new-note", label: "New note", icon: "note" },
	documents: { id: "new-document", label: "New document", icon: "documents" },
};

const EVERYWHERE: MenuEntry[] = [
	{ id: "new-event", label: "New event", icon: "calendar" },
	{ id: "new-reminder", label: "New reminder", icon: "reminders" },
	{ id: "new-client", label: "New client", icon: "clients" },
	{ id: "new-project", label: "New project", icon: "projects" },
];

function blank(area: string, context: MenuRequest["context"]): MenuEntry[] {
	if (!(BLANK_AREAS as readonly string[]).includes(area)) return [];
	// The mail list has things to do to a list that no other screen has.
	if (area === "notes") {
		const [first, ...rest] = EVERYWHERE;
		return [
			{ id: "new-note", label: "New note", icon: "note" },
			{ id: "new-page", label: "New page", icon: "documents" },
			...(first ? [{ ...first, separatorBefore: true }] : []),
			...rest,
		];
	}
	if (area === "mail") {
		return [
			{ id: "new-message", label: "New message", icon: "mail" },
			{ id: "sync", label: "Sync now", icon: "sync" },
			{ id: "select-all", label: "Select all", icon: "check", separatorBefore: true },
			...(context === "unread" ? [{ id: "mark-all-read", label: "Mark all read", icon: "read" } as const] : []),
			{ id: "toggle-styled-mail", label: "Styled mail", icon: "templates", separatorBefore: true },
		];
	}
	const own = OWN_NEW[area as BlankArea];
	const rest = EVERYWHERE.filter((entry) => entry.id !== own?.id);
	return own ? [own, ...rest] : rest;
}

function isArchivedStatus(statusId: string | null, db: Db): boolean {
	if (!statusId) return false;
	const row = db
		.select({ key: referenceItems.key })
		.from(referenceItems)
		.where(and(eq(referenceItems.id, statusId), isNull(referenceItems.deletedAt)))
		.get();
	return row?.key === "archived";
}

const REMOVE: MenuEntry = { id: "delete", label: "Delete", icon: "remove", danger: true, separatorBefore: true };

/** The items for one menu, in order. Empty when the record is gone or the kind has nothing to say. */
export async function entriesFor(request: MenuRequest, db: Db = getDb()): Promise<MenuEntry[]> {
	const { kind, id, context } = request;

	switch (kind) {
		case "reminder": {
			const reminder = await reminders.get(id, db);
			if (!reminder) return [];
			const done = reminder.bucket === "done";
			const entries: MenuEntry[] = [
				done ? { id: "reopen", label: "Reopen", icon: "undo" } : { id: "complete", label: "Mark done", icon: "check" },
			];
			if (!done) {
				entries.push(
					{ id: "snooze-tomorrow", label: "Snooze until tomorrow", icon: "reminders" },
					{ id: "snooze", label: "Snooze until a date", icon: "calendar" },
				);
			}
			if (reminder.actionUrl && reminder.actionLabel) entries.push({ id: "open-link", label: reminder.actionLabel, icon: "external" });
			entries.push({ id: "edit", label: "Edit", icon: "edit" });
			if (reminder.clientId === null) entries.push({ id: "move-to-client", label: "Move to a client", icon: "clients" });
			entries.push(REMOVE);
			return entries;
		}

		case "event": {
			// A deadline chip is a project's date, so it is edited as the project and
			// clearing it leaves the project alone. Its id is the project's.
			if (context === "deadline") {
				if (!(await projects.get(id, db))) return [];
				return [
					{ id: "open", label: "Open", icon: "external" },
					{ id: "edit", label: "Edit project", icon: "edit" },
					{ id: "delete", label: "Clear deadline", icon: "remove", danger: true, separatorBefore: true },
				];
			}
			if (!(await calendar.get(id, db))) return [];
			return [
				{ id: "open", label: "Open", icon: "external" },
				{ id: "edit", label: "Edit", icon: "edit" },
				{ id: "duplicate-event", label: "Duplicate", icon: "templates" },
				REMOVE,
			];
		}

		case "client": {
			const client = await clients.get(id, db);
			if (!client) return [];
			const primary = (await clientEmails.listForClient(id, db)).find((row) => row.isPrimary) ?? null;
			// A record's own page is already open on it, so its menu leaves Open out.
			return [
				...(context === "detail" ? [] : [{ id: "open", label: "Open", icon: "external" } as const]),
				{ id: "edit", label: "Edit", icon: "edit" },
				{ id: "new-project", label: "New project", icon: "projects" },
				{ id: "new-note", label: "New note", icon: "note" },
				...(primary ? [{ id: "send-mail", label: "Send a mail", icon: "mail" } as const] : []),
				...(isArchivedStatus(client.statusId, db)
					? []
					: [{ id: "archive-client", label: "Archive", icon: "archive", separatorBefore: true } as const]),
				REMOVE,
			];
		}

		case "file": {
			const file = await documents.get(id, db);
			if (!file) return [];
			// A page has no file to hand to another program.
			const hasFile = file.sourceKind !== "page";
			return [
				{ id: "open", label: "Open", icon: "external" },
				...(hasFile ? [{ id: "open-in-default-app", label: "Open in the default app", icon: "documents" } as const] : []),
				...(hasFile ? [{ id: "download-file", label: "Download", icon: "export" } as const] : []),
				...(hasFile ? [{ id: "send-file", label: "Send by mail", icon: "mail" } as const] : []),
				REMOVE,
			];
		}

		case "mail": {
			const thread = await threads.getThread(id, db);
			if (!thread) return [];
			const { summary } = thread;
			// The reader's own "..." acts on the message in view, so it leaves out what the list row does to a whole row.
			if (context === "reader") {
				return [
					{ id: "archive", label: "Archive", icon: "archive" },
					{ id: "mark-unread", label: "Mark unread", icon: "mail" },
					{ id: "move", label: "Move to a folder", icon: "archive" },
					{ id: "junk", label: "Junk", icon: "junk" },
					{ id: "link", label: summary.clientName ? "Change client" : "Link to a client", icon: "link", separatorBefore: true },
					...(summary.clientId ? [{ id: "unlink-client", label: "Unlink client", icon: "link" } as const] : []),
					{ id: "file-project", label: summary.projectId ? "Change project" : "File under a project", icon: "projects" },
					...(summary.projectId ? [{ id: "unfile-project", label: "Take off the project", icon: "projects" } as const] : []),
					{ id: "copy-address", label: "Copy sender address", icon: "copy", separatorBefore: true },
				];
			}
			return [
				{ id: "open", label: "Open", icon: "external" },
				{ id: "reply", label: "Reply", icon: "reply", separatorBefore: true },
				{ id: "forward", label: "Forward", icon: "forward" },
				summary.unreadCount > 0
					? { id: "mark-read", label: "Mark as read", icon: "check", accelerator: "U", separatorBefore: true }
					: { id: "mark-unread", label: "Mark as unread", icon: "mail", accelerator: "U", separatorBefore: true },
				summary.isFlagged
					? { id: "unflag", label: "Clear flag", icon: "flag", accelerator: "S" }
					: { id: "flag", label: "Flag", icon: "flag", accelerator: "S" },
				{ id: "archive", label: "Archive", icon: "archive", accelerator: "E", separatorBefore: true },
				{ id: "move", label: "Move to a folder", icon: "archive", accelerator: "M" },
				{ id: "junk", label: "Junk", icon: "junk" },
				{ id: "link", label: summary.clientId ? "Change client link" : "Link to a client", icon: "link", separatorBefore: true },
				context === "trash"
					? { id: "delete-forever", label: "Delete forever", icon: "remove", danger: true, separatorBefore: true }
					: { id: "delete", label: "Move to trash", icon: "remove", accelerator: "Delete", danger: true, separatorBefore: true },
			];
		}

		case "blank":
			return blank(id, context);

		case "project": {
			const project = await projects.get(id, db);
			if (!project) return [];
			// Ctrl O and Delete are handled by the project's own page, so they are
			// printed on its menu and nowhere else.
			if (context !== "detail") {
				return [
					{ id: "open", label: "Open", icon: "external" },
					{ id: "open-folder", label: "Open folder", icon: "projects" },
					REMOVE,
				];
			}
			const entries: MenuEntry[] = [
				{ id: "open-folder", label: "Open folder", icon: "projects", accelerator: "CommandOrControl+O" },
				{ id: "copy-path", label: "Copy folder path", icon: "copy" },
				{ id: "change-folder", label: "Change folder", icon: "edit" },
			];
			const [first] = await commands.listForProject(id, db);
			if (first) {
				entries.push(
					runner.isRunning(first.id)
						? { id: "stop-start", label: "Stop start command", icon: "stop" }
						: { id: "run-start", label: "Run start command", icon: "play" },
				);
			}
			if (!isArchivedStatus(project.statusId, db)) {
				entries.push({ id: "archive", label: "Archive", icon: "archive", separatorBefore: true });
			}
			entries.push({ ...REMOVE, accelerator: "Delete", separatorBefore: !entries.some((entry) => entry.separatorBefore) });
			return entries;
		}

		case "add": {
			if (!(await projects.get(id, db))) return [];
			return [
				{ id: "add-mail", label: "Link a mail", icon: "mail" },
				{ id: "add-time", label: "Add time entry", icon: "play" },
				{ id: "add-event", label: "Add calendar event", icon: "calendar" },
				{ id: "add-file", label: "Add file", icon: "attachment" },
				{ id: "add-note", label: "Add note", icon: "note" },
			];
		}

		case "note": {
			const note = await notes.get(id, db);
			if (!note) return [];
			return [
				note.pinnedAt
					? { id: "unpin-note", label: "Unpin from the top", icon: "flag" }
					: { id: "pin-note", label: "Pin to the top", icon: "flag" },
				{ id: "duplicate-note", label: "Duplicate", icon: "templates", accelerator: "CommandOrControl+D" },
				{ id: "move-to-project", label: "Move to a project", icon: "projects" },
				{ ...REMOVE, accelerator: "Delete" },
			];
		}

		case "outbox": {
			const message = await outbox.get(id, db);
			if (!message) return [];
			const editable = message.state === "draft" || message.state === "pending";
			return [
				{ id: "open", label: editable ? "Edit" : "Open", icon: editable ? "edit" : "mail" },
				...(message.state === "failed" ? [{ id: "retry", label: "Try again", icon: "sync", separatorBefore: true } as const] : []),
				...(message.state === "queued" || message.state === "pending"
					? [{ id: "cancel-send", label: "Cancel sending", icon: "stop", separatorBefore: true } as const]
					: []),
			];
		}

		case "template": {
			if (!(await mailTemplates.get(id, db))) return [];
			return [
				{ id: "use-template", label: "Use", icon: "mail" },
				{ id: "show-wide", label: context === "detail" ? "Show narrow" : "Show full size", icon: "templates" },
				{ id: "open-template", label: "Open in Styled mail", icon: "external", separatorBefore: true },
				{ id: "edit", label: "Edit", icon: "edit" },
			];
		}

		case "block": {
			if (!(BLOCK_KINDS as readonly string[]).includes(id)) return [];
			return [
				{ id: "edit-block", label: `Edit this ${id}`, icon: "edit" },
				{ id: "new-block", label: `New ${id}`, icon: "add" },
				{ id: "manage-blocks", label: "Manage intros and outros", icon: "documents", separatorBefore: true },
			];
		}
	}
}
