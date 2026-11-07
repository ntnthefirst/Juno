import { weekdayShort } from "../calendar/dates";

/** 90 is "1 h 30 min", 180 is "3 h 00 min". The design pads the minutes so a column lines up. */
export function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = String(minutes % 60).padStart(2, "0");
	return `${hours} h ${rest} min`;
}

/** The running clock in the title bar: 1:05:09, or 4:09 under an hour. */
export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type Parsed = { ok: true; minutes: number | null } | { ok: false };

/** "14", "14,5" and "1.25" are hours. Empty is no estimate. Quarters and halves survive as whole minutes. */
export function parseHours(raw: string): Parsed {
	const cleaned = raw.replace(/\s/g, "");
	if (cleaned.length === 0) return { ok: true, minutes: null };
	const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
	if (!match) return { ok: false };
	const whole = Number.parseInt(match[1]!, 10) * 60;
	const fraction = Math.round((Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10) * 60) / 100);
	return { ok: true, minutes: whole + fraction };
}

/** Whole minutes as the hours a person would type: 840 is "14", 90 is "1,5". */
export function minutesToHours(minutes: number | null): string {
	if (minutes === null) return "";
	const hours = minutes / 60;
	return String(Math.round(hours * 100) / 100).replace(".", ",");
}

/** "2 Oct": the day and the short month, in English like the rest of the interface. */
export function shortDay(iso: string): string {
	return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 14 Nov" from a calendar date. The year is left out: a project's dates are within a year of today. */
export function dayLabel(date: string): string {
	const day = Number.parseInt(date.slice(8, 10), 10);
	const month = MONTHS[Number.parseInt(date.slice(5, 7), 10) - 1] ?? "";
	return `${weekdayShort(date)} ${day} ${month}`;
}
