/**
 * Calendar subscriptions: calendars Juno reads from an https address and
 * keeps up to date by itself. Read only, and the only place their rules live.
 *
 * - **The address is a secret.** A Google secret iCal address lets anyone who
 *   holds it read the calendar, so it is kept by the credential store, like a
 *   mail password, and never returned to the window or an agent. The row holds
 *   its host and a hash (security.md section 1).
 * - **Fetching is the main process's, under the shared guard**
 *   (./public-fetch.ts): https only, a public host on every redirect, a size
 *   cap and a time limit, with If-None-Match and If-Modified-Since so an
 *   unchanged feed costs a 304. The text is read as hostile (./calendar-feed.ts).
 * - **A failed fetch keeps the last good events** and says why on the row.
 * - **Its events are their own table**, so nothing written for Juno's own
 *   events can edit, export or delete one. The calendar asks for them by range
 *   (`itemsInRange`) beside its own.
 * - **Asking Juno to fetch an address is the owner's decision.** Preview,
 *   create, update and refresh park for approval when an agent asks, whatever
 *   the levels say; see TOOL_ROWS in ./agent-permissions.ts.
 *
 * Refreshing runs once at launch, then on each subscription's interval while
 * Juno runs and is unlocked, and on demand from its settings row.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type {
	CalendarColour,
	CalendarRefreshMinutes,
	CalendarSubscription,
	CalendarSubscriptionInput,
	CalendarSubscriptionItem,
	CalendarSubscriptionPatch,
	CalendarSubscriptionPreview,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { LOCAL_OWNER_ID, now, uuidv7 } from "../db/columns";
import { calendarSubscriptionEvents, calendarSubscriptions, mailAccounts } from "../db/schema";
import type { IcsException } from "./calendar-ics";
import { FeedError, nextOccurrence, normaliseAddress, parseFeed, type FeedEvent, type ParsedFeed } from "./calendar-feed";
import { describeRule, expandSeries, type SeriesShape } from "./calendar-recurrence";
import { systemTimeZone } from "./calendar-time";
import { credentialStore } from "./mail-credentials";
import { fetchPublic, PublicFetchError, type Fetcher, type Lookup } from "./public-fetch";

type Row = typeof calendarSubscriptions.$inferSelect;

export const COLOURS: CalendarColour[] = [
	"accent",
	"seal",
	"tone-1-ink",
	"tone-2-ink",
	"tone-3-ink",
	"tone-4-ink",
	"tone-5-ink",
	"tone-6-ink",
	"tone-7-ink",
	"tone-8-ink",
];
export const REFRESH_MINUTES: CalendarRefreshMinutes[] = [15, 60, 1440];

const SIZE_LIMIT = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_NAME = 120;
const ACCEPT = "text/calendar, text/plain;q=0.5, */*;q=0.1";

/** The network, injected so tests run with no network at all. */
export interface Net {
	fetcher?: Fetcher;
	resolve?: Lookup;
}

export class CalendarSubscriptionError extends Error {
	readonly code: "NOT_FOUND" | "INVALID" | "DUPLICATE" | "NO_STORE";
	constructor(code: CalendarSubscriptionError["code"], message: string) {
		super(message);
		this.name = "CalendarSubscriptionError";
		this.code = code;
	}
}

const invalid = (message: string) => new CalendarSubscriptionError("INVALID", message);

/* ----------------------------------------------------------------- shape */

function alive() {
	return and(eq(calendarSubscriptions.ownerId, LOCAL_OWNER_ID), isNull(calendarSubscriptions.deletedAt));
}

function toRecord(row: Row, mailAccountEmail: string | null): CalendarSubscription {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		name: row.name,
		host: row.host,
		colour: COLOURS.includes(row.colour as CalendarColour) ? (row.colour as CalendarColour) : "accent",
		refreshMinutes: REFRESH_MINUTES.includes(row.refreshMinutes as CalendarRefreshMinutes)
			? (row.refreshMinutes as CalendarRefreshMinutes)
			: 60,
		shown: row.shown,
		lastFetchedAt: row.lastFetchedAt,
		lastAttemptAt: row.lastAttemptAt,
		lastError: row.lastError,
		eventCount: row.eventCount,
		mailAccountId: row.mailAccountId,
		mailAccountEmail,
	};
}

