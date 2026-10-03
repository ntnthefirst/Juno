import type { IconName } from "../components/Icon";

export type ScreenId =
	| "overview"
	| "calendar"
	| "mail"
	| "mail-templates"
	| "documents"
	| "document-templates"
	| "clients"
	| "projects"
	| "reminders"
	| "agent";

export type ScreenItem = { id: ScreenId; label: string; icon: IconName };

/**
 * The sidebar is a rail of icons and nothing else, so it is two short lists:
 * the places the work happens, then the two that are about Juno itself.
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
	{ id: "documents", label: "Documents", icon: "documents" },
];

export const SIDEBAR_BOTTOM: ScreenItem[] = [{ id: "agent", label: "Agent", icon: "agent" }];

export const SCREEN_LABELS: Record<ScreenId, string> = {
	overview: "Overview",
	calendar: "Calendar",
	mail: "Mail",
	"mail-templates": "Styled mail",
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

export const MAIL_SWITCH: ScreenSwitch = {
	left: { id: "mail", label: "Mailbox" },
	right: { id: "mail-templates", label: "Styled mail" },
};

export const DOCUMENT_SWITCH: ScreenSwitch = {
	left: { id: "documents", label: "Documents" },
	right: { id: "document-templates", label: "Templates" },
};
