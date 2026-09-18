/**
 * When a recurring reminder comes round again.
 *
 * Deliberately a small fixed set of patterns, per PLAN.md phase 2: every N days,
 * weeks, months or years, and the Belgian VAT quarter. Anything wider is phase
 * 5's problem, which has `rrule` for it. A half-implemented general recurrence
 * engine is worse than none, because a calendar that is subtly wrong is worse
 * than a calendar that is missing.
 *
 * Everything here is date-only arithmetic on `YYYY-MM-DD` strings, done in UTC.
 * A calendar date has no time and no zone; the moment one goes through a local
 * `Date`, "the 1st" becomes "the 31st at 23:00" somewhere, and the reminder
 * fires on the wrong day twice a year.
 */

export type RecurrencePattern = "once" | "days" | "weeks" | "months" | "years" | "quarter_end";

export interface Recurrence {
	pattern: RecurrencePattern;
	/** How many days, weeks, months or years. Ignored by once and quarter_end. */
	interval: number;
	/**
	 * The day of the month the series is anchored to, for monthly and yearly.
	 *
	 * Kept separately because clamping has to be forgiving: a series anchored to
	 * the 31st lands on 28 February and then has to return to 31 March. Advancing
	 * from the clamped date instead would walk the series backwards, one day a
	 * month, until everything happened on the 28th.
	 */
	anchorDay?: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value: string): { year: number; month: number; day: number } {
	const match = DATE.exec(value);
	if (!match) throw new Error(`Not a calendar date: ${value}`);
	return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDate(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
	// Day 0 of the next month is the last day of this one.
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, count: number): string {
	const { year, month, day } = parseDate(date);
	const shifted = new Date(Date.UTC(year, month - 1, day + count));
	return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * Adds months, clamping to the end of a short month rather than spilling into
 * the next one. 31 January plus one month is 28 February, not 3 March.
 */
export function addMonths(date: string, count: number, anchorDay?: number): string {
	const { year, month, day } = parseDate(date);
	const target = new Date(Date.UTC(year, month - 1 + count, 1));
	const targetYear = target.getUTCFullYear();
	const targetMonth = target.getUTCMonth() + 1;
	const wanted = anchorDay ?? day;
	return formatDate(targetYear, targetMonth, Math.min(wanted, daysInMonth(targetYear, targetMonth)));
}

/** The last day of the quarter the date falls in: 31/03, 30/06, 30/09, 31/12. */
export function quarterEnd(date: string): string {
	const { year, month } = parseDate(date);
	const endMonth = Math.ceil(month / 3) * 3;
	return formatDate(year, endMonth, daysInMonth(year, endMonth));
}

export function compare(a: string, b: string): number {
	// ISO calendar dates sort correctly as strings, which is most of why they are
	// stored this way.
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The next occurrence strictly after `from`.
 *
 * Returns null for a one-off, which is the caller's signal that completing it
 * finishes it rather than rolling it forward.
 */
export function nextOccurrence(
	current: string,
	recurrence: Recurrence,
	from: string = current,
): string | null {
	if (recurrence.pattern === "once") return null;

	const interval = Math.max(1, Math.trunc(recurrence.interval));
	let next = current;

	// Stepping rather than computing how many intervals to skip, because the
	// month patterns are not linear. Bounded so a pathological input cannot spin:
	// 600 steps is fifty years of monthly, or well past any sane daily series.
	for (let guard = 0; guard < 600; guard++) {
		next = step(next, recurrence, interval);
		if (compare(next, from) > 0) return next;
	}
	return next;
}

function step(date: string, recurrence: Recurrence, interval: number): string {
	switch (recurrence.pattern) {
		case "days":
			return addDays(date, interval);
		case "weeks":
			return addDays(date, interval * 7);
		case "months":
			return addMonths(date, interval, recurrence.anchorDay);
		case "years":
			return addMonths(date, interval * 12, recurrence.anchorDay);
		case "quarter_end": {
			// One day past this quarter's end is the next quarter, whose end is the
			// next occurrence. Works from any date in the quarter, not just the end.
			const thisEnd = quarterEnd(date);
			return quarterEnd(addDays(thisEnd, 1));
		}
		default:
			return date;
	}
}

/** Human wording for the interface, in English like the rest of the app. */
export function describe(recurrence: Recurrence): string {
	const n = Math.max(1, Math.trunc(recurrence.interval));
	switch (recurrence.pattern) {
		case "once":
			return "Once";
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
