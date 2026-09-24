/**
 * Writing mail into the database: folders, headers, bodies, flags, and the
 * two decisions that happen on the way in, which thread a message joins and
 * which client that thread belongs to.
 *
 * Kept apart from the sync loop so the threading and linking rules can be
 * tested with rows rather than with a server. The sync (./mail-sync.ts) talks
 * to the mailbox; this file talks to SQLite.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailAddress } from "../../shared/types";
import { type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import {
	clientEmails,
	clients,
	contacts,
	mailAttachments,
	mailFolders,
	mailMessages,
	mailThreads,
} from "../db/schema";
import { normaliseSubject, snippetOf, type ParsedMessage } from "./mail-parse";
import type { RemoteFlags, RemoteFolder, RemoteHeader } from "./mail-source";

export type FolderRow = typeof mailFolders.$inferSelect;
export type MessageRow = typeof mailMessages.$inferSelect;

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ---------------------------------------------------------------- folders */

/**
 * Brings the local folder list in line with the server's. Folders the server no
 * longer has are soft-deleted along with their messages.
 *
 * A folder nobody has an opinion about is pulled. That is the policy, and it
 * lives here rather than in a column default so it can change without a
 * migration. It used to be "the inbox and nothing else", which left Sent empty,
 * Trash empty, and a message moved to a folder nowhere to be found, because the
 * only copy of it was in a folder sync never opened. `sync_choice_at` is what
 * keeps a folder the owner switched off switched off.
 */
export function reconcileFolders(db: Db, accountId: string, remote: RemoteFolder[]): FolderRow[] {
	const stamp = now();
	const existing = db
		.select()
		.from(mailFolders)
		.where(eq(mailFolders.accountId, accountId))
		.all();
	const byPath = new Map(existing.map((f) => [f.path, f]));
	const seen = new Set<string>();

	for (const folder of remote) {
		seen.add(folder.path);
		const current = byPath.get(folder.path);
		if (current) {
			db.update(mailFolders)
				.set({
					name: folder.name,
					delimiter: folder.delimiter,
					specialUse: folder.specialUse,
					deletedAt: null,
					updatedAt: stamp,
				})
				.where(eq(mailFolders.id, current.id))
				.run();
		} else {
			db.insert(mailFolders)
				.values({
					accountId,
					path: folder.path,
					name: folder.name,
					delimiter: folder.delimiter,
					specialUse: folder.specialUse,
					syncEnabled: true,
					createdAt: stamp,
					updatedAt: stamp,
				})
				.run();
		}
	}

	for (const folder of existing) {
		if (seen.has(folder.path) || folder.deletedAt) continue;
		db.update(mailFolders)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(eq(mailFolders.id, folder.id))
			.run();
		retireMessages(db, folder.id, null);
	}

	return db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), isNull(mailFolders.deletedAt)))
		.all();
}

/**
 * Soft-deletes the given messages of a folder and brings their threads up to
 * date, so a thread whose last message went away goes with it. Every removal
 * in this file goes through here for that reason.
 */
function retireMessages(db: Db, folderId: string, uids: number[] | null): number {
	const rows = db
		.select({ uid: mailMessages.uid, threadId: mailMessages.threadId })
		.from(mailMessages)
		.where(and(eq(mailMessages.folderId, folderId), isNull(mailMessages.deletedAt)))
		.all();
	const wanted = uids === null ? null : new Set(uids);
	const gone = wanted === null ? rows : rows.filter((r) => wanted.has(r.uid));
	if (gone.length === 0) return 0;

	const stamp = now();
	const goneUids = gone.map((r) => r.uid);
	for (let i = 0; i < goneUids.length; i += 500) {
		db.update(mailMessages)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(and(eq(mailMessages.folderId, folderId), inArray(mailMessages.uid, goneUids.slice(i, i + 500))))
			.run();
	}
	for (const threadId of new Set(gone.map((r) => r.threadId))) touchThread(db, threadId);
	return gone.length;
}

/**
 * A folder that is no longer on the server: soft-deleted, with its messages.
 * The caller is the folder service, after the server said the mailbox is gone.
 */
