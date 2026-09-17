/**
 * The rules from decision 16, as tests. Each one exists because getting it wrong
 * loses somebody's configuration or breaks a record that points at a value.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase, type ShimDatabase } from "../db/node-sqlite-shim";
import { clients, projects, referenceItems } from "../db/schema";
import * as reference from "./reference";
import { ensureSeeded, type SeedSource } from "./seed";
import { SEED_SETS, SEED_VERSION } from "./seed-data";
import * as settings from "./settings";

let connection: ShimDatabase;
let db: Db;
let settingsDir: string;

beforeEach(() => {
	connection = openDatabase(":memory:");
	runMigrations(connection, resolve(process.cwd(), "electron/main/db/migrations"));
	db = createDrizzle(connection);
	reference.useDatabase(db);
	settingsDir = mkdtempSync(join(tmpdir(), "bureau-reference-"));
	settings.configureSettings(settingsDir);
});

afterEach(() => {
	reference.useDatabase(null);
	settings.configureSettings(null);
	connection.close();
	rmSync(settingsDir, { recursive: true, force: true });
});

function itemCount(): number {
	return db.select().from(referenceItems).all().length;
}

async function itemByKey(setKey: "client_status" | "label", key: string) {
	const set = await reference.getSet(setKey);
	const item = set?.items.find((candidate) => candidate.key === key);
	if (!item) throw new Error(`No item ${key} in ${setKey}.`);
	return item;
}

function rowById(id: string) {
	return db.select().from(referenceItems).where(eq(referenceItems.id, id)).get();
}

function makeClient(statusId: string | null): string {
	const row = db
		.insert(clients)
		.values({ name: "Acme", sortName: "acme", statusId })
		.returning()
		.get();
	return row.id;
}

/** The same sets at a later version, every shipped label and tone changed. */
function laterSeed(): SeedSource {
	return {
		version: SEED_VERSION + 1,
		sets: SEED_SETS.map((set) => ({
			...set,
			items: set.items.map((item) => ({ ...item, label: `${item.label} v2`, tone: "risk" })),
		})),
	};
}

describe("seeding", () => {
	it("is idempotent", async () => {
		const first = await ensureSeeded(db);
		const after = itemCount();
		expect(first.setsCreated).toBe(SEED_SETS.length);
		expect(after).toBe(SEED_SETS.reduce((total, set) => total + set.items.length, 0));

		const second = await ensureSeeded(db);
		expect(second.setsCreated).toBe(0);
		expect(second.itemsCreated).toBe(0);
		expect(second.itemsUpdated).toBe(0);
		expect(itemCount()).toBe(after);

		const sets = await reference.listSets();
		expect(sets).toHaveLength(SEED_SETS.length);
	});

	it("records the applied version", async () => {
		await ensureSeeded(db);
		expect(await settings.getSeedVersion()).toBe(SEED_VERSION);
	});

	it("leaves a customised row alone when the version rises, and updates the rest", async () => {
		await ensureSeeded(db);
		const active = await itemByKey("client_status", "active");
		await reference.updateItem(active.id, { label: "Working with" });

		const result = await ensureSeeded(db, laterSeed());
		expect(result.itemsUpdated).toBeGreaterThan(0);

		const edited = rowById(active.id);
		expect(edited?.label).toBe("Working with");
		expect(edited?.customisedAt).not.toBeNull();

		const lead = await itemByKey("client_status", "lead");
		expect(lead.label).toBe("Lead v2");
		expect(await settings.getSeedVersion()).toBe(SEED_VERSION + 1);
	});

	it("never resurrects a hidden row", async () => {
		await ensureSeeded(db);
		const dormant = await itemByKey("client_status", "dormant");
		await reference.hideItem(dormant.id);

		await ensureSeeded(db, laterSeed());

		const after = rowById(dormant.id);
		expect(after?.hiddenAt).not.toBeNull();
		expect(after?.label).toBe("Dormant");
	});
});

describe("hiding", () => {
	it("leaves the records that already use the item intact", async () => {
		await ensureSeeded(db);
		const active = await itemByKey("client_status", "active");
		const clientId = makeClient(active.id);

		const hidden = await reference.hideItem(active.id);
		expect(hidden.hiddenAt).not.toBeNull();
		expect(hidden.deletedAt).toBeNull();

		const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
		expect(client?.statusId).toBe(active.id);

		// Still resolvable, so the record keeps rendering the value it was given.
		const set = await reference.getSet("client_status");
		const stillThere = set?.items.find((item) => item.id === active.id);
		expect(stillThere?.label).toBe("Active");

		const back = await reference.unhideItem(active.id);
		expect(back.hiddenAt).toBeNull();
	});
});

