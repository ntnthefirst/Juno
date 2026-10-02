/**
 * Reading mail: the thread list, a thread's messages, a message's body made
 * safe, full-text search, and the client link on a thread.
 *
 * Every read filters soft-deleted rows, and every body goes through the
 * sanitiser on the way out. The raw HTML never leaves this module.
 */
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type {
	MailAddress,
	MailAttachment,
	MailMessage,
	MailMessageBody,
	MailSpecialUse,
	MailThread,
	MailThreadListQuery,
	MailThreadSummary,
} from "../../shared/types";
import { isOpenableAttachment } from "../../shared/attachment-kind";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, mailAccounts, mailAttachments, mailFolders, mailMessages, mailThreads } from "../db/schema";
import { outgoingForThread } from "./mail-outbox";
import { sanitiseHtml, textDocumentBody } from "./mail-sanitise";

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const DEFAULT_LIMIT = 50;
/**
 * The most rows one call returns. A page is bounded on purpose, and the list
 * screen asks for another hundred at a time up to this, which is more mail than
 * anybody scrolls in one sitting and small enough to stay one query.
 */
const MAX_LIMIT = 500;

/** Inline images larger than this are not embedded. A logo is kilobytes. */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

let mailDirectory: string | null = null;

export function configureMailThreads(dir: string): void {
	mailDirectory = dir;
}

function mailDir(): string {
	if (!mailDirectory) throw new Error("Mail reading was used before the app configured it.");
	return mailDirectory;
}

/** The directory attachments live in, for the purge, which deletes inside it. */
export function mailRoot(): string {
	return mailDir();
}

type MessageRow = typeof mailMessages.$inferSelect;
type ThreadRow = typeof mailThreads.$inferSelect;

function parseAddresses(json: string): MailAddress[] {
	try {
		const value: unknown = JSON.parse(json);
		if (!Array.isArray(value)) return [];
		return value
			.filter(
				(v): v is MailAddress =>
					typeof v === "object" && v !== null && typeof (v as MailAddress).address === "string",
			)
			.map((v) => ({ name: v.name ?? null, address: v.address }));
	} catch {
		return [];
	}
}

type FolderLabel = { name: string; use: MailSpecialUse | null };

function toMessage(row: MessageRow, attachments: MailAttachment[], folder: FolderLabel | undefined): MailMessage {
	return {
		id: row.id,
		accountId: row.accountId,
		folderId: row.folderId,
		folderName: folder?.name ?? "",
		folderUse: folder?.use ?? null,
		threadId: row.threadId,
		uid: row.uid,
		messageId: row.messageId,
		inReplyTo: row.inReplyTo,
		from: row.fromAddress ? { name: row.fromName, address: row.fromAddress } : null,
		to: parseAddresses(row.toJson),
		cc: parseAddresses(row.ccJson),
		replyTo: parseAddresses(row.replyToJson),
		subject: row.subject,
		snippet: row.snippet,
		sentAt: row.sentAt,
		internalDate: row.internalDate,
		size: row.size,
		isSeen: row.isSeen,
		isFlagged: row.isFlagged,
		isAnswered: row.isAnswered,
		hasAttachments: row.hasAttachments,
		bodyFetched: row.bodyFetchedAt !== null,
		bodyError: row.bodyError,
		attachments,
	};
}

/** Display names for the folders these messages are in, trash and junk included. */
function folderLabels(db: Db, folderIds: string[]): Map<string, FolderLabel> {
	const out = new Map<string, FolderLabel>();
	const unique = [...new Set(folderIds)];
	if (unique.length === 0) return out;
	const rows = db
		.select({ id: mailFolders.id, name: mailFolders.name, use: mailFolders.specialUse })
		.from(mailFolders)
		.where(inArray(mailFolders.id, unique))
		.all();
	for (const row of rows) out.set(row.id, { name: row.name, use: row.use as MailSpecialUse | null });
	return out;
}

function toAttachment(row: typeof mailAttachments.$inferSelect): MailAttachment {
	return {
		id: row.id,
		messageId: row.messageId,
		filename: row.filename,
		mimeType: row.mimeType,
		size: row.size,
		// Rows stored before an inline PDF stopped counting as inline are corrected
		// here, so nothing has to be re-fetched to show their attachment.
		isInline: row.isInline && row.mimeType.toLowerCase().startsWith("image/"),
	};
}

/**
 * The FTS5 query for what a person typed: every word quoted so punctuation
 * cannot become syntax, the last one a prefix so typing narrows as it goes.
 */
