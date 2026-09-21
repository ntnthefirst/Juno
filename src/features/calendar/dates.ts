/**
 * Date helpers for the calendar screens.
 *
 * Two kinds of value move through here and they must not be confused:
 * - a wall-clock string, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS`, which is what
 *   an event stores and what every edit sends back. Arithmetic on these is
 *   done on the UTC fields of a Date so a zone can never shift a day;
 * - a UTC instant, which is what the grid is placed by. It is turned into the
 *   machine's local date and minute of day at render time, and nowhere else.
 */

export type ViewKind = "month" | "week" | "agenda";

const DAY = 86_400_000;

function pad(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

/** Today as YYYY-MM-DD from the machine's clock. Impure: call it from an effect or a handler. */
export function todayIso(): string {
	const now = new Date();
	return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function machineTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** A wall-clock string as a Date whose UTC fields carry the values. */
export function toFloating(local: string): Date {
	const [datePart, timePart] = local.split("T");
	const [y, m, d] = (datePart ?? "").split("-").map(Number);
	const [hh, mm, ss] = (timePart ?? "0:0:0").split(":").map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, ss ?? 0));
}

export function fromFloatingDate(date: Date): string {
	return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function fromFloating(date: Date): string {
	return `${fromFloatingDate(date)}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function addDays(date: string, count: number): string {
	return fromFloatingDate(new Date(toFloating(date).getTime() + count * DAY));
}

/** Keeps the kind: a date stays a date, a date-time stays a date-time. */
export function addLocalDays(local: string, count: number): string {
	const shifted = new Date(toFloating(local).getTime() + count * DAY);
	return local.includes("T") ? fromFloating(shifted) : fromFloatingDate(shifted);
}

export function addLocalMinutes(local: string, minutes: number): string {
	return fromFloating(new Date(toFloating(local).getTime() + minutes * 60_000));
}

export function localMinutesBetween(from: string, to: string): number {
	return Math.round((toFloating(to).getTime() - toFloating(from).getTime()) / 60_000);
}

export function daysBetween(from: string, to: string): number {
	return Math.round((toFloating(to).getTime() - toFloating(from).getTime()) / DAY);
}

export function dateOf(local: string): string {
	return local.slice(0, 10);
}

/** `HH:MM` from a wall-clock string, or an empty string for a date. */
export function timeOf(local: string): string {
	return local.includes("T") ? local.slice(11, 16) : "";
}

export function joinLocal(date: string, time: string): string {
	const [hh = "00", mm = "00"] = time.split(":");
	return `${date}T${pad(Number(hh))}:${pad(Number(mm))}:00`;
}

/** Monday of the week the date is in. */
export function startOfWeek(date: string): string {
	const day = toFloating(date).getUTCDay();
	return addDays(date, day === 0 ? -6 : 1 - day);
}

export function startOfMonth(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, count: number): string {
	const d = toFloating(date);
	const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count, 1));
	const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	return fromFloatingDate(
		new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last))),
	);
}

/** Six weeks of dates starting on the Monday before the 1st. Always 42 cells, so the grid never jumps. */
export function monthGrid(date: string): string[] {
	const first = startOfWeek(startOfMonth(date));
	return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function weekDays(date: string): string[] {
	const monday = startOfWeek(date);
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/* ------------------------------------------------- machine-local rendering */

/** The machine's local date for an instant. */
export function localDateOfInstant(utcIso: string): string {
	const d = new Date(utcIso);
	return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Minutes since local midnight for an instant. */
export function localMinuteOfInstant(utcIso: string): number {
	const d = new Date(utcIso);
	return d.getHours() * 60 + d.getMinutes();
}

export function formatTime(utcIso: string): string {
	const d = new Date(utcIso);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatMinutes(minutes: number): string {
	return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** YYYY-MM-DD as dd/mm/yyyy, split rather than parsed so no zone can touch it. */
export function formatDate(date: string): string {
	const parts = date.slice(0, 10).split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function monthLabel(date: string): string {
	const d = toFloating(date);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Monday-first index, 0 to 6. */
export function weekdayIndex(date: string): number {
	return (toFloating(date).getUTCDay() + 6) % 7;
}

export function weekdayShort(date: string): string {
	return WEEKDAYS_SHORT[weekdayIndex(date)] ?? "";
}

export function weekdayLong(date: string): string {
	return WEEKDAYS_LONG[weekdayIndex(date)] ?? "";
}

/** "Tuesday 22 September 2026". */
export function formatDateLong(date: string): string {
	const d = toFloating(date);
	return `${weekdayLong(date)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "22 Sep" for a heading inside a month that is already named. */
export function formatDayShort(date: string): string {
	const d = toFloating(date);
	return `${d.getUTCDate()} ${(MONTHS[d.getUTCMonth()] ?? "").slice(0, 3)}`;
}

/** "21 to 27 Sep 2026", or "28 Sep to 4 Oct 2026" across a month end. */
export function weekLabel(date: string): string {
	const days = weekDays(date);
	const first = toFloating(days[0]!);
	const last = toFloating(days[6]!);
	if (first.getUTCMonth() === last.getUTCMonth()) {
		return `${first.getUTCDate()} to ${formatDayShort(days[6]!)} ${first.getUTCFullYear()}`;
	}
	return `${formatDayShort(days[0]!)} to ${formatDayShort(days[6]!)} ${last.getUTCFullYear()}`;
}

/** Snaps minutes to the nearest step. */
export function snap(minutes: number, step = 15): number {
	return Math.round(minutes / step) * step;
}
