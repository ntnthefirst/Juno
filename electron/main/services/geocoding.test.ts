import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as calendar from "./calendar";
import * as clients from "./clients";
import { lookupAddress, suggestLocations } from "./geocoding";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("suggestLocations", () => {
	it("matches a client by name and formats its stored address", async () => {
		const db = freshDb();
		await clients.create(
			{
				name: "De Backer BV",
				addressLine1: "Meirstraat 12",
				postalCode: "2000",
				city: "Antwerpen",
				country: "België",
			},
			db,
		);

		const found = suggestLocations("backer", db);
		expect(found).toEqual([
			{ source: "client", label: "De Backer BV", address: "Meirstraat 12, 2000 Antwerpen, België" },
		]);
	});

	it("skips a client with no address on file", async () => {
		const db = freshDb();
		await clients.create({ name: "Jansen" }, db);
		expect(suggestLocations("jansen", db)).toEqual([]);
	});

	it("suggests a location typed on a past event, most recent first", async () => {
		const db = freshDb();
		await calendar.create({ title: "First", startLocal: "2026-09-20T09:00", location: "Café Central" }, db);
		await calendar.create({ title: "Second", startLocal: "2026-09-21T09:00", location: "Café Concordia" }, db);

		const found = suggestLocations("café", db);
		expect(found.map((s) => s.address)).toEqual(["Café Concordia", "Café Central"]);
		expect(found.every((s) => s.source === "recent")).toBe(true);
	});

	it("does not repeat an address a client suggestion already covers", async () => {
		const db = freshDb();
		await clients.create({ name: "Studio Jansen", addressLine1: "Kerkstraat 1", city: "Gent" }, db);
		await calendar.create({ title: "Kickoff", startLocal: "2026-09-20T09:00", location: "Kerkstraat 1, Gent" }, db);

		const found = suggestLocations("kerkstraat", db);
		expect(found).toHaveLength(1);
		expect(found[0]!.source).toBe("client");
	});

	it("returns nothing for a query that is too short", () => {
		const db = freshDb();
		expect(suggestLocations("a", db)).toEqual([]);
	});
});

describe("lookupAddress", () => {
	it("returns candidates from a well-formed response", async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify([{ display_name: "Grote Markt, Antwerpen, België", lat: "51.2213", lon: "4.4009" }]),
				{ status: 200 },
			),
		);

		const found = await lookupAddress("Grote Markt Antwerpen", fetchImpl as unknown as typeof fetch);
		expect(found).toEqual([{ label: "Grote Markt, Antwerpen, België", lat: 51.2213, lon: 4.4009 }]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0]!;
		expect(String(url)).toContain("nominatim.openstreetmap.org");
		expect((init as RequestInit).headers).toMatchObject({ "User-Agent": expect.any(String) });
	});

	it("degrades to an empty list for a query too short to send", async () => {
		const fetchImpl = vi.fn();
		expect(await lookupAddress(" a ", fetchImpl as unknown as typeof fetch)).toEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("turns a network failure into a message that says what to do", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		await expect(lookupAddress("Grote Markt", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
			/type the location by hand/,
		);
	});

	it("turns a non-OK response into the same message", async () => {
		const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
		await expect(lookupAddress("Grote Markt", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
			/type the location by hand/,
		);
	});
});