export function ftsQuery(term: string): string {
	const words = term
		.replace(/["]/g, " ")
		.split(/\s+/)
		// Tokens with no letter or digit are punctuation, and "OR" on its own
		// would be an operator rather than a word.
		.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
		.filter((w) => /[\p{L}\p{N}]/u.test(w) && w.toUpperCase() !== "OR");
	if (words.length === 0) return "";
	return words.map((word, index) => `"${word}"${index === words.length - 1 ? "*" : ""}`).join(" ");
}

interface Summarised {
	thread: ThreadRow;
	clientName: string | null;
	messageCount: number;
	unreadCount: number;
	hasAttachments: boolean;
	isFlagged: boolean;
	snippet: string;
	/** The message the row stands for, which is the one that opens when it is clicked. */
	messageId: string;
	participants: MailAddress[];
}

/**
 * The folders a list is looking at, or null when it spans every folder.
 *
 * A thread lives in every folder one of its messages lives in, so the same
 * conversation is in Inbox for what came in and in Trash for the reply that
 * was deleted. A row counts and shows only what is in the folder it is listed
 * under, otherwise Inbox claims a message that was trashed.
 */
function scopeOf(db: Db, query: MailThreadListQuery): Set<string> | null {
	if (query.folderId) return new Set([query.folderId]);
	if (!query.folderSpecialUse) return null;
	const conditions = [eq(mailFolders.specialUse, query.folderSpecialUse), isNull(mailFolders.deletedAt)];
	if (query.accountId) conditions.push(eq(mailFolders.accountId, query.accountId));
	return new Set(
		db
			.select({ id: mailFolders.id })
			.from(mailFolders)
			.where(and(...conditions))
			.all()
			.map((row) => row.id),
	);
}

function summarise(
	db: Db,
	threads: { thread: ThreadRow; clientName: string | null; snippet?: string; messageId?: string }[],
	scope: Set<string> | null = null,
): MailThreadSummary[] {
	if (threads.length === 0) return [];
	const ids = threads.map((t) => t.thread.id);
	const messages = db
		.select({
			id: mailMessages.id,
			folderId: mailMessages.folderId,
			threadId: mailMessages.threadId,
			fromName: mailMessages.fromName,
			fromAddress: mailMessages.fromAddress,
			toJson: mailMessages.toJson,
			isSeen: mailMessages.isSeen,
			isFlagged: mailMessages.isFlagged,
			hasAttachments: mailMessages.hasAttachments,
			snippet: mailMessages.snippet,
			internalDate: mailMessages.internalDate,
		})
		.from(mailMessages)
		.where(and(inArray(mailMessages.threadId, ids), isNull(mailMessages.deletedAt)))
		.orderBy(desc(mailMessages.internalDate))
		.all();

	const ownAddresses = new Set(
		db
			.select({ email: mailAccounts.email, username: mailAccounts.username })
			.from(mailAccounts)
			.all()
			.flatMap((a) => [a.email.toLowerCase(), a.username.toLowerCase()]),
	);

	const grouped = new Map<string, Summarised>();
	for (const entry of threads) {
		grouped.set(entry.thread.id, {
			thread: entry.thread,
			clientName: entry.clientName,
			messageCount: 0,
			unreadCount: 0,
			hasAttachments: false,
			isFlagged: false,
			snippet: entry.snippet ?? "",
			messageId: entry.messageId ?? "",
			participants: [],
		});
	}
	for (const message of messages) {
		const group = grouped.get(message.threadId);
		if (!group) continue;
		if (scope && !scope.has(message.folderId)) continue;
		group.messageCount += 1;
		if (!message.isSeen) group.unreadCount += 1;
		if (message.hasAttachments) group.hasAttachments = true;
		if (message.isFlagged) group.isFlagged = true;
		// Newest first, so the first message that qualifies is the newest one. A row
		// stands for the newest message in the folder it is listed in (or in the
		// thread, when the list spans folders), and a search names its own hit.
		if (!group.messageId) {
			group.messageId = message.id;
			if (!group.snippet && message.snippet) group.snippet = message.snippet;
		}
		const people = [
			...(message.fromAddress ? [{ name: message.fromName, address: message.fromAddress }] : []),
			...parseAddresses(message.toJson),
		];
		for (const person of people) {
			if (ownAddresses.has(person.address)) continue;
			if (group.participants.some((p) => p.address === person.address)) continue;
			group.participants.push(person);
		}
	}

	// A thread with nothing filed in the listed folder still needs a message.
	const fallbackIds = new Map<string, string>();
	for (const message of messages) if (!fallbackIds.has(message.threadId)) fallbackIds.set(message.threadId, message.id);

	return threads.map(({ thread }) => {
		const group = grouped.get(thread.id)!;
		return {
			id: thread.id,
			accountId: thread.accountId,
			subject: thread.subject || "(no subject)",
			clientId: thread.clientId,
			clientName: group.clientName,
			linkSource: thread.linkSource as "auto" | "manual" | null,
			firstMessageAt: thread.firstMessageAt,
			lastMessageAt: thread.lastMessageAt,
			messageCount: group.messageCount,
			unreadCount: group.unreadCount,
			hasAttachments: group.hasAttachments,
			isFlagged: group.isFlagged,
			participants: group.participants,
			snippet: group.snippet,
			messageId: group.messageId || fallbackIds.get(thread.id) || "",
		};
	});
}

export async function listThreads(query: MailThreadListQuery = {}, db: Db = getDb()): Promise<MailThreadSummary[]> {
	const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const term = query.search?.trim() ?? "";
	const scope = scopeOf(db, query);

	const conditions = [isNull(mailThreads.deletedAt)];
	if (query.accountId) conditions.push(eq(mailThreads.accountId, query.accountId));
	if (query.clientId) conditions.push(eq(mailThreads.clientId, query.clientId));
	if (query.before) conditions.push(lt(mailThreads.lastMessageAt, query.before));
	if (query.folderId) {
		conditions.push(
			sql`exists (select 1 from ${mailMessages} where ${mailMessages.threadId} = ${mailThreads.id} and ${mailMessages.folderId} = ${query.folderId} and ${mailMessages.deletedAt} is null)`,
		);
	}
	if (query.folderSpecialUse) {
		conditions.push(
			sql`exists (select 1 from ${mailMessages} join ${mailFolders} on ${mailFolders.id} = ${mailMessages.folderId} where ${mailMessages.threadId} = ${mailThreads.id} and ${mailFolders.specialUse} = ${query.folderSpecialUse} and ${mailMessages.deletedAt} is null and ${mailFolders.deletedAt} is null)`,
		);
	}
	if (query.unreadOnly) {
		conditions.push(
			sql`exists (select 1 from ${mailMessages} where ${mailMessages.threadId} = ${mailThreads.id} and ${mailMessages.isSeen} = 0 and ${mailMessages.deletedAt} is null)`,
		);
	}
	if (query.flaggedOnly) {
		conditions.push(
			sql`exists (select 1 from ${mailMessages} where ${mailMessages.threadId} = ${mailThreads.id} and ${mailMessages.isFlagged} = 1 and ${mailMessages.deletedAt} is null)`,
		);
	}
	if (query.withAttachments) {
		conditions.push(
			sql`exists (select 1 from ${mailMessages} where ${mailMessages.threadId} = ${mailThreads.id} and ${mailMessages.hasAttachments} = 1 and ${mailMessages.deletedAt} is null)`,
		);
	}
	if (query.fromAddress) {
		const address = query.fromAddress.trim().toLowerCase();
		if (address) {
			// Either side: "mail from Laura" and "mail to Laura" are the same
			// question asked from the two ends of one conversation.
			const inList = `%${escapeLike(JSON.stringify(address))}%`;
			conditions.push(
				sql`exists (select 1 from ${mailMessages} where ${mailMessages.threadId} = ${mailThreads.id} and ${mailMessages.deletedAt} is null and (lower(${mailMessages.fromAddress}) = ${address} or lower(${mailMessages.toJson}) like ${inList} escape '\\' or lower(${mailMessages.ccJson}) like ${inList} escape '\\'))`,
			);
		}
	}
	// A day bound is a date with no time, so the range runs to the end of it.
	if (query.since) conditions.push(sql`${mailThreads.lastMessageAt} >= ${`${query.since}T00:00:00.000Z`}`);
	if (query.until) conditions.push(sql`${mailThreads.lastMessageAt} <= ${`${query.until}T23:59:59.999Z`}`);

	if (term) {
		const match = ftsQuery(term);
		if (!match) return [];
		if (scope && scope.size === 0) return [];
		// The best-ranked message per thread decides the order and the snippet.
		// bm25 and snippet only work in the query that runs the MATCH, and the
		// planner flattens a plain subquery into the join, which breaks that. A
		// materialized CTE keeps the ranking inside the full-text scan. SQLite
		// fills the bare snippet column from the row that produced min(rank).
		const hits = db.all<{ thread_id: string; message_id: string; snippet: string; rank: number }>(sql`
			with f as materialized (
				select message_id,
					snippet(mail_messages_fts, 2, '', '', '...', 12) as snippet,
					bm25(mail_messages_fts, 0.0, 4.0, 1.0, 2.0, 2.0) as rank
				from mail_messages_fts
				where mail_messages_fts match ${match}
			)
			select m.thread_id as thread_id, m.id as message_id, f.snippet as snippet, min(f.rank) as rank
			from f
			join mail_messages m on m.id = f.message_id
			where m.deleted_at is null
			${scope ? sql`and m.folder_id in (${sql.join([...scope].map((id) => sql`${id}`), sql`, `)})` : sql``}
			group by m.thread_id
			order by rank
			limit ${limit * 4}
		`);
		if (hits.length === 0) return [];
		const rows = db
			.select({ thread: mailThreads, clientName: clients.name })
			.from(mailThreads)
			.leftJoin(clients, eq(mailThreads.clientId, clients.id))
			.where(
				and(
					...conditions,
					inArray(
						mailThreads.id,
						hits.map((h) => h.thread_id),
					),
				),
			)
			.all();
		const byId = new Map(rows.map((r) => [r.thread.id, r]));
		const ordered = hits
			.map((hit) => {
				const row = byId.get(hit.thread_id);
				return row
					? { ...row, snippet: hit.snippet.replace(/\s+/g, " ").trim(), messageId: hit.message_id }
					: null;
			})
			.filter((r): r is NonNullable<typeof r> => r !== null)
			.slice(0, limit);
		return summarise(db, ordered, scope);
	}

	const rows = db
		.select({ thread: mailThreads, clientName: clients.name })
		.from(mailThreads)
		.leftJoin(clients, eq(mailThreads.clientId, clients.id))
		.where(and(...conditions))
		.orderBy(desc(mailThreads.lastMessageAt))
		.limit(limit)
		.all();
	return summarise(db, rows, scope);
}

function attachmentsFor(db: Db, messageIds: string[]): Map<string, MailAttachment[]> {
	const out = new Map<string, MailAttachment[]>();
	if (messageIds.length === 0) return out;
	const rows = db
		.select()
		.from(mailAttachments)
		.where(and(inArray(mailAttachments.messageId, messageIds), isNull(mailAttachments.deletedAt)))
		.all();
	for (const row of rows) {
		const list = out.get(row.messageId) ?? [];
		list.push(toAttachment(row));
		out.set(row.messageId, list);
	}
	return out;
}

export async function getThread(id: string, db: Db = getDb()): Promise<MailThread | null> {
	const row = db
		.select({ thread: mailThreads, clientName: clients.name })
		.from(mailThreads)
		.leftJoin(clients, eq(mailThreads.clientId, clients.id))
		.where(and(eq(mailThreads.id, id), isNull(mailThreads.deletedAt)))
		.get();
	if (!row) return null;

	const messages = db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.threadId, id), isNull(mailMessages.deletedAt)))
		.orderBy(mailMessages.internalDate)
		.all();
	const attachments = attachmentsFor(
		db,
		messages.map((m) => m.id),
	);
	const labels = folderLabels(
		db,
		messages.map((m) => m.folderId),
	);

	const [summary] = summarise(db, [row]);
	return {
		summary: summary!,
		messages: messages.map((m) => toMessage(m, attachments.get(m.id) ?? [], labels.get(m.folderId))),
		// The reader shows a reply from the moment it is sent, not from the next
		// sync of Sent (see outgoingForThread).
		outgoing: outgoingForThread(id, db),
	};
}

