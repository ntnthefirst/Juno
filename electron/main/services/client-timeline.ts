/**
 * A client's history, in one stream.
 *
 * Nothing here is a new record of what happened. Every line but a note is read
 * back out of the table that already holds it: the document row, the thread
 * row, the appointment, the reminder, the project. A second table that copied
 * those would be a second truth to keep in step, and it would start lying the
 * first time somebody edited a document without going through this.
 *
 * The one thing that has no other trace is a phone call, so `client_notes` is
 * the row a person writes by hand. It carries `happened_at` separately from
 * `created_at`, because a call remembered on Friday still belongs on Tuesday.
 *
 * Sorting: `at` is an instant and every source produces one. A record that is a
 * date with no time also fills `on`, and the interface shows that instead of
 * converting, which is what keeps a deadline off the wrong day in April
 * (.claude/rules/data.md section 4).
 *
 * Audit rows are deliberately not a source. They exist, they are per-write, and
 * a client with an ordinary week would have thirty "client updated" lines
 * between two that meant something. The audit log is its own screen.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type {
	ClientNote,
	ClientNoteInput,
	ClientNoteKind,
	ClientNotePatch,
	ClientTimelineEntry,
	ClientTimelineKind,
	ClientTimelineQuery,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import {
	calendarEvents,
	clientNotes,
	clients,
	documents,
	mailThreads,
	projects,
	referenceItems,
	reminders,
} from "../db/schema";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 300;

const NOTE_KINDS: ClientNoteKind[] = ["note", "call", "meeting"];

type NoteRow = typeof clientNotes.$inferSelect;

function toNote(row: NoteRow): ClientNote {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		clientId: row.clientId,
		happenedAt: row.happenedAt,
		kind: (NOTE_KINDS.includes(row.kind as ClientNoteKind) ? row.kind : "note") as ClientNoteKind,
		title: row.title,
		body: row.body,
	};
}

function requireClient(clientId: string, db: Db): void {
	const row = db
		.select({ id: clients.id })
		.from(clients)
		.where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
		.get();
	if (!row) throw new Error("That client does not exist.");
}

/** A calendar date turned into an instant, for sorting only. Never displayed. */
function instantOfDate(date: string): string {
	return `${date}T00:00:00.000Z`;
}

/** A wall-clock local string turned into an instant, for sorting only. */
function instantOfLocal(local: string): string {
	return local.length === 10 ? instantOfDate(local) : `${local}.000Z`;
}

/* ----------------------------------------------------------------- notes */

export async function listNotes(clientId: string, db: Db = getDb()): Promise<ClientNote[]> {
	return db
		.select()
		.from(clientNotes)
		.where(and(eq(clientNotes.clientId, clientId), isNull(clientNotes.deletedAt)))
		// The id breaks the tie. Two notes written in one burst share a
		// happened_at to the millisecond, and v7 ids continue the same ordering.
		.orderBy(desc(clientNotes.happenedAt), desc(clientNotes.id))
		.all()
		.map(toNote);
}

export async function getNote(id: string, db: Db = getDb()): Promise<ClientNote | null> {
	const row = db
		.select()
		.from(clientNotes)
		.where(and(eq(clientNotes.id, id), isNull(clientNotes.deletedAt)))
		.get();
	return row ? toNote(row) : null;
}

