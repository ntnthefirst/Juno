/**
 * The calendar. Events, series and their exceptions, the range query the grid
 * is drawn from, and the .ics boundary.
 *
 * Every rule about an event lives here. The three pure modules beside it do
 * the parts that are easy to get subtly wrong and therefore have to be tested
 * on their own: ./calendar-time.ts turns a wall clock in a zone into an
 * instant, ./calendar-recurrence.ts expands a rule, ./calendar-ics.ts reads and
 * writes files.
 *
 * Editing a series is where the shape matters. An edit or a removal names a
 * scope: `this` occurrence, this and `following`, or `all`. "This" writes an
 * exception row; "following" splits the series in two; "all" changes the
 * master and carries the exceptions along. The same three functions serve the
 * window and the agent, so the question is asked in the interface and
 * answered in the arguments, never guessed here.
 */
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
	CalendarDeadlineItem,
	CalendarEditTarget,
	CalendarEvent,
	CalendarEventInput,
	CalendarEventPatch,
	CalendarException,
	CalendarImportResult,
	CalendarItem,
	CalendarRangeQuery,
	CalendarReminderItem,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import { calendarEventExceptions, calendarEvents, clients, projects } from "../db/schema";
import { buildIcs, parseIcs, type IcsEvent } from "./calendar-ics";
import {
	describeRule,
	expandSeries,
	isOccurrenceOf,
	normaliseRule,
	occurrencesBefore,
	retargetRule,
	ruleContinuingFrom,
	ruleEndingBefore,
	seriesEndUtc,
	type SeriesShape,
} from "./calendar-recurrence";
import {
	addLocalDays,
	addLocalMinutes,
	isLocalDate,
	isLocalDateTime,
	isValidTimeZone,
	localDateStartUtc,
	localMinutesBetween,
	localToUtc,
	parseLocal,
	formatLocal,
	systemTimeZone,
} from "./calendar-time";
import { requireClient } from "./clients";
import { todayIsoDate } from "./document-context";
import * as reminders from "./reminders";

type EventRow = typeof calendarEvents.$inferSelect;
type ExceptionRow = typeof calendarEventExceptions.$inferSelect;

/** Bound on what one range query returns, so a year of a daily series cannot swamp a caller. */
const MAX_ITEMS = 5000;

/* ----------------------------------------------------------------- shape */

function toException(row: ExceptionRow): CalendarException {
	return {
		id: row.id,
		eventId: row.eventId,
		occurrenceStartLocal: row.occurrenceStartLocal,
		cancelled: row.cancelled,
		title: row.title,
		notes: row.notes,
		location: row.location,
		startLocal: row.startLocal,
		endLocal: row.endLocal,
	};
}

function toRecord(
	row: EventRow,
	exceptions: ExceptionRow[],
	names: { clientName?: string | null; projectName?: string | null } = {},
): CalendarEvent {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		title: row.title,
		notes: row.notes,
		location: row.location,
		allDay: row.allDay,
		startLocal: row.startLocal,
		endLocal: row.endLocal,
		timezone: row.timezone,
		rrule: row.rrule,
		recurrenceLabel: describeRule(row.rrule),
		startUtc: row.startUtc,
		endUtc: row.endUtc,
		seriesEndUtc: row.seriesEndUtc,
		icalUid: row.icalUid,
		clientId: row.clientId,
		clientName: names.clientName ?? null,
		projectId: row.projectId,
		projectName: names.projectName ?? null,
		exceptions: exceptions.map(toException),
	};
}

function shapeOf(row: Pick<EventRow, "startLocal" | "endLocal" | "allDay" | "timezone" | "rrule">): SeriesShape {
	return {
		startLocal: row.startLocal,
		endLocal: row.endLocal,
		allDay: row.allDay,
		timezone: row.timezone,
		rrule: row.rrule,
	};
}

function instantOf(shape: Pick<SeriesShape, "allDay" | "timezone">, local: string): string {
	return shape.allDay ? localDateStartUtc(local, shape.timezone) : localToUtc(local, shape.timezone);
}

/** Wall-clock length of the master's occurrences. Minutes when timed, days when all-day. */
function durationOf(shape: Pick<SeriesShape, "startLocal" | "endLocal" | "allDay">): number {
	const minutes = localMinutesBetween(shape.startLocal, shape.endLocal);
	return shape.allDay ? Math.max(1, Math.round(minutes / 1440)) : Math.max(0, minutes);
}

