/**
 * One sentence for a call an agent made, the same for every caller.
 *
 * A request, a log row, the overview and a reply to the agent all say what a
 * call is about, and they used to say it as `Tool title (key: value, ...)`:
 * ids, field names and whatever the agent typed, up to sixty characters each.
 * This writes it as a person would ("Update the client bodhi") and names the
 * record when it can.
 *
 * It only reads, and it leaves out anything that could be a secret or a body:
 * a password never reaches the sentence, and neither does the text of a mail.
 * What a person needs to decide is not in this line but in the request's
 * preview and fields (agent-describe.ts), which keep everything.
 */
import { getDb, type Db } from "../db";
import { nameOfRecord } from "./agent-describe";

const SECRET = /pass(word|phrase)?|secret|token|credential/i;
const MAX_NAME = 60;

/** The thing a domain's tools act on, with its article. */
const NOUNS: [prefix: string, noun: string][] = [
	["clients.emails", "email address"],
	["clients.phones", "phone number"],
	["clients.addresses", "address"],
	["clients.notes", "note"],
	["clients.links", "link"],
	["clients.", "client"],
	["contacts.", "contact"],
	["projects.update_asset", "project file"],
	["projects.delete_asset", "project file"],
	["projects.create_link", "project link"],
	["projects.update_link", "project link"],
	["projects.delete_link", "project link"],
	["projects.", "project"],
	["documents.", "document"],
	["templates.components.", "component"],
	["templates.", "document template"],
	["mail.templates.", "mail template"],
	["mail.accounts.", "mail account"],
	["mail.folders.", "mail folder"],
	["mail.threads.", "conversation"],
	["mail.blocks.", "text block"],
	["mail.rules.", "mailbox rule"],
	["mail.outbox.", "draft"],
	["calendar.", "event"],
	["reminders.", "reminder"],
	["time.", "time entry"],
	["notes.", "note"],
	["pages.", "page"],
	["automations.", "automation"],
	["reference.", "list item"],
];

/** The final part of a tool name, as the phrase that goes before the noun. */
const VERBS: Record<string, string> = {
	create: "Create",
	create_event: "Create",
	create_item: "Add",
	create_link: "Add",
	update: "Change",
	update_event: "Change",
	update_item: "Change",
	update_link: "Change",
	update_asset: "Change",
	delete: "Delete",
	delete_asset: "Delete",
	delete_link: "Delete",
	remove: "Remove",
	remove_event: "Remove",
	remove_version: "Remove a version of",
	restore: "Restore",
	restore_event: "Restore",
	archive: "Archive",
	duplicate: "Duplicate",
	disable: "Switch off",
	run: "Run",
	import: "Import",
	import_ics: "Import",
	import_docx: "Import",
	generate: "Generate",
	link: "Link",
	add_version: "Add a version to",
	render_pdf: "Make a PDF of",
	set_status: "Change the status of",
	set_primary: "Make primary",
	set_cover: "Set the cover of",
	set_sync: "Change what syncs for",
	reorder: "Reorder",
	rename: "Rename",
	cancel: "Cancel",
	hide: "Hide",
	hide_item: "Hide",
	unhide_item: "Show",
	reset_all: "Reset",
	reset_set: "Reset",
	accept: "Accept",
	complete: "Complete",
	reopen: "Reopen",
	snooze: "Snooze",
	start: "Start",
	stop: "Stop",
	add_image: "Add a picture to",
	detach: "Detach",
	link_client: "Link a client to",
	unlink_client: "Unlink the client from",
	link_project: "Link a project to",
	unlink_project: "Unlink the project from",
	add_file_from_mail: "File a mail attachment in",
	attach_project_file: "Attach a project file to",
};

function clip(text: string): string {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length > MAX_NAME ? `${one.slice(0, MAX_NAME - 3)}...` : one;
}

/** A name the agent supplied, or null. Never a secret, never a long text. */
function nameFromArgs(args: Record<string, unknown>): string | null {
	for (const key of ["name", "title", "label", "subject"]) {
		if (SECRET.test(key)) continue;
		const value = args[key];
		if (typeof value === "string" && value.trim().length > 0) return clip(value);
	}
	return null;
}

