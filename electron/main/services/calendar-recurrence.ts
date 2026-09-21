/**
 * Expanding a recurring event into occurrences, with its exceptions applied.
 *
 * `rrule` does the RFC 5545 arithmetic. It is driven entirely in "floating"
 * time: the Date objects it sees carry wall-clock values in their UTC fields,
 * so a weekly rule steps exactly seven days of wall clock and never notices a
 * DST change. Each occurrence is then converted to an instant with the event's
 * zone. Doing it the other way round, expanding in UTC, is the classic bug:
 * every occurrence after the clocks change lands an hour off.
 *
 * `rrule` has a `tzid` option that promises the same thing. It is not used,
 * because it depends on an optional library and has open bugs at exactly the
 * boundaries this module exists to get right.
 */
import { RRule, type Options } from "rrule";
import {
	addLocalDays,
	addLocalMinutes,
	fromFloating,
	fromFloatingDate,
	localDateStartUtc,
	localMinutesBetween,
	localToUtc,
	toFloating,
	utcToLocal,
} from "./calendar-time";

export interface SeriesShape {
	startLocal: string;
	endLocal: string;
	allDay: boolean;
	timezone: string;
	rrule: string | null;
}

export interface ExceptionShape {
	occurrenceStartLocal: string;
	cancelled: boolean;
	title: string | null;
	notes: string | null;
	location: string | null;
	startLocal: string | null;
	endLocal: string | null;
}

export interface Occurrence {
	/** The start the rule produced, which is the exception key and RECURRENCE-ID. */
	occurrenceStartLocal: string;
	startLocal: string;
	endLocal: string;
	startUtc: string;
	endUtc: string;
	/** True when an exception row changed this occurrence. */
	isException: boolean;
	title: string | null;
	notes: string | null;
	location: string | null;
}

/** Bound on how many occurrences one range query will hand back for one series. */
const MAX_PER_SERIES = 1000;

function parseOptions(rrule: string): Partial<Options> {
	const text = rrule.trim().replace(/^RRULE:/i, "");
	if (!text) throw new Error("A repeat rule cannot be empty.");
	let options: Partial<Options>;
	try {
		options = RRule.parseString(text);
	} catch (cause: unknown) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`That repeat rule is not valid: ${detail}`);
	}
	if (options.freq === undefined) throw new Error("A repeat rule needs a FREQ.");
	if (
		options.freq === RRule.HOURLY ||
		options.freq === RRule.MINUTELY ||
		options.freq === RRule.SECONDLY
	) {
		throw new Error("A repeat rule has to be daily, weekly, monthly or yearly.");
	}
	if (options.count !== undefined && options.count !== null && options.count < 1) {
		throw new Error("A repeat rule's COUNT has to be 1 or more.");
	}
	delete options.dtstart;
	delete options.tzid;
	return options;
}

function serialise(options: Partial<Options>): string {
	return RRule.optionsToString(options).replace(/^RRULE:/i, "");
}

/**
 * Parses and re-serialises a rule so the stored form is canonical and known to
 * be valid. Throws a message a person can act on.
 */
export function normaliseRule(rrule: string): string {
	return serialise(parseOptions(rrule));
}

export function describeRule(rrule: string | null): string {
	if (!rrule) return "Does not repeat";
	try {
		const text = new RRule(parseOptions(rrule)).toText();
		if (!text || /RRule error/i.test(text)) return `Repeats: ${rrule}`;
		return text.charAt(0).toUpperCase() + text.slice(1);
	} catch {
		return `Repeats: ${rrule}`;
	}
}

function ruleFor(shape: SeriesShape): RRule {
	if (!shape.rrule) throw new Error("Not a recurring event.");
	return new RRule({ ...parseOptions(shape.rrule), dtstart: toFloating(shape.startLocal) });
}

/** Wall-clock length of one occurrence: minutes for a timed event, days for an all-day one. */
function durationOf(shape: SeriesShape): number {
	return shape.allDay
		? Math.max(1, Math.round(localMinutesBetween(shape.startLocal, shape.endLocal) / 1440))
		: Math.max(0, localMinutesBetween(shape.startLocal, shape.endLocal));
}

