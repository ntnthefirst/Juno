import type { IconName } from "../../components/Icon";

/**
 * What a tool does to the world, in a handful of kinds a person can tell apart
 * at a glance. The colour of an icon tile is the verb, not the screen: red is
 * something being removed, amber is something being filed away, iris is
 * something going out, and so on, whichever part of Juno it touches.
 */
export type Verb = "send" | "create" | "change" | "delete" | "file" | "done" | "restore" | "sync";

export type ToolVisual = {
	/** The part of Juno it works in. */
	domain: IconName;
	verb: Verb;
};

/** The first prefix that matches wins, so the specific ones come before the general. */
const DOMAINS: [prefix: string, icon: IconName][] = [
	["mail.templates", "templates"],
	["mail.accounts", "mail"],
	["mail.outbox", "sent"],
	["mail.send", "sent"],
	["mail.draft", "drafts"],
	["mail.reply", "reply"],
	["mail.file", "inbox"],
	["mail.folders", "folder-open"],
	["mail.threads", "branch"],
	["mail.", "mail"],
	["clients.emails", "mail"],
	["clients.phones", "phone"],
	["clients.addresses", "address"],
	["clients.notes", "note"],
	["clients.links", "link"],
	["clients.", "clients"],
	["contacts.", "client"],
	["projects.", "projects"],
	["documents.", "documents"],
	["templates.", "templates"],
	["calendar.", "calendar"],
	["reminders.", "reminders"],
	["settings.", "settings"],
	["updates.", "sync"],
	["automations.", "agent"],
	["agent.", "agent"],
	["search.", "search"],
	["briefing.", "today"],
	["geocoding.", "address"],
	["reference.", "list"],
	["audit.", "list"],
];

function verbOf(toolName: string): Verb {
	const last = toolName.split(".").pop() ?? "";
	if (/^send/.test(last)) return "send";
	if (/^(remove|delete|empty|hide|purge|cancel|clear)/.test(last)) return "delete";
	if (/^(archive|trash|junk|move)/.test(last)) return "file";
	if (/^(restore|reopen|unhide|snooze|retry)/.test(last)) return "restore";
	if (/^(complete|approve|accept)/.test(last)) return "done";
	if (/^(sync|check|test)/.test(last)) return "sync";
	if (/^(create|add|import|fill|draft|reply|connect|generate|render|new|duplicate|connect)/.test(last)) {
		return "create";
	}
	return "change";
}

export function toolVisual(toolName: string): ToolVisual {
	const domain = DOMAINS.find(([prefix]) => toolName.startsWith(prefix))?.[1] ?? "agent";
	return { domain, verb: verbOf(toolName) };
}

type VerbStyle = {
	label: string;
	/** A little glyph for the corner of the tile. */
	icon: IconName;
	/** The tile itself: soft background, strong glyph. */
	tile: string;
	/** The dot in the corner: strong background. */
	dot: string;
};

/** Token names only, never a hex. See brand/BRAND.md section 5. */
export const VERBS: Record<Verb, VerbStyle> = {
	send: {
		label: "Sends",
		icon: "sent",
		tile: "bg-[var(--accent-soft)] text-[var(--accent)]",
		dot: "bg-[var(--accent)] text-[var(--accent-ink)]",
	},
	create: {
		label: "Adds",
		icon: "add",
		tile: "bg-[var(--ok-soft)] text-[var(--ok)]",
		dot: "bg-[var(--ok)] text-[var(--paper)]",
	},
	change: {
		label: "Changes",
		icon: "edit",
		tile: "bg-[var(--sunken)] text-[var(--ink)]",
		dot: "bg-[var(--ink-muted)] text-[var(--paper)]",
	},
	delete: {
		label: "Removes",
		icon: "remove",
		tile: "bg-[var(--risk-soft)] text-[var(--risk)]",
		dot: "bg-[var(--risk)] text-[var(--paper)]",
	},
	file: {
		label: "Files away",
		icon: "move-right",
		tile: "bg-[var(--warn-soft)] text-[var(--warn)]",
		dot: "bg-[var(--warn)] text-[var(--paper)]",
	},
	done: {
		label: "Completes",
		icon: "check",
		tile: "bg-[var(--ok-soft)] text-[var(--ok)]",
		dot: "bg-[var(--ok)] text-[var(--paper)]",
	},
	restore: {
		label: "Brings back",
		icon: "reply",
		tile: "bg-[var(--accent-soft)] text-[var(--accent)]",
		dot: "bg-[var(--accent)] text-[var(--accent-ink)]",
	},
	sync: {
		label: "Syncs",
		icon: "sync",
		tile: "bg-[var(--sunken)] text-[var(--ink)]",
		dot: "bg-[var(--ink-muted)] text-[var(--paper)]",
	},
};
