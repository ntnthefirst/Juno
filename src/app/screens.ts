import type { IconName } from "../components/Icon";

export type ScreenId =
	| "today"
	| "calendar"
	| "mail"
	| "templates"
	| "documents"
	| "document-templates"
	| "clients"
	| "projects"
	| "reminders";

export type ScreenItem = { id: ScreenId; label: string; icon: IconName };
export type ScreenGroup = { heading: string | null; items: ScreenItem[] };

/**
 * Ordered around the start of a workday: orient yourself, communicate, produce,
 * then manage the records behind that work.
 *
 * Settings is deliberately absent. It is a window of its own, reached from the
 * footer of the sidebar, not a tenth destination in this list.
 */
export const SCREEN_GROUPS: ScreenGroup[] = [
	{
		heading: null,
		items: [
			{ id: "today", label: "Today", icon: "today" },
			{ id: "calendar", label: "Calendar", icon: "calendar" },
		],
	},
	{
		heading: "Work",
		items: [
			{ id: "clients", label: "Clients", icon: "clients" },
			{ id: "projects", label: "Projects", icon: "projects" },
		],
	},
	{
		heading: "Mail",
		items: [
			{ id: "mail", label: "Inbox", icon: "mail" },
			{ id: "templates", label: "Mail templates", icon: "templates" },
		],
	},
	{
		heading: "Documents",
		items: [
			{ id: "documents", label: "Documents", icon: "documents" },
			{ id: "document-templates", label: "Document templates", icon: "templates" },
		],
	},
];

export const SCREEN_LABELS: Record<ScreenId, string> = {
	today: "Today",
	calendar: "Calendar",
	mail: "Inbox",
	templates: "Mail templates",
	documents: "Documents",
	"document-templates": "Document templates",
	clients: "Clients",
	projects: "Projects",
	reminders: "Reminders",
};
