/**
 * The words and cells in a file, for the two jobs that need them: recognising
 * that an incoming file is a document Juno already has (decision 39), and
 * showing a file's content where it cannot be drawn as it is (decision 76).
 *
 * A PDF is read through pdf.js as before, a Word file through Mammoth's raw
 * text, a spreadsheet through ExcelJS, a CSV through `csv.ts`, and anything
 * that is text as text. Every other kind has no words Juno can read, and is
 * matched by its bytes or its name only.
 *
 * The parsing runs in the file worker (`file-reader.ts`), off the main
 * process. What is decided here, before any bytes go there, is whether a file
 * is read at all: its kind, its size and what its ZIP says it unpacks to.
 *
 * No Electron import, so every rule here is covered by a test.
 */
import { familyOf, isPdfBytes, isZipBytes, ZIP_LIMITS, zipEntrySizes, zipWithin } from "./file-kind";
import { decodeText, type SheetsResult } from "./file-jobs";
import { readInWorker, type ReadOptions } from "./file-reader";
import { iworkAppOf, type IworkText } from "./iwork-read";
import { extractText, normalise, readText } from "./pdf-text";

export { decodeText, type SheetsResult } from "./file-jobs";

/** Past this a file is not read for its words. Matching a scan of a book is not the job. */
export const MAX_READ_BYTES = 40 * 1024 * 1024;

/** The limits a preview is cut at. A spreadsheet past them shows its start and says so. */
export const PREVIEW_LIMITS = {
	maxTextCharacters: 200_000,
	maxSheets: 10,
	maxRows: 500,
	maxColumns: 50,
	maxCellCharacters: 500,
};

/** How much of a CSV a preview reads. 500 rows of 50 columns fit in far less. */
export const MAX_CSV_BYTES = 8 * 1024 * 1024;

/**
 * The first part of a text file, so a preview of a 60 MB log does not decode
 * and parse all of it on the main process. Cut after the last line break in
 * that part, or else before a character UTF-8 spreads over several bytes, so
 * the part still decodes as what it is.
 */
export function leadingBytes(bytes: Uint8Array, maxBytes: number): { bytes: Uint8Array; cut: boolean } {
	if (bytes.length <= maxBytes) return { bytes, cut: false };
	// A line break near the end of the part, not one far back before a very long line.
	let end = bytes.lastIndexOf(0x0a, maxBytes - 1) + 1;
	if (end < maxBytes * 0.75) {
		end = maxBytes;
		while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
	}
	return { bytes: bytes.subarray(0, end), cut: true };
}

/** A file that calls itself text and is not: a NUL byte in the first part gives it away. */
function looksBinary(bytes: Uint8Array): boolean {
	const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
	return sample.includes(0);
}

/**
 * Each sheet of an `.xlsx` or a `.csv` as rows of the text its cells show,
 * cut at the preview limits. Throws for a file that is not what its name says,
 * which the preview turns into a sentence.
 */
export async function readSheets(
	bytes: Uint8Array,
	fileName: string,
	limits = PREVIEW_LIMITS,
	options: Pick<ReadOptions, "transfer"> = {},
): Promise<SheetsResult> {
	const family = familyOf(fileName);
	if (family === "csv") {
		const start = leadingBytes(bytes, MAX_CSV_BYTES);
		return readInWorker(
			{ kind: "csv", sheetName: fileName.replace(/\.csv$/i, "") || "Sheet", cut: start.cut, limits },
			start.bytes,
			{ fileName, transfer: options.transfer },
		);
	}
	if (family !== "sheet" || !isZipBytes(bytes)) {
		throw new Error(`"${fileName}" is not a spreadsheet Juno can read.`);
	}
	if (!zipWithin(bytes, ZIP_LIMITS.sheet)) {
		throw new Error(`"${fileName}" unpacks to more than Juno reads. Open it in the app that made it.`);
	}
	return readInWorker({ kind: "workbook", limits }, bytes, { fileName, transfer: options.transfer });
}

/**
 * The words in a Pages, Numbers or Keynote file (decision 83), or null when it
 * has none Juno can read: not a zip, older than the format read here, or more
 * than Juno reads. Only the `Index/*.iwa` entries are inflated, so only their
 * sizes are checked; a deck's films are never touched.
 */
