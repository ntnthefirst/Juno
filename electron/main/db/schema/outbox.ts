import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { seededColumns, standardColumns } from "../columns";
import { clients, projects } from "./clients";
import { documents } from "./documents";
import { mailAccounts, mailMessages, mailThreads } from "./mail";

/**
 * A mail template: a Dutch subject and body with placeholders, filled from the
 * same context the document templates use. Seeded reference data, decision 16.
 */
export const mailTemplates = sqliteTable(
	"mail_templates",
	{
		...standardColumns,
		...seededColumns,
		/** Stable machine key: contract_cover, project_kickoff, invoice_due, hosting_renewal. */
		key: text("key").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		language: text("language").notNull().default("nl-BE"),
		/** "u" or "je". Held for the whole template, never mixed. */
		register: text("register").notNull().default("u"),
		subject: text("subject").notNull(),
		bodyHtml: text("body_html").notNull(),
		/**
		 * The values this template asks for when it is used, beyond what the client
		 * and the project already answer. JSON array of input declarations.
		 */
		inputsJson: text("inputs_json"),
		/**
		 * The canvas the editor works on, as JSON. Null is an HTML-only template:
		 * everything written before the canvas existed, and anything somebody
		 * prefers to keep as hand-written HTML. `body_html` is compiled from this
		 * whenever it is set, so the two cannot disagree.
		 */
		layoutJson: text("layout_json"),
	},
	(t) => [
		index("mail_templates_key_idx").on(t.key),
		index("mail_templates_deleted_idx").on(t.deletedAt),
		// The list filters both of these on every read: a hidden system template
		// is gone from the pickers and still resolves on the drafts that point at
		// it (.claude/rules/data.md section 9).
		index("mail_templates_hidden_idx").on(t.hiddenAt),
	],
);

/**
 * The outbox: every message Juno composes, from draft to sent, with the
 * confirmation gate as a state rather than a flag.
 *
 *   draft     being written; nothing will happen to it
 *   pending   an agent asked to send it; a person has to approve it in the app
 *   queued    approved, or sent by a person; the sender will pick it up
 *   sending   in flight
 *   sent      accepted by the SMTP server
 *   failed    the server refused or could not be reached; retry is manual
 *   cancelled withdrawn before it went out
 *
 * A row only reaches `queued` through one function, and that function is the
 * gate. See services/mail-outbox.ts.
 */
export const mailOutbox = sqliteTable(
	"mail_outbox",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		state: text("state").notNull().default("draft"),
		/** JSON arrays of { name, address }. */
		toJson: text("to_json").notNull().default("[]"),
		ccJson: text("cc_json").notNull().default("[]"),
		bccJson: text("bcc_json").notNull().default("[]"),
		subject: text("subject").notNull().default(""),
		bodyText: text("body_text").notNull().default(""),
		/** The rendered HTML, in the house style. Null means text only. */
		bodyHtml: text("body_html"),
		/** Generated once at creation, so a retry never sends under a new id. */
		messageId: text("message_id").notNull(),
		/** Threading headers, copied from the message being answered. */
		inReplyTo: text("in_reply_to"),
		referencesJson: text("references_json").notNull().default("[]"),
		/** The local message this answers, and the thread it belongs to. */
		replyToMessageId: text("reply_to_message_id").references(() => mailMessages.id),
		threadId: text("thread_id").references(() => mailThreads.id),
		clientId: text("client_id").references(() => clients.id),
		projectId: text("project_id").references(() => projects.id),
		templateId: text("template_id").references(() => mailTemplates.id),
		/** user or agent. An agent's message waits for a person. */
		requestedBy: text("requested_by").notNull().default("user"),
		approvedAt: text("approved_at"),
		queuedAt: text("queued_at"),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("last_error"),
		sentAt: text("sent_at"),
		/** Copied into the account's Sent folder, so the phone shows it too. */
		appendedToSentAt: text("appended_to_sent_at"),
		appendError: text("append_error"),
	},
	(t) => [
		index("mail_outbox_account_state_idx").on(t.accountId, t.state),
		index("mail_outbox_state_idx").on(t.state),
		index("mail_outbox_thread_idx").on(t.threadId),
		index("mail_outbox_client_idx").on(t.clientId),
		index("mail_outbox_deleted_idx").on(t.deletedAt),
	],
);

/**
 * Every client an outgoing message concerns.
 *
 * `mail_outbox.client_id` is the one the message is filed under, and it stays.
 * This table is the rest of them, because a message addressed to two people who
 * belong to two different clients concerns both, and dropping one of them the
 * moment the recipients are resolved loses information nobody typed twice.
 * Filled from the addresses, so it follows the To and Cc lines.
 */
export const mailOutboxClients = sqliteTable(
	"mail_outbox_clients",
	{
		...standardColumns,
		outboxId: text("outbox_id")
			.notNull()
			.references(() => mailOutbox.id),
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		/** The address that resolved to this client, so the composer can say why. */
		matchedAddress: text("matched_address").notNull(),
	},
	(t) => [
		index("mail_outbox_clients_outbox_idx").on(t.outboxId),
		index("mail_outbox_clients_client_idx").on(t.clientId),
		index("mail_outbox_clients_deleted_idx").on(t.deletedAt),
	],
);

/**
 * An attachment on an outgoing message. Only a document row for now: the file
 * is resolved from the document at send time, so no path is stored and a
 * document re-rendered after attaching goes out in its latest form.
 */
export const mailOutboxAttachments = sqliteTable(
	"mail_outbox_attachments",
	{
		...standardColumns,
		outboxId: text("outbox_id")
			.notNull()
			.references(() => mailOutbox.id),
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id),
		/** The name the recipient sees. */
		filename: text("filename").notNull(),
	},
	(t) => [
		index("mail_outbox_attachments_outbox_idx").on(t.outboxId),
		index("mail_outbox_attachments_document_idx").on(t.documentId),
	],
);
