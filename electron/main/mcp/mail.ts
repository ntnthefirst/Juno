import type { MailAccountPatch, MailSecurity, MailThreadListQuery } from "../../shared/types";
import * as accounts from "../services/mail-accounts";
import { guess as guessAutoconfig, resolveByMx } from "../services/mail-autoconfig";
import * as folders from "../services/mail-folders";
import * as sync from "../services/mail-sync";
import * as threads from "../services/mail-threads";
import type { ToolDescriptor } from "./types";

/**
 * Mail tools. Read-only against the server, always: phase 3 writes nothing
 * back, and the source interface has no method that could.
 *
 * What is deliberately not here:
 * - **No tool returns a password**, masked or otherwise, and there is no
 *   `mail.accounts.get_credential`. `mail.accounts.create` takes one and that
 *   is the only direction it travels.
 * - **No raw HTML.** The body tool returns the text and the sanitised
 *   metadata; the rendered document is served to the reader's frame and to
 *   nothing else.
 * - **No attachment contents.** An agent learns that a file exists and what it
 *   is called. Opening it is a person's decision.
 *
 * `mail.sync` is side-effectful in the sense that it writes local rows, and
 * harmless in every other: it is the one write here that needs no confirmation.
 */

const SECURITIES: MailSecurity[] = ["tls", "starttls"];

