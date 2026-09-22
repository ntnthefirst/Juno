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
	MailThread,
	MailThreadListQuery,
	MailThreadSummary,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, mailAccounts, mailAttachments, mailFolders, mailMessages, mailThreads } from "../db/schema";
import { sanitiseHtml, textDocument } from "./mail-sanitise";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

function toMessage(row: MessageRow, attachments: MailAttachment[]): MailMessage {
	return {
		id: row.id,
		accountId: row.accountId,
		folderId: row.folderId,
		threadId: row.threadId,
		uid: row.uid,
		messageId: row.messageId,
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

function toAttachment(row: typeof mailAttachments.$inferSelect): MailAttachment {
	return {
		id: row.id,
		messageId: row.messageId,
		filename: row.filename,
		mimeType: row.mimeType,
		size: row.size,
		isInline: row.isInline,
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
	snippet: string;
	participants: MailAddress[];
}

function summarise(
	db: Db,
	threads: { thread: ThreadRow; clientName: string | null; snippet?: string }[],
): MailThreadSummary[] {
	if (threads.length === 0) return [];
	const ids = threads.map((t) => t.thread.id);
	const messages = db
		.select({
			threadId: mailMessages.threadId,
			fromName: mailMessages.fromName,
			fromAddress: mailMessages.fromAddress,
			toJson: mailMessages.toJson,
			isSeen: mailMessages.isSeen,
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
			snippet: entry.snippet ?? "",
			participants: [],
		});
	}
	for (const message of messages) {
		const group = grouped.get(message.threadId);
		if (!group) continue;
		group.messageCount += 1;
		if (!message.isSeen) group.unreadCount += 1;
		if (message.hasAttachments) group.hasAttachments = true;
		if (!group.snippet && message.snippet) group.snippet = message.snippet;
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
			participants: group.participants,
			snippet: group.snippet,
		};
	});
}

export async function listThreads(query: MailThreadListQuery = {}, db: Db = getDb()): Promise<MailThreadSummary[]> {
	const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const term = query.search?.trim() ?? "";

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

	if (term) {
		const match = ftsQuery(term);
		if (!match) return [];
		// The best-ranked message per thread decides the order and the snippet.
		// bm25 and snippet only work in the query that runs the MATCH, and the
		// planner flattens a plain subquery into the join, which breaks that. A
		// materialized CTE keeps the ranking inside the full-text scan. SQLite
		// fills the bare snippet column from the row that produced min(rank).
		const hits = db.all<{ thread_id: string; snippet: string; rank: number }>(sql`
			with f as materialized (
				select message_id,
					snippet(mail_messages_fts, 2, '', '', '...', 12) as snippet,
					bm25(mail_messages_fts, 0.0, 4.0, 1.0, 2.0, 2.0) as rank
				from mail_messages_fts
				where mail_messages_fts match ${match}
			)
			select m.thread_id as thread_id, f.snippet as snippet, min(f.rank) as rank
			from f
			join mail_messages m on m.id = f.message_id
			where m.deleted_at is null
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
				return row ? { ...row, snippet: hit.snippet.replace(/\s+/g, " ").trim() } : null;
			})
			.filter((r): r is NonNullable<typeof r> => r !== null)
			.slice(0, limit);
		return summarise(db, ordered);
	}

	const rows = db
		.select({ thread: mailThreads, clientName: clients.name })
		.from(mailThreads)
		.leftJoin(clients, eq(mailThreads.clientId, clients.id))
		.where(and(...conditions))
		.orderBy(desc(mailThreads.lastMessageAt))
		.limit(limit)
		.all();
	return summarise(db, rows);
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

	const [summary] = summarise(db, [row]);
	return {
		summary: summary!,
		messages: messages.map((m) => toMessage(m, attachments.get(m.id) ?? [])),
	};
}

export async function getMessage(id: string, db: Db = getDb()): Promise<MailMessage | null> {
	const row = db
		.select()
		.from(mailMessages)
		.where(and(eq(mailMessages.id, id), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) return null;
	return toMessage(row, attachmentsFor(db, [id]).get(id) ?? []);
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
): { document: string; remoteImages: number } | null {
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
		return { document: result.document, remoteImages: result.remoteImages };
	}
	return { document: textDocument(row.bodyText ?? ""), remoteImages: 0 };
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
			links: result.links,
		};
	}
	return { messageId: id, text: row.bodyText, hasHtml: false, remoteImages: 0, links: [] };
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
