import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clients, projects, referenceItems, referenceSets, reminders } from "../db/schema";
import { ensureRemindersSeeded, invoiceSuggestions, suggestions } from "./reminders-derive";
import { create } from "./reminders";
import { configureSettings, setAccountingTool } from "./settings";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
	configureSettings(mkdtempSync(join(tmpdir(), "juno-rem-")));
});

/** A client with a project in the given status, which is what the rules read. */
function makeProject(statusKey: string, valueCents: number | null, dueOn?: string) {
	const [set] = db
		.insert(referenceSets)
		.values({ key: "project_status", label: "Project status" })
		.returning()
		.all();
	const [status] = db
		.insert(referenceItems)
		.values({ setId: set!.id, key: statusKey, label: statusKey })
		.returning()
		.all();
	const [client] = db
		.insert(clients)
		.values({ name: "obet", sortName: "obet" })
		.returning()
		.all();
	const [project] = db
		.insert(projects)
		.values({
			clientId: client!.id,
			name: "Website",
			statusId: status!.id,
			agreedValueCents: valueCents,
			dueOn: dueOn ?? null,
		})
		.returning()
		.all();
	return { client: client!, project: project! };
}

describe("ensureRemindersSeeded", () => {
	it("creates the recurring paperwork once", async () => {
		const first = await ensureRemindersSeeded(db, "2026-01-01");
		expect(first.created).toBeGreaterThan(0);

		const second = await ensureRemindersSeeded(db, "2026-01-01");
		expect(second.created).toBe(0);
	});

	it("never opens with an occurrence already in the past", async () => {
		// A fresh install in November must not greet the owner with four overdue
		// reminders from earlier in the year.
		await ensureRemindersSeeded(db, "2026-11-20");
		const rows = db.select().from(reminders).all();
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.dueOn >= "2026-11-20").toBe(true);
		}
	});

	it("marks what it creates as system rows", async () => {
		await ensureRemindersSeeded(db, "2026-01-01");
		const rows = db.select().from(reminders).all();
		expect(rows.every((row) => row.isSystem)).toBe(true);
		expect(rows.every((row) => row.seedKey !== null)).toBe(true);
	});

	it("gives every seeded reminder a note saying to confirm the date", async () => {
		await ensureRemindersSeeded(db, "2026-01-01");
		const rows = db.select().from(reminders).all();
		// Juno does not know anyone's filing deadlines. Saying so is the point.
		expect(rows.every((row) => (row.notes ?? "").length > 0)).toBe(true);
	});
});

describe("invoiceSuggestions", () => {
	it("suggests a delivered project that has a value", async () => {
		makeProject("delivered", 210000);
		const rows = await invoiceSuggestions(db, "2026-05-10");
		expect(rows).toHaveLength(1);
		expect(rows[0]!.title).toContain("obet");
		expect(rows[0]!.category).toBe("invoice");
	});

	it("ignores a project that is still active", async () => {
		makeProject("active", 210000);
		expect(await invoiceSuggestions(db, "2026-05-10")).toHaveLength(0);
	});

	it("ignores a delivered project with no agreed value", async () => {
		makeProject("delivered", null);
		expect(await invoiceSuggestions(db, "2026-05-10")).toHaveLength(0);
	});

	it("stops suggesting once a real invoice reminder exists", async () => {
		const { project } = makeProject("delivered", 210000);
		expect(await invoiceSuggestions(db, "2026-05-10")).toHaveLength(1);

		await create(
			{ title: "Invoice it", dueOn: "2026-05-10", category: "invoice", projectId: project.id },
			db,
			"2026-05-10",
		);
		expect(await invoiceSuggestions(db, "2026-05-10")).toHaveLength(0);
	});

	it("carries the accounting tool link, since Juno never invoices itself", async () => {
		makeProject("delivered", 210000);
		await setAccountingTool({ name: "Accountable", url: "https://example.invalid" });

		const rows = await invoiceSuggestions(db, "2026-05-10");
		expect(rows[0]!.actionUrl).toBe("https://example.invalid");
		expect(rows[0]!.actionLabel).toContain("Accountable");
		expect(rows[0]!.notes).toContain("does not raise invoices");
	});
});

describe("suggestions", () => {
	it("returns deadline suggestions inside the horizon and not beyond it", async () => {
		makeProject("active", null, "2026-05-20");
		const near = await suggestions(db, "2026-05-10");
		expect(near.some((s) => s.key.startsWith("deadline:"))).toBe(true);

		const far = await suggestions(db, "2026-01-01");
		expect(far.some((s) => s.key.startsWith("deadline:"))).toBe(false);
	});

	it("sorts by date", async () => {
		makeProject("delivered", 210000, "2026-05-15");
		const rows = await suggestions(db, "2026-05-10");
		const dates = rows.map((r) => r.dueOn);
		expect([...dates].sort()).toEqual(dates);
	});
});
