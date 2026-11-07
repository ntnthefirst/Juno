/**
 * The right-click menus, as the renderer and the main process agree on them.
 *
 * The renderer sends a kind and a record id. It never sends a list of items,
 * so a script running in the page cannot invent a menu: what is offered is
 * decided in the main process from the record itself. What comes back is
 * either nothing, a note that the main process did the work, or the name of
 * something the screen has to do because only the screen can (open a form,
 * go to a record, ask first).
 */

/** The kinds drawn in the design's Context Menu set. */
export const MENU_KINDS = ["reminder", "event", "client", "file", "mail", "blank", "project", "add", "block", "note"] as const;
export type MenuKind = (typeof MENU_KINDS)[number];

/** A blank area is named by the screen it is on, so the menu can start with what belongs there. */
export const BLANK_AREAS = ["overview", "reminders", "calendar", "clients", "projects", "mail", "notes", "documents"] as const;
export type BlankArea = (typeof BLANK_AREAS)[number];

/** The two block menus in the composer toolbar. */
export const BLOCK_KINDS = ["intro", "outro"] as const;

/**
 * A small fixed vocabulary that lets one kind show a variant. Anything else is
 * refused, so this is not a way to pass free text into the main process.
 *
 * - `deadline`: an event-kind chip that is really a project deadline.
 * - `trash`: a mail row that is already in the trash.
 * - `detail`: a project menu opened from the record's own page.
 * - `unread`: the mail list, with a folder open that has unread mail in it.
 */
export const MENU_CONTEXTS = ["deadline", "trash", "detail", "unread"] as const;
export type MenuContext = (typeof MENU_CONTEXTS)[number];

export type MenuRequest = {
	kind: MenuKind;
	/** The record id. For `blank` the area, for `block` intro or outro. */
	id: string;
	context?: MenuContext | null;
	/** Where the menu opens, in the window's own coordinates. */
	x: number;
	y: number;
};

/** What the screen is asked to do. The main process performs the rest itself. */
export const MENU_ACTIONS = [
	"open",
	"edit",
	"delete",
	"delete-forever",
	"complete",
	"reopen",
	"snooze",
	"open-link",
	"move-to-client",
	"new-note",
	"mark-read",
	"mark-unread",
	"flag",
	"unflag",
	"archive",
	"move",
	"junk",
	"link",
	"change-folder",
	"run-start",
	"stop-start",
	"new-event",
	"new-reminder",
	"new-client",
	"new-project",
	"new-document",
	"new-page",
	"move-to-project",
	"new-message",
	"sync",
	"select-all",
	"mark-all-read",
	"toggle-styled-mail",
	"add-mail",
	"add-time",
	"add-event",
	"add-file",
	"add-note",
	"edit-block",
	"new-block",
	"manage-blocks",
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** What the main process does itself, through the same services the buttons use. */
export const MENU_MAIN_ACTIONS = ["snooze-tomorrow", "open-in-default-app", "open-folder", "copy-path", "pin-note", "unpin-note", "duplicate-note"] as const;
export type MenuMainAction = (typeof MENU_MAIN_ACTIONS)[number];

export type MenuOutcome =
	/** Dismissed, or the kind has nothing to offer. */
	| { type: "none" }
	/** The main process did it. The screen reloads and may show the note. */
	| { type: "done"; message?: string }
	/** It could not be done, in words worth showing. */
	| { type: "failed"; message: string }
	/** Only the screen can do this one. */
	| { type: "ui"; action: MenuAction };

/** One line of a menu, before it is drawn. */
export type MenuEntry = {
	id: MenuAction | MenuMainAction;
	label: string;
	/** Shown beside the label only where the key really does the thing. */
	accelerator?: string;
	danger?: boolean;
	separatorBefore?: boolean;
};

const ID_LIMIT = 200;

/**
 * Checks what arrived over the channel. The renderer is trusted to be Juno's
 * own page and still not to have sent anything well formed.
 */
export function parseMenuRequest(raw: unknown): MenuRequest {
	if (typeof raw !== "object" || raw === null) throw new Error("That menu request was not understood.");
	const { kind, id, context, x, y } = raw as Record<string, unknown>;
	if (typeof kind !== "string" || !(MENU_KINDS as readonly string[]).includes(kind)) {
		throw new Error("That kind of menu does not exist.");
	}
	if (typeof id !== "string" || id.length === 0 || id.length > ID_LIMIT) {
		throw new Error("That menu request has no record.");
	}
	if (context != null && (typeof context !== "string" || !(MENU_CONTEXTS as readonly string[]).includes(context))) {
		throw new Error("That menu context does not exist.");
	}
	if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error("That menu request has no position.");
	}
	return {
		kind: kind as MenuKind,
		id,
		context: (context as MenuContext | null | undefined) ?? null,
		x: Math.round(x),
		y: Math.round(y),
	};
}
