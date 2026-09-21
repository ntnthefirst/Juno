/**
 * The small set of repeat rules the form can build, and how they become an
 * RFC 5545 RRULE. Anything the form cannot represent is kept as the text it
 * came in as and shown as a custom rule, so an imported rule is never quietly
 * simplified.
 */
import { dateOf, toFloating, weekdayIndex } from "./dates";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const WEEKDAYS: { value: Weekday; label: string; long: string }[] = [
	{ value: "MO", label: "M", long: "Monday" },
	{ value: "TU", label: "T", long: "Tuesday" },
	{ value: "WE", label: "W", long: "Wednesday" },
	{ value: "TH", label: "T", long: "Thursday" },
	{ value: "FR", label: "F", long: "Friday" },
	{ value: "SA", label: "S", long: "Saturday" },
	{ value: "SU", label: "S", long: "Sunday" },
];

export type RecurrenceState = {
	freq: Frequency;
	interval: number;
	/** Weekly only. Empty means the start's own weekday. */
	weekdays: Weekday[];
	/** Monthly only: the same date each month, or the same weekday of the same week. */
	monthly: "day" | "weekday";
	ends: "never" | "count" | "until";
	count: number;
	/** YYYY-MM-DD. */
	until: string;
};

export const DEFAULT_STATE: RecurrenceState = {
	freq: "WEEKLY",
	interval: 1,
	weekdays: [],
	monthly: "day",
	ends: "never",
	count: 10,
	until: "",
};

function startWeekday(startLocal: string): Weekday {
	return WEEKDAYS[weekdayIndex(dateOf(startLocal))]!.value;
}

/** "the second Tuesday" or "the last Friday" for a monthly rule on a weekday. */
function monthlyWeekday(startLocal: string): { nth: number; weekday: Weekday } {
	const d = toFloating(dateOf(startLocal));
	const day = d.getUTCDate();
	const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
	return { nth: day + 7 > daysInMonth ? -1 : Math.ceil(day / 7), weekday: startWeekday(startLocal) };
}

export function buildRule(state: RecurrenceState, startLocal: string, allDay: boolean): string {
	const parts = [`FREQ=${state.freq}`];
	if (state.interval > 1) parts.push(`INTERVAL=${Math.trunc(state.interval)}`);
	if (state.freq === "WEEKLY") {
		const days = state.weekdays.length > 0 ? state.weekdays : [startWeekday(startLocal)];
		parts.push(`BYDAY=${[...days].sort((a, b) => order(a) - order(b)).join(",")}`);
	}
	if (state.freq === "MONTHLY") {
		if (state.monthly === "weekday") {
			const { nth, weekday } = monthlyWeekday(startLocal);
			parts.push(`BYDAY=${nth}${weekday}`);
		} else {
			parts.push(`BYMONTHDAY=${toFloating(dateOf(startLocal)).getUTCDate()}`);
		}
	}
	if (state.ends === "count") parts.push(`COUNT=${Math.max(1, Math.trunc(state.count))}`);
	if (state.ends === "until" && state.until) {
		const date = state.until.replace(/-/g, "");
		// The stored form is wall clock, so the last day ends at 23:59:59 on it.
		parts.push(allDay ? `UNTIL=${date}` : `UNTIL=${date}T235959Z`);
	}
	return parts.join(";");
}

function order(day: Weekday): number {
	return WEEKDAYS.findIndex((w) => w.value === day);
}

const KNOWN = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "COUNT", "UNTIL", "WKST"]);

/**
 * Reads a rule back into the form's state, or null when the form cannot show
 * it faithfully. The caller then keeps the rule as text.
 */
export function parseRule(rrule: string, startLocal: string): RecurrenceState | null {
	const fields = new Map<string, string>();
	for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
		const [key, value] = part.split("=");
		if (!key || value === undefined) return null;
		if (!KNOWN.has(key.toUpperCase())) return null;
		fields.set(key.toUpperCase(), value);
	}
	const freq = fields.get("FREQ")?.toUpperCase();
	if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

	const state: RecurrenceState = { ...DEFAULT_STATE, freq, weekdays: [] };
	const interval = Number(fields.get("INTERVAL") ?? "1");
	if (!Number.isInteger(interval) || interval < 1) return null;
	state.interval = interval;

	const byday = fields.get("BYDAY");
	const bymonthday = fields.get("BYMONTHDAY");
	if (freq === "WEEKLY") {
		if (bymonthday) return null;
		if (byday) {
			const days = byday.split(",").map((d) => d.toUpperCase());
			if (!days.every((d): d is Weekday => WEEKDAYS.some((w) => w.value === d))) return null;
			state.weekdays = days;
		}
	} else if (freq === "MONTHLY") {
		if (byday && bymonthday) return null;
		if (byday) {
			const expected = monthlyWeekday(startLocal);
			const match = /^([+-]?\d)([A-Z]{2})$/i.exec(byday);
			if (!match || Number(match[1]) !== expected.nth || match[2]!.toUpperCase() !== expected.weekday) return null;
			state.monthly = "weekday";
		} else if (bymonthday) {
			if (Number(bymonthday) !== toFloating(dateOf(startLocal)).getUTCDate()) return null;
			state.monthly = "day";
		}
	} else if (byday || bymonthday) {
		return null;
	}

	const count = fields.get("COUNT");
	const until = fields.get("UNTIL");
	if (count && until) return null;
	if (count) {
		if (!/^\d+$/.test(count)) return null;
		state.ends = "count";
		state.count = Number(count);
	} else if (until) {
		const match = /^(\d{4})(\d{2})(\d{2})/.exec(until);
		if (!match) return null;
		state.ends = "until";
		state.until = `${match[1]}-${match[2]}-${match[3]}`;
	}
	return state;
}

export function describeState(state: RecurrenceState, startLocal: string): string {
	const n = Math.max(1, Math.trunc(state.interval));
	let text: string;
	switch (state.freq) {
		case "DAILY":
			text = n === 1 ? "Every day" : `Every ${n} days`;
			break;
		case "WEEKLY": {
			const days = state.weekdays.length > 0 ? state.weekdays : [startWeekday(startLocal)];
			const names = [...days].sort((a, b) => order(a) - order(b)).map((d) => WEEKDAYS[order(d)]!.long);
			text = `${n === 1 ? "Every week" : `Every ${n} weeks`} on ${listOf(names)}`;
			break;
		}
		case "MONTHLY": {
			const base = n === 1 ? "Every month" : `Every ${n} months`;
			if (state.monthly === "weekday") {
				const { nth, weekday } = monthlyWeekday(startLocal);
				const ordinal = nth === -1 ? "last" : ["first", "second", "third", "fourth"][nth - 1];
				text = `${base} on the ${ordinal} ${WEEKDAYS[order(weekday)]!.long}`;
			} else {
				text = `${base} on day ${toFloating(dateOf(startLocal)).getUTCDate()}`;
			}
			break;
		}
		default:
			text = n === 1 ? "Every year" : `Every ${n} years`;
	}
	if (state.ends === "count") text += `, ${state.count} ${state.count === 1 ? "time" : "times"}`;
	if (state.ends === "until" && state.until) text += `, until ${state.until.split("-").reverse().join("/")}`;
	return text;
}

function listOf(names: string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
