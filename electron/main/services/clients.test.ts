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
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clientStatusChanges, referenceItems, referenceSets } from "../db/schema";
import * as clientAddresses from "./client-addresses";
import * as clientEmails from "./client-emails";
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

/**
 * A status item, without going through the seed machinery: a "client_status"
 * set, created once per database, with one item in it. The tests below only
 * need a status that exists, not the shipped set.
 */
function createStatus(db: Db, label: string, tone: string | null = null) {
	const set =
		db.select({ id: referenceSets.id }).from(referenceSets).where(eq(referenceSets.key, "client_status")).get() ??
		db.insert(referenceSets).values({ key: "client_status", label: "Client status" }).returning().get();
	return db
		.insert(referenceItems)
		.values({ setId: set.id, key: label.toLowerCase(), label, tone })
		.returning()
		.get();
}

/** Every non-deleted status change row for a client, oldest first. */
function statusChangesFor(db: Db, clientId: string) {
	return db
		.select()
		.from(clientStatusChanges)
		.where(and(eq(clientStatusChanges.clientId, clientId), isNull(clientStatusChanges.deletedAt)))
		.orderBy(clientStatusChanges.changedAt)
		.all();
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
			const updated = await clients.update(created.id, { vatNumber: "BE0123456789" }, db);
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

	it("searches case-insensitively, including a client's city", async () => {
		const db = freshDb();
		const acker = await clients.create({ name: "Van Acker NV" }, db);
		await clientAddresses.create({ clientId: acker.id, addressLine1: "Kerkstraat 1", city: "Gent" }, db);
		const bravo = await clients.create({ name: "Bravo BV" }, db);
		await clientAddresses.create({ clientId: bravo.id, addressLine1: "Marktplein 2", city: "Brugge" }, db);

		expect(await clients.list({ search: "ACKER" }, db)).toHaveLength(1);
		expect(await clients.list({ search: "acker" }, db)).toHaveLength(1);
		expect(await clients.list({ search: "gENT" }, db)).toHaveLength(1);
		expect(await clients.list({ search: "zzz" }, db)).toHaveLength(0);
	});

	it("resolves the primary email and the primary address's city on the list row", async () => {
		const db = freshDb();
		const acme = await clients.create({ name: "Acme" }, db);
		await clientAddresses.create({ clientId: acme.id, addressLine1: "Kerkstraat 1", city: "Gent" }, db);
		await clientEmails.create({ clientId: acme.id, email: "hallo@acme.example" }, db);

		const rows = await clients.list({}, db);
		expect(rows[0]?.city).toBe("Gent");
		expect(rows[0]?.email).toBe("hallo@acme.example");
	});

	it("lists the client touched last first, counting its projects as activity", async () => {
		const db = freshDb();
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-03-01T09:00:00.000Z"));
			const first = await clients.create({ name: "Aardvark" }, db);
			vi.setSystemTime(new Date("2026-03-02T09:00:00.000Z"));
			const second = await clients.create({ name: "Zebra" }, db);
			expect((await clients.list({}, db)).map((row) => row.id)).toEqual([second.id, first.id]);

			vi.setSystemTime(new Date("2026-03-05T09:00:00.000Z"));
			await projects.create({ clientId: first.id, name: "Site" }, db);
			const rows = await clients.list({}, db);
			expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
			expect(rows[0]?.lastActivityAt).toBe("2026-03-05T09:00:00.000Z");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("status changes", () => {
	it("writes one entry when the status changes", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead", "accent");
		const active = createStatus(db, "Active", "ok");
		const client = await clients.create({ name: "Acme", statusId: lead.id }, db);

		await clients.update(client.id, { statusId: active.id }, db);

		const rows = statusChangesFor(db, client.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromStatusId).toBe(lead.id);
		expect(rows[0]?.toStatusId).toBe(active.id);
	});

	it("writes no entry for the status a client is created with", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead");
		const client = await clients.create({ name: "Acme", statusId: lead.id }, db);

		expect(statusChangesFor(db, client.id)).toHaveLength(0);
	});

	it("writes nothing when the status is set to what it already was", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead");
		const client = await clients.create({ name: "Acme", statusId: lead.id }, db);

		await clients.update(client.id, { statusId: lead.id }, db);

		expect(statusChangesFor(db, client.id)).toHaveLength(0);
	});

	it("folds two changes within ten minutes into one, from the first status to the last", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead");
		const active = createStatus(db, "Active");
		const dormant = createStatus(db, "Dormant");
		const client = await clients.create({ name: "Acme", statusId: lead.id }, db);

		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));
			await clients.update(client.id, { statusId: active.id }, db);
			vi.setSystemTime(new Date("2026-03-14T09:05:00.000Z"));
			await clients.update(client.id, { statusId: dormant.id }, db);
		} finally {
			vi.useRealTimers();
		}

		const rows = statusChangesFor(db, client.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromStatusId).toBe(lead.id);
		expect(rows[0]?.toStatusId).toBe(dormant.id);
		expect(rows[0]?.changedAt).toBe("2026-03-14T09:05:00.000Z");
	});

	it("starts a new entry when a change comes more than ten minutes after the last", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead");
		const active = createStatus(db, "Active");
		const dormant = createStatus(db, "Dormant");
		const client = await clients.create({ name: "Acme", statusId: lead.id }, db);

		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));
			await clients.update(client.id, { statusId: active.id }, db);
			vi.setSystemTime(new Date("2026-03-14T09:11:00.000Z"));
			await clients.update(client.id, { statusId: dormant.id }, db);
		} finally {
			vi.useRealTimers();
		}

		const rows = statusChangesFor(db, client.id);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ fromStatusId: lead.id, toStatusId: active.id });
		expect(rows[1]).toMatchObject({ fromStatusId: active.id, toStatusId: dormant.id });
	});

	it("removes the entry when a fold brings the status back to where it started", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead");
		const active = createStatus(db, "Active");
		const client = await clients.create({ name: "Acme", statusId: lead.id }, db);

		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));
			await clients.update(client.id, { statusId: active.id }, db);
			vi.setSystemTime(new Date("2026-03-14T09:05:00.000Z"));
			await clients.update(client.id, { statusId: lead.id }, db);
		} finally {
			vi.useRealTimers();
		}

		expect(statusChangesFor(db, client.id)).toHaveLength(0);
	});

	it("treats no status on both ends as a fold back to the start", async () => {
		const db = freshDb();
		const lead = createStatus(db, "Lead");
		const client = await clients.create({ name: "Acme" }, db);

		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));
			await clients.update(client.id, { statusId: lead.id }, db);
			vi.setSystemTime(new Date("2026-03-14T09:05:00.000Z"));
			await clients.update(client.id, { statusId: null }, db);
		} finally {
			vi.useRealTimers();
		}

		expect(statusChangesFor(db, client.id)).toHaveLength(0);
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