export async function getMessage(id: string, db: Db = getDb()): Promise<MailMessage | null> {
	const row = db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.id, id), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) return null;
	return toMessage(row, attachmentsFor(db, [id]).get(id) ?? [], folderLabels(db, [row.folderId]).get(row.folderId));
}

/**
 * The absolute path of an attachment, checked to stay inside the mail
 * directory. The stored path is built from ids by the service, but the check
 * costs nothing and a moved database is not impossible.
 */
export function attachmentPath(id: string, db: Db = getDb()): { path: string; filename: string } {
	const row = db
		.select()
		.from(mailAttachments)
		.where(and(eq(mailAttachments.id, id), isNull(mailAttachments.deletedAt)))
		.get();
	if (!row) throw new Error("That attachment does not exist.");
	const root = resolve(mailDir());
	const target = resolve(root, row.filePath);
	if (target !== root && !target.startsWith(root + sep)) {
		throw new Error("That attachment's path is outside the mail folder, so Juno will not open it.");
	}
	return { path: target, filename: row.filename };
}

/**
 * The path of an attachment the operating system may open. Throws for a type
 * outside the short list, which is the only gate: the window hides the button
 * for an untrusted sender, but a renderer's word is not enough.
 */
export function openableAttachmentPath(id: string, db: Db = getDb()): string {
	const { path, filename } = attachmentPath(id, db);
	if (!isOpenableAttachment(filename)) {
		throw new Error(`${filename} cannot be opened from Juno. Use Show in folder instead.`);
	}
	return path;
}