export function retireFolder(db: Db, folderId: string): void {
	const stamp = now();
	retireMessages(db, folderId, null);
	db.update(mailFolders)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailFolders.id, folderId))
		.run();
}

/** UIDVALIDITY changed: every local UID for this folder is meaningless. */
export function resetFolder(db: Db, folderId: string, uidValidity: string): void {
	retireMessages(db, folderId, null);
	db.update(mailFolders)
		.set({ uidValidity, syncedHorizonDays: null, updatedAt: now() })
		.where(eq(mailFolders.id, folderId))
		.run();
}

/** Every live local UID in a folder, ascending. */
export function localUids(db: Db, folderId: string): number[] {
	return db
		.select({ uid: mailMessages.uid })
		.from(mailMessages)
		.where(and(eq(mailMessages.folderId, folderId), isNull(mailMessages.deletedAt)))
		.orderBy(mailMessages.uid)
		.all()
		.map((r) => r.uid);
}

/** Messages the server no longer has, soft-deleted. Returns how many. */
export function markMissing(db: Db, folderId: string, presentUids: Set<number>): number {
	const gone = localUids(db, folderId).filter((uid) => !presentUids.has(uid));
	return retireMessages(db, folderId, gone);
}

export function refreshFolderCounts(db: Db, folderId: string): void {
	const counts = db
		.select({
			total: sql<number>`count(*)`,
			unread: sql<number>`sum(case when ${mailMessages.isSeen} = 0 then 1 else 0 end)`,
		})
		.from(mailMessages)
		.where(and(eq(mailMessages.folderId, folderId), isNull(mailMessages.deletedAt)))
		.get();
	db.update(mailFolders)
		.set({
			messageCount: counts?.total ?? 0,
			unreadCount: counts?.unread ?? 0,
			updatedAt: now(),
		})
		.where(eq(mailFolders.id, folderId))
		.run();
}

/* ---------------------------------------------------------------- threads */

interface ThreadKey {
	messageId: string | null;
	inReplyTo: string | null;
	references: string[];
	subject: string;
	date: string;
}

/**
 * Which thread a message belongs to, by Message-ID graph only. A message joins
 * the thread of anything it references, or of anything that references it,
 * which is the case when a reply arrives before the original. Two threads that
 * turn out to be one are merged. Subject matching is deliberately not used: it
 * turns every "Re: factuur" into one thread.
 */
export function resolveThread(db: Db, accountId: string, key: ThreadKey): string {
	const related = new Set<string>();
	const ancestors = [key.inReplyTo, ...key.references].filter((id): id is string => Boolean(id));

	if (ancestors.length > 0) {
		const rows = db
			.select({ threadId: mailMessages.threadId })
			.from(mailMessages)
			.where(
				and(
					eq(mailMessages.accountId, accountId),
					isNull(mailMessages.deletedAt),
					inArray(mailMessages.messageId, ancestors),
				),
			)
			.all();
		for (const row of rows) related.add(row.threadId);
	}

	if (key.messageId) {
		const needle = `%${escapeLike(JSON.stringify(key.messageId))}%`;
		const rows = db
			.select({ threadId: mailMessages.threadId })
			.from(mailMessages)
			.where(
				and(
					eq(mailMessages.accountId, accountId),
					isNull(mailMessages.deletedAt),
					or(
						eq(mailMessages.inReplyTo, key.messageId),
						sql`${mailMessages.referencesJson} like ${needle} escape '\\'`,
					),
				),
			)
			.all();
		for (const row of rows) related.add(row.threadId);
	}

	const stamp = now();
	const [first, ...rest] = [...related];

	if (!first) {
		return db
			.insert(mailThreads)
			.values({
				accountId,
				subject: key.subject,
				subjectNorm: normaliseSubject(key.subject),
				firstMessageAt: key.date,
				lastMessageAt: key.date,
				createdAt: stamp,
				updatedAt: stamp,
			})
			.returning({ id: mailThreads.id })
			.get().id;
	}

	if (rest.length > 0) {
		// Merge into the first. A manual client link on any of them wins, so a
		// choice the owner made is not lost to a late-arriving reply.
		const threads = db
			.select()
			.from(mailThreads)
			.where(inArray(mailThreads.id, [first, ...rest]))
			.all();
		const manual = threads.find((t) => t.linkSource === "manual");
		const keep = threads.find((t) => t.id === first)!;
		db.update(mailMessages)
			.set({ threadId: first, updatedAt: stamp })
			.where(inArray(mailMessages.threadId, rest))
			.run();
		db.update(mailThreads)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(inArray(mailThreads.id, rest))
			.run();
		if (manual && manual.id !== first) {
			db.update(mailThreads)
				.set({ clientId: manual.clientId, linkSource: "manual", updatedAt: stamp })
				.where(eq(mailThreads.id, first))
				.run();
		} else if (!keep.clientId) {
			const linked = threads.find((t) => t.clientId);
			if (linked) {
				db.update(mailThreads)
					.set({ clientId: linked.clientId, linkSource: linked.linkSource, updatedAt: stamp })
					.where(eq(mailThreads.id, first))
					.run();
			}
		}
	}

	return first;
}

