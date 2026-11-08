/**
 * Reading a calendar feed someone else wrote, as hostile input.
 *
 * A subscription's text comes from a server Juno does not control, so it is
 * read with limits the owner's own .ics import does not need: a cap on how
 * many events, how long a title or a note can be, how many changed
 * occurrences a series can carry and how far a COUNT can run, and no control
 * characters in anything that will be drawn. `calendar-ics.ts` does the
 * parsing, including recurrence, and nothing here evaluates what a feed says.
 *
 * Pure, so the limits are tested on their own (calendar-feed.test.ts).
 */
import type { CalendarSubscriptionPreview } from "../../shared/types";
import { parseIcs, type IcsEvent } from "./calendar-ics";
import { expandSeries, seriesEndUtc, type SeriesShape } from "./calendar-recurrence";
import { isValidTimeZone, localDateStartUtc, localToUtc } from "./calendar-time";

/** More than a busy calendar holds in ten years. A feed past it is refused, not cut short. */
export const MAX_EVENTS = 10_000;
const MAX_EXCEPTIONS = 1_000;
/** A COUNT past this is cut to it, so working out where a series ends stays quick. */
const MAX_COUNT = 2_000;
const MAX_TITLE = 300;
const MAX_LOCATION = 300;
const MAX_NOTES = 8_000;
const MAX_NAME = 120;
const MAX_ADDRESS = 2_048;

export class FeedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FeedError";
	}
}

/** An event ready to store: the parsed shape, cleaned, with its instants worked out. */
export interface FeedEvent extends IcsEvent {
	startUtc: string;
	endUtc: string;
	seriesEndUtc: string | null;
}

export interface ParsedFeed {
	/** The name the feed gives itself (X-WR-CALNAME), or null. */
	name: string | null;
	events: FeedEvent[];
	warnings: string[];
}

/**
 * The address as Juno keeps it. `webcal://` is what Apple and Outlook hand out
 * for the same https address, so it is read as one. Anything else that is not
 * https is refused here, before a request is made.
 */
export function normaliseAddress(raw: string): URL {
	const trimmed = raw.trim();
	if (!trimmed) throw new FeedError("Paste the address of the calendar.");
	if (trimmed.length > MAX_ADDRESS) throw new FeedError("That address is too long to be a calendar address.");
	const swapped = trimmed.replace(/^webcals?:\/\//i, "https://");
	let url: URL;
	try {
		url = new URL(swapped);
	} catch {
		throw new FeedError("That is not a web address. A calendar address starts with https://.");
	}
	if (url.protocol !== "https:") {
		throw new FeedError("Only https addresses can be subscribed to. Ask for the https address of the calendar.");
	}
	if (url.username || url.password) throw new FeedError("An address with a login in it cannot be subscribed to.");
	url.hash = "";
	return url;
}

/** Keeps line breaks and tabs, drops every other control character, and cuts to a length. */
export function cleanText(value: string, max: number): string {
	// Compared by code point rather than with a character class, so the source
	// holds no control characters of its own. The C1 range, the zero-width and
	// line-separator characters and the direction overrides go too: they
	// reorder or hide text.
	const stripped = Array.from(value)
		.filter((char) => {
			const code = char.codePointAt(0)!;
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
			return !(code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0) || code === 0x200b || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069));
		})
		.join("")
		.trim();
	return stripped.length > max ? `${stripped.slice(0, max - 3).trimEnd()}...` : stripped;
}

function cleanOptional(value: string | null, max: number): string | null {
	if (value === null) return null;
	const cleaned = cleanText(value, max);
	return cleaned.length > 0 ? cleaned : null;
}

/** The calendar's own name, from the first X-WR-CALNAME line, unfolded. */
export function feedName(source: string): string | null {
	const unfolded = source.slice(0, 64 * 1024).replace(/\r?\n[ \t]/g, "");
	const match = /^X-WR-CALNAME(?:;[^:\r\n]*)?:(.*)$/im.exec(unfolded);
	if (!match) return null;
	const name = cleanText(match[1]!.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " "), MAX_NAME);
	return name.length > 0 ? name : null;
}

function clampCount(rrule: string | null): string | null {
	if (!rrule) return null;
	return rrule.replace(/COUNT=(\d+)/i, (_whole, count: string) => `COUNT=${Math.min(Number(count), MAX_COUNT)}`);
}