export const mailTools: ToolDescriptor[] = [
	{
		name: "mail.accounts.list",
		title: "List mail accounts",
		description:
			"Every configured IMAP account with its server, sync settings, last sync time and last error. Never a password.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => accounts.list(),
	},
	{
		name: "mail.accounts.create",
		title: "Add a mail account",
		description:
			"Adds an IMAP account. The password is stored in the operating system keychain and " +
			"cannot be read back through any tool. Test the settings first with mail.accounts.test.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				email: { type: "string", description: "The address, like hallo@obet.be." },
				label: { type: "string", description: "What to call it. Defaults to the address." },
				imap_host: { type: "string", description: "Hostname only, like imap.example.be." },
				imap_port: { type: "integer", description: "993 for tls, 143 for starttls." },
				imap_security: { type: "string", enum: SECURITIES },
				username: { type: "string", description: "Defaults to the address." },
				password: { type: "string" },
				horizon_days: {
					type: "integer",
					minimum: 1,
					maximum: 3650,
					description: "How far back the first sync of a folder reaches. Default 90.",
				},
				sync_interval_minutes: { type: "integer", minimum: 1, maximum: 1440 },
			},
			required: ["email", "imap_host", "password"],
			additionalProperties: false,
		},
		handler: async (args) =>
			accounts.create({
				email: String(args.email),
				imapHost: String(args.imap_host),
				password: String(args.password),
				...(args.label !== undefined ? { label: String(args.label) } : {}),
				...(args.imap_port !== undefined ? { imapPort: Number(args.imap_port) } : {}),
				...(args.imap_security !== undefined ? { imapSecurity: args.imap_security as MailSecurity } : {}),
				...(args.username !== undefined ? { username: String(args.username) } : {}),
				...(args.horizon_days !== undefined ? { horizonDays: Number(args.horizon_days) } : {}),
				...(args.sync_interval_minutes !== undefined
					? { syncIntervalMinutes: Number(args.sync_interval_minutes) }
					: {}),
			}),
	},
	{
		name: "mail.accounts.update",
		title: "Edit a mail account",
		description: "Changes the settings of an account. A new password replaces the stored one.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				email: { type: "string" },
				label: { type: "string" },
				imap_host: { type: "string" },
				imap_port: { type: "integer" },
				imap_security: { type: "string", enum: SECURITIES },
				username: { type: "string" },
				password: { type: "string" },
				horizon_days: { type: "integer", minimum: 1, maximum: 3650 },
				sync_interval_minutes: { type: "integer", minimum: 1, maximum: 1440 },
				sync_enabled: { type: "boolean" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const patch: MailAccountPatch = {
				...(args.email !== undefined ? { email: String(args.email) } : {}),
				...(args.label !== undefined ? { label: String(args.label) } : {}),
				...(args.imap_host !== undefined ? { imapHost: String(args.imap_host) } : {}),
				...(args.imap_port !== undefined ? { imapPort: Number(args.imap_port) } : {}),
				...(args.imap_security !== undefined ? { imapSecurity: args.imap_security as MailSecurity } : {}),
				...(args.username !== undefined ? { username: String(args.username) } : {}),
				...(args.password !== undefined ? { password: String(args.password) } : {}),
				...(args.horizon_days !== undefined ? { horizonDays: Number(args.horizon_days) } : {}),
				...(args.sync_interval_minutes !== undefined
					? { syncIntervalMinutes: Number(args.sync_interval_minutes) }
					: {}),
				...(args.sync_enabled !== undefined ? { syncEnabled: Boolean(args.sync_enabled) } : {}),
			};
			return accounts.update(String(args.id), patch);
		},
	},
	{
		name: "mail.accounts.remove",
		title: "Remove a mail account",
		description:
			"Removes an account and forgets its password. The messages already pulled stay on this machine.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => accounts.remove(String(args.id)),
	},
	{
		name: "mail.accounts.guess",
		title: "Guess mail server settings",
		description:
			"Server settings for an email address, from a table of known providers and otherwise from " +
			"the imap./smtp. convention. Nothing is stored and nothing is fetched over the network, so " +
			"this is a suggestion to check with mail.accounts.test, not an answer.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				email: { type: "string", description: "A full address, for example hallo@example.be" },
			},
			required: ["email"],
			additionalProperties: false,
		},
		handler: async (args) => guessAutoconfig(String(args.email)),
	},
	{
		name: "mail.accounts.look_up",
		title: "Find the mail host behind a domain",
		description:
			"Asks DNS which servers handle mail for the address's domain, and maps the answer to IMAP " +
			"and SMTP settings. This is what finds a business whose own domain is hosted elsewhere, " +
			"which mail.accounts.guess cannot see. Null means the host is not one Juno recognises. " +
			"Makes a DNS query; stores nothing.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				email: { type: "string", description: "A full address, for example info@example.be" },
			},
			required: ["email"],
			additionalProperties: false,
		},
		handler: async (args) => resolveByMx(String(args.email)),
	},
	{
		name: "mail.accounts.test",
		title: "Test a mail connection",
		description:
			"Connects with the given settings and logs out again without storing anything. With only " +
			"an id, tests an existing account using its stored password. Returns whether it worked and, " +
			"if not, what to change.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				imap_host: { type: "string" },
				imap_port: { type: "integer" },
				imap_security: { type: "string", enum: SECURITIES },
				username: { type: "string" },
				password: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: async (args) =>
			accounts.test({
				...(args.id !== undefined ? { id: String(args.id) } : {}),
				...(args.imap_host !== undefined ? { imapHost: String(args.imap_host) } : {}),
				...(args.imap_port !== undefined ? { imapPort: Number(args.imap_port) } : {}),
				...(args.imap_security !== undefined ? { imapSecurity: args.imap_security as MailSecurity } : {}),
				...(args.username !== undefined ? { username: String(args.username) } : {}),
				...(args.password !== undefined ? { password: String(args.password) } : {}),
			}),
	},
	{
		name: "mail.folders.list",
		title: "List folders",
		description:
			"The folders of an account as last seen on the server, with counts and whether each is synced.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { account_id: { type: "string" } },
			required: ["account_id"],
			additionalProperties: false,
		},
		handler: async (args) => folders.list(String(args.account_id)),
	},
	{
		name: "mail.folders.set_sync",
		title: "Turn a folder's sync on or off",
		description: "Whether the next sync pulls this folder. The inbox is on by default, the rest off.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, enabled: { type: "boolean" } },
			required: ["id", "enabled"],
			additionalProperties: false,
		},
		handler: async (args) => folders.setSyncEnabled(String(args.id), Boolean(args.enabled)),
	},
	{
		name: "mail.sync",
		title: "Sync mail",
		description:
			"Pulls new mail into this machine, for one account or all of them, and waits for the run " +
			"to finish. Reads only: nothing is written to the server. Each run is bounded, so a large " +
			"first sync takes several runs; the status says what remains.",
		readOnly: false,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { account_id: { type: "string", description: "Leave out for every account." } },
			additionalProperties: false,
		},
		handler: async (args) =>
			args.account_id ? [await sync.syncAccount(String(args.account_id))] : sync.syncAll(),
	},
	{
		name: "mail.sync_status",
		title: "Read sync status",
		description: "The state of the last or current sync run per account, including any error.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: async () => sync.status(),
	},
	{
		name: "mail.threads.list",
		title: "List threads",
		description:
			"Threads newest first, filtered by account, folder or client. With search, a full-text " +
			"match over subject, body and sender, ranked, with a snippet. Pages with before.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: {
				account_id: { type: "string" },
				folder_id: { type: "string" },
				client_id: { type: "string" },
				search: { type: "string", description: "Words to find. The last one matches as a prefix." },
				unread_only: { type: "boolean" },
				limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
				before: {
					type: "string",
					description: "The last_message_at of the last row seen, for the next page.",
				},
			},
			additionalProperties: false,
		},
		handler: async (args) => {
			const query: MailThreadListQuery = {
				...(args.account_id !== undefined ? { accountId: String(args.account_id) } : {}),
				...(args.folder_id !== undefined ? { folderId: String(args.folder_id) } : {}),
				...(args.client_id !== undefined ? { clientId: String(args.client_id) } : {}),
				...(args.search !== undefined ? { search: String(args.search) } : {}),
				...(args.unread_only !== undefined ? { unreadOnly: Boolean(args.unread_only) } : {}),
				...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
				...(args.before !== undefined ? { before: String(args.before) } : {}),
			};
			return threads.listThreads(query);
		},
	},
	{
		name: "mail.threads.get",
		title: "Read a thread",
		description:
			"A thread with every message's headers, flags and attachment list, oldest first. Bodies " +
			"come from mail.messages.body.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => threads.getThread(String(args.id)),
	},
	{
		name: "mail.threads.link_client",
		title: "Link a thread to a client",
		description:
			"Records that this thread belongs to a client. A link made this way is kept through every " +
			"later sync, unlike the automatic one made from the sender's address.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, client_id: { type: "string" } },
			required: ["id", "client_id"],
			additionalProperties: false,
		},
		handler: async (args) => threads.linkClient(String(args.id), String(args.client_id)),
	},
	{
		name: "mail.threads.unlink_client",
		title: "Unlink a thread from its client",
		description: "Removes the client link, and stops the sync from putting it back.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => threads.unlinkClient(String(args.id)),
	},
	{
		name: "mail.messages.get",
		title: "Read a message's headers",
		description: "One message: addresses, subject, dates, flags and attachments. Not the body.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => threads.getMessage(String(args.id)),
	},
	{
		name: "mail.messages.body",
		title: "Read a message's body",
		description:
			"The plain text of a message, plus every link it carries with its real target and how " +
			"many remote images were blocked. Null text means the body has not been fetched yet.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (args) => threads.getBody(String(args.id)),
	},
];
