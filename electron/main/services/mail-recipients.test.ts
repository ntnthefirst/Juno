/**
 * Recipients: what a typed fragment could mean, and which clients an address
 * belongs to.
 *
 * The case worth holding is the one a single `client_id` column cannot express.
 * Two clients can share an address, a bookkeeper being the usual reason, and a
 * message to that address concerns both. Picking one of them here would throw
 * away something nobody can retype.
 */
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientEmails from "./client-emails";
import * as clients from "./clients";
import * as contacts from "./contacts";
import * as recipients from "./mail-recipients";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

let db: Db;
let jansen: string;
let obet: string;

beforeEach(async () => {
	db = freshDb();
	jansen = (await clients.create({ name: "Jansen Dakwerken" }, db)).id;
	obet = (await clients.create({ name: "Obet" }, db)).id;
	await clientEmails.create({ clientId: jansen, email: "info@jansen.be" }, db);
	await clientEmails.create({ clientId: obet, email: "hallo@obet.be" }, db);
	await contacts.create({ clientId: jansen, name: "Laura Peeters", email: "laura@jansen.be" }, db);
});

describe("which clients an address belongs to", () => {
	it("resolves a client's own address and a contact's", async () => {
		expect(await recipients.clientsFor(["info@jansen.be"], db)).toEqual([
			{ clientId: jansen, clientName: "Jansen Dakwerken", matchedAddress: "info@jansen.be" },
		]);
		expect((await recipients.clientsFor(["laura@jansen.be"], db))[0]?.clientId).toBe(jansen);
	});

	it("returns both clients when two share an address", async () => {
		await contacts.create({ clientId: obet, name: "De boekhouder", email: "boek@kantoor.be" }, db);
		await contacts.create({ clientId: jansen, name: "De boekhouder", email: "boek@kantoor.be" }, db);

		const found = await recipients.clientsFor(["boek@kantoor.be"], db);

		expect(found.map((entry) => entry.clientId).sort()).toEqual([jansen, obet].sort());
	});

	it("returns every client on the line, once each", async () => {
		const found = await recipients.clientsFor(
			["info@jansen.be", "laura@jansen.be", "HALLO@OBET.BE", "nobody@example.be"],
			db,
		);

		expect(found.map((entry) => entry.clientId).sort()).toEqual([jansen, obet].sort());
	});

	it("says nothing about an address it does not know", async () => {
		expect(await recipients.clientsFor(["stranger@example.be"], db)).toEqual([]);
	});
});

describe("suggesting a recipient", () => {
	it("matches an address and a client's name", async () => {
		expect((await recipients.suggest("jansen", {}, db)).map((s) => s.address)).toEqual(
			expect.arrayContaining(["info@jansen.be", "laura@jansen.be"]),
		);
		expect((await recipients.suggest("obet", {}, db)).map((s) => s.address)).toEqual(["hallo@obet.be"]);
	});

	it("matches a contact by name, which is what a person remembers", async () => {
		const found = await recipients.suggest("laura", {}, db);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ address: "laura@jansen.be", name: "Laura Peeters", source: "contact" });
		expect(found[0]?.clients).toEqual([{ id: jansen, name: "Jansen Dakwerken" }]);
	});

	it("carries every client an address belongs to", async () => {
		await contacts.create({ clientId: obet, name: "De boekhouder", email: "boek@kantoor.be" }, db);
		await contacts.create({ clientId: jansen, name: "De boekhouder", email: "boek@kantoor.be" }, db);

		const found = await recipients.suggest("boek@", {}, db);

		expect(found).toHaveLength(1);
		expect(found[0]?.clients.map((c) => c.id).sort()).toEqual([jansen, obet].sort());
	});

	it("says nothing for one character, because everything matches it", async () => {
		expect(await recipients.suggest("j", {}, db)).toEqual([]);
		expect(await recipients.suggest("  ", {}, db)).toEqual([]);
	});

	it("does not read a wildcard out of what was typed", async () => {
		expect(await recipients.suggest("%@%", {}, db)).toEqual([]);
	});
});
