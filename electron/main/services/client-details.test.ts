/**
 * Runs under plain Node through Vitest, not inside Electron. See the header
 * comment in clients.test.ts for why.
 *
 * Emails, phones and addresses share the same primary-flag rule, so one file
 * covers the shape once for each and does not repeat every case three times.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as addresses from "./client-addresses";
import * as clients from "./clients";
import * as emails from "./client-emails";
import * as phones from "./client-phones";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("client emails", () => {
	it("makes the first email primary without being asked", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const first = await emails.create({ clientId: client.id, email: "hallo@acme.example" }, db);
		expect(first.isPrimary).toBe(true);
	});

	it("leaves a second email non-primary unless it is created as primary", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const first = await emails.create({ clientId: client.id, email: "hallo@acme.example" }, db);
		const second = await emails.create({ clientId: client.id, email: "info@acme.example" }, db);

		expect(first.isPrimary).toBe(true);
		expect(second.isPrimary).toBe(false);
	});

	it("clears the flag on siblings when a new email is created as primary", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const first = await emails.create({ clientId: client.id, email: "hallo@acme.example" }, db);
		await emails.create(
			{ clientId: client.id, email: "facturatie@acme.example", label: "Facturatie", isPrimary: true },
			db,
		);

		const forClient = await emails.listForClient(client.id, db);
		expect(forClient.filter((e) => e.isPrimary)).toHaveLength(1);
		expect(forClient.find((e) => e.id === first.id)?.isPrimary).toBe(false);
	});

	it("moves the flag on setPrimary and keeps another client's untouched", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const other = await clients.create({ name: "Bravo" }, db);
		const first = await emails.create({ clientId: client.id, email: "hallo@acme.example" }, db);
		const second = await emails.create({ clientId: client.id, email: "info@acme.example" }, db);
		const elsewhere = await emails.create({ clientId: other.id, email: "hallo@bravo.example" }, db);

		const promoted = await emails.setPrimary(second.id, db);
		expect(promoted.isPrimary).toBe(true);

		const forClient = await emails.listForClient(client.id, db);
		expect(forClient.find((e) => e.id === first.id)?.isPrimary).toBe(false);
		expect(forClient.find((e) => e.id === second.id)?.isPrimary).toBe(true);

		const forOther = await emails.listForClient(other.id, db);
		expect(forOther.find((e) => e.id === elsewhere.id)?.isPrimary).toBe(true);
	});

	it("refuses an empty address", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		await expect(emails.create({ clientId: client.id, email: "   " }, db)).rejects.toThrow(
			/cannot be empty/,
		);
	});
});

describe("client phones", () => {
	it("makes the first phone primary without being asked", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const first = await phones.create({ clientId: client.id, phone: "+32 9 000 00 00" }, db);
		expect(first.isPrimary).toBe(true);
	});
});

describe("client addresses", () => {
	it("makes the first address primary and accepts a free-text label", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const office = await addresses.create(
			{ clientId: client.id, label: "Kantoor Leuven", addressLine1: "Bondgenotenlaan 1", city: "Leuven" },
			db,
		);
		expect(office.isPrimary).toBe(true);
		expect(office.label).toBe("Kantoor Leuven");

		const warehouse = await addresses.create(
			{ clientId: client.id, label: "Magazijn", addressLine1: "Industrieweg 4", city: "Mechelen" },
			db,
		);
		expect(warehouse.isPrimary).toBe(false);
	});

	it("requires at least a street and number", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		await expect(addresses.create({ clientId: client.id, addressLine1: "  " }, db)).rejects.toThrow(
			/street and number/,
		);
	});
});
