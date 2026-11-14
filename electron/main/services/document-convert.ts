/**
 * A file becomes a PDF (decision 77): through Word when Word is installed,
 * which keeps the layout exactly, and through Juno when it is not, which may
 * not. The PDF is kept as a new version of the same document, so the
 * original stays, and signing then works on it.
 *
 * What Juno converts itself:
 * - a Word file through Mammoth's HTML and the PDF printer,
 * - a spreadsheet or a CSV through the table its preview shows,
 * - text as text,
 * - a PNG or JPEG placed on an A4 page with pdf-lib, and any other picture,
 *   SVG included, drawn by the printer's offscreen window, which runs no
 *   script.
 *
 * Anything else (an iWork file, an archive, a drawing) is refused with a
 * sentence: Juno has no way to draw it, and a PDF of its thumbnail would be a
 * lie about what the document says.
 *
 * The printer and Word are handed in at startup (`configureConversion`), so
 * this module stays testable in plain Node with a printer that is not one.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import { extensionOf } from "../../shared/mime";
import type { ConversionRoute, ConvertPdfResult, PreviewSheet } from "../../shared/types";
import { getDb, type Db } from "../db";
import { announce } from "./document-events";
import * as versions from "./document-versions";
import { documentStorageDir, fileNameFor, get } from "./documents";
import { familyOf, isPdfBytes, isPdfMediaType, ZIP_LIMITS, zipWithin } from "./file-kind";
import { sanitiseDocumentHtml } from "./file-preview";
import { decodeText, MAX_CSV_BYTES, PREVIEW_LIMITS, readSheets } from "./file-text";
import { extractText } from "./pdf-text";
import { escapeHtml } from "./template-render";

type Hooks = {
	/** Prints a body of HTML to PDF bytes in a window nobody sees (document-pdf.ts). */
	printHtml: (input: { title: string; bodyHtml: string }) => Promise<Buffer>;
	/** Whether Word is installed (word-convert.ts). */
	wordAvailable: () => Promise<boolean>;
	/** Asks Word to save `inputPath` as a PDF at `outputPath`. */
	convertWithWord: (inputPath: string, outputPath: string) => Promise<void>;
};

let hooks: Hooks | null = null;

export function configureConversion(next: Hooks | null): void {
	hooks = next;
}

function configured(): Hooks {
	if (!hooks) throw new Error("configureConversion() was not called before a file was converted.");
	return hooks;
}

/** Word opens these; Juno can read only the first. */
const WORD_FAMILIES = new Set(["word", "legacy-word"]);

const TABLE_CSS =
	"<style>.juno-sheet{margin:0 0 18pt}.juno-sheet h2{font-size:12pt;margin:0 0 6pt}" +
	".juno-sheet table{border-collapse:collapse;font-size:8pt;width:100%}" +
	".juno-sheet td{border:0.5pt solid #b8b5ad;padding:2pt 4pt;vertical-align:top}" +
	".juno-cut{font-size:8pt;color:#5c5a55}pre.juno-text{white-space:pre-wrap;font-size:9pt;margin:0}</style>";