function readAll(db: Db, id?: string): CalendarSubscription[] {
	const rows = db
		.select({ row: calendarSubscriptions, email: mailAccounts.email, accountDeleted: mailAccounts.deletedAt })
		.from(calendarSubscriptions)
		.leftJoin(mailAccounts, eq(calendarSubscriptions.mailAccountId, mailAccounts.id))
		.where(id ? and(alive(), eq(calendarSubscriptions.id, id)) : alive())
		.orderBy(asc(calendarSubscriptions.createdAt), asc(calendarSubscriptions.id))
		.all();
	return rows.map(({ row, email, accountDeleted }) => toRecord(row, accountDeleted ? null : (email ?? null)));
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(calendarSubscriptions)
		.where(and(alive(), eq(calendarSubscriptions.id, id)))
		.get();
	if (!row) {
		throw new CalendarSubscriptionError("NOT_FOUND", `No calendar subscription with id "${id}". It does not exist or it was removed.`);
	}
	return row;
}

/* ------------------------------------------------------------ validation */

function checkName(raw: string): string {
	const name = raw.replace(/\s+/g, " ").trim();
	if (!name) throw invalid("A calendar needs a name.");
	if (name.length > MAX_NAME) throw invalid(`A calendar name can be at most ${MAX_NAME} characters.`);
	return name;
}

function checkColour(colour: string): CalendarColour {
	if (!COLOURS.includes(colour as CalendarColour)) {
		throw invalid(`"${colour}" is not a calendar colour. Use one of ${COLOURS.join(", ")}.`);
	}
	return colour as CalendarColour;
}

function checkRefresh(minutes: number): CalendarRefreshMinutes {
	if (!REFRESH_MINUTES.includes(minutes as CalendarRefreshMinutes)) {
		throw invalid("A calendar is fetched every 15 minutes, every hour (60) or every day (1440).");
	}
	return minutes as CalendarRefreshMinutes;
}

function address(raw: string): URL {
	try {
		return normaliseAddress(raw);
	} catch (cause) {
		throw invalid(cause instanceof Error ? cause.message : String(cause));
	}
}

function hashOf(url: URL): string {
	return createHash("sha256").update(url.href).digest("hex");
}

function checkUnique(url: URL, db: Db, except?: string): void {
	const conditions = [alive(), eq(calendarSubscriptions.urlHash, hashOf(url))];
	if (except) conditions.push(ne(calendarSubscriptions.id, except));
	const existing = db.select({ name: calendarSubscriptions.name }).from(calendarSubscriptions).where(and(...conditions)).get();
	if (existing) throw new CalendarSubscriptionError("DUPLICATE", `You already subscribe to this calendar, as ${existing.name}.`);
}

function checkAccount(mailAccountId: string | null | undefined, db: Db): string | null {
	if (!mailAccountId) return null;
	const account = db
		.select({ id: mailAccounts.id })
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, mailAccountId), isNull(mailAccounts.deletedAt)))
		.get();
	if (!account) throw invalid(`No mail account with id "${mailAccountId}". It does not exist or it was removed.`);
	return account.id;
}

/* ------------------------------------------------------------- the secret */

function keyFor(id: string): string {
	return `calendar-subscription:${id}`;
}

function requireStore() {
	const store = credentialStore();
	if (!store.isAvailable()) {
		throw new CalendarSubscriptionError(
			"NO_STORE",
			"This computer cannot keep the address safe right now, so the calendar was not saved. Try again after signing in to Windows again.",
		);
	}
	return store;
}

/* --------------------------------------------------------------- fetching */

type Fetched =
	| { notModified: true; etag: string | null; lastModified: string | null }
	| { notModified: false; feed: ParsedFeed; etag: string | null; lastModified: string | null };

