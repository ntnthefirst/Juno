/**
 * Folders, as the sidebar sees them, and the four things a person does to one:
 * make it, rename it, remove it, and decide whether it is pulled at all.
 *
 * The rows are written by the sync (mail-store.ts). Everything here that
 * changes the server reaches the server first and the rows second, the same
 * rule filing keeps (mail-actions.ts): a folder that exists only locally is a
 * folder the next sync deletes, and one deleted only locally comes back.
 */
import { and, asc, eq, isNull, like, ne } from "drizzle-orm";
import type { MailFolder, MailSpecialUse } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import { mailAccounts, mailFolders } from "../db/schema";
import { retireFolder } from "./mail-store";
import { withWriter } from "./mail-writer";

type Row = typeof mailFolders.$inferSelect;

/** Inbox first, then the special folders in a fixed order, then the rest by path. */
const SPECIAL_ORDER: Record<string, number> = {
	inbox: 0,
	drafts: 1,
	sent: 2,
	archive: 3,
	junk: 4,
	trash: 5,
};

/** What a folder serving a purpose is called when Juno has to make one. */
const SPECIAL_NAMES: Record<MailSpecialUse, string> = {
	inbox: "INBOX",
	drafts: "Drafts",
	sent: "Sent",
	archive: "Archive",
	junk: "Junk",
	trash: "Trash",
};

function toRecord(row: Row): MailFolder {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		accountId: row.accountId,
		path: row.path,
		name: row.name,
		delimiter: row.delimiter,
		specialUse: (row.specialUse as MailSpecialUse | null) ?? null,
		syncEnabled: row.syncEnabled,
		messageCount: row.messageCount,
		unreadCount: row.unreadCount,
		lastSyncAt: row.lastSyncAt,
	};
}

export function sortFolders<T extends { specialUse: string | null; path: string }>(folders: T[]): T[] {
	return [...folders].sort((a, b) => {
		const ra = a.specialUse ? (SPECIAL_ORDER[a.specialUse] ?? 9) : 9;
		const rb = b.specialUse ? (SPECIAL_ORDER[b.specialUse] ?? 9) : 9;
		if (ra !== rb) return ra - rb;
		return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
	});
}

function rows(accountId: string, db: Db): Row[] {
	return db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), isNull(mailFolders.deletedAt)))
		.orderBy(asc(mailFolders.path))
		.all();
}

export async function list(accountId: string, db: Db = getDb()): Promise<MailFolder[]> {
	return sortFolders(rows(accountId, db)).map(toRecord);
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.id, id), isNull(mailFolders.deletedAt)))
		.get();
	if (!row) throw new Error("That folder does not exist.");
	return row;
}

/**
 * The name a person typed, as a single path segment.
 *
 * The delimiter has to go: a name carrying one would create a folder inside
 * another one without saying so, and on a server whose delimiter is "." that is
 * every name with a dot in it.
 */
function cleanName(name: string, delimiter: string | null): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("A folder needs a name.");
	if (trimmed.length > 100) throw new Error("That folder name is too long.");
	const separators = new Set([delimiter, "/", "\\"].filter((d): d is string => Boolean(d)));
	for (const separator of separators) {
		if (trimmed.includes(separator)) {
			throw new Error(`A folder name cannot contain "${separator}" on this server.`);
		}
	}
	return trimmed;
}

/** The delimiter the server uses for this account, from whatever folder knows it. */
function delimiterFor(list: Row[]): string {
	return list.find((folder) => folder.delimiter)?.delimiter ?? ".";
}

/**
 * Where a new top-level folder goes.
 *
 * Some servers put everything under INBOX, which is why this account's paths
 * read `INBOX.INBOX.Sent`. Guessing the wrong side of that creates a folder the
 * server hides, so the prefix is taken from the folders that are already there:
 * whatever the existing non-inbox folders share, a new one shares too.
 */
