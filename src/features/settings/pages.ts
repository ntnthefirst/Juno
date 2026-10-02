import type { SettingsSection } from "@shared/types";
import type { IconName } from "../../components/Icon";

/**
 * The shape of the settings window: six groups, and inside each of them the
 * pages that show one subject at a time.
 *
 * A page is what the window draws between the title and the end of the
 * content. It owns one or more sections, and a section is what a search result
 * points at (the `anchor` of `<Section>`). Putting the anchors here, once, is
 * what lets a result open the right page without every page being drawn to look
 * for it.
 *
 * `SettingsSection` stays the name of a group, because the main process and the
 * rest of the app ask for a group (`openSettings("mcp")`) and should not need to
 * know how it is split into pages.
 */
export type SettingsPageId =
	| "appearance"
	| "updates"
	| "about"
	| "details"
	| "contact"
	| "accounting"
	| "mail"
	| "statuses"
	| "signature"
	| "certificate"
	| "lock"
	| "backup"
	| "mcp-server"
	| "mcp-connect"
	| "mcp-tools";

export type SettingsPage = {
	id: SettingsPageId;
	group: SettingsSection;
	/** In the navigation, and the title of the page. */
	label: string;
	/** The `anchor` of every section this page draws. */
	anchors: string[];
	/**
	 * One section on the page. Its heading would only repeat the page's title,
	 * so it is drawn without one and keeps its description and its button.
	 */
	solo: boolean;
};

export type SettingsGroup = {
	id: SettingsSection;
	label: string;
	icon: IconName;
};

export const GROUPS: SettingsGroup[] = [
	{ id: "general", label: "General", icon: "settings" },
	{ id: "business", label: "Your business", icon: "client" },
	{ id: "mail", label: "Mail accounts", icon: "mail" },
	{ id: "documents", label: "Documents", icon: "documents" },
	{ id: "security", label: "Security and data", icon: "lock" },
	{ id: "mcp", label: "MCP", icon: "agent" },
];

export const PAGES: SettingsPage[] = [
	{ id: "appearance", group: "general", label: "Appearance", anchors: ["appearance"], solo: true },
	{ id: "updates", group: "general", label: "Updates", anchors: ["updates"], solo: true },
	{ id: "about", group: "general", label: "Help and about", anchors: ["onboarding", "about"], solo: false },

	{ id: "details", group: "business", label: "Your details", anchors: ["owner-details"], solo: true },
	{ id: "contact", group: "business", label: "Emails and phones", anchors: ["owner-emails", "owner-phones"], solo: false },
	{ id: "accounting", group: "business", label: "Accounting", anchors: ["accounting"], solo: true },

	{ id: "mail", group: "mail", label: "Mail accounts", anchors: ["mail-accounts", "removed-accounts"], solo: false },

	{ id: "statuses", group: "documents", label: "Statuses and labels", anchors: ["reference"], solo: true },
	{ id: "signature", group: "documents", label: "Signature image", anchors: ["signature"], solo: true },
	{ id: "certificate", group: "documents", label: "Digital signature", anchors: ["certificate"], solo: true },

	{ id: "lock", group: "security", label: "Lock", anchors: ["lock"], solo: true },
	{ id: "backup", group: "security", label: "Backup", anchors: ["backup"], solo: true },

	{ id: "mcp-server", group: "mcp", label: "Server", anchors: ["mcp-server", "mcp-clients"], solo: false },
	{ id: "mcp-connect", group: "mcp", label: "Connect a client", anchors: ["mcp-connect"], solo: true },
	{ id: "mcp-tools", group: "mcp", label: "What an agent can do", anchors: ["mcp-tools"], solo: true },
];

export function pageById(id: SettingsPageId): SettingsPage {
	const page = PAGES.find((candidate) => candidate.id === id);
	if (!page) throw new Error(`There is no settings page called "${id}".`);
	return page;
}

export function groupById(id: SettingsSection): SettingsGroup {
	const group = GROUPS.find((candidate) => candidate.id === id);
	if (!group) throw new Error(`There is no settings group called "${id}".`);
	return group;
}

export function pagesOf(group: SettingsSection): SettingsPage[] {
	return PAGES.filter((page) => page.group === group);
}

/** Where a group opens: its first page. */
export function firstPageOf(group: SettingsSection): SettingsPageId {
	const first = pagesOf(group)[0];
	if (!first) throw new Error(`The settings group "${group}" has no pages.`);
	return first.id;
}

/** The page that draws a section, or null for an anchor nothing draws. */
export function pageOfAnchor(anchor: string): SettingsPage | null {
	return PAGES.find((page) => page.anchors.includes(anchor)) ?? null;
}