function count(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function nounOf(toolName: string): string | null {
	for (const [prefix, noun] of NOUNS) if (toolName.startsWith(prefix)) return noun;
	return null;
}

/** Tools whose sentence is not "verb the noun". */
function special(toolName: string, args: Record<string, unknown>, db: Db): string | null {
	const named = nameOfRecord(toolName, args, db);
	switch (toolName) {
		case "mail.draft":
			return typeof args.subject === "string" && args.subject ? `Write the draft "${clip(args.subject)}"` : "Write a mail draft";
		case "mail.reply":
			return named ? `Write a reply to "${named}"` : "Write a reply to a mail";
		case "mail.send":
			return named ? `Send the draft "${named}"` : "Send a draft";
		case "mail.send_from_template":
			return named ? `Send a mail from the template "${named}"` : "Send a mail from a template";
		case "mail.sync":
			return "Fetch new mail";
		case "documents.generate":
			return named ? `Make a document from the template "${named}"` : "Make a document from a template";
		case "documents.import":
			return "Import a document";
		case "time.start":
			return named ? `Start the timer on "${named}"` : "Start a timer";
		case "time.stop":
			return "Stop the timer";
		case "settings.set_owner":
			return "Change your own details";
		case "settings.set_theme":
			return "Change the theme";
		case "settings.add_owner_email":
		case "settings.update_owner_email":
		case "settings.remove_owner_email":
			return `${toolName.endsWith("add_owner_email") ? "Add" : toolName.endsWith("remove_owner_email") ? "Remove" : "Change"} one of your email addresses`;
		case "settings.add_owner_phone":
		case "settings.update_owner_phone":
		case "settings.remove_owner_phone":
			return `${toolName.endsWith("add_owner_phone") ? "Add" : toolName.endsWith("remove_owner_phone") ? "Remove" : "Change"} one of your phone numbers`;
		case "updates.set_auto_install":
			return "Change whether updates install by themselves";
		case "desktop.update":
			return "Change the desktop settings";
		case "mail.file.set_folder_seen":
			return named ? `Mark every mail in "${named}" as read` : "Mark every mail in a folder as read";
		case "mail.file.empty_folder":
			return named ? `Empty the folder "${named}"` : "Empty a mail folder";
	}
	if (toolName.startsWith("mail.file.")) {
		const verb = toolName.slice("mail.file.".length).replace(/_messages$/, "");
		const n = count(args.message_ids) || count(args.thread_ids);
		const what = n > 0 ? plural(n, "mail", "mails") : "a mail";
		const words: Record<string, string> = {
			archive: "Archive",
			junk: "Move to junk",
			move: "Move",
			trash: "Move to the bin",
			delete: "Delete for good",
			set_flagged: "Change the star on",
			set_seen: "Change the read state of",
		};
		const head = words[verb];
		if (head) return `${head} ${what}`;
	}
	return null;
}

/**
 * The sentence for a call, in the language of the interface. `title` is the
 * tool's own title, used when nothing better can be said.
 */
export function summaryFor(
	toolName: string,
	title: string,
	args: Record<string, unknown>,
	db: Db = getDb(),
): string {
	const sentence = special(toolName, args, db);
	if (sentence) return sentence;

	const noun = nounOf(toolName);
	const verb = VERBS[toolName.split(".").pop() ?? ""];
	if (!noun || !verb) return title;

	// An id on these names a file or a link, which the lookup cannot resolve.
	const aboutProject = noun.startsWith("project ") ? null : undefined;
	const name = nameFromArgs(args) ?? (aboutProject === null ? null : nameOfRecord(toolName, args, db));
	if (toolName.endsWith(".set_primary")) return name ? `Make the ${noun} "${name}" the main one` : `Make a ${noun} the main one`;
	return name ? `${verb} the ${noun} "${name}"` : `${verb} a ${noun}`;
}
