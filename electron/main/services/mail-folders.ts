/**
 * Folders, as the sidebar sees them. The rows are written by the sync
 * (mail-store.ts); this module reads them and flips the one setting a person
 * controls, whether a folder is pulled at all.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { MailFolder, MailSpecialUse } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { mailFolders } from "../db/schema";

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

export async function list(accountId: string, db: Db = getDb()): Promise<MailFolder[]> {
	const rows = db
		.select()
		.from(mailFolders)
		.where(and(eq(mailFolders.accountId, accountId), isNull(mailFolders.deletedAt)))
		.orderBy(asc(mailFolders.path))
		.all();
	return sortFolders(rows).map(toRecord);
}

export async function setSyncEnabled(id: string, enabled: boolean, db: Db = getDb()): Promise<MailFolder> {
	const updated = db
		.update(mailFolders)
		.set({ syncEnabled: enabled, updatedAt: now() })
		.where(and(eq(mailFolders.id, id), isNull(mailFolders.deletedAt)))
		.returning()
		.get();
	if (!updated) throw new Error("That folder does not exist.");
	return toRecord(updated);
}
