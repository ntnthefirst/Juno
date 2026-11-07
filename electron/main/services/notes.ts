/**
 * Notes. Something written down for its own sake, which may belong to a
 * client, a project, or nothing.
 *
 * The body is Markdown and is saved as it is typed, so `update` is cheap and
 * has no draft state. Search runs on `notes_fts`, which triggers keep in step
 * with the table; a deleted note is filtered out here, not in the index, so
 * restoring one needs nothing re-indexed.
 *
 * Deleting is a soft delete like every other record, and an agent's delete
 * parks behind the confirmation gate (.claude/rules/mcp.md).
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Note, NoteHit, NoteInput, NotePatch, NoteQuery } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, notes, projects } from "../db/schema";
import { requireClient } from "./clients";
import { ftsQuery } from "./mail-threads";
import { requireProject } from "./projects";

const MAX_TITLE = 300;
const MAX_BODY = 200_000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

type Row = typeof notes.$inferSelect;

function toNote(row: Row, names: { clientName: string | null; projectName: string | null }): Note {
	return { ...row, clientName: names.clientName, projectName: names.projectName };
}

function selectWithNames(db: Db) {
	return db
		.select({ note: notes, clientName: clients.name, projectName: projects.name })
		.from(notes)
		.leftJoin(clients, eq(notes.clientId, clients.id))
		.leftJoin(projects, eq(notes.projectId, projects.id));
}

function cleanTitle(value: unknown): string {
	if (typeof value !== "string") throw new Error("A note title is text.");
	const title = value.replace(/\s+/g, " ").trim();
	if (title.length > MAX_TITLE) throw new Error(`A note title can be at most ${MAX_TITLE} characters.`);
	return title;
}

function cleanBody(value: unknown): string {
	if (typeof value !== "string") throw new Error("A note body is text.");
	if (value.length > MAX_BODY) throw new Error("That note is too long. Split it into two.");
	return value.replace(/\r\n/g, "\n");
}

/** Checks that a client and a project exist, so a note cannot point at nothing. */
function checkOwners(clientId: string | null | undefined, projectId: string | null | undefined, db: Db): void {
	if (clientId) requireClient(clientId, db);
	if (projectId) requireProject(projectId, db);
}

export async function list(query: NoteQuery = {}, db: Db = getDb()): Promise<Note[]> {
	const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
	const rows = selectWithNames(db)
		.where(
			and(
				isNull(notes.deletedAt),
				query.clientId ? eq(notes.clientId, query.clientId) : undefined,
				query.projectId ? eq(notes.projectId, query.projectId) : undefined,
			),
		)
		// Pinned first, then the newest edit. The id breaks a tie inside one millisecond.
		.orderBy(sql`${notes.pinnedAt} is null`, desc(notes.pinnedAt), desc(notes.updatedAt), desc(notes.id))
		.limit(limit)
		.all();
	return rows.map((row) => toNote(row.note, row));
}

export async function get(id: string, db: Db = getDb()): Promise<Note | null> {
	const row = selectWithNames(db)
		.where(and(eq(notes.id, id), isNull(notes.deletedAt)))
		.get();
	return row ? toNote(row.note, row) : null;
}

function requireNote(id: string, db: Db): Note {
	const row = selectWithNames(db)
		.where(and(eq(notes.id, id), isNull(notes.deletedAt)))
		.get();
	if (!row) throw new Error(`No note with id "${id}". It may have been deleted.`);
	return toNote(row.note, row);
}

/** Notes whose title or text holds every word typed, best match first. */
export async function search(term: string, query: NoteQuery = {}, db: Db = getDb()): Promise<NoteHit[]> {
	const match = ftsQuery(term);
	if (!match) return [];
	const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), MAX_LIMIT);
	const hits = db.all<{ note_id: string; snippet: string }>(sql`
		select note_id, snippet(notes_fts, 2, '', '', '...', 12) as snippet
		from notes_fts
		where notes_fts match ${match}
		order by bm25(notes_fts, 0.0, 4.0, 1.0)
		limit ${limit * 3}
	`);
	if (hits.length === 0) return [];
	const rows = selectWithNames(db)
		.where(
			and(
				isNull(notes.deletedAt),
				inArray(
					notes.id,
					hits.map((hit) => hit.note_id),
				),
				query.clientId ? eq(notes.clientId, query.clientId) : undefined,
				query.projectId ? eq(notes.projectId, query.projectId) : undefined,
			),
		)
		.all();
	const byId = new Map(rows.map((row) => [row.note.id, toNote(row.note, row)]));
	const out: NoteHit[] = [];
	for (const hit of hits) {
		const note = byId.get(hit.note_id);
		if (note) out.push({ note, snippet: hit.snippet.replace(/\s+/g, " ").trim() });
		if (out.length === limit) break;
	}
	return out;
}

export async function create(input: NoteInput = {}, db: Db = getDb()): Promise<Note> {
	const title = input.title === undefined ? "" : cleanTitle(input.title);
	const body = input.body === undefined ? "" : cleanBody(input.body);
	checkOwners(input.clientId, input.projectId, db);
	const stamp = now();
	const row = db
		.insert(notes)
		.values({
			title,
			body,
			clientId: input.clientId ?? null,
			projectId: input.projectId ?? null,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get();
	return requireNote(row.id, db);
}

/** Fields left out are untouched. `pinned` sets or clears the pin. */
export async function update(id: string, patch: NotePatch, db: Db = getDb()): Promise<Note> {
	requireNote(id, db);
	const stamp = now();
	const set: Partial<typeof notes.$inferInsert> = { updatedAt: stamp };
	if (patch.title !== undefined) set.title = cleanTitle(patch.title);
	if (patch.body !== undefined) set.body = cleanBody(patch.body);
	if (patch.clientId !== undefined || patch.projectId !== undefined) {
		checkOwners(patch.clientId, patch.projectId, db);
		if (patch.clientId !== undefined) set.clientId = patch.clientId;
		if (patch.projectId !== undefined) set.projectId = patch.projectId;
	}
	if (patch.pinned !== undefined) set.pinnedAt = patch.pinned ? stamp : null;
	db.update(notes)
		.set(set)
		.where(and(eq(notes.id, id), isNull(notes.deletedAt)))
		.run();
	return requireNote(id, db);
}

/** A copy that is not pinned and is titled as a copy, so the two are told apart in the list. */
export async function duplicate(id: string, db: Db = getDb()): Promise<Note> {
	const source = requireNote(id, db);
	const title = source.title === "" ? "" : `${source.title} (copy)`.slice(0, MAX_TITLE);
	return create({ title, body: source.body, clientId: source.clientId, projectId: source.projectId }, db);
}

export async function remove(id: string, db: Db = getDb()): Promise<Note> {
	const stamp = now();
	const row = db
		.update(notes)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(notes.id, id), isNull(notes.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No note with id "${id}" to delete. It may already be deleted.`);
	return toNote(row, { clientName: null, projectName: null });
}

export async function restore(id: string, db: Db = getDb()): Promise<Note> {
	const row = db
		.update(notes)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(notes.id, id), isNotNull(notes.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted note with id "${id}" to restore.`);
	return requireNote(id, db);
}
