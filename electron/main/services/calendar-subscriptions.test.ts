import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { calendarSubscriptionEvents, calendarSubscriptions } from "../db/schema";
import { listRange } from "./calendar";
import { create, get, getEvent, list, preview, refresh, refreshDue, remove, update, type Net } from "./calendar-subscriptions";
import { configureCredentialStore, credentialStore, MemoryCredentialStore } from "./mail-credentials";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const ADDRESS = "https://calendar.example.com/calendar/ical/secret-token-123/basic.ics";

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
	configureCredentialStore(new MemoryCredentialStore());
});

function feed(events: string[], name = "Workshop rota"): string {
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Test//EN",
		`X-WR-CALNAME:${name}`,
		...events,
		"END:VCALENDAR",
	].join("\r\n");
}

function event(uid: string, summary: string, start: string, end: string, extra: string[] = []): string {
	return [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`SUMMARY:${summary}`,
		`DTSTART;TZID=Europe/Brussels:${start}`,
		`DTEND;TZID=Europe/Brussels:${end}`,
		...extra,
		"END:VEVENT",
	].join("\r\n");
}

const ROTA = feed([
	event("a@test", "Morning shift", "20261112T090000", "20261112T120000"),
	event("b@test", "Weekly stand-up", "20261102T100000", "20261102T103000", ["RRULE:FREQ=WEEKLY;BYDAY=MO"]),
]);

/** A server held in memory. Every request is recorded with its headers. */
function server(respond: (headers: Headers, call: number) => Response | Promise<Response>) {
	const calls: Headers[] = [];
	const net: Net = {
		resolve: async () => [{ address: "93.184.216.34" }],
		fetcher: async (_url, init) => {
			const headers = new Headers(init?.headers);
			calls.push(headers);
			return respond(headers, calls.length);
		},
	};
	return { net, calls };
}

const ok = (body: string, headers: Record<string, string> = {}) =>
	new Response(body, { status: 200, headers: { "content-type": "text/calendar", ...headers } });

async function rotaInRange(from = "2026-11-01", to = "2026-11-30") {
	const items = await listRange({ from, to, timezone: "Europe/Brussels", includeSubscriptions: true }, db, "2026-11-01");
	return items.filter((item) => item.kind === "subscription");
}

describe("preview", () => {
	it("says what an address holds and saves nothing", async () => {
		const { net } = server(() => ok(ROTA));
		const seen = await preview(ADDRESS, net, new Date("2026-11-08T12:00:00Z"));
		expect(seen).toMatchObject({ host: "calendar.example.com", name: "Workshop rota", eventCount: 2 });
		expect(seen.next).toMatchObject({ title: "Weekly stand-up", startLocal: "2026-11-09T10:00:00" });
		expect(await list(db)).toEqual([]);
	});

	it("reads webcal as https", async () => {
		const { net } = server(() => ok(ROTA));
		const seen = await preview(ADDRESS.replace("https://", "webcal://"), net);
		expect(seen.host).toBe("calendar.example.com");
	});

	it("says plainly when the address is not a calendar", async () => {
		const { net } = server(() => ok("<html><body>Sign in</body></html>"));
		await expect(preview(ADDRESS, net)).rejects.toThrow(/calendar\.example\.com did not send a calendar/);
	});
});

describe("the address guard", () => {
	it("refuses http before asking anything", async () => {
		const { net, calls } = server(() => ok(ROTA));
		await expect(create({ url: "http://calendar.example.com/a.ics", name: "Plain" }, db, net)).rejects.toThrow(/https/);
		expect(calls).toHaveLength(0);
	});

	it("refuses a host on this network, and a redirect onto one", async () => {
		const { calls, net } = server(() => ok(ROTA));
		await expect(
			create({ url: ADDRESS, name: "Inside" }, db, { ...net, resolve: async () => [{ address: "192.168.1.10" }] }),
		).rejects.toThrow(/private address/);
		expect(calls).toHaveLength(0);

		const bounce: Net = {
			resolve: async (host) => [{ address: host === "router.example.com" ? "10.0.0.1" : "93.184.216.34" }],
			fetcher: async () => new Response(null, { status: 302, headers: { location: "https://router.example.com/" } }),
		};
		await expect(preview(ADDRESS, bounce)).rejects.toThrow(/private address/);
		expect(await list(db)).toEqual([]);
	});

	it("refuses a body over the size cap", async () => {
		const { net } = server(() => ok("BEGIN:VCALENDAR\r\n" + "X".repeat(11 * 1024 * 1024)));
		await expect(create({ url: ADDRESS, name: "Huge" }, db, net)).rejects.toThrow(/larger than 10 MB/);
		expect(await list(db)).toEqual([]);
	});

	it("never puts the address in an error, the row or what the window gets", async () => {
		const { net } = server(() => ok(ROTA));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		expect(JSON.stringify(made)).not.toContain("secret-token");
		const row = db.select().from(calendarSubscriptions).get()!;
		expect(JSON.stringify(row)).not.toContain("secret-token");
		expect(credentialStore().get(row.credentialKey)).toBe(ADDRESS);

		const failing = server(() => new Response(null, { status: 404 }));
		const after = await refresh(made.id, db, failing.net);
		expect(after.lastError).toContain("calendar.example.com");
		expect(after.lastError).not.toContain("secret-token");
	});
});

