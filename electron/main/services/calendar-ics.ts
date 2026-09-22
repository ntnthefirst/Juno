/**
 * The .ics boundary: events out to a file, and a file in to events.
 *
 * `ical.js` parses and serialises; it does not decide what a time means. The
 * rules for that are here, and they follow RFC 5545 rather than whichever
 * calendar wrote the file:
 *
 * - A DTSTART with an IANA TZID keeps its wall clock and its zone. This is
 *   what Juno writes, and what Google and Apple write.
 * - A DTSTART with some other TZID (Outlook writes Windows names) and a
 *   VTIMEZONE in the file is converted to an instant using that VTIMEZONE and
 *   then expressed in the default zone, with a warning, because the wall clock
 *   in a zone Juno cannot name is not something it can keep.
 * - A UTC DTSTART is expressed in the default zone.
 * - A floating DTSTART is taken to be the default zone's wall clock.
 * - A DATE DTSTART is an all-day event, and stays a date.
 *
 * Exported timed events carry a VTIMEZONE built from what `Intl` knows about
 * the zone, so a reader that does not carry its own zone table still lands
 * the occurrences after a DST change on the right hour.
 */
import ICAL from "ical.js";
import { ruleUntilFromUtc, ruleUntilToUtc, normaliseRule } from "./calendar-recurrence";
import {
	addLocalDays,
	addLocalMinutes,
	isValidTimeZone,
	localMinutesBetween,
	localToUtc,
	offsetMinutesAt,
	utcToLocal,
	wallClockAt,
	formatLocal,
} from "./calendar-time";

export interface IcsException {
	occurrenceStartLocal: string;
	cancelled: boolean;
	title: string | null;
	notes: string | null;
	location: string | null;
	startLocal: string | null;
	endLocal: string | null;
}

export interface IcsEvent {
	icalUid: string;
	title: string;
	notes: string | null;
	location: string | null;
	allDay: boolean;
	startLocal: string;
	endLocal: string;
	timezone: string;
	rrule: string | null;
	exceptions: IcsException[];
	createdAt?: string;
	updatedAt?: string;
}

export interface IcsParseResult {
	events: IcsEvent[];
	warnings: string[];
}

const PRODUCT = "-//Juno//Calendar//EN";

/* --------------------------------------------------------------- export */

/** An instant as an ical.js UTC time, for DTSTAMP and CREATED. */
function utcTime(iso: string): ICAL.Time {
	return ICAL.Time.fromDateTimeString(iso.replace(/\.\d{3}Z$/, "Z"));
}

function timeProperty(component: ICAL.Component, name: string, local: string, allDay: boolean, zone: string): void {
	if (allDay) {
		component.addPropertyWithValue(name, ICAL.Time.fromDateString(local.slice(0, 10)));
		return;
	}
	const property = component.addPropertyWithValue(name, ICAL.Time.fromDateTimeString(local));
	property.setParameter("tzid", zone);
}

function rruleForFile(rrule: string, allDay: boolean, zone: string): string {
	if (allDay) {
		// An all-day series ends on a date, and the file says so as a date.
		return normaliseRule(rrule).replace(/UNTIL=(\d{8})T\d{6}Z?/, "UNTIL=$1");
	}
	return ruleUntilToUtc(rrule, zone);
}

/**
 * A VTIMEZONE for an IANA zone, worked out from `Intl`.
 *
 * The year is sampled for offset changes. No change gives one STANDARD block.
 * Two changes give a DAYLIGHT and a STANDARD block, each with a yearly rule on
 * the weekday and week the change fell on, which is how every zone with a
 * regular DST schedule is defined. A zone with an irregular schedule gets the
 * sampled year's dates, which is the most any table-free method can say.
 */
