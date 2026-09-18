/**
 * Reminders. Bureau tells you; it never acts.
 *
 * Decision 9 is binding: no invoice is generated, numbered or sent, and no money
 * moves. A reminder that says "time to invoice obet" carries a link to wherever
 * the invoicing actually happens, and stops there.
 *
 * The date logic is in ./recurrence.ts, which is pure and tested. The bucketing
 * below is pure too, for the same reason: "is this overdue" is the question the
 * whole feature turns on.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, documents, projects, reminderCompletions, reminders } from "../db/schema";
import { todayIsoDate } from "./document-context";
import {
	compare,
	describe as describeRecurrence,
	nextOccurrence,
	type Recurrence,
	type RecurrencePattern,
} from "./recurrence";

export type ReminderCategory = "paperwork" | "invoice" | "payment" | "renewal" | "other";

export type ReminderBucket = "overdue" | "today" | "soon" | "later" | "snoozed" | "done";

export interface ReminderRecord {
	id: string;
	ownerId: string;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
	title: string;
	notes: string | null;
	dueOn: string;
	pattern: RecurrencePattern;
	interval: number;
	anchorDay: number | null;
	leadDays: number;
	category: ReminderCategory;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	documentId: string | null;
	snoozedUntil: string | null;
	completedAt: string | null;
	lastCompletedOn: string | null;
	actionUrl: string | null;
	actionLabel: string | null;
	isSystem: boolean;
	/** Computed, not stored. */
	bucket: ReminderBucket;
	recurrenceLabel: string;
}

export interface ReminderInput {
	title: string;
	dueOn: string;
	notes?: string | null;
	pattern?: RecurrencePattern;
	interval?: number;
	anchorDay?: number | null;
	leadDays?: number;
	category?: ReminderCategory;
	clientId?: string | null;
	projectId?: string | null;
	documentId?: string | null;
	actionUrl?: string | null;
	actionLabel?: string | null;
}

export type ReminderPatch = Partial<ReminderInput>;

/** How far ahead counts as "soon" rather than "later". */
export const SOON_DAYS = 7;

interface Bucketable {
	dueOn: string;
	leadDays: number;
	snoozedUntil: string | null;
	completedAt: string | null;
}

/**
 * Which pile a reminder belongs in today.
 *
 * Pure and exported so the rule is tested rather than inferred from whichever
 * screen happens to render it.
 */
export function bucketFor(reminder: Bucketable, today: string): ReminderBucket {
	if (reminder.completedAt) return "done";

	// A snooze that has run out is simply over. Storing the expiry rather than a
	// flag means nothing has to sweep the table to un-snooze anything.
	if (reminder.snoozedUntil && compare(reminder.snoozedUntil, today) > 0) return "snoozed";

	const cmp = compare(reminder.dueOn, today);
	if (cmp < 0) return "overdue";
	if (cmp === 0) return "today";

	const daysAhead = daysBetween(today, reminder.dueOn);
	// Lead days pull a reminder forward: a yearly renewal with 30 days of lead
	// starts asking a month out rather than on the morning it expires.
	if (daysAhead <= Math.max(reminder.leadDays, SOON_DAYS)) return "soon";
	return "later";
}

export function daysBetween(from: string, to: string): number {
	const day = 24 * 60 * 60 * 1000;
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day);
}

/** Everything that wants attention now: overdue, due today, or inside its lead. */
export function isActionable(bucket: ReminderBucket): boolean {
	return bucket === "overdue" || bucket === "today" || bucket === "soon";
}

type Row = typeof reminders.$inferSelect;

function toRecord(
	row: Row,
	today: string,
	names: { clientName?: string | null; projectName?: string | null } = {},
): ReminderRecord {
	const recurrence: Recurrence = {
		pattern: row.pattern as RecurrencePattern,
		interval: row.interval,
		anchorDay: row.anchorDay ?? undefined,
	};
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		title: row.title,
		notes: row.notes,
		dueOn: row.dueOn,
		pattern: recurrence.pattern,
		interval: row.interval,
		anchorDay: row.anchorDay,
		leadDays: row.leadDays,
		category: row.category as ReminderCategory,
		clientId: row.clientId,
		clientName: names.clientName ?? null,
		projectId: row.projectId,
		projectName: names.projectName ?? null,
		documentId: row.documentId,
		snoozedUntil: row.snoozedUntil,
		completedAt: row.completedAt,
		lastCompletedOn: row.lastCompletedOn,
		actionUrl: row.actionUrl,
		actionLabel: row.actionLabel,
		isSystem: row.isSystem,
		bucket: bucketFor(row, today),
		recurrenceLabel: describeRecurrence(recurrence),
	};
}

