import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { standardColumns } from "../columns";
import { clients } from "./clients";

/**
 * An IMAP account. Settings only.
 *
 * Decision 6: the password lives in the credential store, wrapped by
 * safeStorage, under `credential_key`. If a secret can appear in a SELECT it is
 * in the wrong place, and nothing in this table can.
 *
 * Phase 3 is read-only. Nothing here is ever written back to the server.
 */
export const mailAccounts = sqliteTable(
	"mail_accounts",
	{
		...standardColumns,
		/** What the sidebar calls it: "hallo@obet.be" or "Work". */
		label: text("label").notNull(),
		email: text("email").notNull(),
		imapHost: text("imap_host").notNull(),
		imapPort: integer("imap_port").notNull().default(993),
		/** tls (implicit, port 993) or starttls (upgrade, port 143). Never plain. */
		imapSecurity: text("imap_security").notNull().default("tls"),
		username: text("username").notNull(),
		/** Where the password is. A reference, never the value. */
		credentialKey: text("credential_key").notNull(),
		/**
		 * Sending, phase 4. Null host means the account is read-only. The same
		 * credential serves both directions; `smtp_username` only overrides the
		 * login name when a provider wants a different one.
		 */
		smtpHost: text("smtp_host"),
		smtpPort: integer("smtp_port").notNull().default(465),
		smtpSecurity: text("smtp_security").notNull().default("tls"),
		smtpUsername: text("smtp_username"),
		/** The display name on outgoing mail. Defaults to the owner's name. */
		fromName: text("from_name"),
		/**
		 * How far back the first sync of a folder reaches, in days. Bounds a large
		 * mailbox to something that finishes tonight; raise it later to pull more.
		 */
		horizonDays: integer("horizon_days").notNull().default(90),
		syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(10),
		syncEnabled: integer("sync_enabled", { mode: "boolean" }).notNull().default(true),
		lastSyncAt: text("last_sync_at"),
		/** The last failure, in words a person can act on. Cleared by a clean sync. */
		lastSyncError: text("last_sync_error"),
	},
	(t) => [
		index("mail_accounts_owner_idx").on(t.ownerId),
		index("mail_accounts_deleted_idx").on(t.deletedAt),
	],
);