function endAfter(shape: Pick<SeriesShape, "allDay">, start: string, duration: number): string {
	return shape.allDay ? addLocalDays(start, duration) : addLocalMinutes(start, duration);
}

/* ------------------------------------------------------------ validation */

/** Accepts `YYYY-MM-DDTHH:MM` as well, and always stores seconds. */
function normaliseDateTime(value: string, field: string): string {
	const trimmed = value.trim();
	if (isLocalDate(trimmed)) {
		throw new Error(`${field} needs a time as well as a date, like 2026-03-14T10:00. Use allDay for a date on its own.`);
	}
	if (!isLocalDateTime(trimmed)) {
		throw new Error(`${field} must be a local date and time like 2026-03-14T10:00, with no zone suffix.`);
	}
	return formatLocal(parseLocal(trimmed));
}

function normaliseDate(value: string, field: string): string {
	const trimmed = value.trim().slice(0, 10);
	if (!isLocalDate(trimmed)) {
		throw new Error(`${field} must be a calendar date like 2026-03-14 for an all-day event.`);
	}
	return trimmed;
}

interface Normalised {
	title: string;
	notes: string | null;
	location: string | null;
	allDay: boolean;
	startLocal: string;
	endLocal: string;
	timezone: string;
	rrule: string | null;
	clientId: string | null;
	projectId: string | null;
}

/**
 * Turns an input, or an existing row with a patch over it, into a row's worth
 * of checked values. The same function serves create and update so the two
 * cannot disagree about what is valid.
 */
function normalise(base: Normalised | null, input: CalendarEventInput | CalendarEventPatch, db: Db): Normalised {
	const title = (input.title ?? base?.title ?? "").trim();
	if (!title) throw new Error("An event needs a title.");

	const allDay = input.allDay ?? base?.allDay ?? false;
	const timezone = input.timezone ?? base?.timezone ?? systemTimeZone();
	if (!isValidTimeZone(timezone)) {
		throw new Error(`"${timezone}" is not a time zone Juno knows. Use an IANA name like Europe/Brussels.`);
	}

	const rawStart = input.startLocal ?? base?.startLocal;
	if (!rawStart) throw new Error("An event needs a start.");
	const startLocal = allDay ? normaliseDate(rawStart, "startLocal") : normaliseDateTime(rawStart, "startLocal");

	let endLocal: string;
	if (input.endLocal !== undefined) {
		endLocal = allDay ? normaliseDate(input.endLocal, "endLocal") : normaliseDateTime(input.endLocal, "endLocal");
	} else if (base && base.allDay === allDay) {
		// A start moved without an end keeps the length.
		endLocal = input.startLocal !== undefined ? endAfter({ allDay }, startLocal, durationOf(base)) : base.endLocal;
	} else {
		// New, or the all-day setting flipped: a date cannot end at 10:30 and a
		// time cannot end "tomorrow", so the end is derived afresh.
		endLocal = allDay ? addLocalDays(startLocal, 1) : addLocalMinutes(startLocal, 60);
	}
	if (allDay && endLocal <= startLocal) {
		throw new Error("An all-day event ends on the day after its last day, so the end has to be later than the start.");
	}
	if (!allDay && endLocal < startLocal) throw new Error("An event cannot end before it starts.");

	const rawRule = input.rrule !== undefined ? input.rrule : (base?.rrule ?? null);
	const rrule = rawRule && rawRule.trim() ? normaliseRule(rawRule) : null;

	let clientId = input.clientId !== undefined ? input.clientId : (base?.clientId ?? null);
	const projectId = input.projectId !== undefined ? input.projectId : (base?.projectId ?? null);
	if (projectId) {
		const project = db
			.select({ id: projects.id, clientId: projects.clientId })
			.from(projects)
			.where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
			.get();
		if (!project) throw new Error(`No project with id "${projectId}". It does not exist or it was deleted.`);
		if (clientId && clientId !== project.clientId) {
			throw new Error("That project belongs to a different client. Pick the project's own client, or leave the client out.");
		}
		clientId = project.clientId;
	}
	if (clientId) requireClient(clientId, db);

	const notes = input.notes !== undefined ? input.notes : (base?.notes ?? null);
	const location = input.location !== undefined ? input.location : (base?.location ?? null);

	return {
		title,
		notes: notes && notes.trim() ? notes.trim() : null,
		location: location && location.trim() ? location.trim() : null,
		allDay,
		startLocal,
		endLocal,
		timezone,
		rrule,
		clientId,
		projectId,
	};
}