function endFor(shape: SeriesShape, startLocal: string, duration: number): string {
	return shape.allDay ? addLocalDays(startLocal, duration) : addLocalMinutes(startLocal, duration);
}

function instantOf(shape: SeriesShape, local: string): string {
	return shape.allDay ? localDateStartUtc(local, shape.timezone) : localToUtc(local, shape.timezone);
}

function keyOf(shape: SeriesShape, floating: Date): string {
	return shape.allDay ? fromFloatingDate(floating) : fromFloating(floating);
}

/**
 * The floating starts the rule produces between two floating bounds, with the
 * event's own start included even when the rule would not generate it. RFC
 * 5545 calls that case undefined; every calendar people use shows the event on
 * the day it was created, so this does too.
 */
function floatingStarts(shape: SeriesShape, after: Date, before: Date): Date[] {
	const rule = ruleFor(shape);
	const starts = rule.between(after, before, true, (_date, count) => count < MAX_PER_SERIES);
	const first = toFloating(shape.startLocal);
	if (
		first.getTime() >= after.getTime() &&
		first.getTime() <= before.getTime() &&
		!starts.some((d) => d.getTime() === first.getTime())
	) {
		starts.unshift(first);
	}
	return starts;
}

/**
 * Every occurrence of a series that overlaps `[fromUtc, toUtc)`, in order.
 *
 * Exceptions are applied by key. A cancelled occurrence is dropped. A moved one
 * is placed where it was moved to, and is found even when its original slot
 * is outside the window, because the exceptions are walked separately from
 * the rule.
 */
export function expandSeries(
	shape: SeriesShape,
	exceptions: ExceptionShape[],
	fromUtc: string,
	toUtc: string,
): Occurrence[] {
	const duration = durationOf(shape);
	const byKey = new Map(exceptions.map((e) => [e.occurrenceStartLocal, e]));

	// The floating window is the UTC window padded by a day each side plus one
	// occurrence's length, so nothing that overlaps the range is missed. The
	// precise test happens in UTC below.
	const pad = 86_400_000 + (shape.allDay ? duration * 86_400_000 : duration * 60_000);
	const after = new Date(Date.parse(fromUtc) - pad);
	const before = new Date(Date.parse(toUtc) + pad);

	const out: Occurrence[] = [];
	const overlaps = (startUtc: string, endUtc: string) => startUtc < toUtc && endUtc > fromUtc;

	for (const floating of floatingStarts(shape, after, before)) {
		const key = keyOf(shape, floating);
		if (byKey.has(key)) continue;
		const endLocal = endFor(shape, key, duration);
		const startUtc = instantOf(shape, key);
		const endUtc = instantOf(shape, endLocal);
		if (!overlaps(startUtc, endUtc)) continue;
		out.push({
			occurrenceStartLocal: key,
			startLocal: key,
			endLocal,
			startUtc,
			endUtc,
			isException: false,
			title: null,
			notes: null,
			location: null,
		});
	}

	for (const exception of exceptions) {
		if (exception.cancelled) continue;
		const startLocal = exception.startLocal ?? exception.occurrenceStartLocal;
		const endLocal = exception.endLocal ?? endFor(shape, startLocal, duration);
		const startUtc = instantOf(shape, startLocal);
		const endUtc = instantOf(shape, endLocal);
		if (!overlaps(startUtc, endUtc)) continue;
		out.push({
			occurrenceStartLocal: exception.occurrenceStartLocal,
			startLocal,
			endLocal,
			startUtc,
			endUtc,
			isException: true,
			title: exception.title,
			notes: exception.notes,
			location: exception.location,
		});
	}

	out.sort((a, b) => (a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0));
	return out;
}

/**
 * When the series is over, as an instant, or null when it never is. Used to
 * index past series out of a range query; it may be a little generous and
 * must never be early.
 */
export function seriesEndUtc(shape: SeriesShape): string | null {
	if (!shape.rrule) return instantOf(shape, shape.endLocal);
	const options = parseOptions(shape.rrule);
	const duration = durationOf(shape);
	if (options.until) {
		const last = keyOf(shape, options.until);
		return instantOf(shape, endFor(shape, last, duration));
	}
	if (options.count) {
		const all = ruleFor(shape).all();
		const lastFloating = all[all.length - 1] ?? toFloating(shape.startLocal);
		return instantOf(shape, endFor(shape, keyOf(shape, lastFloating), duration));
	}
	return null;
}