export interface ListQuery {
	/** Only what wants attention now. */
	actionableOnly?: boolean;
	includeDone?: boolean;
	clientId?: string;
	category?: ReminderCategory;
}

export async function list(
	query: ListQuery = {},
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord[]> {
	const rows = db
		.select({
			reminder: reminders,
			clientName: clients.name,
			projectName: projects.name,
		})
		.from(reminders)
		.leftJoin(clients, eq(reminders.clientId, clients.id))
		.leftJoin(projects, eq(reminders.projectId, projects.id))
		.where(isNull(reminders.deletedAt))
		.orderBy(asc(reminders.dueOn))
		.all();

	let records = rows.map((row) =>
		toRecord(row.reminder, today, {
			clientName: row.clientName,
			projectName: row.projectName,
		}),
	);

	if (!query.includeDone) records = records.filter((r) => r.bucket !== "done");
	if (query.actionableOnly) records = records.filter((r) => isActionable(r.bucket));
	if (query.clientId) records = records.filter((r) => r.clientId === query.clientId);
	if (query.category) records = records.filter((r) => r.category === query.category);

	return records;
}

export async function get(
	id: string,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord | null> {
	const row = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.id, id), isNull(reminders.deletedAt)))
		.get();
	return row ? toRecord(row, today) : null;
}

/**
 * A monthly or yearly series has to remember the day it was anchored to.
 *
 * Without this, a reminder set for the 31st clamps to 28 February and then
 * advances from the clamped date, so every later occurrence is on the 28th. The
 * series walks backwards once and never recovers. Derived here rather than asked
 * for, because nobody setting a reminder thinks in anchor days.
 */
function anchorFor(
	pattern: RecurrencePattern | undefined,
	dueOn: string | undefined,
	given: number | null | undefined,
): number | null {
	if (given !== undefined && given !== null) return given;
	if (pattern !== "months" && pattern !== "years") return null;
	if (!dueOn) return null;
	return Number(dueOn.slice(8, 10));
}

function validate(input: ReminderInput | ReminderPatch): void {
	if (input.title !== undefined && !input.title.trim()) {
		throw new Error("A reminder needs a title.");
	}
	if (input.dueOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
		throw new Error("A reminder needs a date in YYYY-MM-DD form.");
	}
	if (input.leadDays !== undefined && (input.leadDays < 0 || input.leadDays > 365)) {
		throw new Error("Lead days has to be between 0 and 365.");
	}
}

export async function create(
	input: ReminderInput,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	validate(input);
	if (!input.title?.trim()) throw new Error("A reminder needs a title.");

	const [row] = db
		.insert(reminders)
		.values({
			title: input.title.trim(),
			notes: input.notes ?? null,
			dueOn: input.dueOn,
			pattern: input.pattern ?? "once",
			interval: input.interval ?? 1,
			anchorDay: anchorFor(input.pattern, input.dueOn, input.anchorDay),
			leadDays: input.leadDays ?? 0,
			category: input.category ?? "other",
			clientId: input.clientId ?? null,
			projectId: input.projectId ?? null,
			documentId: input.documentId ?? null,
			actionUrl: input.actionUrl ?? null,
			actionLabel: input.actionLabel ?? null,
		})
		.returning()
		.all();
	return toRecord(row!, today);
}

