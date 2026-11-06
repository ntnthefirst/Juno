/**
 * Time spent on projects, by a timer or typed in afterwards.
 *
 * One timer runs at a time. The rule is kept in two places on purpose: here,
 * so the message says which project it is running on, and in a partial unique
 * index, so two callers racing each other cannot both start one.
 *
 * Durations are whole minutes and are what gets added up. A finished timer is
 * rounded to the nearest minute with a floor of one, because a zero-minute row
 * reads as a mistake in a list of entries.
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type {
	RunningTimer,
	TimeEntry,
	TimeEntryInput,
	TimeEntryPatch,
	TimeTotals,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { projects, timeEntries } from "../db/schema";
import { requireProject } from "./projects";

/** A week. Longer than that is a typo for a number of minutes, not a sitting. */
const MAX_MINUTES = 7 * 24 * 60;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

type Listener = (running: RunningTimer | null) => void;
const listeners = new Set<Listener>();

/** Fires when a timer starts or stops, so the title bar follows an agent's call too. */
export function onTimerChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function announce(db: Db): void {
	if (listeners.size === 0) return;
	const current = running(db);
	for (const listener of listeners) {
		try {
			listener(current);
		} catch {
			// A listener that throws is not allowed to break a write.
		}
	}
}

function checkMinutes(value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error("A duration is a whole number of minutes. 1 h 30 is 90.");
	}
	if (value < 1) throw new Error("A time entry has to be at least one minute.");
	if (value > MAX_MINUTES) throw new Error("A single time entry cannot be longer than a week.");
	return value;
}

function checkInstant(value: string, field: string): string {
	if (!ISO.test(value) || Number.isNaN(Date.parse(value))) {
		throw new Error(`${field} must be a UTC time like 2026-03-14T09:05:00.000Z.`);
	}
	return new Date(value).toISOString();
}

function plusMinutes(iso: string, minutes: number): string {
	return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function cleanNote(note: string | null | undefined): string | null {
	const value = note?.trim();
	return value ? value : null;
}

function requireEntry(id: string, db: Db): TimeEntry {
	const row = db
		.select()
		.from(timeEntries)
		.where(and(eq(timeEntries.id, id), isNull(timeEntries.deletedAt)))
		.get();
	if (!row) throw new Error(`No time entry with id "${id}". It may have been deleted.`);
	return row as TimeEntry;
}

/** The timer that is running, or null. */
export function running(db: Db = getDb()): RunningTimer | null {
	const row = db
		.select({ entry: timeEntries, projectName: projects.name })
		.from(timeEntries)
		.innerJoin(projects, eq(projects.id, timeEntries.projectId))
		.where(and(isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)))
		.get();
	return row ? { entry: row.entry as TimeEntry, projectName: row.projectName } : null;
}

export async function start(
	projectId: string,
	note?: string | null,
	db: Db = getDb(),
): Promise<TimeEntry> {
	const project = requireProject(projectId, db);
	const active = running(db);
	if (active) {
		throw new Error(
			`A timer is already running on "${active.projectName}". Stop it before starting another.`,
		);
	}

	const stamp = now();
	const row = db
		.insert(timeEntries)
		.values({
			projectId,
			clientId: project.clientId,
			startedAt: stamp,
			note: cleanNote(note),
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get();
	announce(db);
	return row as TimeEntry;
}

/** Stops the running timer. Throws when there is none, so a stray click is told so. */
export async function stop(note?: string | null, db: Db = getDb()): Promise<TimeEntry> {
	const active = running(db);
	if (!active) throw new Error("No timer is running.");

	const stamp = now();
	const elapsed = Math.round((Date.parse(stamp) - Date.parse(active.entry.startedAt)) / 60_000);
	const minutes = Math.min(Math.max(elapsed, 1), MAX_MINUTES);
	const named = cleanNote(note);

	const row = db
		.update(timeEntries)
		.set({
			endedAt: stamp,
			durationMinutes: minutes,
			updatedAt: stamp,
			...(named ? { note: named } : {}),
		})
		.where(eq(timeEntries.id, active.entry.id))
		.returning()
		.get();
	announce(db);
	return row as TimeEntry;
}

export async function create(input: TimeEntryInput, db: Db = getDb()): Promise<TimeEntry> {
	const project = requireProject(input.projectId, db);
	const minutes = checkMinutes(input.durationMinutes);
	const startedAt = input.startedAt
		? checkInstant(input.startedAt, "startedAt")
		: plusMinutes(now(), -minutes);

	const stamp = now();
	return db
		.insert(timeEntries)
		.values({
			projectId: project.id,
			clientId: project.clientId,
			startedAt,
			endedAt: plusMinutes(startedAt, minutes),
			durationMinutes: minutes,
			note: cleanNote(input.note),
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get() as TimeEntry;
}

export async function update(
	id: string,
	patch: TimeEntryPatch,
	db: Db = getDb(),
): Promise<TimeEntry> {
	const existing = requireEntry(id, db);
	const finished = existing.endedAt !== null;
	const changesTime = patch.durationMinutes !== undefined || patch.startedAt !== undefined;
	if (!finished && changesTime) {
		throw new Error("This timer is still running. Stop it before changing its time.");
	}

	const values: Partial<typeof timeEntries.$inferInsert> = { updatedAt: now() };
	if (patch.note !== undefined) values.note = cleanNote(patch.note);

	if (changesTime) {
		const startedAt =
			patch.startedAt !== undefined ? checkInstant(patch.startedAt, "startedAt") : existing.startedAt;
		const minutes =
			patch.durationMinutes !== undefined
				? checkMinutes(patch.durationMinutes)
				: (existing.durationMinutes ?? 1);
		values.startedAt = startedAt;
		values.durationMinutes = minutes;
		values.endedAt = plusMinutes(startedAt, minutes);
	}

	return db
		.update(timeEntries)
		.set(values)
		.where(eq(timeEntries.id, id))
		.returning()
		.get() as TimeEntry;
}

/** Soft delete. Removing the running timer stops it counting and clears the title bar. */
export async function remove(id: string, db: Db = getDb()): Promise<TimeEntry> {
	requireEntry(id, db);
	const stamp = now();
	const row = db
		.update(timeEntries)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(timeEntries.id, id))
		.returning()
		.get();
	announce(db);
	return row as TimeEntry;
}

/** Newest first, the running timer included. */
export async function list(projectId: string, db: Db = getDb()): Promise<TimeEntry[]> {
	return db
		.select()
		.from(timeEntries)
		.where(and(eq(timeEntries.projectId, projectId), isNull(timeEntries.deletedAt)))
		.orderBy(desc(timeEntries.startedAt), desc(timeEntries.id))
		.all() as TimeEntry[];
}

export async function total(projectId: string, db: Db = getDb()): Promise<TimeTotals> {
	const project = requireProject(projectId, db);
	const row = db
		.select({
			minutes: sql<number>`coalesce(sum(${timeEntries.durationMinutes}), 0)`,
			entries: sql<number>`count(*)`,
		})
		.from(timeEntries)
		.where(
			and(
				eq(timeEntries.projectId, projectId),
				isNull(timeEntries.deletedAt),
				isNotNull(timeEntries.endedAt),
			),
		)
		.get();
	return {
		loggedMinutes: row?.minutes ?? 0,
		estimatedMinutes: project.estimatedMinutes ?? null,
		entryCount: row?.entries ?? 0,
	};
}
