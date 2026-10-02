import type { SettingsSection } from "@shared/types";
import { pageOfAnchor } from "./pages";

/**
 * One thing a person might go looking for in settings.
 *
 * An entry points at a section on a tab, not at a control: the anchor is the
 * `anchor` prop of a `<Section>` (rendered as `data-setting`), so the window can
 * switch tab, scroll there and flash it. Several entries can share an anchor,
 * which is how "lock when idle" and "PIN" both land on the lock section.
 *
 * `keywords` is where the words people actually use go: synonyms, the older
 * name for the thing, the problem it solves. A title that says "Lock" does not
 * help somebody typing "password" or "screensaver", so add those here rather
 * than rewording the interface.
 */
export type SettingEntry = {
	tab: SettingsSection;
	anchor: string;
	/** What the result is called. */
	title: string;
	/** One line under the title, saying what the setting does. */
	description: string;
	keywords: string[];
};

export const TAB_LABELS: Record<SettingsSection, string> = {
	general: "General",
	business: "Your business",
	mail: "Mail accounts",
	documents: "Documents",
	security: "Security and data",
	mcp: "MCP",
};

export const SETTING_ENTRIES: SettingEntry[] = [
	// General
	{
		tab: "general",
		anchor: "appearance",
		title: "Theme",
		description: "Light, dark, or follow your operating system.",
		keywords: [
			"appearance",
			"dark mode",
			"light mode",
			"night",
			"colour",
			"color",
			"system",
			"look",
			"display",
			"bright",
			"contrast",
			"skin",
		],
	},
	{
		tab: "general",
		anchor: "appearance",
		title: "Collapse the sidebar on its own",
		description: "Back to icons after you choose something or click beside it.",
		keywords: [
			"sidebar",
			"menu",
			"navigation",
			"rail",
			"icons",
			"auto collapse",
			"shrink",
			"hide",
			"narrow",
			"drawer",
			"expand",
		],
	},
	{
		tab: "general",
		anchor: "onboarding",
		title: "Getting started",
		description: "Show the walkthrough again or run setup again.",
		keywords: [
			"walkthrough",
			"tour",
			"tutorial",
			"welcome",
			"first run",
			"onboarding",
			"setup",
			"intro",
			"help",
			"guide",
			"replay",
			"redo",
		],
	},
	{
		tab: "general",
		anchor: "updates",
		title: "Updates",
		description: "Check for a new version and install it.",
		keywords: [
			"update",
			"upgrade",
			"new version",
			"release",
			"download",
			"install",
			"restart",
			"latest",
			"check for updates",
			"automatic",
			"auto install",
			"version",
			"changelog",
		],
	},
	{
		tab: "general",
		anchor: "about",
		title: "About and data location",
		description: "The platform and where the database file is kept.",
		keywords: [
			"about",
			"version",
			"database",
			"path",
			"folder",
			"location",
			"where is my data",
			"storage",
			"platform",
			"windows",
			"mac",
			"development build",
			"file",
		],
	},

	// Your business
	{
		tab: "business",
		anchor: "owner-details",
		title: "Your details",
		description: "Name, business, VAT number, IBAN and address printed on documents.",
		keywords: [
			"profile",
			"name",
			"first name",
			"last name",
			"business name",
			"company",
			"vat",
			"btw",
			"vat number",
			"establishment number",
			"ondernemingsnummer",
			"iban",
			"bank",
			"bank account",
			"address",
			"street",
			"postal code",
			"zip",
			"city",
			"country",
			"owner",
			"letterhead",
			"contract",
		],
	},
	{
		tab: "business",
		anchor: "owner-emails",
		title: "Email addresses",
		description: "The addresses documents print, with one marked primary.",
		keywords: ["email", "e-mail", "mail address", "primary", "contact", "owner", "sender", "reply to"],
	},
	{
		tab: "business",
		anchor: "owner-phones",
		title: "Phone numbers",
		description: "The numbers documents print, with one marked primary.",
		keywords: ["phone", "telephone", "mobile", "gsm", "cell", "number", "primary", "contact", "owner"],
	},
	{
		tab: "business",
		anchor: "accounting",
		title: "Accounting",
		description: "Where you invoice. Invoice reminders link here.",
		keywords: [
			"invoice",
			"invoicing",
			"bookkeeping",
			"billing",
			"factuur",
			"link",
			"url",
			"website",
			"reminder",
			"payment",
			"money",
			"external",
		],
	},

	// Mail
	{
		tab: "mail",
		anchor: "mail-accounts",
		title: "Mail accounts",
		description: "Add, edit, pause or remove an IMAP account.",
		keywords: [
			"email",
			"imap",
			"smtp",
			"account",
			"inbox",
			"server",
			"host",
			"port",
			"password",
			"login",
			"add account",
			"folders",
			"sync",
			"pause",
			"resume",
			"gmail",
			"outlook",
			"sending",
			"receiving",
			"keychain",
			"app password",
			"ssl",
			"tls",
		],
	},
	{
		tab: "mail",
		anchor: "removed-accounts",
		title: "Removed accounts",
		description: "Bring back or permanently delete an account you removed.",
		keywords: [
			"removed",
			"deleted",
			"trash",
			"restore",
			"undo",
			"recover",
			"delete mail",
			"purge",
			"archive",
			"old account",
		],
	},

	// Documents
	{
		tab: "documents",
		anchor: "reference",
		title: "Statuses and labels",
		description: "Edit, reorder, hide or reset the statuses, types and labels.",
		keywords: [
			"status",
			"statuses",
			"label",
			"labels",
			"tag",
			"tags",
			"type",
			"document type",
			"client status",
			"reminder preset",
			"preset",
			"colour",
			"order",
			"sort",
			"reorder",
			"reset",
			"defaults",
			"hide",
			"lead",
			"prospect",
			"active",
			"category",
		],
	},
	{
		tab: "documents",
		anchor: "signature",
		title: "Signature",
		description: "The image stamped onto a PDF when you sign it.",
		keywords: [
			"sign",
			"signing",
			"stamp",
			"image",
			"handwritten",
			"draw",
			"png",
			"picture",
			"contract",
			"pdf",
			"seal",
			"autograph",
		],
	},
	{
		tab: "documents",
		anchor: "certificate",
		title: "Digital signature",
		description: "A certificate that signs the PDF itself.",
		keywords: [
			"certificate",
			"p12",
			"pfx",
			"passphrase",
			"password",
			"eidas",
			"qualified",
			"tamper",
			"verify",
			"trust",
			"pdf",
			"cryptographic",
			"authority",
			"cert",
		],
	},

	// Security and data
	{
		tab: "security",
		anchor: "lock",
		title: "Lock",
		description: "A PIN or passphrase that covers the app when you step away.",
		keywords: [
			"lock",
			"lock screen",
			"pin",
			"passphrase",
			"password",
			"security",
			"privacy",
			"protect",
			"unlock",
			"biometric",
			"walk away",
			"turn off",
			"change pin",
			"set up a lock",
		],
	},
	{
		tab: "security",
		anchor: "lock",
		title: "Lock when idle",
		description: "Lock after 5, 15 or 30 minutes without input, on sleep or on minimise.",
		keywords: [
			"idle",
			"inactivity",
			"timeout",
			"minutes",
			"auto lock",
			"screensaver",
			"away",
			"sleep",
			"minimise",
			"minimize",
			"screen lock",
			"suspend",
		],
	},
	{
		tab: "security",
		anchor: "backup",
		title: "Backup",
		description: "Copy everything to a backup file, or restore one.",
		keywords: [
			"backup",
			"back up",
			"restore",
			"export",
			"copy",
			"save",
			"recover",
			"rollback",
			"data loss",
			"folder",
			"replace",
			"snapshot",
			"archive",
			"safe",
		],
	},

	// MCP
	{
		tab: "mcp",
		anchor: "mcp-server",
		title: "MCP server",
		description: "Switch the server an agent connects to on or off, copy its URL, change its port.",
		keywords: [
			"mcp",
			"agent",
			"ai",
			"model context protocol",
			"server",
			"url",
			"port",
			"localhost",
			"on",
			"off",
			"enable",
			"disable",
			"address",
			"copy",
		],
	},
	{
		tab: "mcp",
		anchor: "mcp-clients",
		title: "Connected clients",
		description: "Which agents were let in, remove one, or make an access token.",
		keywords: [
			"clients",
			"connected",
			"revoke",
			"remove",
			"token",
			"access token",
			"code",
			"pairing",
			"agent",
			"mcp",
			"authorise",
			"authorize",
		],
	},
	{
		tab: "mcp",
		anchor: "mcp-connect",
		title: "Connect a client",
		description: "Add Juno to Claude Code, Cursor, VS Code and other clients.",
		keywords: [
			"mcp",
			"agent",
			"claude",
			"assistant",
			"connect",
			"config",
			"configuration",
			"json",
			"install",
			"integration",
			"cursor",
			"vs code",
			"codex",
			"windsurf",
			"manual",
		],
	},
	{
		tab: "mcp",
		anchor: "mcp-tools",
		title: "What an agent can do",
		description: "The tools an agent can call, read only or changing something.",
		keywords: [
			"tools",
			"permissions",
			"capabilities",
			"read only",
			"write",
			"allowed",
			"access",
			"agent",
			"mcp",
			"list of tools",
			"what can it do",
		],
	},
];