export async function update(
	id: string,
	patch: ReminderPatch,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	validate(patch);
	const existing = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.id, id), isNull(reminders.deletedAt)))
		.get();
	if (!existing) throw new Error("That reminder no longer exists.");

	const [row] = db
		.update(reminders)
		.set({
			...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
			...(patch.notes !== undefined ? { notes: patch.notes } : {}),
			...(patch.dueOn !== undefined ? { dueOn: patch.dueOn } : {}),
			...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}),
			...(patch.interval !== undefined ? { interval: patch.interval } : {}),
			// Recomputed whenever the pattern or the date moves, so an edit cannot
			// leave a series anchored to a day it no longer starts on.
			...(patch.anchorDay !== undefined || patch.pattern !== undefined || patch.dueOn !== undefined
				? {
						anchorDay: anchorFor(
							patch.pattern ?? (existing.pattern as RecurrencePattern),
							patch.dueOn ?? existing.dueOn,
							patch.anchorDay,
						),
					}
				: {}),
			...(patch.leadDays !== undefined ? { leadDays: patch.leadDays } : {}),
			...(patch.category !== undefined ? { category: patch.category } : {}),
			...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
			...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
			...(patch.actionUrl !== undefined ? { actionUrl: patch.actionUrl } : {}),
			...(patch.actionLabel !== undefined ? { actionLabel: patch.actionLabel } : {}),
			customisedAt: now(),
			updatedAt: now(),
		})
		.where(eq(reminders.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That reminder no longer exists.");
	return toRecord(row, today);
}

/**
 * Ticks a reminder off.
 *
 * A one-off is finished. A recurring one rolls forward to its next occurrence
 * after today, so a quarterly reminder left for six months lands on the next
 * quarter rather than on the one that was missed. The occurrence that was due is
 * written to the completion log either way.
 */
export async function complete(
	id: string,
	options: { note?: string | null } = {},
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	const row = db
		.select()
		.from(reminders)
		.where(and(eq(reminders.id, id), isNull(reminders.deletedAt)))
		.get();
	if (!row) throw new Error("That reminder no longer exists.");

	const next = nextOccurrence(
		row.dueOn,
		{
			pattern: row.pattern as RecurrencePattern,
			interval: row.interval,
			anchorDay: row.anchorDay ?? undefined,
		},
		today,
	);

	db.insert(reminderCompletions)
		.values({
			reminderId: row.id,
			dueOn: row.dueOn,
			completedAt: now(),
			note: options.note ?? null,
		})
		.run();

	const [updated] = db
		.update(reminders)
		.set({
			lastCompletedOn: row.dueOn,
			// A recurring reminder is never "completed": it moves. Setting both would
			// hide it from every list that filters on completedAt.
			completedAt: next === null ? now() : null,
			dueOn: next ?? row.dueOn,
			snoozedUntil: null,
			updatedAt: now(),
		})
		.where(eq(reminders.id, id))
		.returning()
		.all();

	return toRecord(updated!, today);
}

/** Pushes a reminder out without pretending it is done. */
export async function snooze(
	id: string,
	until: string,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
		throw new Error("A snooze needs a date in YYYY-MM-DD form.");
	}
	if (compare(until, today) <= 0) throw new Error("A snooze has to end in the future.");

	const [row] = db
		.update(reminders)
		.set({ snoozedUntil: until, updatedAt: now() })
		.where(eq(reminders.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That reminder no longer exists.");
	return toRecord(row, today);
}

export async function reopen(
	id: string,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	const [row] = db
		.update(reminders)
		.set({ completedAt: null, snoozedUntil: null, updatedAt: now() })
		.where(eq(reminders.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That reminder no longer exists.");
	return toRecord(row, today);
}

export async function remove(
	id: string,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	const [row] = db
		.update(reminders)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(reminders.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That reminder no longer exists.");
	return toRecord(row, today);
}

export async function restore(
	id: string,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	const [row] = db
		.update(reminders)
		.set({ deletedAt: null, updatedAt: now() })
		.where(eq(reminders.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That reminder no longer exists.");
	return toRecord(row, today);
}

export async function history(reminderId: string, db: Db = getDb()) {
	return db
		.select()
		.from(reminderCompletions)
		.where(eq(reminderCompletions.reminderId, reminderId))
		.orderBy(asc(reminderCompletions.dueOn))
		.all();
}

/** Documents referenced by reminders, resolved for display. */
export async function documentTitle(id: string, db: Db = getDb()): Promise<string | null> {
	const row = db.select().from(documents).where(eq(documents.id, id)).get();
	return row?.title ?? null;
}