function inlineImages(db: Db, messageId: string): Map<string, string> {
	const out = new Map<string, string>();
	const rows = db
		.select()
		.from(mailAttachments)
		.where(and(eq(mailAttachments.messageId, messageId), isNull(mailAttachments.deletedAt)))
		.all();
	for (const row of rows) {
		if (!row.contentId || !row.mimeType.startsWith("image/") || row.size > MAX_INLINE_IMAGE_BYTES) continue;
		try {
			const bytes = readFileSync(join(mailDir(), row.filePath));
			out.set(row.contentId.replace(/^<|>$/g, ""), `data:${row.mimeType};base64,${bytes.toString("base64")}`);
		} catch {
			// A missing file is a missing image, not a broken reader.
		}
	}
	return out;
}

/**
 * The body as a complete document for the reader's sandboxed frame. Served
 * over the app scheme with a CSP header; see main/scheme.ts.
 */
export function renderBody(
	id: string,
	options: { allowRemoteImages?: boolean } = {},
	db: Db = getDb(),
): { document: string; scriptNonce: string; remoteImages: number } | null {
	const row = db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.id, id), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) return null;
	if (row.bodyHtml) {
		const result = sanitiseHtml(row.bodyHtml, {
			allowRemoteImages: options.allowRemoteImages ?? false,
			inlineImages: inlineImages(db, id),
		});
		return { document: result.document, scriptNonce: result.scriptNonce, remoteImages: result.remoteImages };
	}
	const result = textDocumentBody(row.bodyText ?? "");
	return { document: result.document, scriptNonce: result.scriptNonce, remoteImages: 0 };
}

