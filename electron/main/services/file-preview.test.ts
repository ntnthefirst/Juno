/**
 * Previews (decision 76) from files made in the test: a source of each kind
 * comes back as the shape the window draws, and what `app://preview/` serves
 * carries the policy that keeps it inert.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FilePreview } from "../../shared/types";
import { parseCsv } from "./csv";
import { importFile } from "./document-import";
import { configureDocumentStorage, remove as removeDocument } from "./documents";
import { familyOf, readableFileName, zipEntrySizes } from "./file-kind";
import {
	AGREEMENT,
	docxBytes,
	freshDb,
	iworkBytes,
	JPEG_BYTES,
	PNG_BYTES,
	textPdf,
	xlsxBytes,
} from "./file-fixtures";
import {
	configurePreview,
	forgetPreviews,
	iworkPicture,
	MAX_HELD_BYTES,
	preview,
	previewForAgent,
	sanitiseDocumentHtml,
	servePreview,
} from "./file-preview";
import { readableText, readSheets } from "./file-text";
import { extractText } from "./pdf-text";

// pdf.js and ExcelJS are loaded the first time they are used, and each load
// takes seconds on a busy machine. Paid once here, so each test's own limit
// measures what the test does.
beforeAll(async () => {
	await extractText(new Uint8Array());
	await readSheets(await xlsxBytes({ Warm: [["up"]] }), "warm.xlsx");
}, 120_000);

afterEach(() => configurePreview(null));

function bytes(fileName: string, data: Uint8Array | string) {
	return { kind: "bytes" as const, fileName, data: typeof data === "string" ? new Uint8Array(Buffer.from(data)) : data };
}

/**
 * The same ZIP with every entry claiming to unpack to two gigabytes, as a
 * ZIP bomb's directory does. Nothing is inflated, so this is cheap to make.
 */
function bomb(zip: Uint8Array): Uint8Array {
	const out = new Uint8Array(zip);
	const view = new DataView(out.buffer);
	let end = out.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	for (let index = 0; index < count; index += 1) {
		view.setUint32(at + 24, 0x7fffffff, true);
		at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
	}
	return out;
}

function served(result: FilePreview) {
	if (!("url" in result)) throw new Error(`No address for a ${result.kind} preview.`);
	const token = result.url.replace("app://preview/", "");
	return servePreview(token);
}

describe("reading a CSV", () => {
	it("keeps quoted separators, doubled quotes and line breaks, and takes a semicolon from a Belgian Excel", () => {
		const parsed = parseCsv('naam;bedrag;opmerking\r\n"Peeters, An";12,50;"zei ""ja""\nen ging"\r\nJanssens;7;\r\n');
		expect(parsed.rows).toEqual([
			["naam", "bedrag", "opmerking"],
			["Peeters, An", "12,50", 'zei "ja"\nen ging'],
			["Janssens", "7", ""],
		]);
		expect(parsed.truncatedRows).toBe(false);
	});

	it("cuts rows and columns past the limits and says so", () => {
		const text = Array.from({ length: 10 }, (_, row) => Array.from({ length: 6 }, (_, col) => `${row}-${col}`).join(",")).join("\n");
		const parsed = parseCsv(text, { maxRows: 3, maxColumns: 2 });
		expect(parsed.rows).toEqual([
			["0-0", "0-1"],
			["1-0", "1-1"],
			["2-0", "2-1"],
		]);
		expect(parsed).toMatchObject({ truncatedRows: true, truncatedColumns: true, totalRows: 10 });
	});
});

describe("what a file is", () => {
	it("judges the family from the name", () => {
		expect(familyOf("Contract.PDF")).toBe("pdf");
		expect(familyOf("brief.docx")).toBe("word");
		expect(familyOf("oud.doc")).toBe("legacy-word");
		expect(familyOf("prijzen.xlsx")).toBe("sheet");
		expect(familyOf("lijst.csv")).toBe("csv");
		expect(familyOf("logo.svg")).toBe("svg");
		expect(familyOf("foto.jpeg")).toBe("image");
		expect(familyOf("Offerte.pages")).toBe("iwork");
		expect(familyOf("notities.md")).toBe("text");
		expect(familyOf("plan.dwg")).toBe("other");
	});

	it("builds a readable name that every platform accepts", () => {
		expect(readableFileName('Offerte: "Acme" / 2026', "docx")).toBe("Offerte Acme 2026.docx");
		expect(readableFileName("CON", "txt")).toBe("CON document.txt");
		expect(readableFileName("...", "../x")).toBe("Document");
	});
});