async function fetchFeed(
	url: URL,
	validators: { etag: string | null; lastModified: string | null } | null,
	net: Net,
): Promise<Fetched> {
	const headers: Record<string, string> = {};
	if (validators?.etag) headers["if-none-match"] = validators.etag;
	if (validators?.lastModified) headers["if-modified-since"] = validators.lastModified;
	const result = await fetchPublic(url.href, {
		label: url.host,
		what: "calendar",
		accept: ACCEPT,
		sizeLimit: SIZE_LIMIT,
		timeoutMs: TIMEOUT_MS,
		headers,
		...(net.fetcher ? { fetcher: net.fetcher } : {}),
		...(net.resolve ? { resolve: net.resolve } : {}),
	});
	// A fresh body brings its own validators, or none; a 304 may leave them out
	// and the ones that were sent still hold.
	const etag = result.headers.get("etag")?.slice(0, 200) ?? null;
	const lastModified = result.headers.get("last-modified")?.slice(0, 100) ?? null;
	if (result.notModified) {
		if (!validators) throw new PublicFetchError(`Juno did not load ${url.host}. The server answered 304.`);
		return { notModified: true, etag: etag ?? validators.etag, lastModified: lastModified ?? validators.lastModified };
	}
	const text = new TextDecoder("utf-8").decode(result.bytes);
	return { notModified: false, feed: parseFeed(text, url.host, systemTimeZone()), etag, lastModified };
}

/** A failure as the row shows it: the guard's and the parser's own words, never a stack. */
function plainError(cause: unknown, host: string): string {
	if (cause instanceof PublicFetchError || cause instanceof FeedError || cause instanceof CalendarSubscriptionError) {
		return cause.message;
	}
	return `Juno could not read ${host}. Try again later.`;
}

/**
 * Brings the stored events in line with a feed: updates what is still there,
 * adds what is new, brings back what returned, and soft-deletes what went.
 * Rows are matched by UID, so a refresh that changes nothing writes nothing.
 */
function storeEvents(subscriptionId: string, events: FeedEvent[], db: Db, stamp: string): void {
	const existing = new Map(
		db
			.select()
			.from(calendarSubscriptionEvents)
			.where(eq(calendarSubscriptionEvents.subscriptionId, subscriptionId))
			.all()
			.map((row) => [row.icalUid, row]),
	);
	const seen = new Set<string>();
	for (const event of events) {
		seen.add(event.icalUid);
		const values = {
			title: event.title,
			notes: event.notes,
			location: event.location,
			allDay: event.allDay,
			startLocal: event.startLocal,
			endLocal: event.endLocal,
			timezone: event.timezone,
			rrule: event.rrule,
			startUtc: event.startUtc,
			endUtc: event.endUtc,
			seriesEndUtc: event.seriesEndUtc,
			exceptionsJson: JSON.stringify(event.exceptions),
		};
		const row = existing.get(event.icalUid);
		if (!row) {
			db.insert(calendarSubscriptionEvents)
				.values({ id: uuidv7(), ownerId: LOCAL_OWNER_ID, createdAt: stamp, updatedAt: stamp, subscriptionId, icalUid: event.icalUid, ...values })
				.run();
			continue;
		}
		const unchanged =
			row.deletedAt === null && (Object.keys(values) as (keyof typeof values)[]).every((key) => row[key] === values[key]);
		if (unchanged) continue;
		db.update(calendarSubscriptionEvents)
			.set({ ...values, deletedAt: null, updatedAt: stamp })
			.where(eq(calendarSubscriptionEvents.id, row.id))
			.run();
	}
	for (const row of existing.values()) {
		if (row.deletedAt !== null || seen.has(row.icalUid)) continue;
		db.update(calendarSubscriptionEvents)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(eq(calendarSubscriptionEvents.id, row.id))
			.run();
	}
}

/* ----------------------------------------------------------------- reads */

export async function list(db: Db = getDb()): Promise<CalendarSubscription[]> {
	return readAll(db);
}

export async function get(id: string, db: Db = getDb()): Promise<CalendarSubscription | null> {
	return readAll(db, id)[0] ?? null;
}

