/**
 * Opening a document in another app and keeping what is saved there
 * (decision 75), and turning a file into a PDF (decision 77). The operating
 * system, the printer and Word are stand-ins; the Word path runs for real only
 * on a machine that has Word.
 */
import { accessSync, constants, mkdtempSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DocumentsChanged } from "../../shared/types";
import * as clients from "./clients";
import { configureConversion, convertToPdf } from "./document-convert";
import { onDocumentsChanged } from "./document-events";
import { importFile } from "./document-import";
import * as versions from "./document-versions";
import * as working from "./document-working";
import * as documents from "./documents";
import { configureDocumentStorage } from "./documents";
import { AGREEMENT, docxBytes, freshDb, PNG_BYTES, textPdf } from "./file-fixtures";
import { extractText } from "./pdf-text";
import { convertWithWord, wordInstalled } from "./word-convert";

beforeAll(async () => {
	await extractText(new Uint8Array());
}, 60_000);

afterEach(() => {
	working.configureWorkingCopies(null);
	configureConversion(null);
});

function bytes(fileName: string, data: Uint8Array | string) {
	return { kind: "bytes" as const, fileName, data: typeof data === "string" ? new Uint8Array(Buffer.from(data)) : data };
}

async function setUp() {
	const db = freshDb();
	configureDocumentStorage(mkdtempSync(join(tmpdir(), "juno-working-")));
	const client = await clients.create({ name: "Acme" }, db);
	const opened: string[] = [];
	working.configureWorkingCopies({
		openPath: async (path) => {
			opened.push(path);
			return "";
		},
	});
	return { db, client, opened };
}

/** Writes the file as another app saving it would: new bytes and a later modified time. */
function saveElsewhere(path: string, content: string | Uint8Array): void {
	writeFileSync(path, content);
	const later = new Date(Date.now() + 5000);
	utimesSync(path, later, later);
}

function isReadOnly(path: string): boolean {
	try {
		accessSync(path, constants.W_OK);
		return false;
	} catch {
		return true;
	}
}