describe("usage", () => {
	it("counts live clients and projects, and ignores deleted ones", async () => {
		await ensureSeeded(db);
		const active = await itemByKey("client_status", "active");
		const projectActive = (await reference.getSet("project_status"))?.items.find(
			(item) => item.key === "active",
		);
		expect(projectActive).toBeDefined();

		const clientId = makeClient(active.id);
		makeClient(active.id);
		db
			.insert(projects)
			.values({ clientId, name: "Website", statusId: projectActive!.id })
			.run();

		expect((await reference.usage(active.id)).inUseBy).toBe(2);
		expect((await reference.usage(projectActive!.id)).inUseBy).toBe(1);

		db
			.update(clients)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(clients.id, clientId))
			.run();
		expect((await reference.usage(active.id)).inUseBy).toBe(1);
	});

	it("reports zero for an item nothing points at", async () => {
		await ensureSeeded(db);
		const archived = await itemByKey("client_status", "archived");
		expect(await reference.usage(archived.id)).toEqual({ itemId: archived.id, inUseBy: 0 });
	});
});

describe("reset", () => {
	it("restores shipped values, unhides, and clears customisedAt", async () => {
		await ensureSeeded(db);
		const lead = await itemByKey("client_status", "lead");
		const dormant = await itemByKey("client_status", "dormant");
		await reference.updateItem(lead.id, { label: "Prospect", tone: "risk" });
		await reference.hideItem(dormant.id);

		const result = await reference.resetSet("client_status", "keep");
		expect(result.unhidden).toBe(1);
		expect(result.restored).toBe(4);

		const restored = rowById(lead.id);
		expect(restored?.label).toBe("Lead");
		expect(restored?.tone).toBe("accent");
		expect(restored?.customisedAt).toBeNull();
		expect(rowById(dormant.id)?.hiddenAt).toBeNull();
	});

	it("keeps user items when asked to", async () => {
		await ensureSeeded(db);
		const set = await reference.getSet("label");
		const mine = await reference.createItem({ setId: set!.set.id, label: "Board seat" });

		const result = await reference.resetSet("label", "keep");
		expect(result.userItemsKept).toBe(1);
		expect(result.userItemsRemoved).toBe(0);
		expect(rowById(mine.id)?.deletedAt).toBeNull();
	});

	it("removes user items when asked to", async () => {
		await ensureSeeded(db);
		const set = await reference.getSet("label");
		const mine = await reference.createItem({ setId: set!.set.id, label: "Board seat" });

		const result = await reference.resetSet("label", "remove");
		expect(result.userItemsRemoved).toBe(1);
		expect(rowById(mine.id)?.deletedAt).not.toBeNull();

		const after = await reference.getSet("label");
		expect(after?.items.some((item) => item.id === mine.id)).toBe(false);
	});

	it("hides rather than deletes a user item something points at", async () => {
		await ensureSeeded(db);
		const set = await reference.getSet("client_status");
		const mine = await reference.createItem({ setId: set!.set.id, label: "In dispute" });
		makeClient(mine.id);

		const result = await reference.resetSet("client_status", "remove");
		expect(result.userItemsRemoved).toBe(0);
		expect(result.userItemsKept).toBe(1);

		const row = rowById(mine.id);
		expect(row?.deletedAt).toBeNull();
		expect(row?.hiddenAt).not.toBeNull();
	});

	it("resets every set at once", async () => {
		await ensureSeeded(db);
		const total = SEED_SETS.reduce((sum, set) => sum + set.items.length, 0);
		const result = await reference.resetAll("keep");
		expect(result.restored).toBe(total);
	});
});

describe("items", () => {
	it("adds a user item with a derived key at the end of the set", async () => {
		await ensureSeeded(db);
		const set = await reference.getSet("label");
		const created = await reference.createItem({ setId: set!.set.id, label: "Board seat" });
		expect(created.key).toBe("board_seat");
		expect(created.isSystem).toBe(false);
		expect(created.seedKey).toBeNull();

		const live = db
			.select()
			.from(referenceItems)
			.where(and(eq(referenceItems.setId, set!.set.id), isNull(referenceItems.deletedAt)))
			.all();
		expect(Math.max(...live.map((row) => row.sortOrder))).toBe(created.sortOrder);
	});

	it("reorders and marks the moved system rows as customised", async () => {
		await ensureSeeded(db);
		const set = await reference.getSet("client_status");
		const ids = set!.items.map((item) => item.id).reverse();

		const reordered = await reference.reorder(set!.set.id, ids);
		expect(reordered.map((item) => item.id)).toEqual(ids);
		expect(reordered.every((item) => item.customisedAt !== null)).toBe(true);
	});

	it("refuses a duplicate key in the same set", async () => {
		await ensureSeeded(db);
		const set = await reference.getSet("client_status");
		await expect(
			reference.createItem({ setId: set!.set.id, label: "Active" }),
		).rejects.toThrow(/already has an item/);
	});
});