/** What the reader needs beside the frame. See MailMessageBody. */
export async function getBody(id: string, db: Db = getDb()): Promise<MailMessageBody | null> {
	const row = db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.id, id), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) return null;
	if (row.bodyHtml) {
		const result = sanitiseHtml(row.bodyHtml);
		return {
			messageId: id,
			text: row.bodyText,
			hasHtml: true,
			remoteImages: result.remoteImages,
			suspicious: result.suspicious,
			links: result.links,
		};
	}
	return { messageId: id, text: row.bodyText, hasHtml: false, remoteImages: 0, suspicious: false, links: [] };
}

async function requireThread(id: string, db: Db): Promise<MailThreadSummary> {
	const thread = await getThread(id, db);
	if (!thread) throw new Error("That thread does not exist.");
	return thread.summary;
}

/** A person's choice. Survives every later sync. */
export async function linkClient(threadId: string, clientId: string, db: Db = getDb()): Promise<MailThreadSummary> {
	const client = db
		.select({ id: clients.id })
		.from(clients)
		.where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
		.get();
	if (!client) throw new Error("That client does not exist.");
	await requireThread(threadId, db);
	db.update(mailThreads)
		.set({ clientId, linkSource: "manual", updatedAt: now() })
		.where(eq(mailThreads.id, threadId))
		.run();
	return requireThread(threadId, db);
}

/** Also a person's choice: stored as manual with no client, so auto-link stays away. */
export async function unlinkClient(threadId: string, db: Db = getDb()): Promise<MailThreadSummary> {
	await requireThread(threadId, db);
	db.update(mailThreads)
		.set({ clientId: null, linkSource: "manual", updatedAt: now() })
		.where(eq(mailThreads.id, threadId))
		.run();
	return requireThread(threadId, db);
}

/** How many live threads point at a client, for the client screen. */
export async function countForClient(clientId: string, db: Db = getDb()): Promise<number> {
	const row = db
		.select({ n: sql<number>`count(*)` })
		.from(mailThreads)
		.where(and(eq(mailThreads.clientId, clientId), isNull(mailThreads.deletedAt)))
		.get();
	return row?.n ?? 0;
}