/** One stored feed event, while it and its subscription exist. For the right-click menu's check. */
export async function getEvent(id: string, db: Db = getDb()): Promise<{ id: string; subscriptionId: string } | null> {
	const row = db
		.select({ id: calendarSubscriptionEvents.id, subscriptionId: calendarSubscriptionEvents.subscriptionId })
		.from(calendarSubscriptionEvents)
		.innerJoin(calendarSubscriptions, eq(calendarSubscriptionEvents.subscriptionId, calendarSubscriptions.id))
		.where(and(eq(calendarSubscriptionEvents.id, id), isNull(calendarSubscriptionEvents.deletedAt), alive()))
		.get();
	return row ?? null;
}

/**
 * Fetches an address once and says what it holds, saving nothing. This is the
 * "<name>, N events. The next one is ..." line on the Add calendar page.
 */
export async function preview(url: string, net: Net = {}, at: Date = new Date()): Promise<CalendarSubscriptionPreview> {
	const target = address(url);
	const fetched = await fetchFeed(target, null, net);
	if (fetched.notModified) throw new PublicFetchError(`Juno did not load ${target.host}. The server answered 304.`);
	return {
		host: target.host,
		name: fetched.feed.name,
		eventCount: fetched.feed.events.length,
		next: nextOccurrence(fetched.feed.events, at.toISOString()),
		warnings: fetched.feed.warnings,
	};
}

/**
 * Every occurrence of every shown subscription inside `[fromUtc, toUtc)`, for
 * the calendar's range query. Read only by type: the items are their own kind.
 */
export function itemsInRange(fromUtc: string, toUtc: string, db: Db = getDb()): CalendarSubscriptionItem[] {
	const rows = db
		.select({ event: calendarSubscriptionEvents, sub: calendarSubscriptions })
		.from(calendarSubscriptionEvents)
		.innerJoin(calendarSubscriptions, eq(calendarSubscriptionEvents.subscriptionId, calendarSubscriptions.id))
		.where(
			and(
				alive(),
				eq(calendarSubscriptions.shown, true),
				isNull(calendarSubscriptionEvents.deletedAt),
				lt(calendarSubscriptionEvents.startUtc, toUtc),
				or(isNull(calendarSubscriptionEvents.seriesEndUtc), gt(calendarSubscriptionEvents.seriesEndUtc, fromUtc)),
			),
		)
		.orderBy(asc(calendarSubscriptionEvents.startUtc), asc(calendarSubscriptionEvents.id))
		.all();

	const items: CalendarSubscriptionItem[] = [];
	for (const { event, sub } of rows) {
		const base = {
			kind: "subscription" as const,
			subscriptionId: sub.id,
			subscriptionName: sub.name,
			colour: toRecord(sub, null).colour,
			eventId: event.id,
			allDay: event.allDay,
			timezone: event.timezone,
			isRecurring: event.rrule !== null,
			recurrenceLabel: describeRule(event.rrule),
		};
		if (!event.rrule) {
			if (event.startUtc < toUtc && event.endUtc > fromUtc) {
				items.push({
					...base,
					occurrenceStartLocal: event.startLocal,
					title: event.title,
					notes: event.notes,
					location: event.location,
					startLocal: event.startLocal,
					endLocal: event.endLocal,
					startUtc: event.startUtc,
					endUtc: event.endUtc,
				});
			}
			continue;
		}
		let exceptions: IcsException[] = [];
		try {
			const parsed: unknown = JSON.parse(event.exceptionsJson);
			if (Array.isArray(parsed)) exceptions = parsed as IcsException[];
		} catch {
			exceptions = [];
		}
		const shape: SeriesShape = {
			startLocal: event.startLocal,
			endLocal: event.endLocal,
			allDay: event.allDay,
			timezone: event.timezone,
			rrule: event.rrule,
		};
		let occurrences: ReturnType<typeof expandSeries>;
		try {
			occurrences = expandSeries(shape, exceptions, fromUtc, toUtc);
		} catch {
			// A rule that stopped being readable shows nothing rather than breaking the grid.
			continue;
		}
		for (const occurrence of occurrences) {
			items.push({
				...base,
				occurrenceStartLocal: occurrence.occurrenceStartLocal,
				title: occurrence.title ?? event.title,
				notes: occurrence.notes ?? event.notes,
				location: occurrence.location ?? event.location,
				startLocal: occurrence.startLocal,
				endLocal: occurrence.endLocal,
				startUtc: occurrence.startUtc,
				endUtc: occurrence.endUtc,
			});
		}
	}
	return items;
}