describe("a preview", () => {
	it("hands a PDF over as its bytes", async () => {
		const pdf = await textPdf(AGREEMENT);
		const result = await preview(bytes("Contract.pdf", pdf), freshDb());
		expect(result.kind).toBe("pdf");
		if (result.kind === "pdf") expect(result.data.length).toBe(pdf.length);
		expect(result.meta).toMatchObject({ name: "Contract.pdf", mediaType: "application/pdf", extension: "pdf", size: pdf.length });
	});

	it("serves a picture by token with a policy that runs nothing", async () => {
		const result = await preview(bytes("pixel.png", PNG_BYTES), freshDb());
		expect(result.kind).toBe("image");
		const answer = served(result)!;
		expect(answer.contentType).toBe("image/png");
		expect(answer.csp).toContain("default-src 'none'");
		expect(answer.csp).toContain("sandbox");
		expect(Buffer.compare(answer.body, Buffer.from(PNG_BYTES))).toBe(0);
	});

	it("serves an SVG as an SVG picture whose script can never run", async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="4" height="4"/></svg>';
		const result = await preview(bytes("logo.svg", svg), freshDb());
		expect(result.kind).toBe("image");
		const answer = served(result)!;
		expect(answer.contentType).toBe("image/svg+xml");
		expect(answer.csp).not.toMatch(/script-src/);
		expect(answer.csp).toContain("default-src 'none'");
		expect(answer.csp).toContain("sandbox");
	});

	it("turns a Word file into sanitised HTML on its own address", async () => {
		const docx = await docxBytes(["Overeenkomst", "Artikel 1. De opdrachtnemer levert de website op."]);
		const result = await preview(bytes("Overeenkomst.docx", docx), freshDb());
		expect(result.kind).toBe("html");
		const answer = served(result)!;
		const html = answer.body.toString("utf8");
		expect(answer.contentType).toMatch(/^text\/html/);
		expect(answer.csp).toContain("default-src 'none'");
		expect(answer.csp).not.toMatch(/script-src/);
		// An empty sandbox: no script, no form, no navigation of the window, even
		// past a sanitiser that missed something.
		expect(answer.csp).toMatch(/(^|; )sandbox(;|$)/);
		expect(html).toContain("Artikel 1. De opdrachtnemer levert de website op.");
		expect(html).not.toMatch(/<script/i);
	});

	it("keeps only inline pictures and plain structure from a Word file's HTML", () => {
		const clean = sanitiseDocumentHtml(
			'<p onclick="x()">Tekst <a href="https://example.test">link</a></p>' +
				'<img src="https://example.test/track.png"><img src="data:image/png;base64,iVBORw0KGgo=">' +
				'<img src="data:image/svg+xml;base64,PHN2Zz4=">',
		);
		expect(clean).toBe('<p>Tekst <a>link</a></p><img src="data:image/png;base64,iVBORw0KGgo=" />');
	});

	it("reads a workbook into its sheets and cuts a long one", async () => {
		const rows = Array.from({ length: 600 }, (_, index) => [`Regel ${index + 1}`, index * 2]);
		const xlsx = await xlsxBytes({ Prijzen: [["Product", "Prijs"], ["Website", 2500]], Lang: rows });
		const result = await preview(bytes("prijzen.xlsx", xlsx), freshDb());
		expect(result.kind).toBe("table");
		if (result.kind !== "table") return;
		expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Prijzen", "Lang"]);
		expect(result.sheets[0]!.rows).toEqual([
			["Product", "Prijs"],
			["Website", "2500"],
		]);
		expect(result.sheets[1]!).toMatchObject({ truncatedRows: true, totalRows: 600 });
		expect(result.sheets[1]!.rows).toHaveLength(500);
	});

	it("reads a CSV as one sheet", async () => {
		const result = await preview(bytes("klanten.csv", "naam,stad\nAcme,Gent\n"), freshDb());
		expect(result.kind).toBe("table");
		if (result.kind === "table") expect(result.sheets[0]!.rows).toEqual([["naam", "stad"], ["Acme", "Gent"]]);
	});

	it("shows text as text, and cuts a long file", async () => {
		const short = await preview(bytes("notities.md", "# Vergadering\n\n- Website opleveren"), freshDb());
		expect(short).toMatchObject({ kind: "text", text: "# Vergadering\n\n- Website opleveren", truncated: false });
		const long = await preview(bytes("log.txt", "a".repeat(250_000)), freshDb());
		expect(long).toMatchObject({ kind: "text", truncated: true });
		if (long.kind === "text") expect(long.text.length).toBe(200_000);
	});

	it("shows the picture an iWork file carries", async () => {
		for (const at of ["preview.jpg", "QuickLook/Preview.jpg", "QuickLook/Thumbnail.jpg"]) {
			const result = await preview(bytes("Offerte.pages", await iworkBytes(JPEG_BYTES, at)), freshDb());
			expect(result).toMatchObject({ kind: "thumbnail", from: "iwork" });
			expect(served(result)!.contentType).toBe("image/jpeg");
		}
	});

	it("asks the operating system for a thumbnail of anything else, and says so when there is none", async () => {
		const none = await preview(bytes("plan.dwg", "AC1032 drawing"), freshDb());
		expect(none.kind).toBe("none");
		if (none.kind === "none") expect(none.reason).toMatch(/Open it/);

		const asked: string[] = [];
		configurePreview({
			thumbnail: async (path) => {
				asked.push(path);
				return Buffer.from(PNG_BYTES);
			},
		});
		const drawn = await preview(bytes("plan.dwg", "AC1032 drawing"), freshDb());
		expect(drawn).toMatchObject({ kind: "thumbnail", from: "system" });
		expect(asked[0]).toMatch(/juno-preview-[a-f0-9]+\.dwg$/);
	});

	it("previews a kept document by its id, never by a path", async () => {
		const db = freshDb();
		configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-preview-")));
		const record = await importFile({ source: bytes("Brief.docx", await docxBytes(AGREEMENT)) }, db);
		const result = await preview({ kind: "document", documentId: record.id }, db);
		expect(result).toMatchObject({ kind: "html", meta: { name: "Brief.docx" } });
		const version = await preview({ kind: "version", versionId: record.latestVersion!.id }, db);
		expect(version.kind).toBe("html");
	});

	it("refuses a deleted document and its versions, for the window and for an agent", async () => {
		const db = freshDb();
		configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-preview-")));
		const record = await importFile({ source: bytes("Geheim.txt", "Wat in de prullenbak ligt.") }, db);
		const versionId = record.latestVersion!.id;
		await removeDocument(record.id, db);
		await expect(preview({ kind: "document", documentId: record.id }, db)).rejects.toThrow(/no longer exists/);
		await expect(preview({ kind: "version", versionId }, db)).rejects.toThrow(/no longer exists/);
		await expect(previewForAgent({ kind: "version", versionId }, db)).rejects.toThrow(/no longer exists/);
	});

	it("gives an agent the words and cells, and no address", async () => {
		const db = freshDb();
		const word = await previewForAgent(bytes("Brief.docx", await docxBytes(AGREEMENT)), db);
		expect(word.kind).toBe("html");
		expect(word.text).toContain("Betaling gebeurt binnen dertig dagen");
		const sheet = await previewForAgent(bytes("klanten.csv", "naam,stad\nAcme,Gent\n"), db);
		expect(sheet.sheets?.[0]?.rows).toEqual([["naam", "stad"], ["Acme", "Gent"]]);
		const picture = await previewForAgent(bytes("pixel.png", PNG_BYTES), db);
		expect(picture).toMatchObject({ kind: "image", text: null, sheets: null });
		expect(JSON.stringify(picture)).not.toContain("app://");
	});

	it("holds no more than its ceiling of bytes in memory, dropping the oldest address first", async () => {
		forgetPreviews();
		const size = Math.floor(MAX_HELD_BYTES / 2.5);
		const first = await preview(bytes("een.png", new Uint8Array(size)), freshDb());
		const second = await preview(bytes("twee.png", new Uint8Array(size)), freshDb());
		expect(served(first)).not.toBeNull();
		const third = await preview(bytes("drie.png", new Uint8Array(size)), freshDb());
		expect(served(first)).toBeNull();
		expect(served(second)).not.toBeNull();
		expect(served(third)).not.toBeNull();
		forgetPreviews();
	}, 60_000);

	it("reads a ZIP's sizes from its directory without inflating it", async () => {
		const entries = zipEntrySizes(await docxBytes(AGREEMENT))!;
		const body = entries.find((entry) => entry.name === "word/document.xml");
		expect(body!.inflated).toBeGreaterThan(100);
		expect(zipEntrySizes(new Uint8Array(Buffer.from("not a zip at all, only words")))).toBeNull();
	});

	it("turns away a Word file, a workbook or an iWork picture that unpacks to far more than it weighs", async () => {
		const word = bomb(await docxBytes(AGREEMENT));
		const wordPreview = await preview(bytes("Bom.docx", word), freshDb());
		expect(wordPreview).toMatchObject({ kind: "none", reason: expect.stringMatching(/too large/) });
		expect((await readableText(word, "Bom.docx")).text).toBeNull();

		const sheet = bomb(await xlsxBytes({ Blad: [["a", 1]] }));
		await expect(readSheets(sheet, "Bom.xlsx")).rejects.toThrow(/unpacks to more than Juno reads/);
		expect((await preview(bytes("Bom.xlsx", sheet), freshDb())).kind).toBe("none");

		const pages = bomb(await iworkBytes(JPEG_BYTES));
		expect(await iworkPicture(pages)).toBeNull();
	});

	it("answers nothing for a token it never issued", () => {
		expect(servePreview("0".repeat(48))).toBeNull();
		expect(servePreview("../../etc/passwd")).toBeNull();
	});
});