function derived(values: Normalised): { startUtc: string; endUtc: string; seriesEndUtc: string | null } {
	return {
		startUtc: instantOf(values, values.startLocal),
		endUtc: instantOf(values, values.endLocal),
		seriesEndUtc: seriesEndUtc(values),
	};
}

/* ----------------------------------------------------------------- reads */

function requireEvent(id: string, db: Db): EventRow {
	const row = db
		.select()
		.from(calendarEvents)
		.where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt)))
		.get();
	if (!row) throw new Error(`No event with id "${id}". It does not exist or it was deleted.`);
	return row;
}

function exceptionsFor(eventIds: string[], db: Db): Map<string, ExceptionRow[]> {
	const out = new Map<string, ExceptionRow[]>();
	if (eventIds.length === 0) return out;
	const rows = db
		.select()
		.from(calendarEventExceptions)
		.where(and(inArray(calendarEventExceptions.eventId, eventIds), isNull(calendarEventExceptions.deletedAt)))
		.orderBy(asc(calendarEventExceptions.occurrenceStartLocal))
		.all();
	for (const row of rows) {
		const list = out.get(row.eventId) ?? [];
		list.push(row);
		out.set(row.eventId, list);
	}
	return out;
}

function namesFor(eventIds: string[], db: Db): Map<string, { clientName: string | null; projectName: string | null }> {
	const out = new Map<string, { clientName: string | null; projectName: string | null }>();
	if (eventIds.length === 0) return out;
	const rows = db
		.select({ id: calendarEvents.id, clientName: clients.name, projectName: projects.name })
		.from(calendarEvents)
		.leftJoin(clients, eq(calendarEvents.clientId, clients.id))
		.leftJoin(projects, eq(calendarEvents.projectId, projects.id))
		.where(inArray(calendarEvents.id, eventIds))
		.all();
	for (const row of rows) out.set(row.id, { clientName: row.clientName, projectName: row.projectName });
	return out;
}

export async function get(id: string, db: Db = getDb()): Promise<CalendarEvent | null> {
	const row = db
		.select()
		.from(calendarEvents)
		.where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt)))
		.get();
	if (!row) return null;
	const names = namesFor([row.id], db).get(row.id);
	return toRecord(row, exceptionsFor([row.id], db).get(row.id) ?? [], names);
}

/** Masters that can have an occurrence inside `[fromUtc, toUtc)`. */
function mastersInRange(
	fromUtc: string,
	toUtc: string,
	filter: { clientId?: string; projectId?: string },
	db: Db,
): EventRow[] {
	const conditions = [
		isNull(calendarEvents.deletedAt),
		lt(calendarEvents.startUtc, toUtc),
		or(isNull(calendarEvents.seriesEndUtc), gt(calendarEvents.seriesEndUtc, fromUtc)),
	];
	if (filter.clientId) conditions.push(eq(calendarEvents.clientId, filter.clientId));
	if (filter.projectId) conditions.push(eq(calendarEvents.projectId, filter.projectId));
	return db
		.select()
		.from(calendarEvents)
		.where(and(...conditions))
		.orderBy(asc(calendarEvents.startUtc))
		.all();
}

function rangeBounds(query: CalendarRangeQuery): { zone: string; fromUtc: string; toUtc: string } {
	const zone = query.timezone ?? systemTimeZone();
	if (!isValidTimeZone(zone)) throw new Error(`"${zone}" is not a time zone Juno knows.`);
	if (!isLocalDate(query.from) || !isLocalDate(query.to)) {
		throw new Error("A range needs from and to as calendar dates like 2026-03-01.");
	}
	if (query.to < query.from) throw new Error("The range ends before it starts.");
	if (localMinutesBetween(query.from, query.to) > 400 * 1440) {
		throw new Error("A range can cover at most 400 days. Ask for less at a time.");
	}
	return {
		zone,
		fromUtc: localDateStartUtc(query.from, zone),
		toUtc: localDateStartUtc(addLocalDays(query.to, 1), zone),
	};
}

/**
 * Everything on the grid between two dates: every occurrence of every event,
 * plus open reminders and project deadlines as read-only overlays.
 */
