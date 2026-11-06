/**
 * Finds a day and a time in the words of a message, in Dutch and English.
 *
 * Pure, local and shy: it needs both a day and a time in the same sentence,
 * it ignores quoted history, and it only offers a moment that is still ahead.
 * A wrong guess costs one press of Not now, but a stream of them teaches
 * people to ignore the bar, so it errs towards saying nothing.
 */

export interface DetectedMoment {
	/** `YYYY-MM-DDTHH:MM:SS`, no zone suffix, in the machine's local time. */
	startLocal: string;
	/** How the day is said in the bar: "Friday", "tomorrow", "12 November". */
	dayLabel: string;
	/** `HH:MM`. */
	time: string;
}

const WEEKDAYS: Record<string, number> = {
	zondag: 0,
	maandag: 1,
	dinsdag: 2,
	woensdag: 3,
	donderdag: 4,
	vrijdag: 5,
	zaterdag: 6,
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

const MONTHS: Record<string, number> = {
	januari: 1,
	january: 1,
	jan: 1,
	februari: 2,
	february: 2,
	feb: 2,
	maart: 3,
	march: 3,
	mrt: 3,
	mar: 3,
	april: 4,
	apr: 4,
	mei: 5,
	may: 5,
	juni: 6,
	june: 6,
	jun: 6,
	juli: 7,
	july: 7,
	jul: 7,
	augustus: 8,
	august: 8,
	aug: 8,
	september: 9,
	sept: 9,
	sep: 9,
	oktober: 10,
	october: 10,
	okt: 10,
	oct: 10,
	november: 11,
	nov: 11,
	december: 12,
	dec: 12,
};

const ENGLISH_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ENGLISH_MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join("|");

const WEEKDAY_RE = new RegExp(`\\b(${WEEKDAY_NAMES})\\b`);
const RELATIVE_RE = /\b(overmorgen|morgen|tomorrow|vandaag|today)\b/;
const NUMERIC_DATE_RE = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/;
const TEXT_DATE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|e|ste)?\\s+(${MONTH_NAMES})\\.?(?:\\s+(\\d{4}))?\\b`);

const MERIDIEM_RE = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/;
const CLOCK_RE = /\b(\d{1,2}):(\d{2})\b/;
const DUTCH_CLOCK_RE = /\b(\d{1,2})[uh](\d{2})\b/;
const HOUR_ONLY_RE = /\b(\d{1,2})\s?(?:uur|u|h)\b/;

/** What a reply carries below the new words: arrowed lines and the "wrote:" line. */
export function stripQuotedHistory(text: string): string {
	const kept: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (/^(on .{5,200} wrote:?|op .{5,200} schreef.*:?|-{2,}\s*(original message|oorspronkelijk bericht).*)$/i.test(trimmed)) break;
		if (/^(from|van):\s/i.test(trimmed) && kept.length > 0) break;
		if (trimmed.startsWith(">")) continue;
		kept.push(line);
	}
	return kept.join("\n");
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function clockOf(sentence: string): { hour: number; minute: number } | null {
	const meridiem = MERIDIEM_RE.exec(sentence);
	if (meridiem) {
		let hour = Number(meridiem[1]);
		const minute = meridiem[2] ? Number(meridiem[2]) : 0;
		if (hour < 1 || hour > 12 || minute > 59) return null;
		if (meridiem[3] === "pm" && hour < 12) hour += 12;
		if (meridiem[3] === "am" && hour === 12) hour = 0;
		return { hour, minute };
	}
	const exact = CLOCK_RE.exec(sentence) ?? DUTCH_CLOCK_RE.exec(sentence);
	if (exact) {
		const hour = Number(exact[1]);
		const minute = Number(exact[2]);
		return hour <= 23 && minute <= 59 ? { hour, minute } : null;
	}
	const bare = HOUR_ONLY_RE.exec(sentence);
	if (bare) {
		const hour = Number(bare[1]);
		return hour <= 23 ? { hour, minute: 0 } : null;
	}
	return null;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** A real calendar day, or null: 31 February is not one. */
function calendarDay(year: number, month: number, day: number): Date | null {
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(year, month - 1, day);
	return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** The first day a sentence names, resolved against the day the message was written. */
function dayOf(sentence: string, written: Date): Date | null {
	const relative = RELATIVE_RE.exec(sentence);
	const weekday = WEEKDAY_RE.exec(sentence);
	const textual = TEXT_DATE_RE.exec(sentence);
	const numeric = NUMERIC_DATE_RE.exec(sentence);

	const found = [
		relative ? { at: relative.index, kind: "relative" as const } : null,
		weekday ? { at: weekday.index, kind: "weekday" as const } : null,
		textual ? { at: textual.index, kind: "textual" as const } : null,
		numeric ? { at: numeric.index, kind: "numeric" as const } : null,
	]
		.filter((entry): entry is { at: number; kind: "relative" | "weekday" | "textual" | "numeric" } => entry !== null)
		.sort((a, b) => a.at - b.at)[0];
	if (!found) return null;

	if (found.kind === "relative") {
		const word = relative![1]!;
		if (word === "vandaag" || word === "today") return startOfDay(written);
		return addDays(startOfDay(written), word === "overmorgen" ? 2 : 1);
	}
	if (found.kind === "weekday") {
		const target = WEEKDAYS[weekday![1]!]!;
		// Strictly after the day it was written: "Friday", on a Friday, is next week.
		const ahead = ((target - written.getDay() + 7) % 7) || 7;
		return addDays(startOfDay(written), ahead);
	}

	const [dayText, monthWord, numericMonth, yearText] =
		found.kind === "textual"
			? [textual![1]!, textual![2]!, null, textual![3]]
			: [numeric![1]!, null, numeric![2]!, numeric![3]];
	const month = monthWord ? MONTHS[monthWord]! : Number(numericMonth);
	let year = written.getFullYear();
	if (yearText) year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
	let date = calendarDay(year, month, Number(dayText));
	// A date with no year that already passed this year is the one next year.
	if (date && !yearText && date < startOfDay(written)) date = calendarDay(year + 1, month, Number(dayText));
	return date;
}

function labelFor(date: Date, today: Date): string {
	const gap = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / 86_400_000);
	if (gap === 0) return "today";
	if (gap === 1) return "tomorrow";
	if (gap > 1 && gap < 7) return ENGLISH_DAYS[date.getDay()]!;
	return `${date.getDate()} ${ENGLISH_MONTHS[date.getMonth()]!}`;
}

/**
 * The first sentence that names both a day and a time, if that moment is still
 * ahead of `now`. `written` is when the message was written, which is what
 * "Friday" and "tomorrow" are counted from.
 */
export function detectMoment(text: string, written: Date, now: Date = new Date()): DetectedMoment | null {
	const body = stripQuotedHistory(text).slice(0, 6000).toLowerCase();
	for (const sentence of body.split(/[.!?;]\s+|\n+/)) {
		const clock = clockOf(sentence);
		if (!clock) continue;
		const day = dayOf(sentence, written);
		if (!day) continue;

		const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.hour, clock.minute);
		if (start.getTime() < now.getTime()) continue;
		const time = `${pad(clock.hour)}:${pad(clock.minute)}`;
		return {
			startLocal: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}:00`,
			dayLabel: labelFor(day, now),
			time,
		};
	}
	return null;
}
