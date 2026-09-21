/**
 * Wall-clock time in a named zone, and how it becomes an instant.
 *
 * A calendar event is "10:00 in Europe/Brussels", not "08:00Z". The two agree
 * for one occurrence and disagree after the clocks change, which is the whole
 * reason the schema stores wall-clock values and a zone. This module is the
 * one place that converts between the two, and it is pure so the DST cases
 * are tested rather than trusted.
 *
 * Everything uses `Intl`, which Electron ships with full ICU, so there is no
 * zone database to bundle and no native module to build.
 *
 * Two string shapes appear throughout:
 * - a local date-time, `YYYY-MM-DDTHH:MM:SS`, with no zone suffix;
 * - a UTC instant, `YYYY-MM-DDTHH:MM:SS.sssZ`, as `Date.toISOString()` makes it.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export interface WallClock {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

export function isValidTimeZone(zone: string): boolean {
	if (!zone || zone.length > 64) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** What the machine is set to. The default for a new event, never an assumption about a stored one. */
export function systemTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function parseLocal(value: string): WallClock {
	const match = LOCAL.exec(value);
	if (!match) throw new Error(`Not a local date-time: ${value}`);
	return {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
		hour: Number(match[4] ?? 0),
		minute: Number(match[5] ?? 0),
		second: Number(match[6] ?? 0),
	};
}

export function isLocalDateTime(value: string): boolean {
	const match = LOCAL.exec(value);
	if (!match || match[4] === undefined) return false;
	return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isLocalDate(value: string): boolean {
	const match = LOCAL.exec(value);
	if (!match || match[4] !== undefined) return false;
	return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isRealDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12 || day < 1) return false;
	return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

export function formatLocal(w: WallClock): string {
	return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

export function formatLocalDate(w: WallClock): string {
	return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/**
 * A "floating" Date: one whose UTC fields hold wall-clock values. This is the
 * shape `rrule` works in, and the shape all wall-clock arithmetic here uses,
 * because UTC fields never jump at a DST boundary.
 */
export function toFloating(local: string): Date {
	const w = parseLocal(local);
	return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
}

export function fromFloating(date: Date): string {
	return formatLocal({
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: date.getUTCHours(),
		minute: date.getUTCMinutes(),
		second: date.getUTCSeconds(),
	});
}

export function fromFloatingDate(date: Date): string {
	return formatLocalDate({
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: 0,
		minute: 0,
		second: 0,
	});
}

/** Wall-clock arithmetic: the same clock reading, some minutes later. */
export function addLocalMinutes(local: string, minutes: number): string {
	return fromFloating(new Date(toFloating(local).getTime() + minutes * 60_000));
}

export function addLocalDays(local: string, days: number): string {
	const dated = !local.includes("T");
	const shifted = new Date(toFloating(local).getTime() + days * 86_400_000);
	return dated ? fromFloatingDate(shifted) : fromFloating(shifted);
}

/** Whole minutes between two wall-clock readings, ignoring any zone. */
export function localMinutesBetween(from: string, to: string): number {
	return Math.round((toFloating(to).getTime() - toFloating(from).getTime()) / 60_000);
}

export function localDateOf(local: string): string {
	return local.slice(0, 10);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(zone, f);
	}
	return f;
}

/** The wall clock in `zone` at a given instant. */
export function wallClockAt(instant: Date, zone: string): WallClock {
	const parts = formatterFor(zone).formatToParts(instant);
	const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		// ICU reports midnight as 24 in some versions even with h23.
		hour: read("hour") % 24,
		minute: read("minute"),
		second: read("second"),
	};
}

/** Minutes east of UTC that `zone` observes at an instant. */
export function offsetMinutesAt(instant: Date, zone: string): number {
	const w = wallClockAt(instant, zone);
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
	return Math.round((asUtc - instant.getTime()) / 60_000);
}

export function utcToLocal(utcIso: string, zone: string): string {
	return formatLocal(wallClockAt(new Date(utcIso), zone));
}

/**
 * The instant at which `zone` reads `local`.
 *
 * Wall-clock readings are not unique: when the clocks go back an hour the
 * reading 02:30 happens twice, and when they go forward it never happens at
 * all. Both are handled the way every calendar does: an ambiguous reading
 * takes the earlier instant, and a reading in the gap is pushed forward by the
 * length of the gap, so 02:30 on the spring day becomes 03:30.
 */
export function localToUtc(local: string, zone: string): string {
	const guess = toFloating(local).getTime();
	const day = 86_400_000;
	const offsets = new Set<number>();
	for (const probe of [guess - day, guess, guess + day]) {
		offsets.add(offsetMinutesAt(new Date(probe), zone));
	}

	const matches: number[] = [];
	for (const offset of offsets) {
		const candidate = guess - offset * 60_000;
		if (formatLocal(wallClockAt(new Date(candidate), zone)) === formatLocal(parseLocal(local))) {
			matches.push(candidate);
		}
	}
	if (matches.length > 0) return new Date(Math.min(...matches)).toISOString();

	// In the gap. Use the offset in force just before it, which lands on the
	// reading the clocks jumped to.
	const before = offsetMinutesAt(new Date(guess - day), zone);
	return new Date(guess - before * 60_000).toISOString();
}

/** Midnight at the start of a calendar date, in `zone`, as an instant. */
export function localDateStartUtc(date: string, zone: string): string {
	return localToUtc(`${date.slice(0, 10)}T00:00:00`, zone);
}
