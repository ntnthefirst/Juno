import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { apply, configureDocumentsFolder, current, reset, set } from "./documents-folder";
import { configureSettings } from "./settings";

let pointedAt = "";
let defaultDirectory = "";

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), "juno-docs-folder-"));
	configureSettings(root);
	defaultDirectory = join(root, "documents");
	pointedAt = "";
	configureDocumentsFolder({ defaultDirectory, apply: (directory) => (pointedAt = directory) });
});

describe("the documents folder", () => {
	it("is the folder inside the data folder until one is chosen", async () => {
		expect(await current()).toEqual({ path: defaultDirectory, isDefault: true });
		await apply();
		expect(pointedAt).toBe(defaultDirectory);
	});

	it("points new documents at a chosen folder and remembers it", async () => {
		const chosen = join(mkdtempSync(join(tmpdir(), "juno-docs-chosen-")), "Contracts");
		const folder = await set(chosen);
		expect(folder).toEqual({ path: chosen, isDefault: false });
		expect(pointedAt).toBe(chosen);
		expect(await current()).toEqual({ path: chosen, isDefault: false });
	});

	it("goes back to the default and forgets the choice", async () => {
		await set(mkdtempSync(join(tmpdir(), "juno-docs-chosen-")));
		const folder = await reset();
		expect(folder.isDefault).toBe(true);
		expect(pointedAt).toBe(defaultDirectory);
		expect((await current()).isDefault).toBe(true);
	});

	it("refuses a path that is a file and says what to do", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "juno-docs-file-")), "plain.txt");
		writeFileSync(file, "x");
		await expect(set(file)).rejects.toThrow(/Choose a folder you can save files in/);
	});

	it("refuses a relative path", async () => {
		await expect(set("documents")).rejects.toThrow(/not a relative path/);
	});

	it("falls back to the default at startup when the chosen folder has gone", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "juno-docs-file-")), "now-a-file");
		await set(join(mkdtempSync(join(tmpdir(), "juno-docs-chosen-")), "Gone"));
		const { setDocumentsFolder } = await import("./settings");
		writeFileSync(file, "x");
		await setDocumentsFolder(file);
		const folder = await apply();
		expect(folder.isDefault).toBe(true);
		expect(pointedAt).toBe(defaultDirectory);
	});
});