/* ---------------------------------------------------------------- writes */

/**
 * Subscribes to a calendar. The address is fetched first, and nothing is
 * saved when that fails, so a subscription that exists has worked at least
 * once. This is also what the add-account flow calls for a Google calendar,
 * with `mailAccountId` set.
 */
export async function create(
	input: CalendarSubscriptionInput,
	db: Db = getDb(),
	net: Net = {},
): Promise<CalendarSubscription> {
	const url = address(input.url);
	const name = checkName(input.name);
	const colour = checkColour(input.colour ?? "accent");
	const refreshMinutes = checkRefresh(input.refreshMinutes ?? 60);
	const mailAccountId = checkAccount(input.mailAccountId, db);
	checkUnique(url, db);
	const store = requireStore();

	const fetched = await fetchFeed(url, null, net);
	if (fetched.notModified) throw new PublicFetchError(`Juno did not load ${url.host}. The server answered 304.`);
	// Checked again: another call may have added it while this one was fetching.
	checkUnique(url, db);

	const id = uuidv7();
	const stamp = now();
	store.set(keyFor(id), url.href);
	try {
		db.transaction(() => {
			db.insert(calendarSubscriptions)
				.values({
					id,
					ownerId: LOCAL_OWNER_ID,
					createdAt: stamp,
					updatedAt: stamp,
					name,
					host: url.host,
					urlHash: hashOf(url),
					credentialKey: keyFor(id),
					colour,
					refreshMinutes,
					shown: true,
					lastFetchedAt: stamp,
					lastAttemptAt: stamp,
					lastError: null,
					etag: fetched.etag,
					lastModified: fetched.lastModified,
					eventCount: fetched.feed.events.length,
					mailAccountId,
				})
				.run();
			storeEvents(id, fetched.feed.events, db, stamp);
		});
	} catch (cause) {
		store.delete(keyFor(id));
		throw cause;
	}
	return readAll(db, id)[0]!;
}

/**
 * Changes a subscription. A new address is fetched before anything is
 * written, so a wrong one changes nothing; the rest is local.
 */
export async function update(
	id: string,
	patch: CalendarSubscriptionPatch,
	db: Db = getDb(),
	net: Net = {},
): Promise<CalendarSubscription> {
	const row = requireRow(id, db);
	const values: Partial<typeof calendarSubscriptions.$inferInsert> = {};
	if (patch.name !== undefined) values.name = checkName(patch.name);
	if (patch.colour !== undefined) values.colour = checkColour(patch.colour);
	if (patch.refreshMinutes !== undefined) values.refreshMinutes = checkRefresh(patch.refreshMinutes);
	if (patch.shown !== undefined) values.shown = Boolean(patch.shown);

	if (patch.url !== undefined) {
		const url = address(patch.url);
		checkUnique(url, db, id);
		const store = requireStore();
		const fetched = await fetchFeed(url, null, net);
		if (fetched.notModified) throw new PublicFetchError(`Juno did not load ${url.host}. The server answered 304.`);
		requireRow(id, db);
		const stamp = now();
		store.set(row.credentialKey, url.href);
		db.transaction(() => {
			db.update(calendarSubscriptions)
				.set({
					...values,
					host: url.host,
					urlHash: hashOf(url),
					etag: fetched.etag,
					lastModified: fetched.lastModified,
					lastFetchedAt: stamp,
					lastAttemptAt: stamp,
					lastError: null,
					eventCount: fetched.feed.events.length,
					updatedAt: stamp,
				})
				.where(eq(calendarSubscriptions.id, id))
				.run();
			storeEvents(id, fetched.feed.events, db, stamp);
		});
		return readAll(db, id)[0]!;
	}

	if (Object.keys(values).length > 0) {
		db.update(calendarSubscriptions).set({ ...values, updatedAt: now() }).where(eq(calendarSubscriptions.id, id)).run();
	}
	return readAll(db, id)[0]!;
}