/** Whether the rule generates this key. False for a key that is not an occurrence. */
export function isOccurrenceOf(shape: SeriesShape, occurrenceStartLocal: string): boolean {
	if (!shape.rrule) return occurrenceStartLocal === shape.startLocal;
	if (occurrenceStartLocal === shape.startLocal) return true;
	const at = toFloating(occurrenceStartLocal);
	return floatingStarts(shape, at, at).length > 0;
}

/** How many occurrences the rule produces strictly before a key. */
export function occurrencesBefore(shape: SeriesShape, occurrenceStartLocal: string): number {
	const at = toFloating(occurrenceStartLocal);
	const before = new Date(at.getTime() - 1000);
	return floatingStarts(shape, toFloating(shape.startLocal), before).length;
}

/**
 * The rule with an end just before `occurrenceStartLocal`, for the first half
 * of a split series. A COUNT is dropped, because UNTIL now says where it ends.
 */
export function ruleEndingBefore(rrule: string, occurrenceStartLocal: string): string {
	const options = parseOptions(rrule);
	delete options.count;
	options.until = new Date(toFloating(occurrenceStartLocal).getTime() - 1000);
	return serialise(options);
}

/**
 * The rule for the second half of a split series. A COUNT loses the
 * occurrences the first half kept; anything else carries over unchanged.
 */
export function ruleContinuingFrom(rrule: string, consumed: number): string {
	const options = parseOptions(rrule);
	if (options.count) options.count = Math.max(1, options.count - consumed);
	return serialise(options);
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/**
 * A rule pinned to its start, after the start moved.
 *
 * A weekly rule "on Tuesday" whose series is dragged to Wednesday means
 * Wednesdays from now on; keeping BYDAY=TU would put the first occurrence on
 * a Wednesday and every later one back on a Tuesday. The same goes for a
 * monthly rule on the 13th moved to the 14th. Only a rule that named exactly
 * the start's own day is rewritten; anything more deliberate is kept.
 */
export function retargetRule(rrule: string, fromStartLocal: string, toStartLocal: string): string {
	const options = parseOptions(rrule);
	const from = toFloating(fromStartLocal);
	const to = toFloating(toStartLocal);
	if (from.getUTCDay() === to.getUTCDay() && from.getUTCDate() === to.getUTCDate()) return serialise(options);

	if (options.freq === RRule.WEEKLY && Array.isArray(options.byweekday) && options.byweekday.length === 1) {
		const only = options.byweekday[0];
		const fromDay = WEEKDAYS[from.getUTCDay()];
		// rrule numbers Monday 0, so its weekday is one behind Date's.
		const matches = typeof only === "number" ? only === (from.getUTCDay() + 6) % 7 : String(only) === fromDay;
		if (matches) options.byweekday = [RRule[WEEKDAYS[to.getUTCDay()]]];
	} else if (
		options.freq === RRule.MONTHLY &&
		(options.bymonthday === from.getUTCDate() ||
			(Array.isArray(options.bymonthday) && options.bymonthday.length === 1 && options.bymonthday[0] === from.getUTCDate()))
	) {
		options.bymonthday = [to.getUTCDate()];
	}
	return serialise(options);
}

/**
 * Converts a rule's UNTIL between the floating form stored here and the UTC
 * form an .ics file carries when DTSTART has a zone. Used only at the file
 * boundary. All-day events keep a date UNTIL and pass through unchanged.
 */
export function ruleUntilToUtc(rrule: string, zone: string): string {
	const options = parseOptions(rrule);
	if (!options.until) return serialise(options);
	options.until = new Date(localToUtc(fromFloating(options.until), zone));
	return serialise(options);
}

export function ruleUntilFromUtc(rrule: string, zone: string): string {
	const options = parseOptions(rrule);
	if (!options.until) return serialise(options);
	options.until = toFloating(utcToLocal(options.until.toISOString(), zone));
	return serialise(options);
}
