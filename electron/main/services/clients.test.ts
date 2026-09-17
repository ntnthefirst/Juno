/**
 * Runs under plain Node through Vitest, not inside Electron, which is why no
 * service may import `electron`. Each test gets its own in-memory database built
 * from the committed migrations, so the tests prove the real schema.
 *
 * The migrations folder is resolved from the working directory rather than from
 * the module's own location: the main process compiles to CommonJS, where
 * `import.meta` is a compile error, and Vitest loads this file as an ES module,
 * where `__dirname` does not exist. `npx vitest run` runs from the repo root.
 */
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clients from "./clients";
import * as contacts from "./contacts";
import * as projects from "./projects";
import * as search from "./search";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("clients", () => {
	it("lowercases sortName on create and keeps it in step on update", async () => {
		const db = freshDb();

		const created = await clients.create({ name: "De Backer BV" }, db);
		expect(created.name).toBe("De Backer BV");
		expect(created.sortName).toBe("de backer bv");

		const renamed = await clients.update(created.id, { name: "Van Acker NV" }, db);
		expect(renamed.sortName).toBe("van acker nv");
	});

	it("refuses a client with no name", async () => {
		const db = freshDb();
		await expect(clients.create({ name: "   " }, db)).rejects.toThrow(/needs a name/);
	});

	it("hides a deleted client from the list and brings it back on restore", async () => {
		const db = freshDb();
		const created = await clients.create({ name: "Acme" }, db);

		expect(await clients.list({}, db)).toHaveLength(1);

		const deleted = await clients.remove(created.id, db);
		expect(deleted.deletedAt).not.toBeNull();
		expect(await clients.list({}, db)).toHaveLength(0);
		expect(await clients.get(created.id, db)).toBeNull();
		expect(await clients.list({ includeDeleted: true }, db)).toHaveLength(1);

		const restored = await clients.restore(created.id, db);
		expect(restored.deletedAt).toBeNull();
		expect(await clients.list({}, db)).toHaveLength(1);
	});

	it("bumps updatedAt on update and leaves createdAt alone", async () => {
		const db = freshDb();
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));
			const created = await clients.create({ name: "Acme" }, db);
			expect(created.createdAt).toBe("2026-03-14T09:00:00.000Z");
			expect(created.updatedAt).toBe("2026-03-14T09:00:00.000Z");

			vi.setSystemTime(new Date("2026-03-14T11:30:00.000Z"));
			const updated = await clients.update(created.id, { city: "Gent" }, db);
			expect(updated.updatedAt).toBe("2026-03-14T11:30:00.000Z");
			expect(updated.createdAt).toBe(created.createdAt);
		} finally {
			vi.useRealTimers();
		}
	});

	it("counts projects per client in the list without a second query per row", async () => {
		const db = freshDb();
		const acme = await clients.create({ name: "Acme" }, db);
		await clients.create({ name: "Bravo" }, db);
		await projects.create({ clientId: acme.id, name: "Website" }, db);
		await projects.create({ clientId: acme.id, name: "Brochure" }, db);

		const rows = await clients.list({}, db);
		expect(rows.map((row) => row.name)).toEqual(["Acme", "Bravo"]);
		expect(rows[0]?.projectCount).toBe(2);
		expect(rows[0]?.openProjectCount).toBe(2);
		expect(rows[1]?.projectCount).toBe(0);
	});

	it("searches case-insensitively", async () => {
		const db = freshDb();
		await clients.create({ name: "Van Acker NV", city: "Gent" }, db);
		await clients.create({ name: "Bravo BV", city: "Brugge" }, db);

		expect(await clients.list({ search: "ACKER" }, db)).toHaveLength(1);
		expect(await clients.list({ search: "acker" }, db)).toHaveLength(1);
		expect(await clients.list({ search: "gENT" }, db)).toHaveLength(1);
		expect(await clients.list({ search: "zzz" }, db)).toHaveLength(0);
	});
});

describe("contacts", () => {
	it("clears the primary flag on siblings when one is set", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const other = await clients.create({ name: "Bravo" }, db);

		const first = await contacts.create(
			{ clientId: client.id, name: "An Peeters", isPrimary: true },
			db,
		);
		const second = await contacts.create({ clientId: client.id, name: "Bert Claes" }, db);
		const elsewhere = await contacts.create(
			{ clientId: other.id, name: "Cara Dries", isPrimary: true },
			db,
		);

		const promoted = await contacts.setPrimary(second.id, db);
		expect(promoted.isPrimary).toBe(true);

		const forClient = await contacts.listForClient(client.id, db);
		expect(forClient.filter((contact) => contact.isPrimary)).toHaveLength(1);
		expect(forClient[0]?.id).toBe(second.id);
		expect(forClient.find((contact) => contact.id === first.id)?.isPrimary).toBe(false);

		const forOther = await contacts.listForClient(other.id, db);
		expect(forOther.find((contact) => contact.id === elsewhere.id)?.isPrimary).toBe(true);
	});

	it("moves the flag when a contact is created as primary", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		const first = await contacts.create(
			{ clientId: client.id, name: "An Peeters", isPrimary: true },
			db,
		);
		await contacts.create({ clientId: client.id, name: "Bert Claes", isPrimary: true }, db);

		const forClient = await contacts.listForClient(client.id, db);
		expect(forClient.filter((contact) => contact.isPrimary)).toHaveLength(1);
		expect(forClient.find((contact) => contact.id === first.id)?.isPrimary).toBe(false);
	});
});

describe("projects", () => {
	it("throws when the client does not exist", async () => {
		const db = freshDb();
		await expect(
			projects.create({ clientId: "01900000-0000-7000-8000-000000000000", name: "Website" }, db),
		).rejects.toThrow(/No client with id/);
	});

	it("throws when the client was soft deleted", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		await clients.remove(client.id, db);
		await expect(projects.create({ clientId: client.id, name: "Website" }, db)).rejects.toThrow(
			/No client with id/,
		);
	});

	it("refuses a value that is not whole cents", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		await expect(
			projects.create({ clientId: client.id, name: "Website", agreedValueCents: 1250.5 }, db),
		).rejects.toThrow(/whole number of cents/);
	});

	it("joins the client name into the list", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Acme" }, db);
		await projects.create({ clientId: client.id, name: "Website", dueOn: "2026-05-01" }, db);

		const rows = await projects.list({}, db);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.clientName).toBe("Acme");
		expect(rows[0]?.dueOn).toBe("2026-05-01");
	});
});

describe("search", () => {
	it("finds clients, projects and contacts regardless of case", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Van Acker NV" }, db);
		await projects.create({ clientId: client.id, name: "Acker rebrand" }, db);
		await contacts.create({ clientId: client.id, name: "Ann Ackerman" }, db);

		const hits = await search.global("ACKER", 10, db);
		expect(hits.map((hit) => hit.kind).sort()).toEqual(["client", "contact", "project"]);

		expect(await search.global("acker", 10, db)).toHaveLength(3);
		expect(await search.global("   ", 10, db)).toHaveLength(0);
	});

	it("leaves deleted records out", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Van Acker NV" }, db);
		await clients.remove(client.id, db);
		expect(await search.global("acker", 10, db)).toHaveLength(0);
	});
});