const inFlight = new Map<string, Promise<CalendarSubscription>>();

/**
 * Fetches a subscription again. A 304 keeps the events as they are; a failure
 * keeps them too, and the reason is written on the row in plain words rather
 * than thrown, so the settings row and an agent read the same answer.
 */
export function refresh(id: string, db: Db = getDb(), net: Net = {}): Promise<CalendarSubscription> {
	const running = inFlight.get(id);
	if (running) return running;
	const work = refreshNow(id, db, net).finally(() => inFlight.delete(id));
	inFlight.set(id, work);
	return work;
}

async function refreshNow(id: string, db: Db, net: Net): Promise<CalendarSubscription> {
	const row = requireRow(id, db);
	const attempt = now();
	const fail = (message: string) => {
		db.update(calendarSubscriptions)
			.set({ lastAttemptAt: attempt, lastError: message, updatedAt: attempt })
			.where(and(eq(calendarSubscriptions.id, id), isNull(calendarSubscriptions.deletedAt)))
			.run();
		return readAll(db, id)[0] ?? toRecord({ ...row, lastAttemptAt: attempt, lastError: message }, null);
	};

	let stored: string | null;
	try {
		stored = credentialStore().get(row.credentialKey);
	} catch {
		stored = null;
	}
	if (!stored) return fail(`The address of ${row.name} is no longer kept on this computer. Edit it and paste the address again.`);

	let fetched: Fetched;
	try {
		fetched = await fetchFeed(new URL(stored), { etag: row.etag, lastModified: row.lastModified }, net);
	} catch (cause) {
		return fail(plainError(cause, row.host));
	}

	// Removed while the request was out: nothing to write to.
	const current = db
		.select({ id: calendarSubscriptions.id })
		.from(calendarSubscriptions)
		.where(and(alive(), eq(calendarSubscriptions.id, id)))
		.get();
	if (!current) return toRecord(row, null);

	const stamp = now();
	db.transaction(() => {
		db.update(calendarSubscriptions)
			.set({
				etag: fetched.etag,
				lastModified: fetched.lastModified,
				lastFetchedAt: stamp,
				lastAttemptAt: stamp,
				lastError: null,
				updatedAt: stamp,
				...(fetched.notModified ? {} : { eventCount: fetched.feed.events.length }),
			})
			.where(eq(calendarSubscriptions.id, id))
			.run();
		if (!fetched.notModified) storeEvents(id, fetched.feed.events, db, stamp);
	});
	return readAll(db, id)[0]!;
}

/** Stops the subscription, takes its events off the calendar and forgets the address. */
export async function remove(id: string, db: Db = getDb()): Promise<CalendarSubscription> {
	const row = requireRow(id, db);
	const stamp = now();
	db.transaction(() => {
		db.update(calendarSubscriptions).set({ deletedAt: stamp, updatedAt: stamp }).where(eq(calendarSubscriptions.id, id)).run();
		db.update(calendarSubscriptionEvents)
			.set({ deletedAt: stamp, updatedAt: stamp })
			.where(and(eq(calendarSubscriptionEvents.subscriptionId, id), isNull(calendarSubscriptionEvents.deletedAt)))
			.run();
	});
	try {
		credentialStore().delete(row.credentialKey);
	} catch {
		// The row is gone either way; a store that cannot be reached keeps nothing usable.
	}
	return toRecord({ ...row, deletedAt: stamp, updatedAt: stamp }, null);
}

/* ------------------------------------------------- what an approval shows */

export interface SubscriptionReview {
	summary: string;
	preview: string;
}

const EVERY: Record<CalendarRefreshMinutes, string> = { 15: "every 15 minutes", 60: "every hour", 1440: "every day" };

/**
 * What the owner reads before approving an agent's request. Each one checks
 * the request first, so one that could never run is refused at once instead
 * of waiting for a person.
 */
export function reviewPreview(url: string): SubscriptionReview {
	const target = address(url);
	return {
		summary: `Read the calendar at ${target.host} once`,
		preview: `Juno will fetch ${target.href} once to see what calendar it is. Nothing is saved.`,
	};
}