/** Lowercase with accents removed, so "réminder" and "reminder" are the same word. */
export function normalise(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();
}

/**
 * A word matches when it starts a word in the text, or sits inside it and is at
 * least three characters. Prefix first keeps "pin" from matching "shipping"
 * while "pass" still finds "passphrase".
 */
function wordMatches(text: string, word: string): boolean {
	if (text.startsWith(word) || text.includes(` ${word}`)) return true;
	return word.length >= 3 && text.includes(word);
}

/**
 * Whether two words are one slip apart: a letter wrong, missing, extra, or two
 * neighbours swapped. "lokc" is near "lock" and "passwrd" is near "password".
 */
export function isNear(a: string, b: string): boolean {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > 1) return false;
	let at = 0;
	while (at < a.length && at < b.length && a[at] === b[at]) at++;
	if (a.length === b.length) {
		if (a.slice(at + 1) === b.slice(at + 1)) return true;
		return a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2);
	}
	return a.length > b.length ? a.slice(at + 1) === b.slice(at) : a.slice(at) === b.slice(at + 1);
}

/** The words a typo has to be near: the title's and the keywords', one by one. */
function tokensOf(entry: SettingEntry): string[] {
	return [entry.title, ...entry.keywords]
		.flatMap((text) => normalise(text).split(/[^a-z0-9]+/))
		.filter((token) => token.length >= 3);
}