export async function listRange(
	query: CalendarRangeQuery,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<CalendarItem[]> {
	const { zone, fromUtc, toUtc } = rangeBounds(query);
	const masters = mastersInRange(fromUtc, toUtc, query, db);
	const ids = masters.map((m) => m.id);
	const exceptions = exceptionsFor(ids, db);
	const names = namesFor(ids, db);

	const items: (CalendarItem & { sortKey: string })[] = [];

	for (const master of masters) {
		const shape = shapeOf(master);
		const own = names.get(master.id);
		const base = {
			kind: "event" as const,
			eventId: master.id,
			allDay: master.allDay,
			timezone: master.timezone,
			isRecurring: master.rrule !== null,
			rrule: master.rrule,
			recurrenceLabel: describeRule(master.rrule),
			clientId: master.clientId,
			clientName: own?.clientName ?? null,
			projectId: master.projectId,
			projectName: own?.projectName ?? null,
		};
		if (!master.rrule) {
			if (master.startUtc < toUtc && master.endUtc > fromUtc) {
				items.push({
					...base,
					occurrenceStartLocal: master.startLocal,
					title: master.title,
					notes: master.notes,
					location: master.location,
					startLocal: master.startLocal,
					endLocal: master.endLocal,
					startUtc: master.startUtc,
					endUtc: master.endUtc,
					isException: false,
					sortKey: master.startUtc,
				});
			}
			continue;
		}
		for (const occurrence of expandSeries(shape, exceptions.get(master.id) ?? [], fromUtc, toUtc)) {
			items.push({
				...base,
				occurrenceStartLocal: occurrence.occurrenceStartLocal,
				title: occurrence.title ?? master.title,
				notes: occurrence.notes ?? master.notes,
				location: occurrence.location ?? master.location,
				startLocal: occurrence.startLocal,
				endLocal: occurrence.endLocal,
				startUtc: occurrence.startUtc,
				endUtc: occurrence.endUtc,
				isException: occurrence.isException,
				sortKey: occurrence.startUtc,
			});
		}
	}

	if (query.includeReminders) {
		for (const reminder of await reminders.list({}, db, today)) {
			if (reminder.dueOn < query.from || reminder.dueOn > query.to) continue;
			if (query.clientId && reminder.clientId !== query.clientId) continue;
			if (query.projectId && reminder.projectId !== query.projectId) continue;
			const item: CalendarReminderItem = {
				kind: "reminder",
				reminderId: reminder.id,
				title: reminder.title,
				dueOn: reminder.dueOn,
				bucket: reminder.bucket,
				category: reminder.category,
				clientName: reminder.clientName,
			};
			items.push({ ...item, sortKey: localDateStartUtc(reminder.dueOn, zone) });
		}
	}

	if (query.includeDeadlines) {
		const conditions = [
			isNull(projects.deletedAt),
			isNull(clients.deletedAt),
			sql`${projects.dueOn} >= ${query.from}`,
			sql`${projects.dueOn} <= ${query.to}`,
		];
		if (query.clientId) conditions.push(eq(projects.clientId, query.clientId));
		if (query.projectId) conditions.push(eq(projects.id, query.projectId));
		const rows = db
			.select({
				projectId: projects.id,
				projectName: projects.name,
				clientId: clients.id,
				clientName: clients.name,
				dueOn: projects.dueOn,
			})
			.from(projects)
			// Left, not inner: a project with no client still has a due date, and
			// an inner join is how it would quietly stop appearing on the calendar.
			.leftJoin(clients, eq(projects.clientId, clients.id))
			.where(and(...conditions))
			.all();
		for (const row of rows) {
			if (!row.dueOn) continue;
			const item: CalendarDeadlineItem = {
				kind: "deadline",
				projectId: row.projectId,
				projectName: row.projectName,
				clientId: row.clientId,
				clientName: row.clientName,
				dueOn: row.dueOn,
			};
			items.push({ ...item, sortKey: localDateStartUtc(row.dueOn, zone) });
		}
	}

	items.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
	return items.slice(0, MAX_ITEMS).map((item) => {
		const rest: CalendarItem & { sortKey?: string } = { ...item };
		delete rest.sortKey;
		return rest;
	});
}

/* ---------------------------------------------------------------- writes */

export async function create(input: CalendarEventInput, db: Db = getDb()): Promise<CalendarEvent> {
	const values = normalise(null, input, db);
	const id = uuidv7();
	const [row] = db
		.insert(calendarEvents)
		.values({
			id,
			...values,
			...derived(values),
			icalUid: `${id}@juno`,
		})
		.returning()
		.all();
	return (await get(row!.id, db))!;
}

/**
 * Shifts an exception's key and, when it carries one, its own start and end,
 * by the wall-clock delta the master moved by. A moved occurrence moves with
 * its series; a cancelled one stays cancelled on the corresponding day.
 */
function shiftExceptions(
	eventId: string,
	master: Pick<SeriesShape, "allDay">,
	deltaMinutes: number,
	db: Db,
): void {
	if (deltaMinutes === 0) return;
	const rows = db
		.select()
		.from(calendarEventExceptions)
		.where(and(eq(calendarEventExceptions.eventId, eventId), isNull(calendarEventExceptions.deletedAt)))
		.all();
	const shift = (local: string | null) =>
		local === null
			? null
			: master.allDay
				? addLocalDays(local, Math.round(deltaMinutes / 1440))
				: addLocalMinutes(local, deltaMinutes);
	for (const row of rows) {
		db.update(calendarEventExceptions)
			.set({
				occurrenceStartLocal: shift(row.occurrenceStartLocal)!,
				startLocal: shift(row.startLocal),
				endLocal: shift(row.endLocal),
				updatedAt: now(),
			})
			.where(eq(calendarEventExceptions.id, row.id))
			.run();
	}
}

function dropExceptions(eventId: string, db: Db, fromKey?: string): void {
	const conditions = [eq(calendarEventExceptions.eventId, eventId), isNull(calendarEventExceptions.deletedAt)];
	if (fromKey) conditions.push(sql`${calendarEventExceptions.occurrenceStartLocal} >= ${fromKey}`);
	db.update(calendarEventExceptions)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(and(...conditions))
		.run();
}

function requireOccurrence(master: EventRow, target: CalendarEditTarget, db: Db): string {
	const key = target.occurrenceStartLocal;
	if (!key) {
		throw new Error(`Editing ${target.scope === "this" ? "one occurrence" : "this and following occurrences"} needs occurrenceStartLocal, the occurrence being edited.`);
	}
	const existing = db
		.select({ id: calendarEventExceptions.id })
		.from(calendarEventExceptions)
		.where(
			and(
				eq(calendarEventExceptions.eventId, master.id),
				eq(calendarEventExceptions.occurrenceStartLocal, key),
				isNull(calendarEventExceptions.deletedAt),
			),
		)
		.get();
	if (!existing && !isOccurrenceOf(shapeOf(master), key)) {
		throw new Error(`${key} is not an occurrence of this event. Use the occurrenceStartLocal a range query returned.`);
	}
	return key;
}

function updateAll(master: EventRow, patch: CalendarEventPatch, db: Db): CalendarEvent {
	const base: Normalised = {
		title: master.title,
		notes: master.notes,
		location: master.location,
		allDay: master.allDay,
		startLocal: master.startLocal,
		endLocal: master.endLocal,
		timezone: master.timezone,
		rrule: master.rrule,
		clientId: master.clientId,
		projectId: master.projectId,
	};
	const values = normalise(base, patch, db);
	if (values.rrule && patch.rrule === undefined && values.startLocal !== master.startLocal) {
		values.rrule = retargetRule(values.rrule, master.startLocal, values.startLocal);
	}

	db.transaction(() => {
		if (master.rrule && (!values.rrule || values.allDay !== master.allDay)) {
			// The keys no longer mean anything: the series is gone, or its
			// occurrences changed kind.
			dropExceptions(master.id, db);
		} else if (master.rrule && values.startLocal !== master.startLocal) {
			shiftExceptions(master.id, values, localMinutesBetween(master.startLocal, values.startLocal), db);
		}
		db.update(calendarEvents)
			.set({ ...values, ...derived(values), updatedAt: now() })
			.where(eq(calendarEvents.id, master.id))
			.run();
	});
	return getSync(master.id, db);
}

function getSync(id: string, db: Db): CalendarEvent {
	const row = requireEvent(id, db);
	const names = namesFor([id], db).get(id);
	return toRecord(row, exceptionsFor([id], db).get(id) ?? [], names);
}

const SERIES_ONLY: (keyof CalendarEventPatch)[] = ["rrule", "timezone", "allDay", "clientId", "projectId"];

function updateThis(master: EventRow, patch: CalendarEventPatch, target: CalendarEditTarget, db: Db): CalendarEvent {
	for (const field of SERIES_ONLY) {
		if (patch[field] !== undefined && patch[field] !== master[field]) {
			throw new Error(`${field} applies to the whole series. Edit with scope "all" to change it.`);
		}
	}
	const key = requireOccurrence(master, target, db);
	const shape = shapeOf(master);
	const existing = db
		.select()
		.from(calendarEventExceptions)
		.where(
			and(
				eq(calendarEventExceptions.eventId, master.id),
				eq(calendarEventExceptions.occurrenceStartLocal, key),
				isNull(calendarEventExceptions.deletedAt),
			),
		)
		.get();

	const currentStart = existing?.startLocal ?? key;
	const currentEnd = existing?.endLocal ?? endAfter(shape, currentStart, durationOf(shape));
	const normaliseOne = (value: string, field: string) =>
		master.allDay ? normaliseDate(value, field) : normaliseDateTime(value, field);

	const startLocal = patch.startLocal !== undefined ? normaliseOne(patch.startLocal, "startLocal") : currentStart;
	let endLocal: string;
	if (patch.endLocal !== undefined) {
		endLocal = normaliseOne(patch.endLocal, "endLocal");
	} else if (patch.startLocal !== undefined) {
		// Moved without an end: keep the occurrence's length.
		endLocal = endAfter(shape, startLocal, master.allDay
			? Math.max(1, Math.round(localMinutesBetween(currentStart, currentEnd) / 1440))
			: localMinutesBetween(currentStart, currentEnd));
	} else {
		endLocal = currentEnd;
	}
	if (master.allDay && endLocal <= startLocal) throw new Error("An all-day event has to end after it starts.");
	if (!master.allDay && endLocal < startLocal) throw new Error("An event cannot end before it starts.");
	if (patch.title !== undefined && !patch.title.trim()) throw new Error("An event needs a title.");

	// Only what differs from the master is stored, so a later edit of the
	// series still reaches this occurrence's untouched fields.
	const title = patch.title !== undefined ? (patch.title.trim() === master.title ? null : patch.title.trim()) : (existing?.title ?? null);
	const notes = patch.notes !== undefined ? (patch.notes === master.notes ? null : patch.notes) : (existing?.notes ?? null);
	const location = patch.location !== undefined ? (patch.location === master.location ? null : patch.location) : (existing?.location ?? null);
	// Back on its own slot means storing nothing for the times.
	const sameTimes = startLocal === key && endLocal === endAfter(shape, key, durationOf(shape));

	if (existing) {
		db.update(calendarEventExceptions)
			.set({
				cancelled: false,
				title,
				notes,
				location,
				startLocal: sameTimes ? null : startLocal,
				endLocal: sameTimes ? null : endLocal,
				updatedAt: now(),
			})
			.where(eq(calendarEventExceptions.id, existing.id))
			.run();
	} else {
		db.insert(calendarEventExceptions)
			.values({
				eventId: master.id,
				occurrenceStartLocal: key,
				cancelled: false,
				title,
				notes,
				location,
				startLocal: sameTimes ? null : startLocal,
				endLocal: sameTimes ? null : endLocal,
			})
			.run();
	}
	db.update(calendarEvents).set({ updatedAt: now() }).where(eq(calendarEvents.id, master.id)).run();
	return getSync(master.id, db);
}

function updateFollowing(master: EventRow, patch: CalendarEventPatch, target: CalendarEditTarget, db: Db): CalendarEvent {
	const key = requireOccurrence(master, target, db);
	if (key === master.startLocal) return updateAll(master, patch, db);

	const shape = shapeOf(master);
	const duration = durationOf(shape);
	const base: Normalised = {
		title: master.title,
		notes: master.notes,
		location: master.location,
		allDay: master.allDay,
		startLocal: key,
		endLocal: endAfter(shape, key, duration),
		timezone: master.timezone,
		rrule: patch.rrule !== undefined ? patch.rrule : ruleContinuingFrom(master.rrule!, occurrencesBefore(shape, key)),
		clientId: master.clientId,
		projectId: master.projectId,
	};
	const values = normalise(base, patch, db);
	if (values.rrule && patch.rrule === undefined && values.startLocal !== key) {
		values.rrule = retargetRule(values.rrule, key, values.startLocal);
	}
	const newId = uuidv7();

	db.transaction(() => {
		const truncated = { ...shape, rrule: ruleEndingBefore(master.rrule!, key) };
		db.update(calendarEvents)
			.set({ rrule: truncated.rrule, seriesEndUtc: seriesEndUtc(truncated), updatedAt: now() })
			.where(eq(calendarEvents.id, master.id))
			.run();

		db.insert(calendarEvents)
			.values({ id: newId, ...values, ...derived(values), icalUid: `${newId}@juno` })
			.run();

		// Exceptions from the split onwards belong to the new series, shifted
		// by however far its first occurrence moved.
		const moving = db
			.select({ id: calendarEventExceptions.id })
			.from(calendarEventExceptions)
			.where(
				and(
					eq(calendarEventExceptions.eventId, master.id),
					isNull(calendarEventExceptions.deletedAt),
					sql`${calendarEventExceptions.occurrenceStartLocal} >= ${key}`,
				),
			)
			.all();
		if (moving.length > 0) {
			db.update(calendarEventExceptions)
				.set({ eventId: newId, updatedAt: now() })
				.where(inArray(calendarEventExceptions.id, moving.map((m) => m.id)))
				.run();
			if (!values.rrule || values.allDay !== master.allDay) dropExceptions(newId, db);
			else shiftExceptions(newId, values, localMinutesBetween(key, values.startLocal), db);
		}
	});
	return getSync(newId, db);
}

/**
 * Edits an event. A single event ignores the scope. A series needs one, and
 * for `this` and `following` the occurrence being looked at.
 *
 * Returns the event that now holds the edited occurrences: the master for
 * `this` and `all`, and the new series for `following`.
 */
export async function update(
	id: string,
	patch: CalendarEventPatch,
	target: CalendarEditTarget = { scope: "all" },
	db: Db = getDb(),
): Promise<CalendarEvent> {
	const master = requireEvent(id, db);
	if (!master.rrule) return updateAll(master, patch, db);
	switch (target.scope) {
		case "all":
			return updateAll(master, patch, db);
		case "this":
			return updateThis(master, patch, target, db);
		case "following":
			return updateFollowing(master, patch, target, db);
		default:
			throw new Error(`Scope has to be this, following or all, not "${String(target.scope)}".`);
	}
}

/**
 * Removes an event, or part of a series. `this` cancels one occurrence,
 * `following` ends the series before it, `all` soft-deletes the master.
 * Returns the master as it now is; a soft-deleted one can be restored.
 */
export async function remove(
	id: string,
	target: CalendarEditTarget = { scope: "all" },
	db: Db = getDb(),
): Promise<CalendarEvent> {
	const master = requireEvent(id, db);
	const scope = master.rrule ? target.scope : "all";

	if (scope === "all" || (scope === "following" && target.occurrenceStartLocal === master.startLocal)) {
		db.update(calendarEvents)
			.set({ deletedAt: now(), updatedAt: now() })
			.where(eq(calendarEvents.id, master.id))
			.run();
		const row = db.select().from(calendarEvents).where(eq(calendarEvents.id, master.id)).get()!;
		return toRecord(row, exceptionsFor([master.id], db).get(master.id) ?? [], namesFor([master.id], db).get(master.id));
	}

	const key = requireOccurrence(master, target, db);
	if (scope === "this") {
		const existing = db
			.select({ id: calendarEventExceptions.id })
			.from(calendarEventExceptions)
			.where(
				and(
					eq(calendarEventExceptions.eventId, master.id),
					eq(calendarEventExceptions.occurrenceStartLocal, key),
					isNull(calendarEventExceptions.deletedAt),
				),
			)
			.get();
		if (existing) {
			db.update(calendarEventExceptions)
				.set({ cancelled: true, title: null, notes: null, location: null, startLocal: null, endLocal: null, updatedAt: now() })
				.where(eq(calendarEventExceptions.id, existing.id))
				.run();
		} else {
			db.insert(calendarEventExceptions)
				.values({ eventId: master.id, occurrenceStartLocal: key, cancelled: true })
				.run();
		}
		db.update(calendarEvents).set({ updatedAt: now() }).where(eq(calendarEvents.id, master.id)).run();
		return getSync(master.id, db);
	}

	if (scope === "following") {
		db.transaction(() => {
			const truncated = { ...shapeOf(master), rrule: ruleEndingBefore(master.rrule!, key) };
			db.update(calendarEvents)
				.set({ rrule: truncated.rrule, seriesEndUtc: seriesEndUtc(truncated), updatedAt: now() })
				.where(eq(calendarEvents.id, master.id))
				.run();
			dropExceptions(master.id, db, key);
		});
		return getSync(master.id, db);
	}

	throw new Error(`Scope has to be this, following or all, not "${String(scope)}".`);
}

export async function restore(id: string, db: Db = getDb()): Promise<CalendarEvent> {
	const [row] = db
		.update(calendarEvents)
		.set({ deletedAt: null, updatedAt: now() })
		.where(eq(calendarEvents.id, id))
		.returning()
		.all();
	if (!row) throw new Error(`No event with id "${id}".`);
	return getSync(id, db);
}

/* ------------------------------------------------------------------- ics */

function toIcs(row: EventRow, exceptions: ExceptionRow[]): IcsEvent {
	return {
		icalUid: row.icalUid,
		title: row.title,
		notes: row.notes,
		location: row.location,
		allDay: row.allDay,
		startLocal: row.startLocal,
		endLocal: row.endLocal,
		timezone: row.timezone,
		rrule: row.rrule,
		exceptions: exceptions.map((e) => ({
			occurrenceStartLocal: e.occurrenceStartLocal,
			cancelled: e.cancelled,
			title: e.title,
			notes: e.notes,
			location: e.location,
			startLocal: e.startLocal,
			endLocal: e.endLocal,
		})),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Every event with an occurrence in the range, as an .ics text. A series is
 * written whole, with its rule, so the reader expands it the same way.
 */
export async function exportIcs(query: CalendarRangeQuery, db: Db = getDb()): Promise<string> {
	const { fromUtc, toUtc } = rangeBounds(query);
	const masters = mastersInRange(fromUtc, toUtc, query, db);
	const exceptions = exceptionsFor(masters.map((m) => m.id), db);
	return buildIcs(masters.map((m) => toIcs(m, exceptions.get(m.id) ?? [])));
}

/**
 * Reads an .ics text into the calendar. An event whose UID is already here is
 * updated in place, so importing the same file twice changes nothing.
 */
export async function importIcs(
	source: string,
	db: Db = getDb(),
	defaultZone: string = systemTimeZone(),
): Promise<CalendarImportResult> {
	const parsed = parseIcs(source, defaultZone);
	const result: CalendarImportResult = { created: 0, updated: 0, skipped: 0, warnings: [...parsed.warnings] };

	db.transaction(() => {
		for (const event of parsed.events) {
			let values: Normalised;
			try {
				values = normalise(
					null,
					{
						title: event.title,
						notes: event.notes,
						location: event.location,
						allDay: event.allDay,
						startLocal: event.startLocal,
						endLocal: event.endLocal,
						timezone: event.timezone,
						rrule: event.rrule,
					},
					db,
				);
			} catch (cause: unknown) {
				result.skipped += 1;
				result.warnings.push(`${event.title}: ${cause instanceof Error ? cause.message : String(cause)}`);
				continue;
			}

			const existing = db
				.select({ id: calendarEvents.id })
				.from(calendarEvents)
				.where(and(eq(calendarEvents.icalUid, event.icalUid), isNull(calendarEvents.deletedAt)))
				.get();

			let eventId: string;
			if (existing) {
				eventId = existing.id;
				db.update(calendarEvents)
					.set({ ...values, ...derived(values), updatedAt: now() })
					.where(eq(calendarEvents.id, eventId))
					.run();
				dropExceptions(eventId, db);
				result.updated += 1;
			} else {
				eventId = uuidv7();
				db.insert(calendarEvents)
					.values({ id: eventId, ...values, ...derived(values), icalUid: event.icalUid })
					.run();
				result.created += 1;
			}

			if (!values.rrule) continue;
			for (const exception of event.exceptions) {
				db.insert(calendarEventExceptions)
					.values({
						eventId,
						occurrenceStartLocal: exception.occurrenceStartLocal,
						cancelled: exception.cancelled,
						title: exception.title,
						notes: exception.notes,
						location: exception.location,
						startLocal: exception.startLocal,
						endLocal: exception.endLocal,
					})
					.run();
			}
		}
	});

	return result;
}