export function reviewCreate(input: CalendarSubscriptionInput, db: Db = getDb()): SubscriptionReview {
	const url = address(input.url);
	const name = checkName(input.name);
	checkColour(input.colour ?? "accent");
	const refreshMinutes = checkRefresh(input.refreshMinutes ?? 60);
	checkAccount(input.mailAccountId, db);
	checkUnique(url, db);
	return {
		summary: `Subscribe to ${name} from ${url.host}`,
		preview:
			`Juno will fetch ${url.href} now and ${EVERY[refreshMinutes]} after that, and show its events on the calendar as ${name}, read only.\n` +
			"This is a standing instruction: Juno keeps fetching this address until the subscription is removed.",
	};
}

export function reviewUpdate(id: string, patch: CalendarSubscriptionPatch, db: Db = getDb()): SubscriptionReview {
	const row = requireRow(id, db);
	const lines: string[] = [];
	if (patch.name !== undefined) lines.push(`Name: ${row.name} becomes ${checkName(patch.name)}.`);
	if (patch.colour !== undefined) lines.push(`Colour: ${row.colour} becomes ${checkColour(patch.colour)}.`);
	if (patch.refreshMinutes !== undefined) {
		lines.push(`Fetched ${EVERY[checkRefresh(patch.refreshMinutes)]} instead of ${EVERY[toRecord(row, null).refreshMinutes]}.`);
	}
	if (patch.shown !== undefined) lines.push(patch.shown ? "Shown on the calendar." : "Hidden from the calendar.");
	if (patch.url !== undefined) {
		const url = address(patch.url);
		checkUnique(url, db, id);
		lines.push(`Address: from ${row.host} to ${url.href}, fetched straight away.`);
	}
	if (lines.length === 0) throw invalid("Nothing to change. Give at least one of name, colour, refresh_minutes, shown or url.");
	return { summary: `Change the calendar subscription ${row.name}`, preview: lines.join("\n") };
}

export function reviewRefresh(id: string, db: Db = getDb()): SubscriptionReview {
	const row = requireRow(id, db);
	return { summary: `Fetch ${row.name} again`, preview: `Juno will fetch ${row.name} from ${row.host} now.` };
}

export function reviewRemove(id: string, db: Db = getDb()): SubscriptionReview {
	const row = requireRow(id, db);
	return {
		summary: `Remove the calendar subscription ${row.name}`,
		preview: `${row.name} (${row.host}) stops being fetched, its ${row.eventCount} events leave the calendar, and the address is forgotten.`,
	};
}

/* ------------------------------------------------------------- schedule */

const TICK_MS = 60_000;
const FIRST_RUN_DELAY_MS = 20_000;
let timer: NodeJS.Timeout | null = null;

/**
 * Fetches every subscription that is due: all of them when `all` is set (the
 * run at launch), otherwise those whose interval has passed since the last
 * try. One at a time, and it stops as soon as Juno locks.
 */
export async function refreshDue(
	options: { all?: boolean; isPaused?: () => boolean; at?: Date } = {},
	db: Db = getDb(),
	net: Net = {},
): Promise<number> {
	const at = (options.at ?? new Date()).getTime();
	let count = 0;
	for (const subscription of readAll(db)) {
		if (options.isPaused?.()) break;
		const last = subscription.lastAttemptAt ? Date.parse(subscription.lastAttemptAt) : 0;
		if (!options.all && at - last < subscription.refreshMinutes * 60_000) continue;
		await refresh(subscription.id, db, net);
		count++;
	}
	return count;
}

export function startScheduler(isPaused: () => boolean): void {
	if (timer) return;
	setTimeout(() => {
		if (!isPaused()) void refreshDue({ all: true, isPaused }).catch(() => undefined);
	}, FIRST_RUN_DELAY_MS).unref();
	timer = setInterval(() => {
		if (!isPaused()) void refreshDue({ isPaused }).catch(() => undefined);
	}, TICK_MS);
	timer.unref();
}

export function stopScheduler(): void {
	if (timer) clearInterval(timer);
	timer = null;
}
