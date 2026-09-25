/**
 * Runs under plain Node through Vitest, not inside Electron, which is why no
 * service under test here may import `electron`. Each test gets its own
 * in-memory database built from the committed migrations, and its own temp
 * folder for the files, so the tests prove the real schema and the real writes.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clients from "./clients";
import * as assets from "./project-assets";
import * as commands from "./project-commands";
import * as links from "./project-links";
import { configureProjectStorage, safeFileName, uniqueNameIn } from "./project-storage";
import * as projects from "./projects";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

let root: string;
let source: string;

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

/** A real file on disk to add, because copying one is the thing being tested. */
function makeFile(name: string, contents = "x"): string {
	const path = join(source, name);
	writeFileSync(path, contents, "utf8");
	return path;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "juno-projects-"));
	source = mkdtempSync(join(tmpdir(), "juno-source-"));
	configureProjectStorage(join(root, "projects"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	rmSync(source, { recursive: true, force: true });
});

describe("projects", () => {
	it("creates one with no client at all", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		expect(project.clientId).toBeNull();
		expect(project.storageMode).toBe("app");

		const listed = await projects.list({}, db);
		expect(listed).toHaveLength(1);
		expect(listed[0]!.clientName).toBeNull();
	});

	it("separates the projects that have a client from the ones that do not", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "De Backer BV" }, db);
		await projects.create({ name: "Website", clientId: client.id }, db);
		await projects.create({ name: "Juno" }, db);

		expect((await projects.list({ unassigned: true }, db)).map((row) => row.name)).toEqual(["Juno"]);
		expect((await projects.list({ unassigned: false }, db)).map((row) => row.name)).toEqual([
			"Website",
		]);
	});

	it("refuses a local folder that is not there", async () => {
		const db = freshDb();
		await expect(
			projects.create({ name: "Juno", localPath: join(root, "nope") }, db),
		).rejects.toThrow(/no folder at/);
	});

	it("counts the links, files and commands a card shows", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		await links.create(
			{ projectId: project.id, label: "Repository", target: "https://github.com/you/juno" },
			db,
		);
		await assets.add({ projectId: project.id, sourcePath: makeFile("shot.png") }, db);
		await commands.create({ projectId: project.id, label: "Dev", command: "npm run dev" }, db);

		const [row] = await projects.list({}, db);
		expect(row!.linkKinds).toEqual(["github"]);
		expect(row!.assetCount).toBe(1);
		expect(row!.commandCount).toBe(1);
	});
});

describe("a project's links", () => {
	it("works out github and figma from the address", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		const repository = await links.create(
			{ projectId: project.id, label: "Repository", target: "https://github.com/you/juno" },
			db,
		);
		const designs = await links.create(
			{ projectId: project.id, label: "Designs", target: "https://figma.com/file/abc" },
			db,
		);

		expect(repository.kind).toBe("github");
		expect(designs.kind).toBe("figma");
	});

	it("takes an absolute path as a folder", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const link = await links.create(
			{ projectId: project.id, label: "On disk", target: source },
			db,
		);
		expect(link.kind).toBe("folder");
	});

	it("refuses anything that is not https and not a full path", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		await expect(
			links.create({ projectId: project.id, label: "Bad", target: "javascript:alert(1)" }, db),
		).rejects.toThrow(/have to be https/);
		await expect(
			links.create({ projectId: project.id, label: "Bad", target: "http://example.com" }, db),
		).rejects.toThrow(/have to be https/);
		await expect(
			links.create({ projectId: project.id, label: "Bad", target: "file:///etc/passwd" }, db),
		).rejects.toThrow(/have to be https/);
		await expect(
			links.create({ projectId: project.id, label: "Bad", target: "somewhere/relative" }, db),
		).rejects.toThrow(/whole path/);
	});

	it("keeps the order a reorder asked for", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const first = await links.create(
			{ projectId: project.id, label: "One", target: "https://one.example" },
			db,
		);
		const second = await links.create(
			{ projectId: project.id, label: "Two", target: "https://two.example" },
			db,
		);

		const reordered = await links.reorder(project.id, [second.id, first.id], db);
		expect(reordered.map((row) => row.label)).toEqual(["Two", "One"]);
	});
});

