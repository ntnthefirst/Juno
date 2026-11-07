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

export interface DetectedReminder {
	/** `deadline` is a thing asked for by a day, `followup` is a promise to come back. */
	kind: "deadline" | "followup";
	/** `YYYY-MM-DD`, in the machine's local calendar. */
	dueOn: string;
	/** How the day is said in the bar: "Friday", "15 March". */
	dayLabel: string;
}

/** The words that put a date after them in the sense of "no later than". */
const DEADLINE_CUE_RE =
	/\b(?:tegen|voor|uiterlijk|ten laatste|deadline(?:\s+is)?|by|before|no later than|due(?:\s+by|\s+on)?)\s+((?:(?:uiterlijk|graag|ten laatste|op|de|dit|deze|aanstaande|next|this|the|on)\s+)*)/g;

/** A day expression at the very start of the text, which is what "by Friday" means. */
const LEADING_DAY_RES = [
	new RegExp(`^${RELATIVE_RE.source}`),
	new RegExp(`^${WEEKDAY_RE.source}`),
	new RegExp(`^${TEXT_DATE_RE.source}`),
	new RegExp(`^${NUMERIC_DATE_RE.source}`),
];

/** What follows a number that makes it a quantity and not a date: "3-4 uur", "15/20 personen". */
const QUANTITY_AFTER_RE = /^\s*(?:uur|u\b|h\b|hours?|personen|people|stuks|pieces|dagen|days|weken|weeks|euro|eur|€|%)/;
const MONEY_RE = /€\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|eur\b|euro\b|%)/g;

/** Words that may sit between "ik laat" and "weten" without changing who is told what. */
const WETEN_FILLER = `het|u|je|jullie|iets|nog|snel|spoedig|binnenkort|later|dan|volgende|deze|week|morgen|overmorgen|vandaag|${WEEKDAY_NAMES}`;

const FOLLOW_UP_RES = [
	new RegExp(String.raw`\b(?:ik|we|wij)\s+(?:laat|laten|zal|zullen)\s+(?:(?:${WETEN_FILLER})\s+){0,4}weten\b`),
	/\b(?:ik|we|wij)\s+(?:laat|laten)\s+(?:(?:snel|nog|binnenkort|volgende|deze|week|later)\s+){0,3}iets\s+van\s+(?:me|mij|ons)\s+horen\b/,
	new RegExp(String.raw`\b(?:ik|we|wij)\s+(?:kom|komen)\s+(?:(?:er|hier|daar|erop|hierop|daarop|op|bij|u|je|jullie|volgende|deze|week|nog|snel|binnenkort|later|${WEEKDAY_NAMES})\s+){0,5}terug\b`),
	/\b(?:ik|we|wij)\s+(?:zal|zullen)\s+(?:(?:er|hier|daar|erop|snel|nog|binnenkort|later)\s+)*(?:op\s+)?terugkomen\b/,
	/\b(?:ik|we|wij)\s+(?:bel|bellen)\s+(?:u|je|jullie)\s+(?:nog\s+|snel\s+)?terug\b/,
	/\b(?:ik|we|wij)\s+(?:neem|nemen)\s+(?:binnenkort\s+|snel\s+)?contact\s+(?:met\s+(?:u|je|jullie)\s+)?op\b/,
	/\b(?:i|we)(?:'ll|\s+will|\s+shall)\s+(?:get back to you|come back to you|follow up|be in touch|let you know|reach out)\b/,
];

/** How far ahead a deadline may be. A year-less date that already passed rolls into next year, and that is rarely what a request means. */
const MAX_DEADLINE_DAYS = 180;

const NEXT_WEEK_RE = /\b(?:volgende week|next week|binnen (?:een|1) week|within a week)\b/;
/** Without a day, how long after the message was written a promise is worth checking on. */
const FOLLOW_UP_DEFAULT_DAYS = 7;

function daysBetween(from: Date, to: Date): number {
	return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function localIso(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day a "by ..." phrase names, or null when the number after the cue is a quantity. */
function deadlineDay(sentence: string, written: Date): Date | null {
	const clean = sentence.replace(MONEY_RE, " ");
	DEADLINE_CUE_RE.lastIndex = 0;
	for (let cue = DEADLINE_CUE_RE.exec(clean); cue; cue = DEADLINE_CUE_RE.exec(clean)) {
		const rest = clean.slice(cue.index + cue[0].length);
		for (const re of LEADING_DAY_RES) {
			const hit = re.exec(rest);
			if (!hit) continue;
			if (QUANTITY_AFTER_RE.test(rest.slice(hit[0].length))) continue;
			const day = dayOf(hit[0], written);
			if (day) return day;
		}
	}
	return null;
}

/**
 * A message that asks for something by a day ("tegen vrijdag", "by Friday",
 * "graag voor 15 maart"), or says its writer will come back ("ik laat iets
 * weten", "I'll get back to you"). The first is due on that day, the second on
 * the day named or a week after the message.
 *
 * Shy on purpose: a bare date is not a deadline, so a cue has to sit right in
 * front of it. A sentence that also has a clock time is an appointment and is
 * left to the calendar suggestion. A day that has passed is never offered.
 */
export function detectReminder(text: string, written: Date, now: Date = new Date()): DetectedReminder | null {
	const body = stripQuotedHistory(text).slice(0, 6000).toLowerCase().replace(/[’‘]/g, "'");
	const sentences = body.split(/[.!?;]\s+|\n+/);
	const today = startOfDay(now);

	for (const sentence of sentences) {
		if (clockOf(sentence)) continue;
		const day = deadlineDay(sentence, written);
		if (!day || day < today || daysBetween(today, day) > MAX_DEADLINE_DAYS) continue;
		return { kind: "deadline", dueOn: localIso(day), dayLabel: labelFor(day, now) };
	}

	for (const sentence of sentences) {
		if (!FOLLOW_UP_RES.some((re) => re.test(sentence))) continue;
		const named = clockOf(sentence) ? null : dayOf(sentence, written);
		const day = named ?? addDays(startOfDay(written), NEXT_WEEK_RE.test(sentence) ? 7 : FOLLOW_UP_DEFAULT_DAYS);
		if (day < today) continue;
		return { kind: "followup", dueOn: localIso(day), dayLabel: labelFor(day, now) };
	}
	return null;
}