/** Keeps the thread's date range in step with its messages. */
export function touchThread(db: Db, threadId: string): void {
	const range = db
		.select({
			first: sql<string | null>`min(${mailMessages.internalDate})`,
			last: sql<string | null>`max(${mailMessages.internalDate})`,
			subject: sql<string | null>`(select ${mailMessages.subject} from ${mailMessages} where ${mailMessages.threadId} = ${threadId} and ${mailMessages.deletedAt} is null order by ${mailMessages.internalDate} asc limit 1)`,
		})
		.from(mailMessages)
		.where(and(eq(mailMessages.threadId, threadId), isNull(mailMessages.deletedAt)))
		.get();
	if (!range?.first || !range.last) {
		db.update(mailThreads)
			.set({ deletedAt: now(), updatedAt: now() })
			.where(eq(mailThreads.id, threadId))
			.run();
		return;
	}
	db.update(mailThreads)
		.set({
			firstMessageAt: range.first,
			lastMessageAt: range.last,
			...(range.subject !== null ? { subject: range.subject, subjectNorm: normaliseSubject(range.subject) } : {}),
			deletedAt: null,
			updatedAt: now(),
		})
		.where(eq(mailThreads.id, threadId))
		.run();
}

/**
 * Links a thread to a client by the addresses on a message, when nobody has
 * decided otherwise. `link_source = manual` is never overwritten, including a
 * manual unlink, which is stored as manual with no client.
 */
export function autoLinkThread(
	db: Db,
	threadId: string,
	addresses: MailAddress[],
	ownAddresses: Set<string>,
): string | null {
	const thread = db.select().from(mailThreads).where(eq(mailThreads.id, threadId)).get();
	if (!thread || thread.linkSource !== null) return thread?.clientId ?? null;

	const candidates = [...new Set(addresses.map((a) => a.address.toLowerCase()))].filter(
		(a) => a && !ownAddresses.has(a),
	);
	if (candidates.length === 0) return null;

	const viaContact = db
		.select({ clientId: contacts.clientId })
		.from(contacts)
		.innerJoin(clients, eq(contacts.clientId, clients.id))
		.where(
			and(
				isNull(contacts.deletedAt),
				isNull(clients.deletedAt),
				inArray(sql`lower(${contacts.email})`, candidates),
			),
		)
		.get();
	const viaClient = viaContact
		? null
		: db
				.select({ clientId: clientEmails.clientId })
				.from(clientEmails)
				.innerJoin(clients, eq(clients.id, clientEmails.clientId))
				.where(
					and(
						isNull(clientEmails.deletedAt),
						isNull(clients.deletedAt),
						inArray(sql`lower(${clientEmails.email})`, candidates),
					),
				)
				.get();

	const clientId = viaContact?.clientId ?? viaClient?.clientId ?? null;
	if (!clientId) return null;

	db.update(mailThreads)
		.set({ clientId, linkSource: "auto", updatedAt: now() })
		.where(eq(mailThreads.id, threadId))
		.run();
	return clientId;
}

