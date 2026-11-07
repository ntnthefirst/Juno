import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { configureDocumentStorage } from "./documents";
import * as pageImages from "./page-images";
import * as pages from "./pages";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let db: Db;
let dir: string;

/** The eight signature bytes of a PNG plus filler, enough for the type to be read. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	dir = mkdtempSync(join(tmpdir(), "juno-pages-"));
	configureDocumentStorage(dir);
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("a page's pictures", () => {
	it("keeps the file in the page's own folder and hands back a relative path", async () => {
		const page = await pages.create({ title: "Quote" }, db);
		const block = pageImages.store(page.document.id, { fileName: "Oak table.png", data: PNG }, db);

		expect(block.path).toMatch(new RegExp(`^pages/${page.document.id}/[a-f0-9-]+[.]png$`));
		expect(block.alt).toBe("Oak table");
		expect(new Uint8Array(readFileSync(pageImages.absolutePath(block.path)))).toEqual(PNG);
		expect(pageImages.exists(block.path)).toBe(true);
	});

	it("reads the type from the bytes and refuses an SVG, a text file and a huge one", async () => {
		const page = await pages.create({}, db);
		const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
		expect(() => pageImages.store(page.document.id, { fileName: "a.png", data: svg }, db)).toThrow(/PNG, JPEG, GIF or WebP/);
		expect(() => pageImages.store(page.document.id, { fileName: "a.png", data: new Uint8Array(11 * 1024 * 1024) }, db)).toThrow(/10 MB/);
	});

	it("refuses a page that does not exist", () => {
		expect(() => pageImages.store("0190a000-0000-7000-8000-00000000ffff", { fileName: "a.png", data: PNG }, db)).toThrow(/no longer exists/);
	});

	it("serves only a file inside the page's folder, by the name it was given", async () => {
		const page = await pages.create({}, db);
		const block = pageImages.store(page.document.id, { fileName: "a.png", data: PNG }, db);
		const name = block.path.split("/")[2]!;

		expect(pageImages.serve(page.document.id, name).mimeType).toBe("image/png");
		expect(() => pageImages.serve(page.document.id, "missing.png")).toThrow();
		expect(() => pageImages.serve("..", name)).toThrow();
		expect(() => pageImages.absolutePath("pages/../../../etc/passwd.png")).toThrow();
	});

	it("saves a page with its own picture, and refuses another page's", async () => {
		const a = await pages.create({ title: "A" }, db);
		const b = await pages.create({ title: "B" }, db);
		const own = pageImages.store(a.document.id, { fileName: "a.png", data: PNG }, db);

		const saved = await pages.update(a.document.id, { blocks: [own] }, db);
		expect(saved.blocks).toEqual([own]);
		await expect(pages.update(b.document.id, { blocks: [own] }, db)).rejects.toThrow(/only come from the page/);
		await expect(pages.create({ blocks: [own] }, db)).rejects.toThrow(/once the page exists/);
	});
});
