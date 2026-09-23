import * as actions from "../services/mail-actions";
import type { ToolDescriptor } from "./types";

/**
 * Filing mail: archived, trashed, marked junk, moved, read, flagged, gone.
 *
 * Every one of these writes to the IMAP server, which is what separates them
 * from the rest of the mail surface. Sync stays read-only by construction and
 * these go through a different object to reach a different permission, which is
 * the whole point of the split in ../services/mail-writer.ts.
 *
 * All of them are side-effectful and all of them are confirmed, because all of
 * them file something (.claude/rules/mcp.md section 4). `mail.file.delete`
 * destroys the copy on the server as well, and its description says so in those
 * words, because the approval screen prints the description and that sentence
 * is the whole reason a person would say no.
 *
 * Ids are ids. These take thread or message ids from mail.threads.list, never a
 * subject or a sender to match on.
 */

const threadIds = {
	thread_ids: {
		type: "array",
		items: { type: "string" },
		minItems: 1,
		description: "Thread ids from mail.threads.list.",
	},
};

const messageIds = {
	message_ids: {
		type: "array",
		items: { type: "string" },
		minItems: 1,
		description: "Message ids from mail.threads.get.",
	},
};

function ids(args: Record<string, unknown>, key: string): string[] {
	const value = args[key];
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${key} has to be a non-empty list of ids.`);
	}
	return value.map(String);
}

export const mailActionTools: ToolDescriptor[] = [
	{
		name: "mail.file.archive",
		title: "Archive threads",
		description:
			"Moves every message in these threads to the account's Archive folder, on the server. " +
			"Fails with a message saying so if the account has no Archive folder.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: threadIds,
			required: ["thread_ids"],
			additionalProperties: false,
		},
		handler: async (args) => actions.archiveThreads(ids(args, "thread_ids")),
	},
	{
		name: "mail.file.trash",
		title: "Move threads to trash",
		description:
			"Moves every message in these threads to the account's Trash folder, on the server. " +
			"Reversible by moving them back out; mail.file.delete is the one that is not.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: threadIds,
			required: ["thread_ids"],
			additionalProperties: false,
		},
		handler: async (args) => actions.trashThreads(ids(args, "thread_ids")),
	},
	{
		name: "mail.file.junk",
		title: "Move threads to junk",
		description: "Moves every message in these threads to the account's Junk folder, on the server.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: threadIds,
			required: ["thread_ids"],
			additionalProperties: false,
		},
		handler: async (args) => actions.junkThreads(ids(args, "thread_ids")),
	},
	{
		name: "mail.file.move",
		title: "Move threads to a folder",
		description:
			"Moves every message in these threads to a named folder on the same account, on the " +
			"server. Folder ids come from mail.folders.list.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				...threadIds,
				folder_id: { type: "string", description: "A folder id from mail.folders.list." },
			},
			required: ["thread_ids", "folder_id"],
			additionalProperties: false,
		},
		handler: async (args) =>
			actions.moveThreads(ids(args, "thread_ids"), { folderId: String(args.folder_id) }),
	},
	{
		name: "mail.file.delete",
		title: "Delete threads for good",
		description:
			"Deletes every message in these threads from the mail server as well as from this " +
			"machine. There is no undo and no copy left anywhere. Use mail.file.trash unless " +
			"permanent is what was asked for.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: threadIds,
			required: ["thread_ids"],
			additionalProperties: false,
		},
		handler: async (args) => actions.deleteThreadsForever(ids(args, "thread_ids")),
	},
	{
		name: "mail.file.set_seen",
		title: "Mark messages read or unread",
		description: "Sets or clears the read flag on messages, on the server and here.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				...messageIds,
				seen: { type: "boolean", description: "True marks read, false marks unread." },
			},
			required: ["message_ids", "seen"],
			additionalProperties: false,
		},
		handler: async (args) => actions.setSeen(ids(args, "message_ids"), args.seen === true),
	},
	{
		name: "mail.file.set_flagged",
		title: "Flag or unflag messages",
		description: "Sets or clears the flagged mark on messages, on the server and here.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				...messageIds,
				flagged: { type: "boolean" },
			},
			required: ["message_ids", "flagged"],
			additionalProperties: false,
		},
		handler: async (args) => actions.setFlagged(ids(args, "message_ids"), args.flagged === true),
	},
];
