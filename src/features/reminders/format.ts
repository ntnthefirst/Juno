import type { RecurrencePattern, ReminderBucket, ReminderCategory } from "@shared/types";

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
export function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

export function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

export const BUCKET_ORDER: ReminderBucket[] = ["overdue", "today", "soon", "later", "snoozed"];

export const BUCKET_LABELS: Record<ReminderBucket, string> = {
	overdue: "Overdue",
	today: "Today",
	soon: "Soon",
	later: "Later",
	snoozed: "Snoozed",
	done: "Completed",
};

export const CATEGORIES: { value: ReminderCategory; label: string }[] = [
	{ value: "paperwork", label: "Paperwork" },
	{ value: "invoice", label: "Invoice" },
	{ value: "payment", label: "Payment" },
	{ value: "renewal", label: "Renewal" },
	{ value: "other", label: "Other" },
];

export const PATTERNS: { value: RecurrencePattern; label: string }[] = [
	{ value: "once", label: "Once" },
	{ value: "days", label: "Every so many days" },
	{ value: "weeks", label: "Every so many weeks" },
	{ value: "months", label: "Every so many months" },
	{ value: "years", label: "Every so many years" },
	{ value: "quarter_end", label: "End of every quarter" },
];

/** Only these four are counted; once and quarter_end have nothing to count. */
export function takesInterval(pattern: RecurrencePattern): boolean {
	return pattern === "days" || pattern === "weeks" || pattern === "months" || pattern === "years";
}

/** Mirrors describe() in electron/main/services/recurrence.ts, word for word. */
export function describeRecurrence(pattern: RecurrencePattern, interval: number): string {
	const n = Math.max(1, Math.trunc(interval));
	switch (pattern) {
		case "days":
			return n === 1 ? "Every day" : `Every ${n} days`;
		case "weeks":
			return n === 1 ? "Every week" : `Every ${n} weeks`;
		case "months":
			return n === 1 ? "Every month" : `Every ${n} months`;
		case "years":
			return n === 1 ? "Every year" : `Every ${n} years`;
		case "quarter_end":
			return "End of every quarter";
		default:
			return "Once";
	}
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, "0");
}

/**
 * Today as YYYY-MM-DD, read from the local clock. Impure, so it is only ever
 * called from an effect or an event handler, never during render.
 */
export function todayIso(): string {
	const now = new Date();
	return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

function parts(date: string): { year: number; month: number; day: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) return null;
	return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Date-only arithmetic in UTC. A local Date would move the day across a zone. */
export function addDays(date: string, count: number): string {
	const p = parts(date);
	if (!p) return date;
	const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + count));
	return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
}

/** Clamps to the end of a short month: 31 January plus one month is 28 February. */
export function addMonths(date: string, count: number): string {
	const p = parts(date);
	if (!p) return date;
	const target = new Date(Date.UTC(p.year, p.month - 1 + count, 1));
	const year = target.getUTCFullYear();
	const month = target.getUTCMonth() + 1;
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(Math.min(p.day, last), 2)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A due date the way a person says it: Today, Tomorrow, Yesterday, the weekday
 * for the coming week, otherwise the day and month, with the year once it is
 * not this one. Whole days are counted in UTC from the two plain dates, so a
 * zone cannot move the answer.
 */
export function describeDue(dueOn: string, today: string): string {
	const due = parts(dueOn);
	const now = parts(today);
	if (!due || !now) return formatDate(dueOn);
	const days = Math.round(
		(Date.UTC(due.year, due.month - 1, due.day) - Date.UTC(now.year, now.month - 1, now.day)) / 86_400_000,
	);
	if (days === 0) return "Today";
	if (days === 1) return "Tomorrow";
	if (days === -1) return "Yesterday";
	if (days > 1 && days < 7) return WEEKDAYS[new Date(Date.UTC(due.year, due.month - 1, due.day)).getUTCDay()] ?? dueOn;
	const month = MONTHS[due.month - 1] ?? "";
	return due.year === now.year ? `${due.day} ${month}` : `${due.day} ${month} ${due.year}`;
}
