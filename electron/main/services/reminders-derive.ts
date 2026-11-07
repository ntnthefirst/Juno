/**
 * Reminders Juno works out for itself from the state of the records, and the
 * seeding of the recurring paperwork.
 *
 * Suggestions are **not stored**. They are computed on every read and offered;
 * accepting one writes a real reminder. That way a suggestion disappears when
 * the situation that produced it changes, instead of leaving a stale row behind
 * that has to be cleaned up.
 *
 * Decision 9: no suggestion here offers to invoice, because Juno does not.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { clients, projects, reminders } from "../db/schema";
import { formatDate, todayIsoDate } from "./document-context";
import { SEED_REMINDERS, type SeedReminder } from "./reminders-seed";
import { addDays, compare, nextOccurrence } from "./recurrence";
import { create, type ReminderCategory, type ReminderRecord } from "./reminders";

export interface ReminderSuggestion {
	/** Stable, so accepting the same suggestion twice is detectable. */
	key: string;
	title: string;
	notes: string;
	category: ReminderCategory;
	dueOn: string;
	clientId: string | null;
	projectId: string | null;
	actionUrl: string | null;
	actionLabel: string | null;
}

/** Projects with a due date approaching and no reminder pointing at them. */
export async function deadlineSuggestions(
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderSuggestion[]> {
	const horizon = addDays(today, 21);

	const existing = new Set(
		db
			.select({ projectId: reminders.projectId })
			.from(reminders)
			.where(isNull(reminders.deletedAt))
			.all()
			.map((row) => row.projectId)
			.filter((id): id is string => id !== null),
	);

	return db
		.select({ project: projects, client: clients })
		.from(projects)
		// Left, not inner: a deadline on a project that is not for a client is
		// still a deadline, and it is often one of Juno's own.
		.leftJoin(clients, eq(projects.clientId, clients.id))
		// The client is either absent or alive. Dropping the second half would
		// bring back the projects of a client that was deleted.
		.where(and(isNull(projects.deletedAt), or(isNull(projects.clientId), isNull(clients.deletedAt))))
		.all()
		.filter((row) => {
			const due = row.project.dueOn;
			if (!due) return false;
			if (existing.has(row.project.id)) return false;
			// Inside the horizon, including already past.
			return compare(due, horizon) <= 0;
		})
		.map((row) => ({
			key: `deadline:${row.project.id}`,
			title: row.client
				? `${row.project.name} is due for ${row.client.name}`
				: `${row.project.name} is due`,
			notes: `The project's due date is ${formatDate(row.project.dueOn)}.`,
			category: "other" as const,
			dueOn: row.project.dueOn!,
			clientId: row.client?.id ?? null,
			projectId: row.project.id,
			actionUrl: null,
			actionLabel: null,
		}));
}

export async function suggestions(
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderSuggestion[]> {
	return (await deadlineSuggestions(db, today)).sort((a, b) => compare(a.dueOn, b.dueOn));
}

/**
 * Turns one suggestion into a real reminder, found by its key. Looked up again
 * here rather than trusted from the caller, so the reminder is the one the
 * records produce now, and a suggestion that has since gone away is refused.
 */
export async function accept(
	key: string,
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderRecord> {
	const found = (await suggestions(db, today)).find((s) => s.key === key);
	if (!found) {
		throw new Error("That suggestion is gone, because the record behind it changed. List the suggestions again.");
	}
	return create(
		{
			title: found.title,
			dueOn: found.dueOn,
			notes: found.notes,
			category: found.category,
			clientId: found.clientId,
			projectId: found.projectId,
			actionUrl: found.actionUrl,
			actionLabel: found.actionLabel,
		},
		db,
		today,
	);
}

/**
 * Seeds the recurring paperwork.
 *
 * Idempotent, and it never touches a row the owner has edited or hidden. The
 * first occurrence is moved forward to the next one that has not already passed,
 * so a fresh install in November does not open with four overdue reminders from
 * earlier in the year.
 */
export async function ensureRemindersSeeded(
	db: Db = getDb(),
	today: string = todayIsoDate(),
	source: SeedReminder[] = SEED_REMINDERS,
): Promise<{ created: number }> {
	let created = 0;
	const year = Number(today.slice(0, 4));

	for (const seed of source) {
		const existing = db
			.select()
			.from(reminders)
			.where(eq(reminders.seedKey, seed.seedKey))
			.get();
		if (existing) continue;

		const first = `${year}-${String(seed.firstMonth).padStart(2, "0")}-${String(seed.firstDay).padStart(2, "0")}`;
		const dueOn =
			compare(first, today) >= 0
				? first
				: (nextOccurrence(
						first,
						{ pattern: seed.pattern, interval: seed.interval, anchorDay: seed.anchorDay },
						today,
					) ?? first);

		db.insert(reminders)
			.values({
				seedKey: seed.seedKey,
				isSystem: true,
				title: seed.title,
				notes: seed.notes,
				dueOn,
				pattern: seed.pattern,
				interval: seed.interval,
				anchorDay: seed.anchorDay ?? null,
				leadDays: seed.leadDays,
				category: seed.category,
			})
			.run();
		created++;
	}

	return { created };
}
