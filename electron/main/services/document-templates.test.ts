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
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as templates from "./document-templates";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("document-templates", () => {
	it("creates a template from a name alone, with one empty page and no review", async () => {
		const db = freshDb();
		const created = await templates.create({ name: "Test template" }, db);
		expect(created.name).toBe("Test template");
		expect(created.key).toBe("test_template");
		expect(created.reviewedAt).toBeNull();
		expect(created.layout).not.toBeNull();
		expect(created.layout?.pages).toHaveLength(1);
	});

	it("gives a second template with the same name a distinct key", async () => {
		const db = freshDb();
		const first = await templates.create({ name: "Test template" }, db);
		const second = await templates.create({ name: "Test template" }, db);
		expect(first.key).toBe("test_template");
		expect(second.key).toBe("test_template_2");
	});

	it("refuses an empty or whitespace name", async () => {
		const db = freshDb();
		await expect(templates.create({ name: "   " }, db)).rejects.toThrow(/needs a name/);
	});
});