export function buildVtimezone(zone: string, year: number): ICAL.Component {
	const tz = new ICAL.Component("vtimezone");
	tz.addPropertyWithValue("tzid", zone);

	const transitions: { at: number; from: number; to: number }[] = [];
	let previous = offsetMinutesAt(new Date(Date.UTC(year, 0, 1)), zone);
	for (let day = 1; day <= 366; day++) {
		const at = Date.UTC(year, 0, 1 + day);
		const offset = offsetMinutesAt(new Date(at), zone);
		if (offset === previous) continue;
		// Narrow the change to the minute within the day.
		let low = at - 86_400_000;
		let high = at;
		while (high - low > 60_000) {
			const mid = Math.floor((low + high) / 2 / 60_000) * 60_000;
			if (offsetMinutesAt(new Date(mid), zone) === previous) low = mid;
			else high = mid;
		}
		transitions.push({ at: high, from: previous, to: offset });
		previous = offset;
	}

	const offsetOf = (minutes: number) => ICAL.UtcOffset.fromSeconds(minutes * 60);

	const block = (name: "standard" | "daylight", t: { at: number; from: number; to: number }, rule: boolean) => {
		const c = new ICAL.Component(name);
		c.addPropertyWithValue("tzoffsetfrom", offsetOf(t.from));
		c.addPropertyWithValue("tzoffsetto", offsetOf(t.to));
		// DTSTART is the wall clock in the offset being left, per the RFC.
		const wall = wallClockAt(new Date(t.at + t.from * 60_000), "UTC");
		c.addPropertyWithValue("dtstart", ICAL.Time.fromDateTimeString(formatLocal(wall)));
		if (rule) {
			const daysInMonth = new Date(Date.UTC(wall.year, wall.month, 0)).getUTCDate();
			const weekday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][
				new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()
			];
			const nth = wall.day + 7 > daysInMonth ? -1 : Math.ceil(wall.day / 7);
			c.addPropertyWithValue(
				"rrule",
				ICAL.Recur.fromString(`FREQ=YEARLY;BYMONTH=${wall.month};BYDAY=${nth}${weekday}`),
			);
		}
		tz.addSubcomponent(c);
	};

	if (transitions.length === 0) {
		const c = new ICAL.Component("standard");
		c.addPropertyWithValue("tzoffsetfrom", offsetOf(previous));
		c.addPropertyWithValue("tzoffsetto", offsetOf(previous));
		c.addPropertyWithValue("dtstart", ICAL.Time.fromDateTimeString("1970-01-01T00:00:00"));
		tz.addSubcomponent(c);
		return tz;
	}

	for (const t of transitions) {
		block(t.to > t.from ? "daylight" : "standard", t, transitions.length === 2);
	}
	return tz;
}

export function buildIcs(events: IcsEvent[], now: string = new Date().toISOString()): string {
	const calendar = new ICAL.Component("vcalendar");
	calendar.addPropertyWithValue("version", "2.0");
	calendar.addPropertyWithValue("prodid", PRODUCT);
	calendar.addPropertyWithValue("calscale", "GREGORIAN");
	calendar.addPropertyWithValue("method", "PUBLISH");

	const zones = new Set(events.filter((e) => !e.allDay).map((e) => e.timezone));
	const year = Number(now.slice(0, 4));
	for (const zone of zones) calendar.addSubcomponent(buildVtimezone(zone, year));

	for (const event of events) {
		const stamp = utcTime(event.updatedAt ?? now);
		const master = new ICAL.Component("vevent");
		master.addPropertyWithValue("uid", event.icalUid);
		master.addPropertyWithValue("dtstamp", stamp);
		master.addPropertyWithValue("summary", event.title);
		if (event.notes) master.addPropertyWithValue("description", event.notes);
		if (event.location) master.addPropertyWithValue("location", event.location);
		timeProperty(master, "dtstart", event.startLocal, event.allDay, event.timezone);
		timeProperty(master, "dtend", event.endLocal, event.allDay, event.timezone);
		if (event.rrule) {
			master.addPropertyWithValue(
				"rrule",
				ICAL.Recur.fromString(rruleForFile(event.rrule, event.allDay, event.timezone)),
			);
		}
		for (const exception of event.exceptions) {
			if (!exception.cancelled) continue;
			timeProperty(master, "exdate", exception.occurrenceStartLocal, event.allDay, event.timezone);
		}
		if (event.createdAt) master.addPropertyWithValue("created", utcTime(event.createdAt));
		calendar.addSubcomponent(master);

		const duration = event.allDay
			? Math.max(1, Math.round(localMinutesBetween(event.startLocal, event.endLocal) / 1440))
			: localMinutesBetween(event.startLocal, event.endLocal);

		for (const exception of event.exceptions) {
			if (exception.cancelled) continue;
			const override = new ICAL.Component("vevent");
			override.addPropertyWithValue("uid", event.icalUid);
			override.addPropertyWithValue("dtstamp", stamp);
			timeProperty(override, "recurrence-id", exception.occurrenceStartLocal, event.allDay, event.timezone);
			override.addPropertyWithValue("summary", exception.title ?? event.title);
			const notes = exception.notes ?? event.notes;
			if (notes) override.addPropertyWithValue("description", notes);
			const location = exception.location ?? event.location;
			if (location) override.addPropertyWithValue("location", location);
			const start = exception.startLocal ?? exception.occurrenceStartLocal;
			const end =
				exception.endLocal ?? (event.allDay ? addLocalDays(start, duration) : addLocalMinutes(start, duration));
			timeProperty(override, "dtstart", start, event.allDay, event.timezone);
			timeProperty(override, "dtend", end, event.allDay, event.timezone);
			calendar.addSubcomponent(override);
		}
	}

	return calendar.toString();
}

