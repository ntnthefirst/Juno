/**
 * Reminders Juno works out for itself from the state of the records, and the
 * seeding of the recurring paperwork.
 *
 * Suggestions are **not stored**. They are computed on every read and offered;
 * accepting one writes a real reminder. That way a suggestion disappears when
 * the situation that produced it changes, instead of leaving a stale row behind
 * that has to be cleaned up.
 *
 * Decision 9 again: a "time to invoice" suggestion links to wherever invoicing
 * actually happens. Juno never generates, numbers or sends one.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { clients, projects, referenceItems, reminders } from "../db/schema";
import { formatDate, formatEuros, todayIsoDate } from "./document-context";
import { SEED_REMINDERS, type SeedReminder } from "./reminders-seed";
import * as settings from "./settings";
import { addDays, compare, nextOccurrence } from "./recurrence";
import type { ReminderCategory } from "./reminders";

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

/** Project statuses that mean the work is finished and can be billed. */
const BILLABLE_STATUS_KEYS = ["delivered", "done", "completed"];

/**
 * Projects that look ready to invoice.
 *
 * A heuristic, and deliberately a shy one: it suggests, it does not nag, and a
 * project the owner has already made a reminder for is left alone.
 */
export async function invoiceSuggestions(
	db: Db = getDb(),
	today: string = todayIsoDate(),
): Promise<ReminderSuggestion[]> {
	const tool = await settings.getAccountingTool();

	// Inner, deliberately: an invoice suggestion needs somebody to invoice, so a
	// project with no client is not one of these and never should be.
	const rows = db
		.select({ project: projects, client: clients, status: referenceItems })
		.from(projects)
		.innerJoin(clients, eq(projects.clientId, clients.id))
		.leftJoin(referenceItems, eq(projects.statusId, referenceItems.id))
		.where(and(isNull(projects.deletedAt), isNull(clients.deletedAt)))
		.all();

	const existing = new Set(
		db
			.select({ projectId: reminders.projectId })
			.from(reminders)
			.where(and(isNull(reminders.deletedAt), eq(reminders.category, "invoice")))
			.all()
			.map((row) => row.projectId)
			.filter((id): id is string => id !== null),
	);

	return rows
		.filter((row) => {
			if (!row.status || !BILLABLE_STATUS_KEYS.includes(row.status.key)) return false;
			if (!row.project.agreedValueCents || row.project.agreedValueCents <= 0) return false;
			return !existing.has(row.project.id);
		})
		.map((row) => ({
			key: `invoice:${row.project.id}`,
			title: `Invoice ${row.client.name} for ${row.project.name}`,
			notes:
				`Marked ${row.status!.label.toLowerCase()}, agreed value ` +
				`${formatEuros(row.project.agreedValueCents)}. Juno does not raise invoices.`,
			category: "invoice" as const,
			dueOn: today,
			clientId: row.client.id,
			projectId: row.project.id,
			actionUrl: tool.url || null,
			actionLabel: tool.url ? `Open ${tool.name || "your accounting tool"}` : null,
		}));
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
	const [invoices, deadlines] = await Promise.all([
		invoiceSuggestions(db, today),
		deadlineSuggestions(db, today),
	]);
	return [...invoices, ...deadlines].sort((a, b) => compare(a.dueOn, b.dueOn));
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