function instantOf(shape: Pick<SeriesShape, "allDay" | "timezone">, local: string): string {
	return shape.allDay ? localDateStartUtc(local, shape.timezone) : localToUtc(local, shape.timezone);
}

/**
 * Parses a feed and cleans what it says. Throws a sentence naming `host`
 * when the text is not a calendar at all; an event that cannot be placed is
 * left out with a warning instead, so one broken entry does not cost the rest.
 */
export function parseFeed(source: string, host: string, defaultZone: string): ParsedFeed {
	if (!/BEGIN:VCALENDAR/i.test(source.slice(0, 4096))) {
		throw new FeedError(`${host} did not send a calendar. Check that the address is the one in iCal format.`);
	}
	let parsed: ReturnType<typeof parseIcs>;
	try {
		parsed = parseIcs(source, defaultZone);
	} catch {
		throw new FeedError(`${host} sent a calendar Juno cannot read.`);
	}
	if (parsed.events.length > MAX_EVENTS) {
		throw new FeedError(
			`${host} sent ${parsed.events.length.toLocaleString("en-GB")} events. Juno keeps at most ${MAX_EVENTS.toLocaleString("en-GB")} for one calendar.`,
		);
	}

	const warnings = parsed.warnings.slice(0, 20).map((warning) => cleanText(warning, 300));
	const events: FeedEvent[] = [];
	for (const raw of parsed.events) {
		if (!isValidTimeZone(raw.timezone)) continue;
		const event: IcsEvent = {
			...raw,
			icalUid: cleanText(raw.icalUid, 500) || `feed-${events.length}`,
			title: cleanText(raw.title, MAX_TITLE) || "(untitled)",
			notes: cleanOptional(raw.notes, MAX_NOTES),
			location: cleanOptional(raw.location, MAX_LOCATION),
			rrule: clampCount(raw.rrule),
			exceptions: raw.exceptions.slice(0, MAX_EXCEPTIONS).map((exception) => ({
				...exception,
				title: cleanOptional(exception.title, MAX_TITLE),
				notes: cleanOptional(exception.notes, MAX_NOTES),
				location: cleanOptional(exception.location, MAX_LOCATION),
			})),
		};
		try {
			const shape: SeriesShape = {
				startLocal: event.startLocal,
				endLocal: event.endLocal,
				allDay: event.allDay,
				timezone: event.timezone,
				rrule: event.rrule,
			};
			events.push({
				...event,
				startUtc: instantOf(shape, event.startLocal),
				endUtc: instantOf(shape, event.endLocal),
				seriesEndUtc: seriesEndUtc(shape),
			});
		} catch {
			if (warnings.length < 20) warnings.push(`${event.title}: its dates could not be read, so it was left out.`);
		}
	}

	// Two entries with one UID would fight over one row; the last one wins, as an import does.
	const byUid = new Map(events.map((event) => [event.icalUid, event]));
	return { name: feedName(source), events: [...byUid.values()], warnings };
}

/** The first occurrence that starts at or after `nowUtc`, within a year. */
export function nextOccurrence(events: FeedEvent[], nowUtc: string): CalendarSubscriptionPreview["next"] {
	const horizon = new Date(Date.parse(nowUtc) + 366 * 86_400_000).toISOString();
	let best: NonNullable<CalendarSubscriptionPreview["next"]> | null = null;
	const consider = (title: string, startUtc: string, startLocal: string, allDay: boolean) => {
		if (startUtc < nowUtc || startUtc >= horizon) return;
		if (!best || startUtc < best.startUtc) best = { title, startUtc, startLocal, allDay };
	};
	for (const event of events) {
		if (!event.rrule) {
			consider(event.title, event.startUtc, event.startLocal, event.allDay);
			continue;
		}
		if (event.seriesEndUtc !== null && event.seriesEndUtc < nowUtc) continue;
		try {
			const shape: SeriesShape = { ...event };
			for (const occurrence of expandSeries(shape, event.exceptions, nowUtc, horizon)) {
				if (occurrence.startUtc < nowUtc) continue;
				consider(occurrence.title ?? event.title, occurrence.startUtc, occurrence.startLocal, event.allDay);
				break;
			}
		} catch {
			// A rule that cannot be expanded has no next occurrence to offer.
		}
	}
	return best;
}