/* --------------------------------------------------------------- import */

interface ResolvedTime {
	isDate: boolean;
	/** Wall clock as written, when the file gave one. */
	local: string;
	/** The IANA zone that wall clock is in, when the file named one. */
	zone: string | null;
	/** The instant, when the file gave one directly or through a VTIMEZONE. */
	utc: string | null;
}

function resolveTime(property: ICAL.Property | null): ResolvedTime | null {
	if (!property) return null;
	const value = property.getFirstValue();
	if (!(value instanceof ICAL.Time)) return null;
	const rawTzid = property.getParameter("tzid");
	const tzid = typeof rawTzid === "string" ? rawTzid : null;
	if (value.isDate) return { isDate: true, local: value.toString(), zone: null, utc: null };
	if (tzid && isValidTimeZone(tzid)) {
		return { isDate: false, local: value.toString().replace(/Z$/, ""), zone: tzid, utc: null };
	}
	if (value.zone === ICAL.Timezone.utcTimezone) {
		return { isDate: false, local: "", zone: null, utc: value.toJSDate().toISOString() };
	}
	if (value.zone && value.zone !== ICAL.Timezone.localTimezone) {
		// A VTIMEZONE from the file was registered under this TZID, so the
		// instant is exact even though the zone has no IANA name.
		return { isDate: false, local: "", zone: null, utc: value.toJSDate().toISOString() };
	}
	return { isDate: false, local: value.toString(), zone: null, utc: null };
}

/** Expresses a resolved time as a wall clock in `zone`. */
function inZone(time: ResolvedTime, zone: string): string {
	if (time.isDate) return time.local;
	if (time.utc) return utcToLocal(time.utc, zone);
	if (time.zone && time.zone !== zone) return utcToLocal(localToUtc(time.local, time.zone), zone);
	return time.local;
}

function text(component: ICAL.Component, name: string): string | null {
	const value = component.getFirstPropertyValue(name);
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function parseIcs(source: string, defaultZone: string): IcsParseResult {
	const warnings: string[] = [];
	let root: ICAL.Component;
	try {
		root = new ICAL.Component(ICAL.parse(source.replace(/\r?\n/g, "\r\n")));
	} catch (cause: unknown) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`That file is not a calendar Juno can read: ${detail}`);
	}

	// A file may wrap one VCALENDAR or be one. Both happen.
	const calendars = root.name === "vcalendar" ? [root] : root.getAllSubcomponents("vcalendar");
	if (calendars.length === 0) throw new Error("That file has no VCALENDAR in it.");

	const registered: string[] = [];
	try {
		for (const calendar of calendars) {
			for (const vtimezone of calendar.getAllSubcomponents("vtimezone")) {
				const tzid = text(vtimezone, "tzid");
				if (!tzid || isValidTimeZone(tzid) || ICAL.TimezoneService.has(tzid)) continue;
				ICAL.TimezoneService.register(vtimezone);
				registered.push(tzid);
			}
		}

		const masters = new Map<string, IcsEvent>();
		const overrides: { uid: string; component: ICAL.Component }[] = [];
		let anonymous = 0;

		for (const calendar of calendars) {
			for (const component of calendar.getAllSubcomponents("vevent")) {
				let uid = text(component, "uid");
				if (!uid) {
					anonymous += 1;
					uid = `imported-${anonymous}@juno`;
					warnings.push(`An event had no UID and was given ${uid}.`);
				}
				if (component.getFirstProperty("recurrence-id")) {
					overrides.push({ uid, component });
					continue;
				}
				const parsed = parseMaster(component, uid, defaultZone, warnings);
				if (!parsed) continue;
				if (masters.has(uid)) warnings.push(`${uid} appears more than once; the last one was kept.`);
				masters.set(uid, parsed);
			}
		}

		for (const { uid, component } of overrides) {
			const master = masters.get(uid);
			if (!master) {
				// Nothing to hang it off, so it is an event of its own.
				const parsed = parseMaster(component, uid, defaultZone, warnings);
				if (parsed) {
					parsed.icalUid = `${uid}-${component.getFirstProperty("recurrence-id")?.getFirstValue()?.toString() ?? "override"}`;
					masters.set(parsed.icalUid, parsed);
					warnings.push(`${uid} has a changed occurrence but no series; it was imported as a single event.`);
				}
				continue;
			}
			const recurrenceId = resolveTime(component.getFirstProperty("recurrence-id"));
			const start = resolveTime(component.getFirstProperty("dtstart"));
			if (!recurrenceId || !start) continue;
			const key = inZone(recurrenceId, master.timezone);
			const startLocal = inZone(start, master.timezone);
			const end = resolveTime(component.getFirstProperty("dtend"));
			const endLocal = end ? inZone(end, master.timezone) : null;
			const title = text(component, "summary");
			const notes = text(component, "description");
			const location = text(component, "location");
			master.exceptions = master.exceptions.filter((e) => e.occurrenceStartLocal !== key);
			master.exceptions.push({
				occurrenceStartLocal: key,
				cancelled: false,
				title: title !== null && title !== master.title ? title : null,
				notes: notes !== null && notes !== master.notes ? notes : null,
				location: location !== null && location !== master.location ? location : null,
				startLocal,
				endLocal,
			});
		}

		return { events: [...masters.values()], warnings };
	} finally {
		for (const tzid of registered) ICAL.TimezoneService.remove(tzid);
	}
}

