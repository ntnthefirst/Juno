/**
 * Filing mail: read and unread, flagged, archived, trashed, and gone.
 *
 * Every function here changes the mailbox on the server first and the local
 * rows second, in that order and never the other way round. A local-only change
 * is a lie with a timer on it: the next sync reads the server, finds the
 * message exactly where it was, and puts it back. That is what the list of
 * "deleted" mail that kept returning was.
 *
 * So a failure to reach the server is a failure of the whole call, reported to
 * the caller, with nothing changed locally. Half-applied is not a state this
 * offers.
 *
 * Where a message lands after a move:
 *
 * - A server with UIDPLUS answers the MOVE with the new uid, so the local row
 *   is repointed at the destination folder and shows up there immediately.
 * - A server without it says nothing, so the local row is forgotten and the
 *   next sync of the destination folder finds the message again. Until then it
 *   is out of the folder it left, which is what was asked for, and absent from
 *   the one it went to, which is the honest reading of "Juno does not know".
 *
 * Deleting for good is the one call that destroys something. It is confirmed by
 * a person in the window, or parked for approval when an agent asks, and it
 * says in those words that the copy on the server goes too.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { MailFileResult, MailSpecialUse } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { mailFolders, mailMessages, mailThreads } from "../db/schema";
import { connectionFor } from "./mail-accounts";
import { describeMailError } from "./mail-source";
import { refreshFolderCounts } from "./mail-store";
import { openMailboxWriter, type MailboxWriter } from "./mail-writer";

const FLAG_SEEN = "\\Seen";
const FLAG_FLAGGED = "\\Flagged";

type MessageRow = typeof mailMessages.$inferSelect;
type FolderRow = typeof mailFolders.$inferSelect;

/** The messages named, alive, with the folder each one is in. */
function messagesWithFolders(
	db: Db,
	messageIds: string[],
): { message: MessageRow; folder: FolderRow }[] {
	if (messageIds.length === 0) return [];
	return db
		.select({ message: mailMessages, folder: mailFolders })
		.from(mailMessages)
		.innerJoin(mailFolders, eq(mailFolders.id, mailMessages.folderId))
		.where(and(inArray(mailMessages.id, messageIds), isNull(mailMessages.deletedAt)))
		.all();
}

/** Every live message in the named threads. */
function messageIdsOfThreads(db: Db, threadIds: string[]): string[] {
	if (threadIds.length === 0) return [];
	return db
		.select({ id: mailMessages.id })
		.from(mailMessages)
		.where(and(inArray(mailMessages.threadId, threadIds), isNull(mailMessages.deletedAt)))
		.all()
		.map((row) => row.id);
}

function folderBySpecialUse(db: Db, accountId: string, use: MailSpecialUse): FolderRow | null {
	return (
		db
			.select()
			.from(mailFolders)
			.where(
				and(
					eq(mailFolders.accountId, accountId),
					eq(mailFolders.specialUse, use),
					isNull(mailFolders.deletedAt),
				),
			)
			.get() ?? null
	);
}

function folderById(db: Db, folderId: string): FolderRow | null {
	return (
		db
			.select()
			.from(mailFolders)
			.where(and(eq(mailFolders.id, folderId), isNull(mailFolders.deletedAt)))
			.get() ?? null
	);
}

/**
 * Groups the work by account and folder, because a writer is one connection
 * with one folder selected, and opening a second one per message is how an
 * account gets locked out for a few minutes.
 */
function groupByFolder(rows: { message: MessageRow; folder: FolderRow }[]): Map<string, {
	accountId: string;
	folder: FolderRow;
	messages: MessageRow[];
}> {
	const groups = new Map<string, { accountId: string; folder: FolderRow; messages: MessageRow[] }>();
	for (const row of rows) {
		const key = row.folder.id;
		const group = groups.get(key);
		if (group) group.messages.push(row.message);
		else groups.set(key, { accountId: row.message.accountId, folder: row.folder, messages: [row.message] });
	}
	return groups;
}

/**
 * Opens a writer per account, runs the work, and logs out in a `finally`
 * whatever happened. The account's own error wording is used, so a rejected
 * password reads the same here as it does on the settings screen.
 */
