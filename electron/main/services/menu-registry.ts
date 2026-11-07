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
import * as clients from "./clients";
import * as documents from "./documents";
import * as notes from "./notes";
import * as threads from "./mail-threads";
import * as commands from "./project-commands";
import * as runner from "./project-runner";
import * as projects from "./projects";
import * as reminders from "./reminders";

/** What a blank area offers first, because it is what that screen is for. */
const OWN_NEW: Record<BlankArea, MenuEntry | null> = {
	overview: null,
	reminders: { id: "new-reminder", label: "New reminder" },
	calendar: { id: "new-event", label: "New event" },
	clients: { id: "new-client", label: "New client" },
	projects: { id: "new-project", label: "New project" },
	mail: { id: "new-message", label: "New message" },
	notes: { id: "new-note", label: "New note" },
	documents: { id: "new-document", label: "New document" },
};

const EVERYWHERE: MenuEntry[] = [
	{ id: "new-event", label: "New event" },
	{ id: "new-reminder", label: "New reminder" },
	{ id: "new-client", label: "New client" },
	{ id: "new-project", label: "New project" },
];

function blank(area: string, context: MenuRequest["context"]): MenuEntry[] {
	if (!(BLANK_AREAS as readonly string[]).includes(area)) return [];
	// The mail list has things to do to a list that no other screen has.
	if (area === "notes") {
		const [first, ...rest] = EVERYWHERE;
		return [
			{ id: "new-note", label: "New note" },
			{ id: "new-page", label: "New page" },
			...(first ? [{ ...first, separatorBefore: true }] : []),
			...rest,
		];
	}
	if (area === "mail") {
		return [
			{ id: "new-message", label: "New message" },
			{ id: "sync", label: "Sync now" },
			{ id: "select-all", label: "Select all", separatorBefore: true },
			...(context === "unread" ? [{ id: "mark-all-read", label: "Mark all read" } as const] : []),
			{ id: "toggle-styled-mail", label: "Styled mail", separatorBefore: true },
		];
	}
	const own = OWN_NEW[area as BlankArea];
	const rest = EVERYWHERE.filter((entry) => entry.id !== own?.id);
	return own ? [own, ...rest] : rest;
}

function projectIsArchived(statusId: string | null, db: Db): boolean {
	if (!statusId) return false;
	const row = db
		.select({ key: referenceItems.key })
		.from(referenceItems)
		.where(and(eq(referenceItems.id, statusId), isNull(referenceItems.deletedAt)))
		.get();
	return row?.key === "archived";
}

const REMOVE: MenuEntry = { id: "delete", label: "Delete", danger: true, separatorBefore: true };