describe("a working copy", () => {
	it("opens beside the documents, named after the document, and keeps a saved edit as a new version", async () => {
		const { db, client, opened } = await setUp();
		const record = await importFile({ source: bytes("Offerte.txt", "Versie een."), clientId: client.id }, db);
		const changes: DocumentsChanged[] = [];
		const stop = onDocumentsChanged((change) => changes.push(change));

		const result = await working.openDocument(record.id, db);
		expect(result.readOnly).toBe(false);
		const copy = opened[0]!;
		expect(copy).toMatch(/[\\/]\.working[\\/][a-z0-9-]+[\\/]Offerte\.txt$/i);
		expect(readFileSync(copy, "utf8")).toBe("Versie een.");

		// Nothing changed: the check reads nothing new and keeps nothing.
		expect((await working.checkAll(db)).changed).toEqual([]);

		saveElsewhere(copy, "Versie twee, aangepast in een andere app.");
		const checked = await working.checkAll(db);
		expect(checked.changed).toEqual([record.id]);
		const list = versions.list(record.id, db);
		expect(list).toHaveLength(2);
		expect(list[0]).toMatchObject({ kind: "edited", source: "external", isLatest: true, fileName: "Offerte.txt" });
		const latest = await documents.get(record.id, db);
		expect(readFileSync(latest!.pdfPath!, "utf8")).toBe("Versie twee, aangepast in een andere app.");
		// The version's file is a copy of its own; the working copy stays where the other app has it.
		expect(latest!.pdfPath).not.toBe(copy);
		expect(changes).toEqual([{ documentIds: [record.id], reason: "edited-outside" }]);

		// Saved again with the same bytes: nothing new.
		saveElsewhere(copy, "Versie twee, aangepast in een andere app.");
		expect((await working.checkAll(db)).changed).toEqual([]);
		expect(versions.list(record.id, db)).toHaveLength(2);

		// Opening again reuses the same copy.
		await working.openDocument(record.id, db);
		expect(opened[1]).toBe(copy);
		stop();
	});

	it("picks up an edit when the document is read, not only on focus", async () => {
		const { db, client, opened } = await setUp();
		const record = await importFile({ source: bytes("Notities.md", "# Een"), clientId: client.id }, db);
		await working.openDocument(record.id, db);
		saveElsewhere(opened[0]!, "# Twee");
		const read = await working.getChecked(record.id, db);
		expect(read!.versionCount).toBe(2);
		expect(read!.latestVersion!.kind).toBe("edited");
	});

	it("brings an unchanged copy up to the newest version when one was added in Juno", async () => {
		const { db, client, opened } = await setUp();
		const record = await importFile({ source: bytes("Prijzen.txt", "oud"), clientId: client.id }, db);
		await working.openDocument(record.id, db);
		const { addVersion } = await import("./document-import");
		await addVersion({ documentId: record.id, source: bytes("Prijzen.txt", "nieuw") }, db);
		await working.openDocument(record.id, db);
		expect(opened[1]).toBe(opened[0]);
		expect(readFileSync(opened[1]!, "utf8")).toBe("nieuw");
		expect(versions.list(record.id, db)).toHaveLength(2);
	});

	it("opens a signed newest version and any older version read only, and keeps nothing from them", async () => {
		const { db, client, opened } = await setUp();
		const record = await importFile({ source: bytes("Contract.pdf", await textPdf(AGREEMENT)), clientId: client.id }, db);
		const first = record.latestVersion!.id;
		// A signed copy, recorded the way signing records one.
		const signedPath = join(mkdtempSync(join(tmpdir(), "juno-signed-")), "signed.pdf");
		writeFileSync(signedPath, await textPdf([...AGREEMENT, "Ondertekend"]));
		versions.record(
			{
				documentId: record.id,
				kind: "stamped",
				source: "sign",
				pdfPath: signedPath,
				fileDate: new Date().toISOString(),
				fileName: "Contract.pdf",
			},
			db,
		);

		expect(await working.openDocument(record.id, db)).toEqual({ readOnly: true });
		expect(opened[0]).toMatch(/read-only[\\/]Contract \(signed\)\.pdf$/);
		expect(isReadOnly(opened[0]!)).toBe(true);

		expect(await working.openVersion(first, db)).toEqual({ readOnly: true });
		expect(opened[1]).toMatch(/read-only[\\/]Contract \(version 1\)\.pdf$/);
		expect(isReadOnly(opened[1]!)).toBe(true);
		expect((await working.checkAll(db)).changed).toEqual([]);
	});

	it("keeps watching a copy that is missing for a moment, as it is while Word saves", async () => {
		const { db, client, opened } = await setUp();
		const record = await importFile({ source: bytes("Brief.txt", "Eerste versie."), clientId: client.id }, db);
		await working.openDocument(record.id, db);
		const copy = opened[0]!;
		// Word writes a temporary file, removes the original and renames: a
		// check between the last two finds no file at all.
		renameSync(copy, `${copy}.tmp`);
		expect((await working.checkAll(db)).changed).toEqual([]);
		renameSync(`${copy}.tmp`, copy);
		saveElsewhere(copy, "Tweede versie, net bewaard.");
		expect((await working.checkAll(db)).changed).toEqual([record.id]);
		expect(versions.list(record.id, db)[0]).toMatchObject({ kind: "edited", isLatest: true });
	});

	it("says so when no app could open the file", async () => {
		const { db, client } = await setUp();
		working.configureWorkingCopies({ openPath: async () => "No application is associated" });
		const record = await importFile({ source: bytes("Plan.dwg", "AC1032"), clientId: client.id }, db);
		await expect(working.openDocument(record.id, db)).rejects.toThrow(/No app on this machine could open that file/);
	});
});

async function fakePdf(): Promise<Buffer> {
	const pdf = await PDFDocument.create();
	pdf.addPage();
	return Buffer.from(await pdf.save());
}