/** The table a spreadsheet's preview shows, as printable HTML. */
export function sheetsToHtml(sheets: PreviewSheet[]): string {
	return (
		TABLE_CSS +
		sheets
			.map((sheet) => {
				const width = Math.max(1, ...sheet.rows.map((row) => row.length));
				const rows = sheet.rows
					.map(
						(row) =>
							`<tr>${Array.from({ length: width }, (_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`).join("")}</tr>`,
					)
					.join("");
				const cut =
					sheet.truncatedRows || sheet.truncatedColumns
						? `<p class="juno-cut">Only the first ${sheet.rows.length} rows and ${width} columns are in this PDF.</p>`
						: "";
				return `<section class="juno-sheet">${sheets.length > 1 ? `<h2>${escapeHtml(sheet.name)}</h2>` : ""}<table>${rows}</table>${cut}</section>`;
			})
			.join("")
	);
}

const A4 = { width: 595.28, height: 841.89, margin: 36 };

/** A PNG or a JPEG on one A4 page, as large as fits within the margins, centred, never enlarged. */
export async function imageToPdf(bytes: Uint8Array, kind: "png" | "jpeg"): Promise<Buffer> {
	const pdf = await PDFDocument.create();
	const image = kind === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
	const landscape = image.width > image.height;
	const pageWidth = landscape ? A4.height : A4.width;
	const pageHeight = landscape ? A4.width : A4.height;
	const scale = Math.min(1, (pageWidth - A4.margin * 2) / image.width, (pageHeight - A4.margin * 2) / image.height);
	const width = image.width * scale;
	const height = image.height * scale;
	const page = pdf.addPage([pageWidth, pageHeight]);
	page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
	return Buffer.from(await pdf.save());
}

const IMAGE_DATA_TYPES: Record<string, string> = {
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	svg: "image/svg+xml",
};

function pictureHtml(bytes: Uint8Array, mediaType: string): string {
	return (
		"<style>.juno-picture{display:flex;align-items:center;justify-content:center;min-height:240mm}" +
		".juno-picture img{max-width:100%;max-height:250mm}</style>" +
		`<div class="juno-picture"><img alt="" src="data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}"></div>`
	);
}

/**
 * Juno prints the text and the table of a file itself, in one piece, so a huge
 * one would freeze the window while it is laid out. It stops at the same size
 * the preview reads.
 */
function tooLongToConvert(fileName: string): Error {
	return new Error(
		`"${fileName}" is too long for Juno to convert here. Open it in its own program and save or print it as PDF from there.`,
	);
}

/** Makes the PDF bytes for one file in Juno, or says why it cannot. */
async function convertInJuno(bytes: Uint8Array, fileName: string, title: string): Promise<Buffer> {
	const { printHtml } = configured();
	const extension = extensionOf(fileName);
	switch (familyOf(fileName)) {
		case "word": {
			if (!zipWithin(bytes, ZIP_LIMITS.word)) {
				throw new Error(
					"This Word file unpacks to more than Juno can convert. Save it as PDF in Word, then add that as a version.",
				);
			}
			const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
			return printHtml({ title, bodyHtml: sanitiseDocumentHtml(result.value) });
		}
		case "legacy-word":
			throw new Error(
				`Juno can make a PDF of a .${extension} file only through Microsoft Word, which is not installed here. Save it as .docx or as PDF in the app that made it.`,
			);
		case "sheet":
		case "csv": {
			if (familyOf(fileName) === "csv" && bytes.length > MAX_CSV_BYTES) throw tooLongToConvert(fileName);
			const { sheets } = await readSheets(bytes, fileName);
			return printHtml({ title, bodyHtml: sheetsToHtml(sheets) });
		}
		case "text":
			if (bytes.length > PREVIEW_LIMITS.maxTextCharacters) throw tooLongToConvert(fileName);
			return printHtml({ title, bodyHtml: `${TABLE_CSS}<pre class="juno-text">${escapeHtml(decodeText(bytes))}</pre>` });
		case "image":
			if (extension === "png") return imageToPdf(bytes, "png");
			if (extension === "jpg" || extension === "jpeg") return imageToPdf(bytes, "jpeg");
			return printHtml({ title, bodyHtml: pictureHtml(bytes, IMAGE_DATA_TYPES[extension] ?? "image/png") });
		case "svg":
			return printHtml({ title, bodyHtml: pictureHtml(bytes, IMAGE_DATA_TYPES.svg!) });
		default:
			throw new Error(
				"Juno cannot make a PDF of this kind of file. Save it as PDF in the app that made it, then add that as a version.",
			);
	}
}

/** Asks Word for the PDF, in a folder of its own that is removed afterwards. */
async function convertThroughWord(sourcePath: string): Promise<Buffer> {
	const folder = mkdtempSync(join(tmpdir(), "juno-word-"));
	const output = join(folder, "converted.pdf");
	try {
		await configured().convertWithWord(sourcePath, output);
		const bytes = readFileSync(output);
		if (!isPdfBytes(bytes)) throw new Error("Word did not write a PDF. Open the file in Word to check it, then try again.");
		return bytes;
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
}

/**
 * Converts the newest version of a document to PDF and keeps the PDF as the
 * next version. Refuses a document whose newest version is a PDF already.
 */
export async function convertToPdf(documentId: string, db: Db = getDb()): Promise<ConvertPdfResult> {
	const record = await get(documentId, db);
	if (!record) throw new Error("That document no longer exists.");
	const latest = versions.latestFileOf(documentId, db);
	if (isPdfMediaType(latest.mediaType)) throw new Error(`The newest version of "${record.title}" is a PDF already.`);

	const family = familyOf(latest.fileName);
	const useWord = WORD_FAMILIES.has(family) && (await configured().wordAvailable());
	const bytes = useWord
		? await convertThroughWord(latest.path)
		: await convertInJuno(readFileSync(latest.path), latest.fileName, escapeHtml(record.title));
	const via: ConversionRoute = useWord ? "word" : "juno";

	const destination = join(documentStorageDir(), fileNameFor(record.title, "-pdf", "pdf"));
	writeFileSync(destination, bytes);
	const extension = extensionOf(latest.fileName);
	const baseName = extension ? latest.fileName.slice(0, -(extension.length + 1)) : latest.fileName;
	const version = versions.record(
		{
			documentId,
			kind: "converted",
			source: "convert",
			pdfPath: destination,
			fileName: `${baseName || "Document"}.pdf`,
			mediaType: "application/pdf",
			byteSize: bytes.length,
			fileDate: new Date().toISOString(),
			fileHash: versions.hashBytes(bytes),
			textContent: await extractText(bytes),
		},
		db,
	);
	const document = await get(documentId, db);
	if (!document) throw new Error("The PDF was written but the document could not be read back.");
	announce([documentId]);
	return { document, version, via };
}
