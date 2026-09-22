import type { IconName } from "../components/Icon";

export type ScreenId =
	| "today"
	| "clients"
	| "projects"
	| "documents"
	| "mail"
	| "calendar"
	| "reminders"
	| "agent"
	| "templates";

export type ScreenItem = { id: ScreenId; label: string; icon: IconName };
export type ScreenGroup = { heading: string | null; items: ScreenItem[] };

/**
 * Grouped by what the work actually is, not by which phase built it.
 *
 * Today stands alone because it is where a day starts and it is not a category.
 * The rest splits three ways: who you work for, how you talk to them, what you
 * produce for them. Agent sits last because it acts across all three.
 *
 * Settings is deliberately absent. It is a window of its own, reached from the
 * footer of the sidebar, not a tenth destination in this list.
 */
export const SCREEN_GROUPS: ScreenGroup[] = [
	{ heading: null, items: [{ id: "today", label: "Today", icon: "today" }] },
	{
		heading: "Work",
		items: [
			{ id: "clients", label: "Clients", icon: "clients" },
			{ id: "projects", label: "Projects", icon: "projects" },
		],
	},
	{
		heading: "Correspondence",
		items: [
			{ id: "mail", label: "Mail", icon: "mail" },
			{ id: "calendar", label: "Calendar", icon: "calendar" },
			{ id: "reminders", label: "Reminders", icon: "reminders" },
		],
	},
	{
		heading: "Paperwork",
		items: [
			{ id: "documents", label: "Documents", icon: "documents" },
			{ id: "templates", label: "Templates", icon: "templates" },
		],
	},
	{
		heading: "Automation",
		items: [{ id: "agent", label: "Agent", icon: "agent" }],
	},
];

export const SCREEN_LABELS: Record<ScreenId, string> = Object.fromEntries(
	SCREEN_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item.label]),
) as Record<ScreenId, string>;