describe("a project's files", () => {
	it("copies a managed file into the project's folder", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		const asset = await assets.add(
			{ projectId: project.id, sourcePath: makeFile("shot.png") },
			db,
		);

		expect(asset.storage).toBe("managed");
		expect(asset.path).toBe("shot.png");
		expect(asset.kind).toBe("image");
		expect(asset.mimeType).toBe("image/png");
		expect(existsSync(asset.absolutePath)).toBe(true);
		expect(asset.absolutePath.startsWith(join(root, "projects", project.id))).toBe(true);
	});

	it("leaves a linked file where it is", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const original = makeFile("huge.mp4");

		const asset = await assets.add(
			{ projectId: project.id, sourcePath: original, storage: "linked" },
			db,
		);

		expect(asset.storage).toBe("linked");
		expect(asset.absolutePath).toBe(original);
		expect(asset.kind).toBe("video");
		// Nothing was copied: the project's folder is not even there yet.
		expect(existsSync(join(root, "projects", project.id, "huge.mp4"))).toBe(false);
	});

	it("never overwrites a file that is already in the folder", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		const first = await assets.add(
			{ projectId: project.id, sourcePath: makeFile("shot.png", "one") },
			db,
		);
		const second = await assets.add(
			{ projectId: project.id, sourcePath: makeFile("shot.png", "two") },
			db,
		);

		expect(first.path).toBe("shot.png");
		expect(second.path).toBe("shot-2.png");
	});

	it("clears the cover when the file behind it goes", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const asset = await assets.add(
			{ projectId: project.id, sourcePath: makeFile("shot.png") },
			db,
		);

		await projects.setCover(project.id, asset.id, db);
		expect((await projects.get(project.id, db))!.coverAssetId).toBe(asset.id);

		await assets.remove(asset.id, db);
		expect((await projects.get(project.id, db))!.coverAssetId).toBeNull();
	});

	it("keeps a deleted file on disk so the delete can be undone", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const asset = await assets.add(
			{ projectId: project.id, sourcePath: makeFile("shot.png") },
			db,
		);

		await assets.remove(asset.id, db);
		expect(existsSync(asset.absolutePath)).toBe(true);
		expect(await assets.listForProject(project.id, db)).toHaveLength(0);

		const restored = await assets.restore(asset.id, db);
		expect(restored.exists).toBe(true);

		// Purge is the one that really deletes, and nothing calls it on a timer.
		await assets.purge(asset.id, db);
		expect(existsSync(asset.absolutePath)).toBe(false);
	});

	it("leaves a linked file alone when it is purged", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const original = makeFile("huge.mp4");
		const asset = await assets.add(
			{ projectId: project.id, sourcePath: original, storage: "linked" },
			db,
		);

		await assets.remove(asset.id, db);
		await assets.purge(asset.id, db);
		expect(existsSync(original)).toBe(true);
	});

	it("reports a linked file that has gone rather than pretending it is there", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const original = makeFile("gone.png");
		await assets.add({ projectId: project.id, sourcePath: original, storage: "linked" }, db);

		rmSync(original);
		const [row] = await assets.listForProject(project.id, db);
		expect(row!.exists).toBe(false);
		expect(() => assets.pathOf(row!.id, db)).toThrow(/not at/);
	});
});

describe("where a project keeps its files", () => {
	it("moves the files and then writes the row", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		const asset = await assets.add(
			{ projectId: project.id, sourcePath: makeFile("shot.png") },
			db,
		);
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });

		const moved = await projects.setStorage(
			project.id,
			{ mode: "custom", path: elsewhere, move: true },
			db,
		);

		expect(moved.storageMode).toBe("custom");
		expect(moved.storagePath).toBe(join(elsewhere, "juno"));
		expect(existsSync(join(elsewhere, "juno", "shot.png"))).toBe(true);
		expect(existsSync(asset.absolutePath)).toBe(false);

		// The asset row still resolves, because the path it holds is relative.
		const [row] = await assets.listForProject(project.id, db);
		expect(row!.absolutePath).toBe(join(elsewhere, "juno", "shot.png"));
		expect(row!.exists).toBe(true);
	});

	it("carries the files back to the app's own folder", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		await assets.add({ projectId: project.id, sourcePath: makeFile("shot.png") }, db);
		const elsewhere = join(root, "elsewhere");

		await projects.setStorage(project.id, { mode: "custom", path: elsewhere, move: true }, db);
		await projects.setStorage(project.id, { mode: "app", move: true }, db);

		const back = await projects.storage(project.id, db);
		expect(back.mode).toBe("app");
		expect(back.path).toBe(join(root, "projects", project.id));
		expect(readdirSync(back.path)).toEqual(["shot.png"]);
	});

	it("reports what is in the folder", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		await assets.add({ projectId: project.id, sourcePath: makeFile("a.png", "1234") }, db);
		await assets.add({ projectId: project.id, sourcePath: makeFile("b.png", "12") }, db);

		const info = await projects.storage(project.id, db);
		expect(info.exists).toBe(true);
		expect(info.fileCount).toBe(2);
		expect(info.byteSize).toBe(6);
	});

	it("refuses a destination inside the folder being moved", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);
		await assets.add({ projectId: project.id, sourcePath: makeFile("shot.png") }, db);
		const inside = join(root, "projects", project.id, "deeper");

		await expect(
			projects.setStorage(project.id, { mode: "custom", path: inside, move: true }, db),
		).rejects.toThrow(/inside the one being moved/);
	});
});

describe("file names that arrive from outside", () => {
	it("strips a path out of a name rather than following it", () => {
		expect(safeFileName("../../etc/passwd")).toBe("passwd");
		expect(safeFileName("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBe("hosts");
		expect(safeFileName("..")).toBe("file");
		expect(safeFileName("")).toBe("file");
	});

	it("drops the characters a filesystem refuses", () => {
		expect(safeFileName('re<po>rt:"|?*.pdf')).toBe("report.pdf");
	});

	it("numbers a name that is already taken", () => {
		const folder = join(root, "unique");
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "a.png"), "x");
		expect(uniqueNameIn(folder, "a.png")).toBe("a-2.png");
	});
});

describe("a project's commands", () => {
	it("refuses an empty command and a multi-line one", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		await expect(
			commands.create({ projectId: project.id, label: "Dev", command: "  " }, db),
		).rejects.toThrow(/Enter the command/);
		await expect(
			commands.create({ projectId: project.id, label: "Dev", command: "a\nb" }, db),
		).rejects.toThrow(/one line/);
	});

	it("refuses a working directory that is not there", async () => {
		const db = freshDb();
		const project = await projects.create({ name: "Juno" }, db);

		await expect(
			commands.create(
				{ projectId: project.id, label: "Dev", command: "npm run dev", workingDir: join(root, "nope") },
				db,
			),
		).rejects.toThrow(/no folder at/);
	});
});