export function rootPrefixFor(list: Row[], delimiter: string): string {
	const others = list.filter((folder) => folder.specialUse !== "inbox" && folder.path.includes(delimiter));
	if (others.length === 0) return "";
	const prefixes = others.map((folder) => folder.path.slice(0, folder.path.lastIndexOf(delimiter) + 1));
	const first = prefixes[0]!;
	return prefixes.every((prefix) => prefix === first) ? first : "";
}

function pathFor(list: Row[], parent: Row | null, name: string, delimiter: string): string {
	if (parent) return `${parent.path}${parent.delimiter ?? delimiter}${name}`;
	return `${rootPrefixFor(list, delimiter)}${name}`;
}

function insertFolder(
	db: Db,
	accountId: string,
	values: { path: string; name: string; delimiter: string; specialUse: MailSpecialUse | null },
): Row {
	const stamp = now();
	// A path the server already had and Juno had soft-deleted is the same folder
	// coming back, and the unique index on (account, path) says so.
	const existing = db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), eq(mailFolders.path, values.path)))
		.get();
	if (existing) {
		return db
			.update(mailFolders)
			.set({
				name: values.name,
				delimiter: values.delimiter,
				specialUse: values.specialUse,
				syncEnabled: true,
				deletedAt: null,
				updatedAt: stamp,
			})
			.where(eq(mailFolders.id, existing.id))
			.returning()
			.get()!;
	}
	return db
		.insert(mailFolders)
		.values({
			id: uuidv7(),
			accountId,
			path: values.path,
			name: values.name,
			delimiter: values.delimiter,
			specialUse: values.specialUse,
			syncEnabled: true,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get()!;
}

export interface MailFolderInput {
	accountId: string;
	name: string;
	/** Inside another folder, when given. Otherwise beside the inbox. */
	parentId?: string | null;
}

/** Makes a folder on the server and lists it here. */
export async function create(input: MailFolderInput, db: Db = getDb()): Promise<MailFolder> {
	const account = db
		.select({ id: mailAccounts.id })
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, input.accountId), isNull(mailAccounts.deletedAt)))
		.get();
	if (!account) throw new Error("That mail account does not exist.");

	const siblings = rows(input.accountId, db);
	const parent = input.parentId ? requireRow(input.parentId, db) : null;
	if (parent && parent.accountId !== input.accountId) {
		throw new Error("That folder belongs to a different account.");
	}
	const delimiter = delimiterFor(siblings);
	const name = cleanName(input.name, parent?.delimiter ?? delimiter);
	const path = pathFor(siblings, parent, name, delimiter);
	if (siblings.some((folder) => folder.path === path)) {
		throw new Error(`This account already has a folder called ${name}.`);
	}

	await withWriter(input.accountId, db, (writer) => writer.createFolder(path));
	return toRecord(insertFolder(db, input.accountId, { path, name, delimiter, specialUse: null }));
}

/**
 * Renames a folder on the server and repoints the rows, its children included:
 * IMAP renames the whole subtree, so the local paths have to follow or the next
 * sync finds every child missing and retires mail that is still there.
 */
