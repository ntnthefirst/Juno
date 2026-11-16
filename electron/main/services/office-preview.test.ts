/**
 * A Word file or a deck previewed through its own program (decision 83), with
 * the programs injected: which one is asked, what happens when it is missing
 * or fails, and that a second look reads the cache. No real Office runs here.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { docxBytes, freshDb } from "./file-fixtures";
import { configurePreview, preview } from "./file-preview";
import { configureOfficePreview, officePdf, officeRouteFor } from "./office-preview";
import { configurePreviewCache } from "./preview-cache";

const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n% made by a program that is not Office\n%%EOF\n"));

type Call = { route: "word" | "powerpoint"; input: string; output: string };

function office(options: { word?: boolean; powerpoint?: boolean; fail?: boolean } = {}) {
	const calls: Call[] = [];
	const make = (route: Call["route"]) => async (input: string, output: string) => {
		calls.push({ route, input, output });
		// The program reads a copy beside its output, never the person's file.
		expect(dirname(input)).toBe(dirname(output));
		expect(existsSync(input)).toBe(true);
		if (options.fail) throw new Error("Word could not make a PDF of this file.");
		writeFileSync(output, PDF);
	};
	configureOfficePreview({
		wordAvailable: async () => options.word ?? true,
		powerpointAvailable: async () => options.powerpoint ?? true,
		convertWithWord: make("word"),
		convertWithPowerPoint: make("powerpoint"),
	});
	return calls;
}

function bytes(fileName: string, data: Uint8Array | string) {
	return { kind: "bytes" as const, fileName, data: typeof data === "string" ? new Uint8Array(Buffer.from(data)) : data };
}

afterEach(() => {
	configureOfficePreview(null);
	configurePreviewCache(null);
	configurePreview(null);
});

describe("previews through Word and PowerPoint", () => {
	it("picks Word for what Word opens and PowerPoint for a deck", () => {
		for (const name of ["brief.docx", "macro.docm", "oud.doc", "notitie.rtf", "open.odt"]) expect(officeRouteFor(name)).toBe("word");
		for (const name of ["deck.pptx", "deck.pptm", "oud.ppt", "show.pps", "show.ppsx", "open.odp"]) {
			expect(officeRouteFor(name)).toBe("powerpoint");
		}
		for (const name of ["prijzen.xlsx", "Offerte.pages", "plan.pdf"]) expect(officeRouteFor(name)).toBeNull();
	});

	it("shows a Word file and a deck as the PDF their program made", async () => {
		configurePreviewCache({ directory: mkdtempSync(join(tmpdir(), "juno-office-cache-")) });
		const calls = office();
		const word = await preview(bytes("Bestek keuken.docx", await docxBytes(["Bestek keuken"])), freshDb());
		expect(word).toMatchObject({ kind: "pdf", via: "word" });
		const deck = await preview(bytes("Voorstel.pptx", "PK\u0003\u0004 a deck"), freshDb());
		expect(deck).toMatchObject({ kind: "pdf", via: "powerpoint" });
		expect(calls.map((call) => call.route)).toEqual(["word", "powerpoint"]);
		// The copy keeps the extension, which is what tells the program the format, and nothing of the name.
		expect(calls[0]!.input).toMatch(/preview\.docx$/);
		expect(calls[1]!.input).toMatch(/preview\.pptx$/);
	});

	it("reads the second look from the cache, without the program", async () => {
		configurePreviewCache({ directory: mkdtempSync(join(tmpdir(), "juno-office-cache-")) });
		const calls = office();
		const file = await docxBytes(["Algemene voorwaarden"]);
		const first = await officePdf({ name: "voorwaarden.docx", path: null, bytes: file, versionId: null });
		const second = await officePdf({ name: "voorwaarden.docx", path: null, bytes: file, versionId: null });
		expect(first).toMatchObject({ via: "word", cached: false });
		expect(second).toMatchObject({ via: "word", cached: true });
		expect(new Uint8Array(second!.pdf)).toEqual(PDF);
		expect(calls).toHaveLength(1);
	});

	it("keeps a version by its id and a file on disk by its bytes", async () => {
		configurePreviewCache({ directory: mkdtempSync(join(tmpdir(), "juno-office-cache-")) });
		const calls = office();
		const folder = mkdtempSync(join(tmpdir(), "juno-office-file-"));
		const path = join(folder, "deck.pptx");
		writeFileSync(path, "a deck");
		await officePdf({ name: "deck.pptx", path, bytes: null, versionId: "01970000-0000-7000-8000-0000000000aa" });
		await officePdf({ name: "deck.pptx", path, bytes: null, versionId: "01970000-0000-7000-8000-0000000000aa" });
		await officePdf({ name: "deck.pptx", path, bytes: null, versionId: null });
		await officePdf({ name: "deck.pptx", path, bytes: null, versionId: null });
		expect(calls).toHaveLength(2);
		// The person's file is only read.
		expect(readFileSync(path, "utf8")).toBe("a deck");
	});

	it("runs one conversion for two looks at the same file at once", async () => {
		configurePreviewCache({ directory: mkdtempSync(join(tmpdir(), "juno-office-cache-")) });
		const calls = office();
		const file = new Uint8Array(Buffer.from("a deck"));
		const [one, two] = await Promise.all([
			officePdf({ name: "deck.pptx", path: null, bytes: file, versionId: null }),
			officePdf({ name: "deck.pptx", path: null, bytes: file, versionId: null }),
		]);
		expect(one).not.toBeNull();
		expect(two).toBe(one);
		expect(calls).toHaveLength(1);
	});

	it("falls back to the HTML and the thumbnail without an error when the program is missing", async () => {
		const calls = office({ word: false, powerpoint: false });
		const word = await preview(bytes("brief.docx", await docxBytes(["Een brief"])), freshDb());
		expect(word.kind).toBe("html");
		configurePreview({ thumbnail: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
		const deck = await preview(bytes("deck.pptx", "a deck"), freshDb());
		expect(deck).toMatchObject({ kind: "thumbnail", from: "system" });
		expect(calls).toHaveLength(0);
	});

	it("falls back when the program fails, and does not ask it again for that file", async () => {
		configurePreviewCache({ directory: mkdtempSync(join(tmpdir(), "juno-office-cache-")) });
		const calls = office({ fail: true });
		const file = await docxBytes(["Een brief die Word niet opent"]);
		expect((await preview(bytes("brief.docx", file), freshDb())).kind).toBe("html");
		expect((await preview(bytes("brief.docx", file), freshDb())).kind).toBe("html");
		expect(calls).toHaveLength(1);
		const deck = await preview(bytes("deck.pptx", "a deck"), freshDb());
		expect(deck.kind).toBe("none");
		if (deck.kind === "none") expect(deck.reason).toMatch(/PowerPoint/);
	});

	it("asks nothing when it was never set up, as in a test or before startup", async () => {
		configureOfficePreview(null);
		expect(await officePdf({ name: "brief.docx", path: null, bytes: new Uint8Array([1]), versionId: null })).toBeNull();
	});
});