/** The items for one menu, in order. Empty when the record is gone or the kind has nothing to say. */
export async function entriesFor(request: MenuRequest, db: Db = getDb()): Promise<MenuEntry[]> {
	const { kind, id, context } = request;

	switch (kind) {
		case "reminder": {
			const reminder = await reminders.get(id, db);
			if (!reminder) return [];
			const done = reminder.bucket === "done";
			const entries: MenuEntry[] = [done ? { id: "reopen", label: "Reopen" } : { id: "complete", label: "Mark done" }];
			if (!done) entries.push({ id: "snooze-tomorrow", label: "Snooze until tomorrow" }, { id: "snooze", label: "Snooze until a date" });
			if (reminder.actionUrl && reminder.actionLabel) entries.push({ id: "open-link", label: reminder.actionLabel });
			entries.push({ id: "edit", label: "Edit" });
			if (reminder.clientId === null) entries.push({ id: "move-to-client", label: "Move to a client" });
			entries.push(REMOVE);
			return entries;
		}

		case "event": {
			// A deadline chip is a project's date, so it is edited as the project and
			// clearing it leaves the project alone. Its id is the project's.
			if (context === "deadline") {
				if (!(await projects.get(id, db))) return [];
				return [
					{ id: "open", label: "Open" },
					{ id: "edit", label: "Edit project" },
					{ id: "delete", label: "Clear deadline", danger: true, separatorBefore: true },
				];
			}
			if (!(await calendar.get(id, db))) return [];
			return [{ id: "open", label: "Open" }, { id: "edit", label: "Edit" }, REMOVE];
		}

		case "client": {
			if (!(await clients.get(id, db))) return [];
			return [
				{ id: "open", label: "Open" },
				{ id: "edit", label: "Edit" },
				{ id: "new-note", label: "New note" },
				REMOVE,
			];
		}

		case "file": {
			const file = await documents.get(id, db);
			if (!file) return [];
			// A page has no file to hand to another program.
			return [
				{ id: "open", label: "Open" },
				...(file.sourceKind === "page" ? [] : [{ id: "open-in-default-app", label: "Open in the default app" } as const]),
				REMOVE,
			];
		}

		case "mail": {
			const thread = await threads.getThread(id, db);
			if (!thread) return [];
			const { summary } = thread;
			return [
				{ id: "open", label: "Open" },
				summary.unreadCount > 0
					? { id: "mark-read", label: "Mark as read", accelerator: "U", separatorBefore: true }
					: { id: "mark-unread", label: "Mark as unread", accelerator: "U", separatorBefore: true },
				summary.isFlagged
					? { id: "unflag", label: "Clear flag", accelerator: "S" }
					: { id: "flag", label: "Flag", accelerator: "S" },
				{ id: "archive", label: "Archive", accelerator: "E", separatorBefore: true },
				{ id: "move", label: "Move to a folder", accelerator: "M" },
				{ id: "junk", label: "Junk" },
				{ id: "link", label: summary.clientId ? "Change client link" : "Link to a client", separatorBefore: true },
				context === "trash"
					? { id: "delete-forever", label: "Delete forever", danger: true, separatorBefore: true }
					: { id: "delete", label: "Move to trash", accelerator: "Delete", danger: true, separatorBefore: true },
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
				return [{ id: "open", label: "Open" }, { id: "open-folder", label: "Open folder" }, REMOVE];
			}
			const entries: MenuEntry[] = [
				{ id: "open-folder", label: "Open folder", accelerator: "CommandOrControl+O" },
				{ id: "copy-path", label: "Copy folder path" },
				{ id: "change-folder", label: "Change folder" },
			];
			const [first] = await commands.listForProject(id, db);
			if (first) {
				entries.push(
					runner.isRunning(first.id)
						? { id: "stop-start", label: "Stop start command" }
						: { id: "run-start", label: "Run start command" },
				);
			}
			if (!projectIsArchived(project.statusId, db)) {
				entries.push({ id: "archive", label: "Archive", separatorBefore: true });
			}
			entries.push({ ...REMOVE, accelerator: "Delete", separatorBefore: !entries.some((entry) => entry.separatorBefore) });
			return entries;
		}

		case "add": {
			if (!(await projects.get(id, db))) return [];
			return [
				{ id: "add-mail", label: "Link a mail" },
				{ id: "add-time", label: "Add time entry" },
				{ id: "add-event", label: "Add calendar event" },
				{ id: "add-file", label: "Add file" },
				{ id: "add-note", label: "Add note" },
			];
		}

		case "note": {
			const note = await notes.get(id, db);
			if (!note) return [];
			return [
				note.pinnedAt ? { id: "unpin-note", label: "Unpin from the top" } : { id: "pin-note", label: "Pin to the top" },
				{ id: "duplicate-note", label: "Duplicate", accelerator: "CommandOrControl+D" },
				{ id: "move-to-project", label: "Move to a project" },
				{ ...REMOVE, accelerator: "Delete" },
			];
		}

		case "block": {
			if (!(BLOCK_KINDS as readonly string[]).includes(id)) return [];
			return [
				{ id: "edit-block", label: `Edit this ${id}` },
				{ id: "new-block", label: `New ${id}` },
				{ id: "manage-blocks", label: "Manage intros and outros", separatorBefore: true },
			];
		}
	}
}