export async function createNote(input: ClientNoteInput, db: Db = getDb()): Promise<ClientNote> {
	const title = input.title.trim();
	if (title.length === 0) throw new Error("A note needs a line saying what happened.");
	requireClient(input.clientId, db);
	const kind = input.kind ?? "note";
	if (!NOTE_KINDS.includes(kind)) throw new Error(`A note is one of ${NOTE_KINDS.join(", ")}.`);

	const stamp = now();
	const [row] = db
		.insert(clientNotes)
		.values({
			clientId: input.clientId,
			happenedAt: input.happenedAt ?? stamp,
			kind,
			title,
			body: input.body?.trim() || null,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.all();
	if (!row) throw new Error("The note could not be saved.");
	return toNote(row);
}

export async function updateNote(
	id: string,
	patch: ClientNotePatch,
	db: Db = getDb(),
): Promise<ClientNote> {
	const existing = await getNote(id, db);
	if (!existing) throw new Error("That note does not exist.");

	if (patch.kind !== undefined && !NOTE_KINDS.includes(patch.kind)) {
		throw new Error(`A note is one of ${NOTE_KINDS.join(", ")}.`);
	}
	if (patch.title !== undefined && patch.title.trim().length === 0) {
		throw new Error("A note needs a line saying what happened.");
	}

	db.update(clientNotes)
		.set({
			...(patch.happenedAt !== undefined ? { happenedAt: patch.happenedAt } : {}),
			...(patch.kind !== undefined ? { kind: patch.kind } : {}),
			...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
			...(patch.body !== undefined ? { body: patch.body?.trim() || null } : {}),
			updatedAt: now(),
		})
		.where(eq(clientNotes.id, id))
		.run();

	const updated = await getNote(id, db);
	if (!updated) throw new Error("The note could not be saved.");
	return updated;
}

export async function removeNote(id: string, db: Db = getDb()): Promise<ClientNote> {
	const existing = await getNote(id, db);
	if (!existing) throw new Error("That note does not exist.");
	const stamp = now();
	db.update(clientNotes)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(clientNotes.id, id))
		.run();
	return { ...existing, deletedAt: stamp, updatedAt: stamp };
}

export async function restoreNote(id: string, db: Db = getDb()): Promise<ClientNote> {
	const row = db.select().from(clientNotes).where(eq(clientNotes.id, id)).get();
	if (!row) throw new Error("That note does not exist.");
	db.update(clientNotes).set({ deletedAt: null, updatedAt: now() }).where(eq(clientNotes.id, id)).run();
	const restored = await getNote(id, db);
	if (!restored) throw new Error("The note could not be restored.");
	return restored;
}

/* -------------------------------------------------------------- timeline */

/**
 * Each source is read separately and merged, rather than assembled as one SQL
 * union. The tables have nothing in common but a client id, the union would be
 * six casts wide and unreadable, and every source is already indexed on that
 * column so each of these is a short lookup.
 *
 * `limit` is applied per source before the merge and again after it. A client
 * with four hundred mail threads and two documents would otherwise page through
 * mail forever and never reach the documents.
 */
export async function timeline(
	query: ClientTimelineQuery,
	db: Db = getDb(),
): Promise<ClientTimelineEntry[]> {
	requireClient(query.clientId, db);
	const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const wanted = new Set<ClientTimelineKind>(
		query.kinds ?? ["note", "mail", "document", "event", "reminder", "project"],
	);
	const entries: ClientTimelineEntry[] = [];

	if (wanted.has("note")) {
		for (const row of db
			.select()
			.from(clientNotes)
			.where(and(eq(clientNotes.clientId, query.clientId), isNull(clientNotes.deletedAt)))
			.orderBy(desc(clientNotes.happenedAt), desc(clientNotes.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `note:${row.id}`,
				kind: "note",
				at: row.happenedAt,
				on: null,
				title: row.title,
				detail: row.body ? firstLine(row.body) : null,
				entityId: row.id,
				variant: row.kind,
			});
		}
	}

	if (wanted.has("mail")) {
		for (const row of db
			.select({
				id: mailThreads.id,
				subject: mailThreads.subject,
				lastMessageAt: mailThreads.lastMessageAt,
				linkSource: mailThreads.linkSource,
			})
			.from(mailThreads)
			.where(and(eq(mailThreads.clientId, query.clientId), isNull(mailThreads.deletedAt)))
			.orderBy(desc(mailThreads.lastMessageAt), desc(mailThreads.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `mail:${row.id}`,
				kind: "mail",
				at: row.lastMessageAt,
				on: null,
				title: row.subject,
				detail: row.linkSource === "auto" ? "Matched to this client" : null,
				entityId: row.id,
				variant: null,
			});
		}
	}

	if (wanted.has("document")) {
		for (const row of db
			.select({
				id: documents.id,
				title: documents.title,
				createdAt: documents.createdAt,
				issuedOn: documents.issuedOn,
				statusLabel: referenceItems.label,
			})
			.from(documents)
			.leftJoin(referenceItems, eq(referenceItems.id, documents.statusId))
			.where(and(eq(documents.clientId, query.clientId), isNull(documents.deletedAt)))
			.orderBy(desc(documents.createdAt), desc(documents.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `document:${row.id}`,
				kind: "document",
				at: row.issuedOn ? instantOfDate(row.issuedOn) : row.createdAt,
				on: row.issuedOn,
				title: row.title,
				detail: row.statusLabel,
				entityId: row.id,
				variant: null,
			});
		}
	}

	if (wanted.has("event")) {
		for (const row of db
			.select({
				id: calendarEvents.id,
				title: calendarEvents.title,
				startLocal: calendarEvents.startLocal,
				allDay: calendarEvents.allDay,
				location: calendarEvents.location,
				rrule: calendarEvents.rrule,
			})
			.from(calendarEvents)
			.where(and(eq(calendarEvents.clientId, query.clientId), isNull(calendarEvents.deletedAt)))
			.orderBy(desc(calendarEvents.startUtc), desc(calendarEvents.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `event:${row.id}`,
				kind: "event",
				// The series master's first occurrence. A recurring appointment is
				// one line here rather than one per occurrence: a weekly meeting
				// would otherwise be the entire timeline.
				at: instantOfLocal(row.startLocal),
				on: row.allDay ? row.startLocal.slice(0, 10) : null,
				title: row.title,
				detail: [row.location, row.rrule ? "Repeats" : null].filter(Boolean).join("  ·  ") || null,
				entityId: row.id,
				variant: null,
			});
		}
	}

	if (wanted.has("reminder")) {
		for (const row of db
			.select({
				id: reminders.id,
				title: reminders.title,
				dueOn: reminders.dueOn,
				completedAt: reminders.completedAt,
				category: reminders.category,
			})
			.from(reminders)
			.where(and(eq(reminders.clientId, query.clientId), isNull(reminders.deletedAt)))
			.orderBy(desc(reminders.dueOn), desc(reminders.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `reminder:${row.id}`,
				kind: "reminder",
				at: instantOfDate(row.dueOn),
				on: row.dueOn,
				title: row.title,
				detail: row.completedAt ? "Done" : "Due",
				entityId: row.id,
				variant: row.category,
			});
		}
	}

	if (wanted.has("project")) {
		for (const row of db
			.select({
				id: projects.id,
				name: projects.name,
				createdAt: projects.createdAt,
				startsOn: projects.startsOn,
				statusLabel: referenceItems.label,
			})
			.from(projects)
			.leftJoin(referenceItems, eq(referenceItems.id, projects.statusId))
			.where(and(eq(projects.clientId, query.clientId), isNull(projects.deletedAt)))
			.orderBy(desc(projects.createdAt), desc(projects.id))
			.limit(limit)
			.all()) {
			entries.push({
				id: `project:${row.id}`,
				kind: "project",
				at: row.startsOn ? instantOfDate(row.startsOn) : row.createdAt,
				on: row.startsOn,
				title: row.name,
				detail: row.statusLabel,
				entityId: row.id,
				variant: null,
			});
		}
	}

	const before = query.before;
	return entries
		.filter((entry) => (before ? entry.at < before : true))
		// Newest first, with the id as the tiebreaker so a page boundary is
		// stable when two records share an instant.
		.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1))
		.slice(0, limit);
}

