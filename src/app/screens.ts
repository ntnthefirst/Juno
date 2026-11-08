import type { IconName } from "../components/Icon";
import type { ScreenAction } from "../lib/screen-actions";

export type ScreenId =
	| "overview"
	| "calendar"
	| "mail"
	| "mail-templates"
	| "notes"
	| "documents"
	| "document-templates"
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
 * Mail and Documents each hold a second screen behind a switch at the top of
 * the page (`SCREEN_SWITCH`), and Reminders is reached from the overview, so
 * none of the three has an entry of its own here. Settings is a window, not a
 * screen, and is added by the sidebar rather than listed.
 */
export const SIDEBAR_TOP: ScreenItem[] = [
	{ id: "overview", label: "Overview", icon: "overview" },
	{ id: "calendar", label: "Calendar", icon: "calendar" },
	{ id: "clients", label: "Clients", icon: "clients" },
	{ id: "projects", label: "Projects", icon: "projects" },
	{ id: "mail", label: "Mail", icon: "mail" },
	{ id: "notes", label: "Notes", icon: "note" },
	{ id: "documents", label: "Documents", icon: "documents" },
];

export const SCREEN_LABELS: Record<ScreenId, string> = {
	overview: "Overview",
	calendar: "Calendar",
	mail: "Mail",
	"mail-templates": "Styled mail",
	notes: "Notes",
	documents: "Documents",
	"document-templates": "Templates",
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
	documents: "documents",
	"document-templates": "documents",
	clients: "clients",
	projects: "projects",
	reminders: "overview",
	agent: "agent",
};

/**
 * Screens that share a page with another through a switch. Each pair names its
 * two sides, in the order the switch draws them.
 */
export type ScreenSwitch = { left: { id: ScreenId; label: string }; right: { id: ScreenId; label: string } };

export const DOCUMENT_SWITCH: ScreenSwitch = {
	left: { id: "documents", label: "Documents" },
	right: { id: "document-templates", label: "Templates" },
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
	documents: { screen: "documents", label: "New document" },
	"document-templates": { screen: "documents", label: "New document" },
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
	{ screen: "documents", action: "new-page", label: "New page", icon: "documents" },
	{ screen: "calendar", label: "New event", icon: "calendar" },
	{ screen: "clients", label: "New client", icon: "clients" },
	{ screen: "projects", label: "New project", icon: "projects" },
	{ screen: "documents", action: "import", label: "Import a file", icon: "import", separatorBefore: true },
];

/** The glyph of the entry a screen adds to the New menu when the design's list has none for it. */
export const NEW_OWN_ICON: Record<string, IconName> = {
	"New reminder": "reminders",
	"New message": "mail",
	"New document": "documents",
};

/**
 * Screens where New, the text button at the right of the title bar, makes the
 * screen's own record at once. On every other screen it opens the New menu.
 * With a document open the plus at the left takes its place, as the page frame
 * draws it.
 */
export const NEW_AT_RIGHT: ScreenId[] = ["notes", "calendar", "clients", "projects", "documents", "reminders"];