async function withWriter<T>(
	accountId: string,
	db: Db,
	work: (writer: MailboxWriter) => Promise<T>,
): Promise<T> {
	// Outside the try, because a missing password already reads as a sentence
	// with the next action in it and must not be rewritten as a server failure.
	const connection = connectionFor(accountId, db);
	let writer: MailboxWriter | null = null;
	try {
		writer = await openMailboxWriter(connection);
		return await work(writer);
	} catch (error) {
		throw new Error(describeMailError(error, connection));
	} finally {
		await writer?.close().catch(() => undefined);
	}
}

/**
 * A folder whose UIDVALIDITY has moved has been renumbered by the server, so
 * every uid Juno holds for it points at a different message or at nothing.
 * Acting on one would file the wrong mail, so the call stops instead.
 */
function checkUidValidity(folder: FolderRow, remote: string): void {
	if (folder.uidValidity !== null && folder.uidValidity !== remote) {
		throw new Error(
			`${folder.name} was renumbered by the server since the last sync. Sync this account, then try again.`,
		);
	}
}

/* --------------------------------------------------------------- flags */

/**
 * Marks messages read or unread, on the server and here.
 *
 * Cheap, reversible, and the only write in this file that is not filing
 * something. It is still a write, so it is still refused while locked and
 * still parked when an agent asks for it.
 */
export async function setSeen(messageIds: string[], seen: boolean, db: Db = getDb()): Promise<number> {
	return setFlag(messageIds, FLAG_SEEN, seen, { isSeen: seen }, db);
}

/** Flags or unflags messages, on the server and here. */
export async function setFlagged(messageIds: string[], flagged: boolean, db: Db = getDb()): Promise<number> {
	return setFlag(messageIds, FLAG_FLAGGED, flagged, { isFlagged: flagged }, db);
}

async function setFlag(
	messageIds: string[],
	flag: string,
	on: boolean,
	local: Partial<typeof mailMessages.$inferInsert>,
	db: Db,
): Promise<number> {
	const rows = messagesWithFolders(db, messageIds);
	if (rows.length === 0) return 0;

	let changed = 0;
	for (const group of groupByFolder(rows).values()) {
		const uids = group.messages.map((message) => message.uid);
		await withWriter(group.accountId, db, async (writer) => {
			const mailbox = await writer.openFolder(group.folder.path);
			checkUidValidity(group.folder, mailbox.uidValidity);
			await writer.setFlags(uids, on ? [flag] : [], on ? [] : [flag]);
		});
		db.update(mailMessages)
			.set({ ...local, updatedAt: now() })
			.where(inArray(mailMessages.id, group.messages.map((message) => message.id)))
			.run();
		changed += group.messages.length;
		refreshFolderCounts(db, group.folder.id);
	}
	return changed;
}

/* ---------------------------------------------------------------- moves */

/** Where a move is going: a named folder, or whichever one serves a purpose. */
export type MailMoveTarget = { folderId: string } | { specialUse: MailSpecialUse };

function resolveTarget(db: Db, accountId: string, target: MailMoveTarget): FolderRow {
	if ("folderId" in target) {
		const folder = folderById(db, target.folderId);
		if (!folder) throw new Error("That folder does not exist.");
		if (folder.accountId !== accountId) {
			throw new Error("A message cannot be moved to a folder on a different account.");
		}
		return folder;
	}
	const folder = folderBySpecialUse(db, accountId, target.specialUse);
	if (!folder) {
		throw new Error(
			`This account has no ${target.specialUse} folder on the server. Sync the account, or move the message to a folder by name.`,
		);
	}
	return folder;
}

/**
 * Moves messages into another folder on the same account.
 *
 * Messages already in the destination are left alone rather than moved to
 * themselves, which some servers answer to by deleting them.
 */