function scoreEntry(entry: SettingEntry, words: string[]): number {
	const title = normalise(entry.title);
	const keywords = entry.keywords.map(normalise);
	const description = normalise(entry.description);
	const tab = normalise(TAB_LABELS[entry.tab]);
	const page = normalise(pageOfAnchor(entry.anchor)?.label ?? "");
	let tokens: string[] | null = null;

	let total = 0;
	for (const word of words) {
		let best = 0;
		if (title.startsWith(word) || title.includes(` ${word}`)) best = 10;
		else if (keywords.some((keyword) => keyword === word)) best = 9;
		else if (keywords.some((keyword) => wordMatches(keyword, word))) best = 6;
		else if (title.includes(word)) best = 5;
		else if (wordMatches(description, word)) best = 3;
		else if (wordMatches(page, word) || wordMatches(tab, word)) best = 1;
		// A slip of the finger still finds it, below everything that matched as typed.
		else if (word.length >= 4) {
			tokens ??= tokensOf(entry);
			if (tokens.some((token) => isNear(token, word))) best = 2;
		}
		// Every word has to land somewhere, or the entry is not what was asked for.
		if (best === 0) return 0;
		total += best;
	}
	return total;
}

/**
 * The entries that match every word of the query, best first. Ties keep the
 * order the entries are declared in, which is the order of the tabs.
 */
/** The id one result carries, so the search field can say which one is current. */
export function resultId(listId: string, index: number): string {
	return `${listId}-${index}`;
}

export function queryWords(query: string): string[] {
	return normalise(query).split(/\s+/).filter(Boolean);
}

/** Where a result lives, the way it is written under it: "Documents > Signing". */
export function locationOf(entry: SettingEntry): string {
	const group = TAB_LABELS[entry.tab];
	const page = pageOfAnchor(entry.anchor)?.label;
	return page && page !== group ? `${group} > ${page}` : group;
}

export function searchSettings(query: string, entries: SettingEntry[] = SETTING_ENTRIES): SettingEntry[] {
	const words = queryWords(query);
	if (words.length === 0) return [];
	return entries
		.map((entry, index) => ({ entry, index, score: scoreEntry(entry, words) }))
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((hit) => hit.entry);
}