function parseMaster(
	component: ICAL.Component,
	uid: string,
	defaultZone: string,
	warnings: string[],
): IcsEvent | null {
	const start = resolveTime(component.getFirstProperty("dtstart"));
	if (!start) {
		warnings.push(`${uid} has no start and was skipped.`);
		return null;
	}
	const title = text(component, "summary") ?? "(untitled)";
	const allDay = start.isDate;
	const zone = start.zone ?? defaultZone;
	if (!allDay && !start.zone) {
		const rawTzid = component.getFirstProperty("dtstart")?.getParameter("tzid");
		if (typeof rawTzid === "string") {
			warnings.push(`${title}: the zone "${rawTzid}" is not a standard name, so the event was placed in ${defaultZone}.`);
		}
	}

	const startLocal = inZone(start, zone);
	const end = resolveTime(component.getFirstProperty("dtend"));
	let endLocal: string;
	if (end) {
		endLocal = inZone(end, zone);
	} else {
		const duration = component.getFirstPropertyValue("duration");
		const seconds = duration instanceof ICAL.Duration ? duration.toSeconds() : 0;
		endLocal = allDay
			? addLocalDays(startLocal, Math.max(1, Math.round(seconds / 86_400)))
			: addLocalMinutes(startLocal, Math.round(seconds / 60));
	}
	if (allDay && endLocal <= startLocal) endLocal = addLocalDays(startLocal, 1);
	if (!allDay && endLocal < startLocal) endLocal = startLocal;

	let rrule: string | null = null;
	const recur = component.getFirstPropertyValue("rrule");
	if (recur instanceof ICAL.Recur) {
		try {
			const raw = recur.toString();
			rrule = /UNTIL=\d{8}T\d{6}Z/.test(raw) && !allDay ? ruleUntilFromUtc(raw, zone) : normaliseRule(raw);
		} catch (cause: unknown) {
			warnings.push(`${title}: its repeat rule could not be read and was dropped. ${cause instanceof Error ? cause.message : ""}`.trim());
		}
	}

	const exceptions: IcsException[] = [];
	if (rrule) {
		for (const property of component.getAllProperties("exdate")) {
			for (const value of property.getValues()) {
				if (!(value instanceof ICAL.Time)) continue;
				const rawTzid = property.getParameter("tzid");
				const tzid = typeof rawTzid === "string" ? rawTzid : null;
				const resolved: ResolvedTime = value.isDate
					? { isDate: true, local: value.toString(), zone: null, utc: null }
					: tzid && isValidTimeZone(tzid)
						? { isDate: false, local: value.toString(), zone: tzid, utc: null }
						: value.zone && value.zone !== ICAL.Timezone.localTimezone
							? { isDate: false, local: "", zone: null, utc: value.toJSDate().toISOString() }
							: { isDate: false, local: value.toString(), zone: null, utc: null };
				exceptions.push({
					occurrenceStartLocal: inZone(resolved, zone),
					cancelled: true,
					title: null,
					notes: null,
					location: null,
					startLocal: null,
					endLocal: null,
				});
			}
		}
	}

	return {
		icalUid: uid,
		title,
		notes: text(component, "description"),
		location: text(component, "location"),
		allDay,
		startLocal,
		endLocal,
		timezone: zone,
		rrule,
		exceptions,
	};
}
