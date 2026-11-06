/**
 * The records opened last, for the Recent menu in the title bar.
 *
 * A record that is opened again moves to the front rather than appearing twice,
 * and only the newest twenty per owner are kept. Names are looked up when the
 * list is read, so a renamed record shows its new name and a deleted one drops
 * out instead of leaving a dead entry.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { RecentItem, RecentKind } from "../../shared/types";
import { getDb, type Db } from "../db";
import { LOCAL_OWNER_ID, now } from "../db/columns";
import { clients, documents, mailThreads, projects, recentItems } from "../db/schema";

type Row = typeof recentItems.$inferSelect;

export const RECENT_LIMIT = 20;

const KINDS: RecentKind[] = ["client", "project", "document", "thread"];

export class RecentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RecentError";
	}
}

/** Notes that a record was opened, and returns the row that says so. */
export function touch(kind: RecentKind, recordId: string, db: Db = getDb()): Row {
	if (!KINDS.includes(kind)) throw new RecentError(`"${kind}" is not something Juno keeps in Recent.`);
	if (!recordId.trim()) throw new RecentError("Say which record was opened.");

	const stamp = now();
	const existing = db
		.select()
		.from(recentItems)
		.where(
			and(
				eq(recentItems.ownerId, LOCAL_OWNER_ID),
				eq(recentItems.kind, kind),
				eq(recentItems.recordId, recordId),
			),
		)
		.get();

	let row: Row;
	if (existing) {
		// A row that was cleared comes back; the unique index would refuse a second one.
		[row] = db
			.update(recentItems)
			.set({ openedAt: stamp, updatedAt: stamp, deletedAt: null })
			.where(eq(recentItems.id, existing.id))
			.returning()
			.all() as [Row];
	} else {
		[row] = db
			.insert(recentItems)
			.values({ ownerId: LOCAL_OWNER_ID, kind, recordId, openedAt: stamp, createdAt: stamp, updatedAt: stamp })
			.returning()
			.all() as [Row];
	}

	const alive = db
		.select({ id: recentItems.id })
		.from(recentItems)
		.where(and(eq(recentItems.ownerId, LOCAL_OWNER_ID), isNull(recentItems.deletedAt)))
		.orderBy(desc(recentItems.openedAt), desc(recentItems.id))
		.all();
	const overflow = alive.slice(RECENT_LIMIT).map((r) => r.id);
	if (overflow.length > 0) {
		db.update(recentItems)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(inArray(recentItems.id, overflow))
			.run();
	}
	return row;
}

/** Newest first. Records that are gone, or deleted, are left out. */
export function list(db: Db = getDb()): RecentItem[] {
	const rows = db
		.select()
		.from(recentItems)
		.where(and(eq(recentItems.ownerId, LOCAL_OWNER_ID), isNull(recentItems.deletedAt)))
		.orderBy(desc(recentItems.openedAt), desc(recentItems.id))
		.limit(RECENT_LIMIT)
		.all();

	const items: RecentItem[] = [];
	for (const row of rows) {
		const resolved = resolve(row, db);
		if (!resolved) continue;
		items.push({
			id: row.id,
			kind: row.kind as RecentKind,
			recordId: row.recordId,
			name: resolved.name,
			context: resolved.context,
			openedAt: row.openedAt,
		});
	}
	return items;
}

function clientName(id: string | null, db: Db): string | null {
	if (!id) return null;
	const row = db
		.select({ name: clients.name })
		.from(clients)
		.where(and(eq(clients.id, id), isNull(clients.deletedAt)))
		.get();
	return row?.name ?? null;
}

function resolve(row: Row, db: Db): { name: string; context: string | null } | null {
	switch (row.kind) {
		case "client": {
			const name = clientName(row.recordId, db);
			return name ? { name, context: null } : null;
		}
		case "project": {
			const project = db
				.select({ name: projects.name, clientId: projects.clientId })
				.from(projects)
				.where(and(eq(projects.id, row.recordId), isNull(projects.deletedAt)))
				.get();
			return project ? { name: project.name, context: clientName(project.clientId, db) } : null;
		}
		case "document": {
			const document = db
				.select({ title: documents.title, clientId: documents.clientId })
				.from(documents)
				.where(and(eq(documents.id, row.recordId), isNull(documents.deletedAt)))
				.get();
			return document ? { name: document.title, context: clientName(document.clientId, db) } : null;
		}
		case "thread": {
			const thread = db
				.select({ subject: mailThreads.subject, clientId: mailThreads.clientId })
				.from(mailThreads)
				.where(and(eq(mailThreads.id, row.recordId), isNull(mailThreads.deletedAt)))
				.get();
			return thread ? { name: thread.subject || "(no subject)", context: clientName(thread.clientId, db) } : null;
		}
		default:
			return null;
	}
}

/** Empties the list. The records themselves are untouched. */
export function clear(db: Db = getDb()): void {
	const stamp = now();
	db.update(recentItems)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(recentItems.ownerId, LOCAL_OWNER_ID), isNull(recentItems.deletedAt)))
		.run();
}