/**
 * How many entries a client has, per kind, for the tab counts.
 *
 * Six explicit queries rather than one helper taking a table, because the six
 * table types do not unify and the helper that made them fit only did so by
 * widening to any, which turns a renamed column into a runtime surprise instead
 * of a typecheck failure. Repetition is the cheaper of the two.
 */
export async function timelineCounts(
	clientId: string,
	db: Db = getDb(),
): Promise<Record<ClientTimelineKind, number>> {
	requireClient(clientId, db);
	const n = (row: { n: number } | undefined): number => row?.n ?? 0;
	const total = sql<number>`count(*)`;
	return {
		note: n(
			db
				.select({ n: total })
				.from(clientNotes)
				.where(and(eq(clientNotes.clientId, clientId), isNull(clientNotes.deletedAt)))
				.get(),
		),
		mail: n(
			db
				.select({ n: total })
				.from(mailThreads)
				.where(and(eq(mailThreads.clientId, clientId), isNull(mailThreads.deletedAt)))
				.get(),
		),
		document: n(
			db
				.select({ n: total })
				.from(documents)
				.where(and(eq(documents.clientId, clientId), isNull(documents.deletedAt)))
				.get(),
		),
		event: n(
			db
				.select({ n: total })
				.from(calendarEvents)
				.where(and(eq(calendarEvents.clientId, clientId), isNull(calendarEvents.deletedAt)))
				.get(),
		),
		reminder: n(
			db
				.select({ n: total })
				.from(reminders)
				.where(and(eq(reminders.clientId, clientId), isNull(reminders.deletedAt)))
				.get(),
		),
		project: n(
			db
				.select({ n: total })
				.from(projects)
				.where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt)))
				.get(),
		),
	};
}

/** The first line of a note body, for the one-line detail under the title. */
function firstLine(body: string): string {
	const line = body.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
	return line.trim().slice(0, 140);
}