export async function rename(id: string, name: string, db: Db = getDb()): Promise<MailFolder> {
	const folder = requireRow(id, db);
	if (folder.specialUse) {
		throw new Error(`${folder.name} is the account's ${folder.specialUse} folder, so its name is the server's.`);
	}
	const siblings = rows(folder.accountId, db);
	const delimiter = folder.delimiter ?? delimiterFor(siblings);
	const clean = cleanName(name, delimiter);
	if (clean === folder.name) return toRecord(folder);

	const cut = folder.path.lastIndexOf(delimiter);
	const toPath = cut >= 0 ? `${folder.path.slice(0, cut + 1)}${clean}` : clean;
	if (siblings.some((other) => other.id !== folder.id && other.path === toPath)) {
		throw new Error(`This account already has a folder called ${clean}.`);
	}

	await withWriter(folder.accountId, db, (writer) => writer.renameFolder(folder.path, toPath));

	const stamp = now();
	const children = db
		.select()
		.from(mailFolders)
		.where(
			and(
				eq(mailFolders.accountId, folder.accountId),
				ne(mailFolders.id, folder.id),
				like(mailFolders.path, `${folder.path}${delimiter}%`),
				isNull(mailFolders.deletedAt),
			),
		)
		.all();
	db.transaction(() => {
		db.update(mailFolders)
			.set({ path: toPath, name: clean, updatedAt: stamp })
			.where(eq(mailFolders.id, folder.id))
			.run();
		for (const child of children) {
			db.update(mailFolders)
				.set({ path: `${toPath}${child.path.slice(folder.path.length)}`, updatedAt: stamp })
				.where(eq(mailFolders.id, child.id))
				.run();
		}
	});
	return toRecord(requireRow(id, db));
}

/**
 * Removes a folder from the server, with everything in it.
 *
 * This destroys mail, so it is confirmed by a person in the window with the
 * count in front of them, and it refuses a folder the account needs: a server
 * without a Trash folder cannot trash anything.
 */
export async function remove(id: string, db: Db = getDb()): Promise<MailFolder> {
	const folder = requireRow(id, db);
	if (folder.specialUse) {
		throw new Error(`${folder.name} is the account's ${folder.specialUse} folder, so it cannot be removed.`);
	}
	const children = db
		.select({ id: mailFolders.id })
		.from(mailFolders)
		.where(
			and(
				eq(mailFolders.accountId, folder.accountId),
				ne(mailFolders.id, folder.id),
				like(mailFolders.path, `${folder.path}${folder.delimiter ?? "."}%`),
				isNull(mailFolders.deletedAt),
			),
		)
		.all();
	if (children.length > 0) {
		throw new Error(
			`${folder.name} has ${children.length} ${children.length === 1 ? "folder" : "folders"} inside it. Remove those first.`,
		);
	}

	await withWriter(folder.accountId, db, (writer) => writer.deleteFolder(folder.path));
	retireFolder(db, folder.id);
	return toRecord({ ...folder, deletedAt: now() });
}

/**
 * The folder serving a purpose, made on the server if the account has none.
 *
 * An account with no Archive folder is common, and refusing to archive because
 * of it sends a person to a webmail to make one folder. Creating it is what
 * every other mail client does, and it happens because somebody pressed Archive.
 */
export async function ensureSpecialFolder(
	accountId: string,
	use: MailSpecialUse,
	db: Db = getDb(),
): Promise<Row> {
	const existing = db
		.select()
		.from(mailFolders)
		.where(
			and(
				eq(mailFolders.accountId, accountId),
				eq(mailFolders.specialUse, use),
				isNull(mailFolders.deletedAt),
			),
		)
		.get();
	if (existing) return existing;
	if (use === "inbox") throw new Error("This account has no inbox. Sync it, then try again.");

	const siblings = rows(accountId, db);
	const delimiter = delimiterFor(siblings);
	const name = SPECIAL_NAMES[use];
	const path = pathFor(siblings, null, name, delimiter);
	await withWriter(accountId, db, (writer) => writer.createFolder(path));
	return insertFolder(db, accountId, { path, name, delimiter, specialUse: use });
}

/**
 * Turns a folder's sync on or off, and records that the choice was made by
 * hand, so the default the reconcile applies never overrides it again.
 */
export async function setSyncEnabled(id: string, enabled: boolean, db: Db = getDb()): Promise<MailFolder> {
	const updated = db
		.update(mailFolders)
		.set({ syncEnabled: enabled, syncChoiceAt: now(), updatedAt: now() })
		.where(and(eq(mailFolders.id, id), isNull(mailFolders.deletedAt)))
		.returning()
		.get();
	if (!updated) throw new Error("That folder does not exist.");
	return toRecord(updated);
}