/* --------------------------------------------------------------- messages */

const FLAG_SEEN = "\\Seen";
const FLAG_FLAGGED = "\\Flagged";
const FLAG_ANSWERED = "\\Answered";

export interface StoredHeader {
	id: string;
	threadId: string;
	created: boolean;
}

/**
 * Inserts a message from its headers, or refreshes the flags of one already
 * here. Threading and client linking happen at this point, so the list can
 * show a threaded, linked row before the body has been fetched.
 */
export function storeHeader(
	db: Db,
	accountId: string,
	folderId: string,
	header: RemoteHeader,
	ownAddresses: Set<string>,
): StoredHeader {
	const existing = db
		.select({ id: mailMessages.id, threadId: mailMessages.threadId })
		.from(mailMessages)
		.where(
			and(
				eq(mailMessages.accountId, accountId),
				eq(mailMessages.folderId, folderId),
				eq(mailMessages.uid, header.uid),
			),
		)
		.get();

	const flags = new Set(header.flags);
	const stamp = now();

	if (existing) {
		db.update(mailMessages)
			.set({
				isSeen: flags.has(FLAG_SEEN),
				isFlagged: flags.has(FLAG_FLAGGED),
				isAnswered: flags.has(FLAG_ANSWERED),
				deletedAt: null,
				updatedAt: stamp,
			})
			.where(eq(mailMessages.id, existing.id))
			.run();
		touchThread(db, existing.threadId);
		return { id: existing.id, threadId: existing.threadId, created: false };
	}

	const env = header.envelope;
	const threadId = resolveThread(db, accountId, {
		messageId: env.messageId,
		inReplyTo: env.inReplyTo,
		references: env.references,
		subject: env.subject,
		date: header.internalDate,
	});

	const id = uuidv7();
	db.insert(mailMessages)
		.values({
			id,
			accountId,
			folderId,
			threadId,
			uid: header.uid,
			messageId: env.messageId,
			inReplyTo: env.inReplyTo,
			referencesJson: JSON.stringify(env.references),
			fromName: env.from?.name ?? null,
			fromAddress: env.from?.address ?? null,
			toJson: JSON.stringify(env.to),
			ccJson: JSON.stringify(env.cc),
			replyToJson: JSON.stringify(env.replyTo),
			subject: env.subject,
			sentAt: env.date,
			internalDate: header.internalDate,
			size: header.size,
			isSeen: flags.has(FLAG_SEEN),
			isFlagged: flags.has(FLAG_FLAGGED),
			isAnswered: flags.has(FLAG_ANSWERED),
			hasAttachments: header.hasAttachments,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.run();

	touchThread(db, threadId);
	autoLinkThread(
		db,
		threadId,
		[...(env.from ? [env.from] : []), ...env.to, ...env.cc, ...env.replyTo],
		ownAddresses,
	);

	return { id, threadId, created: true };
}

export function applyFlags(db: Db, folderId: string, flags: RemoteFlags[]): number {
	let changed = 0;
	const stamp = now();
	for (const entry of flags) {
		const set = new Set(entry.flags);
		const result = db
			.update(mailMessages)
			.set({
				isSeen: set.has(FLAG_SEEN),
				isFlagged: set.has(FLAG_FLAGGED),
				isAnswered: set.has(FLAG_ANSWERED),
				updatedAt: stamp,
			})
			.where(
				and(
					eq(mailMessages.folderId, folderId),
					eq(mailMessages.uid, entry.uid),
					isNull(mailMessages.deletedAt),
					or(
						sql`${mailMessages.isSeen} != ${set.has(FLAG_SEEN) ? 1 : 0}`,
						sql`${mailMessages.isFlagged} != ${set.has(FLAG_FLAGGED) ? 1 : 0}`,
						sql`${mailMessages.isAnswered} != ${set.has(FLAG_ANSWERED) ? 1 : 0}`,
					),
				),
			)
			.run();
		changed += Number((result as { changes: number | bigint }).changes);
	}
	return changed;
}

/** Messages in a folder still waiting for their body, newest first. */
export function pendingBodies(db: Db, folderId: string, limit: number): { id: string; uid: number }[] {
	return db
		.select({ id: mailMessages.id, uid: mailMessages.uid })
		.from(mailMessages)
		.where(
			and(
				eq(mailMessages.folderId, folderId),
				isNull(mailMessages.deletedAt),
				isNull(mailMessages.bodyFetchedAt),
				isNull(mailMessages.bodyError),
			),
		)
		.orderBy(desc(mailMessages.uid))
		.limit(limit)
		.all();
}

/**
 * Attaches a parsed body to a message: text, HTML, the snippet, and the
 * attachments written to disk under a path built from ids, never from anything
 * the message supplied except the sanitised filename at the end.
 */
export function storeBody(
	db: Db,
	messageId: string,
	parsed: ParsedMessage,
	mailDir: string,
): void {
	const message = db.select().from(mailMessages).where(eq(mailMessages.id, messageId)).get();
	if (!message) return;

	const relativeDir = join(message.accountId, messageId);
	const absoluteDir = join(mailDir, relativeDir);
	const stamp = now();

	db.transaction((tx) => {
		tx.delete(mailAttachments).where(eq(mailAttachments.messageId, messageId)).run();

		const usedNames = new Set<string>();
		for (const attachment of parsed.attachments) {
			let filename = attachment.filename;
			// Two attachments called "image.png" must not overwrite each other.
			let counter = 1;
			while (usedNames.has(filename.toLowerCase())) {
				const dot = attachment.filename.lastIndexOf(".");
				filename =
					dot > 0
						? `${attachment.filename.slice(0, dot)}-${counter}${attachment.filename.slice(dot)}`
						: `${attachment.filename}-${counter}`;
				counter += 1;
			}
			usedNames.add(filename.toLowerCase());

			if (!existsSync(absoluteDir)) mkdirSync(absoluteDir, { recursive: true });
			writeFileSync(join(absoluteDir, filename), attachment.content);

			tx.insert(mailAttachments)
				.values({
					messageId,
					filename,
					mimeType: attachment.mimeType,
					size: attachment.size,
					filePath: join(relativeDir, filename),
					contentId: attachment.contentId,
					isInline: attachment.isInline,
					createdAt: stamp,
					updatedAt: stamp,
				})
				.run();
		}

		tx.update(mailMessages)
			.set({
				bodyText: parsed.text,
				bodyHtml: parsed.html,
				snippet: snippetOf(parsed.text),
				bodyFetchedAt: stamp,
				bodyError: null,
				hasAttachments: parsed.attachments.some((a) => !a.isInline) || message.hasAttachments,
				// The envelope can lack what the full headers carry.
				...(message.messageId === null && parsed.messageId ? { messageId: parsed.messageId } : {}),
				...(message.sentAt === null && parsed.date ? { sentAt: parsed.date } : {}),
				...(message.subject === "" && parsed.subject ? { subject: parsed.subject } : {}),
				updatedAt: stamp,
			})
			.where(eq(mailMessages.id, messageId))
			.run();
	});
}

export function storeBodyError(db: Db, messageId: string, error: string): void {
	db.update(mailMessages)
		.set({ bodyError: error, updatedAt: now() })
		.where(eq(mailMessages.id, messageId))
		.run();
}

/** The addresses that are "us" for an account, so linking ignores them. */
export function ownAddressesFor(email: string, username: string): Set<string> {
	const own = new Set<string>();
	for (const value of [email, username]) {
		const lower = value.trim().toLowerCase();
		if (lower.includes("@")) own.add(lower);
	}
	return own;
}

/** Live messages that still lack a body, across a folder, for the status line. */
export function countPendingBodies(db: Db, folderId: string): number {
	const row = db
		.select({ n: sql<number>`count(*)` })
		.from(mailMessages)
		.where(
			and(
				eq(mailMessages.folderId, folderId),
				isNull(mailMessages.deletedAt),
				isNull(mailMessages.bodyFetchedAt),
				isNull(mailMessages.bodyError),
			),
		)
		.get();
	return row?.n ?? 0;
}