export const mailFolders = sqliteTable(
	"mail_folders",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		/** The server's path, delimiter included: "INBOX", "Archive/2025". */
		path: text("path").notNull(),
		name: text("name").notNull(),
		delimiter: text("delimiter"),
		/** inbox, sent, drafts, trash, junk, archive, or null for an ordinary folder. */
		specialUse: text("special_use"),
		/**
		 * The server's UIDVALIDITY as text, because it is a 32-bit unsigned value
		 * some servers fill entirely. When it changes every local UID is meaningless
		 * and the folder starts over.
		 */
		uidValidity: text("uid_validity"),
		uidNext: integer("uid_next"),
		/** Whether sync pulls this folder. INBOX on by default, the rest opt in. */
		syncEnabled: integer("sync_enabled", { mode: "boolean" }).notNull().default(false),
		/** The horizon the last full listing used, so a raised horizon triggers one. */
		syncedHorizonDays: integer("synced_horizon_days"),
		messageCount: integer("message_count").notNull().default(0),
		unreadCount: integer("unread_count").notNull().default(0),
		lastSyncAt: text("last_sync_at"),
	},
	(t) => [
		uniqueIndex("mail_folders_account_path_idx").on(t.accountId, t.path),
		index("mail_folders_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A thread is the unit the reader shows and the unit that links to a client.
 *
 * `client_id` is the point of the phase: it turns an archive into a client
 * record. `link_source` protects a manual choice from the next sync, which may
 * only fill in a null.
 */
export const mailThreads = sqliteTable(
	"mail_threads",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		/** The subject of the first message, as it arrived. */
		subject: text("subject").notNull(),
		/** Lowercased, with the reply and forward prefixes stripped. */
		subjectNorm: text("subject_norm").notNull(),
		clientId: text("client_id").references(() => clients.id),
		/** auto, manual, or null while unlinked and never touched by hand. */
		linkSource: text("link_source"),
		firstMessageAt: text("first_message_at").notNull(),
		lastMessageAt: text("last_message_at").notNull(),
	},
	(t) => [
		index("mail_threads_account_last_idx").on(t.accountId, t.lastMessageAt),
		index("mail_threads_client_idx").on(t.clientId),
		index("mail_threads_deleted_idx").on(t.deletedAt),
	],
);

/**
 * One message, once. The unique index on (account, folder, uid) is what makes a
 * re-sync an update rather than a duplicate.
 *
 * Headers land first, bodies later, so `body_fetched_at` is null for a message
 * the list can already show but the reader cannot yet open.
 *
 * `body_html` is stored as it arrived. It is hostile input and is sanitised on
 * every read, in the main process, so a sanitiser upgrade applies to old mail.
 */
export const mailMessages = sqliteTable(
	"mail_messages",
	{
		...standardColumns,
		accountId: text("account_id")
			.notNull()
			.references(() => mailAccounts.id),
		folderId: text("folder_id")
			.notNull()
			.references(() => mailFolders.id),
		threadId: text("thread_id")
			.notNull()
			.references(() => mailThreads.id),
		uid: integer("uid").notNull(),
		messageId: text("message_id"),
		inReplyTo: text("in_reply_to"),
		/** JSON array of Message-IDs, from the References header. */
		referencesJson: text("references_json").notNull().default("[]"),
		fromName: text("from_name"),
		fromAddress: text("from_address"),
		/** JSON arrays of { name, address }. */
		toJson: text("to_json").notNull().default("[]"),
		ccJson: text("cc_json").notNull().default("[]"),
		replyToJson: text("reply_to_json").notNull().default("[]"),
		subject: text("subject").notNull().default(""),
		/** The first line or so of the text body, for the list. */
		snippet: text("snippet").notNull().default(""),
		/** The Date header, normalised to UTC. */
		sentAt: text("sent_at"),
		/** When the server received it. The reliable one for ordering. */
		internalDate: text("internal_date").notNull(),
		size: integer("size"),
		isSeen: integer("is_seen", { mode: "boolean" }).notNull().default(false),
		isFlagged: integer("is_flagged", { mode: "boolean" }).notNull().default(false),
		isAnswered: integer("is_answered", { mode: "boolean" }).notNull().default(false),
		hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),
		bodyText: text("body_text"),
		bodyHtml: text("body_html"),
		bodyFetchedAt: text("body_fetched_at"),
		/** Set when a body could not be fetched or parsed, so it is not retried forever. */
		bodyError: text("body_error"),
	},
	(t) => [
		uniqueIndex("mail_messages_folder_uid_idx").on(t.accountId, t.folderId, t.uid),
		index("mail_messages_thread_idx").on(t.threadId),
		index("mail_messages_folder_date_idx").on(t.folderId, t.internalDate),
		index("mail_messages_account_message_id_idx").on(t.accountId, t.messageId),
		index("mail_messages_from_idx").on(t.fromAddress),
		index("mail_messages_body_pending_idx").on(t.folderId, t.bodyFetchedAt),
		index("mail_messages_deleted_idx").on(t.deletedAt),
	],
);

/** On disk under the mail directory, never in the database. */
export const mailAttachments = sqliteTable(
	"mail_attachments",
	{
		...standardColumns,
		messageId: text("message_id")
			.notNull()
			.references(() => mailMessages.id),
		/** The name the message supplied, path separators stripped. */
		filename: text("filename").notNull(),
		mimeType: text("mime_type").notNull(),
		size: integer("size").notNull(),
		/** Relative to the mail directory, built by the service from ids. */
		filePath: text("file_path").notNull(),
		/** The Content-ID, for an image referenced from the HTML body. */
		contentId: text("content_id"),
		isInline: integer("is_inline", { mode: "boolean" }).notNull().default(false),
	},
	(t) => [
		index("mail_attachments_message_idx").on(t.messageId),
		index("mail_attachments_deleted_idx").on(t.deletedAt),
	],
);