export async function readIwork(
	bytes: Uint8Array,
	fileName: string,
	limit = PREVIEW_LIMITS.maxTextCharacters,
	options: Pick<ReadOptions, "transfer"> = {},
): Promise<IworkText | null> {
	const app = iworkAppOf(fileName);
	if (!app || !isZipBytes(bytes)) return null;
	const entries = zipEntrySizes(bytes);
	if (!entries || entries.length > ZIP_LIMITS.iwork.maxEntries) return null;
	const inflated = entries
		.filter((entry) => /^Index\/.+\.iwa$/i.test(entry.name))
		.reduce((total, entry) => total + entry.inflated, 0);
	if (inflated === 0 || inflated > ZIP_LIMITS.iwork.maxInflated) return null;
	try {
		return await readInWorker({ kind: "iwork-text", app, limit }, bytes, { fileName, transfer: options.transfer });
	} catch {
		return null;
	}
}

export interface ReadableText {
	text: string | null;
	truncated: boolean;
}

function cut(text: string, limit: number): ReadableText {
	const trimmed = text.trim();
	if (trimmed.length === 0) return { text: null, truncated: false };
	return trimmed.length > limit
		? { text: trimmed.slice(0, limit), truncated: true }
		: { text: trimmed, truncated: false };
}

/**
 * The words in a file as a person would read them, for a text preview and
 * for an agent. Null text when the file has none Juno can read, never an error:
 * a file without words is still a file.
 */
export async function readableText(
	bytes: Uint8Array,
	fileName: string,
	limit = PREVIEW_LIMITS.maxTextCharacters,
	options: Pick<ReadOptions, "transfer"> = {},
): Promise<ReadableText> {
	if (bytes.length === 0 || bytes.length > MAX_READ_BYTES) return { text: null, truncated: false };
	try {
		switch (familyOf(fileName)) {
			case "pdf":
				return isPdfBytes(bytes) ? cut((await readText(bytes)) ?? "", limit) : { text: null, truncated: false };
			case "word": {
				if (!isZipBytes(bytes) || !zipWithin(bytes, ZIP_LIMITS.word)) return { text: null, truncated: false };
				return cut(await readInWorker({ kind: "word-text" }, bytes, { fileName, transfer: options.transfer }), limit);
			}
			case "sheet":
			case "csv": {
				const { sheets } = await readSheets(bytes, fileName, PREVIEW_LIMITS, options);
				const lines = sheets.flatMap((sheet) => [
					...(sheets.length > 1 ? [`# ${sheet.name}`] : []),
					...sheet.rows.map((row) => row.join("\t")),
				]);
				return cut(lines.join("\n"), limit);
			}
			case "iwork": {
				const read = await readIwork(bytes, fileName, limit, options);
				if (!read) return { text: null, truncated: false };
				const words = cut(read.sections.map((section) => section.text).join("\n\n"), limit);
				return read.truncated && words.text !== null ? { text: words.text, truncated: true } : words;
			}
			case "text":
			case "svg": {
				if (looksBinary(bytes)) return { text: null, truncated: false };
				// No character takes more than four bytes, so this is always enough.
				const start = leadingBytes(bytes, limit * 4);
				const read = cut(decodeText(start.bytes), limit);
				return start.cut && read.text !== null ? { text: read.text, truncated: true } : read;
			}
			default:
				return { text: null, truncated: false };
		}
	} catch {
		return { text: null, truncated: false };
	}
}

/**
 * The words in a file, normalised for comparing (decision 39): lower case,
 * one space between words. Null when the file has none, which only means it
 * can be matched by its bytes and its name and not by its words.
 */
export async function matchText(bytes: Uint8Array, fileName: string): Promise<string | null> {
	if (familyOf(fileName) === "pdf") return isPdfBytes(bytes) ? extractText(bytes) : null;
	// SVG is a picture: its source is markup, not words a person wrote.
	if (familyOf(fileName) === "svg") return null;
	const { text } = await readableText(bytes, fileName, 200_000);
	if (!text) return null;
	const normalised = normalise(text);
	return normalised.length > 0 ? normalised : null;
}
