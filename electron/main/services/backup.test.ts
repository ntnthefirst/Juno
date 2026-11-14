/**
 * The safety copy taken before an update changes the database. Each test builds
 * its own small migrations folder, so what is pending is exactly what the test
 * says it is.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pendingMigrations, runMigrations } from "../db/migrate";
import { openDatabase, type ShimDatabase } from "../db/node-sqlite-shim";
import { configureBackups, create, createBeforeMigrations, list, validate } from "./backup";

let root: string;
let migrations: string;
let backups: string;
let connection: ShimDatabase;

function migration(name: string, sql: string): void {
	writeFileSync(join(migrations, name), sql);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "juno-backup-"));
	migrations = join(root, "migrations");
	backups = join(root, "backups");
	mkdirSync(migrations);
	configureBackups({ directory: backups, databaseFile: join(root, "juno.db") });
	connection = openDatabase(join(root, "juno.db"));
	migration("0001_a.sql", "CREATE TABLE things (id TEXT PRIMARY KEY, name TEXT);");
});

afterEach(() => {
	connection.close();
	rmSync(root, { recursive: true, force: true });
});

function seedCurrent(): void {
	runMigrations(connection, migrations);
	connection.prepare("INSERT INTO things (id, name) VALUES (?, ?)").run("1", "kept");
}

function copies(): string[] {
	return readdirSync(backups).filter((n) => n.startsWith("juno-before-update-"));
}

describe("pendingMigrations", () => {
	it("lists everything on a database that was never migrated", () => {
		expect(pendingMigrations(connection, migrations)).toEqual({
			pending: ["0001_a.sql"],
			applied: [],
		});
	});

	it("lists only what is not yet applied, without applying it", () => {
		seedCurrent();
		migration("0002_b.sql", "ALTER TABLE things ADD COLUMN extra TEXT;");
		const result = pendingMigrations(connection, migrations);
		expect(result.pending).toEqual(["0002_b.sql"]);
		expect(result.applied).toEqual(["0001_a.sql"]);
		expect(() => connection.prepare("SELECT extra FROM things").all()).toThrow();
	});
});

describe("createBeforeMigrations", () => {
	it("takes no copy when the database is current", async () => {
		seedCurrent();
		expect(await createBeforeMigrations(connection, migrations)).toBeNull();
		expect(await list()).toEqual([]);
	});

	it("takes no copy for a database that was never migrated", async () => {
		expect(await createBeforeMigrations(connection, migrations)).toBeNull();
	});

	it("copies a database with a pending migration, with the same rows, and lists it", async () => {
		seedCurrent();
		migration("0002_b.sql", "ALTER TABLE things ADD COLUMN extra TEXT;");
		const info = await createBeforeMigrations(connection, migrations);
		expect(info).not.toBeNull();
		expect(info?.path).toMatch(/juno-before-update-.*-0001_a\.sqlite$/);

		validate(info!.path);
		const copy = openDatabase(info!.path);
		try {
			expect(copy.prepare("SELECT name FROM things").all()).toEqual([{ name: "kept" }]);
		} finally {
			copy.close();
		}
		expect((await list()).map((b) => b.path)).toContain(info!.path);
	});

	it("keeps the last three copies and leaves manual backups alone", async () => {
		seedCurrent();
		migration("0002_b.sql", "ALTER TABLE things ADD COLUMN extra TEXT;");
		mkdirSync(backups, { recursive: true });
		const manual = join(backups, "juno-2020-01-01T00-00-00Z.sqlite");
		writeFileSync(manual, "manual");
		for (const day of ["01", "02", "03", "04", "05"]) {
			writeFileSync(join(backups, `juno-before-update-2020-02-${day}T00-00-00Z-0001_a.sqlite`), "old");
		}

		await createBeforeMigrations(connection, migrations);

		const kept = copies();
		expect(kept).toHaveLength(3);
		expect(kept.some((n) => n.includes("2020-02-01"))).toBe(false);
		expect(readdirSync(backups)).toContain("juno-2020-01-01T00-00-00Z.sqlite");
	});

	it("is not pruned by a manual backup, whatever number of them there are", async () => {
		seedCurrent();
		mkdirSync(backups, { recursive: true });
		const mine = join(backups, "juno-before-update-2020-02-01T00-00-00Z-0001_a.sqlite");
		writeFileSync(mine, "old");
		for (let i = 10; i < 25; i++) {
			writeFileSync(join(backups, `juno-2021-01-${i}T00-00-00Z.sqlite`), "manual");
		}
		await create();
		expect(readdirSync(backups)).toContain("juno-before-update-2020-02-01T00-00-00Z-0001_a.sqlite");
		expect((await list()).filter((b) => !b.path.includes("before-update"))).toHaveLength(10);
	});

	it("throws and leaves the database unmigrated when the copy cannot be made", async () => {
		seedCurrent();
		migration("0002_b.sql", "ALTER TABLE things ADD COLUMN extra TEXT;");
		// A file where the folder should be makes the copy impossible.
		writeFileSync(backups, "not a folder");
		await expect(createBeforeMigrations(connection, migrations)).rejects.toThrow(
			/could not copy your data/,
		);
		expect(pendingMigrations(connection, migrations).pending).toEqual(["0002_b.sql"]);
	});
});