describe("converting to PDF", () => {
	function printer(printed: { title: string; bodyHtml: string }[]) {
		return async (input: { title: string; bodyHtml: string }) => {
			printed.push(input);
			return fakePdf();
		};
	}

	it("converts a Word file in Juno when Word is not there, and keeps the PDF as the next version", async () => {
		const { db, client } = await setUp();
		const printed: { title: string; bodyHtml: string }[] = [];
		configureConversion({
			printHtml: printer(printed),
			wordAvailable: async () => false,
			convertWithWord: async () => {
				throw new Error("Word must not be asked.");
			},
		});
		const record = await importFile({ source: bytes("Overeenkomst.docx", await docxBytes(AGREEMENT)), clientId: client.id }, db);
		const result = await convertToPdf(record.id, db);
		expect(result.via).toBe("juno");
		expect(printed[0]!.bodyHtml).toContain("Betaling gebeurt binnen dertig dagen");
		expect(result.version).toMatchObject({
			kind: "converted",
			source: "convert",
			mediaType: "application/pdf",
			fileName: "Overeenkomst.pdf",
			isLatest: true,
		});
		expect(result.document.versionCount).toBe(2);
		// Now a PDF, so the sign check passes, and converting again is refused.
		expect(() => documents.assertSignable(result.document)).not.toThrow();
		await expect(convertToPdf(record.id, db)).rejects.toThrow(/is a PDF already/);
	});

	it("asks Word when Word is there, with paths the service built", async () => {
		const { db, client } = await setUp();
		const asked: [string, string][] = [];
		configureConversion({
			printHtml: async () => {
				throw new Error("The printer must not be asked.");
			},
			wordAvailable: async () => true,
			convertWithWord: async (input, output) => {
				asked.push([input, output]);
				writeFileSync(output, await fakePdf());
			},
		});
		const record = await importFile({ source: bytes("Brief.docx", await docxBytes(AGREEMENT)), clientId: client.id }, db);
		const result = await convertToPdf(record.id, db);
		expect(result.via).toBe("word");
		expect(asked[0]![0]).toBe(record.pdfPath);
		expect(asked[0]![1]).toMatch(/juno-word-[^\\/]+[\\/]converted\.pdf$/);
	});

	it("places a PNG on an A4 page, prints a spreadsheet and text, and refuses what it cannot draw", async () => {
		const { db, client } = await setUp();
		const printed: { title: string; bodyHtml: string }[] = [];
		configureConversion({ printHtml: printer(printed), wordAvailable: async () => false, convertWithWord: async () => undefined });

		const picture = await importFile({ source: bytes("Foto.png", PNG_BYTES), clientId: client.id }, db);
		const pictureResult = await convertToPdf(picture.id, db);
		const pdf = await PDFDocument.load(readFileSync(pictureResult.document.pdfPath!));
		expect(pdf.getPageCount()).toBe(1);
		expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
		expect(printed).toHaveLength(0);

		const sheet = await importFile({ source: bytes("Prijzen.csv", "product;prijs\nwebsite;<b>2500</b>\n"), clientId: client.id }, db);
		await convertToPdf(sheet.id, db);
		expect(printed[0]!.bodyHtml).toContain("<td>website</td><td>&lt;b&gt;2500&lt;/b&gt;</td>");

		const text = await importFile({ source: bytes("Notities.txt", "Eerste regel\n<script>"), clientId: client.id }, db);
		await convertToPdf(text.id, db);
		expect(printed[1]!.bodyHtml).toContain("Eerste regel\n&lt;script&gt;");

		const old = await importFile({ source: bytes("Oud.doc", "binary word"), clientId: client.id }, db);
		await expect(convertToPdf(old.id, db)).rejects.toThrow(/only through Microsoft Word/);
		const drawing = await importFile({ source: bytes("Plan.dwg", "AC1032"), clientId: client.id }, db);
		await expect(convertToPdf(drawing.id, db)).rejects.toThrow(/cannot make a PDF of this kind of file/);
	});

	// Starts Word, which takes seconds and shows in the task bar, so it runs only
	// when asked for: JUNO_TEST_WORD=1 npm run test. Without Word it does nothing.
	it.runIf(process.platform === "win32" && process.env.JUNO_TEST_WORD === "1")(
		"converts through Microsoft Word itself, when it is installed",
		async () => {
			if (!(await wordInstalled())) return;
			const { db, client } = await setUp();
			configureConversion({
				printHtml: async () => {
					throw new Error("The printer must not be asked.");
				},
				wordAvailable: wordInstalled,
				convertWithWord,
			});
			const record = await importFile({ source: bytes("Word test.docx", await docxBytes(AGREEMENT)), clientId: client.id }, db);
			const result = await convertToPdf(record.id, db);
			expect(result.via).toBe("word");
			expect(statSync(result.document.pdfPath!).size).toBeGreaterThan(500);
			expect(await extractText(readFileSync(result.document.pdfPath!))).toContain("betaling gebeurt binnen dertig dagen");
		},
		120_000,
	);
});