export async function move(
	messageIds: string[],
	target: MailMoveTarget,
	db: Db = getDb(),
): Promise<MailFileResult> {
	const rows = messagesWithFolders(db, messageIds);
	if (rows.length === 0) return { moved: 0, folderName: "", remembered: 0 };

	let moved = 0;
	let remembered = 0;
	let folderName = "";

	for (const group of groupByFolder(rows).values()) {
		const destination = resolveTarget(db, group.accountId, target);
		folderName = destination.name;
		if (destination.id === group.folder.id) continue;

		const uids = group.messages.map((message) => message.uid);
		const uidMap = await withWriter(group.accountId, db, async (writer) => {
			const mailbox = await writer.openFolder(group.folder.path);
			checkUidValidity(group.folder, mailbox.uidValidity);
			return writer.move(uids, destination.path);
		});

		const stamp = now();
		for (const message of group.messages) {
			const landed = uidMap.get(message.uid);
			if (landed === undefined) {
				// The server did not say where it went. Forget the row: the next
				// sync of the destination finds it again under its new uid, and a
				// row pointing at a uid that no longer exists is worse than none.
				db.update(mailMessages)
					.set({ deletedAt: stamp, updatedAt: stamp })
					.where(eq(mailMessages.id, message.id))
					.run();
			} else {
				db.update(mailMessages)
					.set({ folderId: destination.id, uid: landed, updatedAt: stamp })
					.where(eq(mailMessages.id, message.id))
					.run();
				remembered += 1;
			}
			moved += 1;
		}

		refreshFolderCounts(db, group.folder.id);
		refreshFolderCounts(db, destination.id);
	}

	tidyEmptyThreads(db, [...new Set(rows.map((row) => row.message.threadId))]);
	return { moved, folderName, remembered };
}

/** Moves whole threads, which is what the list actually offers. */
export async function moveThreads(
	threadIds: string[],
	target: MailMoveTarget,
	db: Db = getDb(),
): Promise<MailFileResult> {
	return move(messageIdsOfThreads(db, threadIds), target, db);
}

/** Marks whole threads read or unread, which is what a list row offers. */
export async function setThreadsSeen(threadIds: string[], seen: boolean, db: Db = getDb()): Promise<number> {
	return setSeen(messageIdsOfThreads(db, threadIds), seen, db);
}

export async function archiveThreads(threadIds: string[], db: Db = getDb()): Promise<MailFileResult> {
	return moveThreads(threadIds, { specialUse: "archive" }, db);
}

export async function trashThreads(threadIds: string[], db: Db = getDb()): Promise<MailFileResult> {
	return moveThreads(threadIds, { specialUse: "trash" }, db);
}

export async function junkThreads(threadIds: string[], db: Db = getDb()): Promise<MailFileResult> {
	return moveThreads(threadIds, { specialUse: "junk" }, db);
}

/* -------------------------------------------------------------- deleting */

/**
 * Expunges messages from the server and forgets them here.
 *
 * There is no undo, on either side. The caller is a person who has been told
 * that in a sentence with a count in it, or an agent whose call a person
 * approved seeing the same sentence.
 */
export async function deleteForever(messageIds: string[], db: Db = getDb()): Promise<number> {
	const rows = messagesWithFolders(db, messageIds);
	if (rows.length === 0) return 0;

	let removed = 0;
	for (const group of groupByFolder(rows).values()) {
		const uids = group.messages.map((message) => message.uid);
		await withWriter(group.accountId, db, async (writer) => {
			const mailbox = await writer.openFolder(group.folder.path);
			checkUidValidity(group.folder, mailbox.uidValidity);
			await writer.expunge(uids);
		});

		const stamp = now();
		db.update(mailMessages)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(inArray(mailMessages.id, group.messages.map((message) => message.id)))
			.run();
		removed += group.messages.length;
		refreshFolderCounts(db, group.folder.id);
	}

	tidyEmptyThreads(db, [...new Set(rows.map((row) => row.message.threadId))]);
	return removed;
}

export async function deleteThreadsForever(threadIds: string[], db: Db = getDb()): Promise<number> {
	return deleteForever(messageIdsOfThreads(db, threadIds), db);
}

/**
 * A thread with no messages left is not a thread. It is soft-deleted rather
 * than removed, like everything else, so a sync that brings the mail back can
 * find the row it belongs to.
 */
function tidyEmptyThreads(db: Db, threadIds: string[]): void {
	const stamp = now();
	for (const threadId of threadIds) {
		const remaining = db
			.select({ id: mailMessages.id })
			.from(mailMessages)
			.where(and(eq(mailMessages.threadId, threadId), isNull(mailMessages.deletedAt)))
			.limit(1)
			.get();
		if (remaining) continue;
		db.update(mailThreads)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(and(eq(mailThreads.id, threadId), isNull(mailThreads.deletedAt)))
			.run();
	}
}
