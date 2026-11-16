import type { IconName } from "../components/Icon";
import type { ScreenAction } from "../lib/screen-actions";

export type ScreenId =
	| "overview"
	| "calendar"
	| "mail"
	| "mail-templates"
	| "notes"
	| "files"
	| "clients"
	| "projects"
	| "reminders"
	| "agent";

export type ScreenItem = { id: ScreenId; label: string; icon: IconName };

/**
 * The sidebar is a rail of icons and nothing else: the places the work
 * happens, and Settings at the foot. The agent is about Juno itself and sits
 * in the title bar, beside the window's own buttons.
 *
 * Mail holds Styled mail, opened from its title bar, and Reminders is
 * reached from the overview, so neither has an entry of its own here. Settings is a window, not a
 * screen, and is added by the sidebar rather than listed.
 */
export const SIDEBAR_TOP: ScreenItem[] = [
	{ id: "overview", label: "Overview", icon: "overview" },
	{ id: "calendar", label: "Calendar", icon: "calendar" },
	{ id: "clients", label: "Clients", icon: "clients" },
	{ id: "projects", label: "Projects", icon: "projects" },
	{ id: "mail", label: "Mail", icon: "mail" },
	{ id: "notes", label: "Notes", icon: "note" },
	{ id: "files", label: "Files", icon: "documents" },
];

export const SCREEN_LABELS: Record<ScreenId, string> = {
	overview: "Overview",
	calendar: "Calendar",
	mail: "Mail",
	"mail-templates": "Styled mail",
	notes: "Notes",
	files: "Files",
	clients: "Clients",
	projects: "Projects",
	reminders: "Reminders",
	agent: "Agent",
};

/** The sidebar entry that stays lit while a screen without an entry is open. */
export const SIDEBAR_ENTRY: Record<ScreenId, ScreenId> = {
	overview: "overview",
	calendar: "calendar",
	mail: "mail",
	"mail-templates": "mail",
	notes: "notes",
	files: "files",
	clients: "clients",
	projects: "projects",
	reminders: "overview",
	agent: "agent",
};

/**
 * What "new" means on each screen: the screen that holds the record being made,
 * and what the command is called. A screen with no entry has nothing to start,
 * and the shortcut does nothing there rather than guessing.
 */
export const NEW_ON: Partial<Record<ScreenId, { screen: ScreenId; label: string }>> = {
	overview: { screen: "overview", label: "New reminder" },
	reminders: { screen: "reminders", label: "New reminder" },
	calendar: { screen: "calendar", label: "New event" },
	clients: { screen: "clients", label: "New client" },
	projects: { screen: "projects", label: "New project" },
	mail: { screen: "mail", label: "New message" },
	"mail-templates": { screen: "mail", label: "New message" },
	notes: { screen: "notes", label: "New note" },
	files: { screen: "files", label: "New page" },
};

/**
 * Everything the New menu in the title bar offers, in the order the design
 * draws it. Each item does what the same entry in `NEW_ON` does: it asks the
 * screen that owns the record to open its form. A reminder, a message or a
 * document is not in the list, so the screen that makes one adds it at the top
 * while it is in view, and the palette has all of them.
 */
export type NewMenuEntry = {
	screen: ScreenId;
	action?: ScreenAction;
	label: string;
	icon: IconName;
	separatorBefore?: boolean;
};

export const NEW_MENU: NewMenuEntry[] = [
	{ screen: "notes", label: "New note", icon: "note" },
	{ screen: "calendar", label: "New event", icon: "calendar" },
	{ screen: "clients", label: "New client", icon: "clients" },
	{ screen: "projects", label: "New project", icon: "projects" },
];

/**
 * A screen that starts more than one kind of thing has a New menu of its own,
 * with only what belongs there (frames in section 22 of the design). Overview
 * keeps the whole of `NEW_MENU`, and a screen that makes one kind of record
 * makes it at once (`NEW_AT_RIGHT`).
 */
const MAIL_NEW: NewMenuEntry[] = [
	{ screen: "mail", label: "New message", icon: "mail" },
	{ screen: "mail", action: "styled-mail", label: "Styled mail", icon: "templates" },
	{ screen: "mail", action: "new-folder", label: "New folder", icon: "projects", separatorBefore: true },
	{ screen: "mail", action: "new-rule", label: "New mailbox rule", icon: "filter" },
	{ screen: "mail", action: "new-block", label: "New intro or outro", icon: "note" },
];

export const NEW_MENUS: Partial<Record<ScreenId, NewMenuEntry[]>> = {
	mail: MAIL_NEW,
	"mail-templates": MAIL_NEW,
	calendar: [
		{ screen: "calendar", label: "New event", icon: "calendar" },
		{ screen: "calendar", action: "new-reminder", label: "New reminder", icon: "reminders" },
		{ screen: "calendar", action: "subscribe", label: "Subscribe to a calendar", icon: "sync", separatorBefore: true },
		{ screen: "calendar", action: "import-calendar", label: "Import a calendar file", icon: "import" },
	],
};

/** The glyph of the entry a screen adds to the New menu when the design's list has none for it. */
export const NEW_OWN_ICON: Record<string, IconName> = {
	"New reminder": "reminders",
	"New message": "mail",
	"New page": "documents",
};

/**
 * Screens where New, the text button at the right of the title bar, makes the
 * screen's own record at once, because it is the one thing they start. A screen
 * with its own list in `NEW_MENUS` opens that, and any other screen opens the
 * whole New menu. With a document open the plus at the left takes its place, as
 * the page frame draws it.
 */
export const NEW_AT_RIGHT: ScreenId[] = ["notes", "files", "clients", "projects", "reminders"];