describe("create", () => {
	it("fetches, stores the events and shows them on the calendar in its colour", async () => {
		const { net } = server(() => ok(ROTA, { etag: '"v1"' }));
		const made = await create({ url: ADDRESS, name: "Workshop rota", colour: "tone-7-ink", refreshMinutes: 15 }, db, net);
		expect(made).toMatchObject({
			name: "Workshop rota",
			host: "calendar.example.com",
			colour: "tone-7-ink",
			refreshMinutes: 15,
			shown: true,
			eventCount: 2,
			lastError: null,
		});
		expect(made.lastFetchedAt).not.toBeNull();

		const items = await rotaInRange();
		// One single event and five Mondays of the series in November.
		expect(items).toHaveLength(6);
		expect(items[0]).toMatchObject({ kind: "subscription", subscriptionName: "Workshop rota", colour: "tone-7-ink" });
		expect(await getEvent(items[0]!.eventId, db)).toMatchObject({ subscriptionId: made.id });
	});

	it("saves nothing when the first fetch fails", async () => {
		const { net } = server(() => new Response("nope", { status: 500 }));
		await expect(create({ url: ADDRESS, name: "Broken" }, db, net)).rejects.toThrow(/answered 500/);
		expect(await list(db)).toEqual([]);
	});

	it("refuses the same address twice, and a name or colour that is not one", async () => {
		const { net } = server(() => ok(ROTA));
		await create({ url: ADDRESS, name: "Rota" }, db, net);
		await expect(create({ url: ADDRESS, name: "Again" }, db, net)).rejects.toThrow(/already subscribe to this calendar, as Rota/);
		await expect(create({ url: `${ADDRESS}?x=1`, name: "  " }, db, net)).rejects.toThrow(/needs a name/);
		await expect(
			create({ url: `${ADDRESS}?x=2`, name: "Hex", colour: "#ff0000" as never }, db, net),
		).rejects.toThrow(/not a calendar colour/);
	});

	it("is not on a client's or a project's calendar, and not on the plain range", async () => {
		const { net } = server(() => ok(ROTA));
		await create({ url: ADDRESS, name: "Rota" }, db, net);
		const plain = await listRange({ from: "2026-11-01", to: "2026-11-30", timezone: "Europe/Brussels" }, db, "2026-11-01");
		expect(plain.filter((item) => item.kind === "subscription")).toEqual([]);
	});
});

describe("refresh", () => {
	it("sends its validators and keeps the events on a 304", async () => {
		const { net, calls } = server((_headers, call) =>
			call === 1 ? ok(ROTA, { etag: '"v1"', "last-modified": "Sun, 08 Nov 2026 10:00:00 GMT" }) : new Response(null, { status: 304 }),
		);
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		const again = await refresh(made.id, db, net);
		expect(calls[1]!.get("if-none-match")).toBe('"v1"');
		expect(calls[1]!.get("if-modified-since")).toBe("Sun, 08 Nov 2026 10:00:00 GMT");
		expect(again.lastError).toBeNull();
		expect(again.eventCount).toBe(2);
		expect(await rotaInRange()).toHaveLength(6);
	});

	it("keeps the last good events when a fetch fails, and says why on the row", async () => {
		const { net } = server((_headers, call) => (call === 1 ? ok(ROTA) : new Response(null, { status: 503 })));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		const failed = await refresh(made.id, db, net);
		expect(failed.lastError).toBe("Juno did not load calendar.example.com. The server answered 503.");
		expect(failed.lastFetchedAt).toBe(made.lastFetchedAt);
		expect(await rotaInRange()).toHaveLength(6);

		const garbled = server(() => ok("BEGIN:VCALENDAR\r\nthis is not\r\n"));
		const unreadable = await refresh(made.id, db, garbled.net);
		expect(unreadable.lastError).toMatch(/cannot read|did not send/);
		expect(await rotaInRange()).toHaveLength(6);
	});

	it("updates what changed, adds what is new and takes away what the feed dropped", async () => {
		const second = feed([
			event("a@test", "Morning shift, moved", "20261113T090000", "20261113T120000"),
			event("c@test", "Inventory", "20261120T140000", "20261120T160000"),
		]);
		const { net } = server((_headers, call) => ok(call === 1 ? ROTA : second));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		const again = await refresh(made.id, db, net);
		expect(again.eventCount).toBe(2);
		const titles = (await rotaInRange()).map((item) => item.title).sort();
		expect(titles).toEqual(["Inventory", "Morning shift, moved"]);
		// The dropped series is soft-deleted, not gone.
		const rows = db.select().from(calendarSubscriptionEvents).all();
		expect(rows.find((row) => row.icalUid === "b@test")?.deletedAt).not.toBeNull();
	});

	it("is due on its interval and runs once for all at launch", async () => {
		const { net, calls } = server(() => ok(ROTA));
		await create({ url: ADDRESS, name: "Rota", refreshMinutes: 60 }, db, net);
		expect(await refreshDue({ at: new Date() }, db, net)).toBe(0);
		expect(await refreshDue({ at: new Date(Date.now() + 61 * 60_000) }, db, net)).toBe(1);
		expect(await refreshDue({ all: true }, db, net)).toBe(1);
		expect(await refreshDue({ all: true, isPaused: () => true }, db, net)).toBe(0);
		expect(calls).toHaveLength(3);
	});
});

describe("update and remove", () => {
	it("hides a subscription from the calendar without fetching", async () => {
		const { net, calls } = server(() => ok(ROTA));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		const hidden = await update(made.id, { shown: false, name: "Shifts", colour: "seal" }, db, net);
		expect(hidden).toMatchObject({ shown: false, name: "Shifts", colour: "seal" });
		expect(calls).toHaveLength(1);
		expect(await rotaInRange()).toEqual([]);
	});

	it("fetches a new address before it replaces the old one", async () => {
		const { net } = server((_headers, call) => (call === 1 ? ok(ROTA) : new Response(null, { status: 404 })));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		await expect(update(made.id, { url: "https://other.example.com/a.ics" }, db, net)).rejects.toThrow(/nothing at that address/);
		expect((await get(made.id, db))!.host).toBe("calendar.example.com");
	});

	it("soft-deletes the subscription and its events and forgets the address", async () => {
		const { net } = server(() => ok(ROTA));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		const key = db.select().from(calendarSubscriptions).get()!.credentialKey;
		await remove(made.id, db);
		expect(await list(db)).toEqual([]);
		expect(await rotaInRange()).toEqual([]);
		expect(db.select().from(calendarSubscriptionEvents).all().every((row) => row.deletedAt !== null)).toBe(true);
		expect(credentialStore().get(key)).toBeNull();
		await expect(refresh(made.id, db, net)).rejects.toThrow(/No calendar subscription/);
		// The same address can be added again once the old one is gone.
		await create({ url: ADDRESS, name: "Rota again" }, db, net);
	});
});

describe("owner scoping", () => {
	it("never lists, reads or draws another owner's subscription", async () => {
		const { net } = server(() => ok(ROTA));
		const made = await create({ url: ADDRESS, name: "Rota" }, db, net);
		db.update(calendarSubscriptions).set({ ownerId: "someone-else" }).run();
		expect(await list(db)).toEqual([]);
		expect(await get(made.id, db)).toBeNull();
		expect(await rotaInRange()).toEqual([]);
		await expect(refresh(made.id, db, net)).rejects.toThrow(/No calendar subscription/);
		await expect(remove(made.id, db)).rejects.toThrow(/No calendar subscription/);
	});
});
