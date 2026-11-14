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
 * No Electron import, so every rule here is covered by a test.
 */
import mammoth from "mammoth";
import type { PreviewSheet } from "../../shared/types";
import { parseCsv } from "./csv";
import { familyOf, isPdfBytes, isZipBytes } from "./file-kind";
import { extractText, normalise, readText } from "./pdf-text";

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

type ExcelJs = typeof import("exceljs");

let excel: Promise<ExcelJs> | null = null;

/**
 * ExcelJS is loaded the first time a spreadsheet is read, not at launch. It is
 * CommonJS that fills `module.exports` through a require, so its names reach an
 * ES import only through `default`, and reach the compiled main process
 * directly; both are accepted.
 */
function exceljs(): Promise<ExcelJs> {
	excel ??= import("exceljs").then((module) => (module as ExcelJs & { default?: ExcelJs }).default ?? module);
	return excel;
}

/**
 * Bytes as text. UTF-8 when they are valid UTF-8, which is nearly every file
 * written this century, and Windows-1252 otherwise, which is what an older
 * Belgian or Dutch machine wrote.
 */
export function decodeText(bytes: Uint8Array): string {
	const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
	const body = bytes.subarray(start);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(body);
	} catch {
		return new TextDecoder("windows-1252").decode(body);
	}
}

/** A file that calls itself text and is not: a NUL byte in the first part gives it away. */
function looksBinary(bytes: Uint8Array): boolean {
	const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
	return sample.includes(0);
}

function formatCell(value: unknown, text: string): string {
	const date =
		value instanceof Date
			? value
			: value && typeof value === "object" && "result" in value && value.result instanceof Date
				? value.result
				: null;
	const shown = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : text;
	return shown.length > PREVIEW_LIMITS.maxCellCharacters ? `${shown.slice(0, PREVIEW_LIMITS.maxCellCharacters)}...` : shown;
}

/** Drops the empty cells at the end of a row, so a sheet with one wide row does not pad every other. */
function trimRow(row: string[]): string[] {
	let end = row.length;
	while (end > 0 && row[end - 1] === "") end -= 1;
	return row.slice(0, end);
}

export interface SheetsResult {
	sheets: PreviewSheet[];
	truncatedSheets: boolean;
}

/**
 * Each sheet of an `.xlsx` or a `.csv` as rows of the text its cells show,
 * cut at the preview limits. Throws for a file that is not what its name says,
 * which the preview turns into a sentence.
 */
export async function readSheets(bytes: Uint8Array, fileName: string, limits = PREVIEW_LIMITS): Promise<SheetsResult> {
	const family = familyOf(fileName);
	if (family === "csv") {
		const parsed = parseCsv(decodeText(bytes), { maxRows: limits.maxRows, maxColumns: limits.maxColumns });
		return {
			sheets: [
				{
					name: fileName.replace(/\.csv$/i, "") || "Sheet",
					rows: parsed.rows.map((row) => trimRow(row.map((cell) => formatCell(null, cell)))),
					truncatedRows: parsed.truncatedRows,
					truncatedColumns: parsed.truncatedColumns,
					totalRows: parsed.totalRows,
				},
			],
			truncatedSheets: false,
		};
	}
	if (family !== "sheet" || !isZipBytes(bytes)) {
		throw new Error(`"${fileName}" is not a spreadsheet Juno can read.`);
	}
	const lib = await exceljs();
	const workbook = new lib.Workbook();
	// ExcelJS declares its own Buffer as an ArrayBuffer, and reads one through JSZip.
	await workbook.xlsx.load(new Uint8Array(bytes).buffer);
	const sheets: PreviewSheet[] = [];
	const all = workbook.worksheets;
	for (const worksheet of all.slice(0, limits.maxSheets)) {
		const rowCount = worksheet.rowCount;
		const columnCount = worksheet.columnCount;
		const rows: string[][] = [];
		for (let r = 1; r <= Math.min(rowCount, limits.maxRows); r += 1) {
			const row = worksheet.getRow(r);
			const cells: string[] = [];
			for (let c = 1; c <= Math.min(columnCount, limits.maxColumns); c += 1) {
				const cell = row.getCell(c);
				cells.push(formatCell(cell.value, cell.text ?? ""));
			}
			rows.push(trimRow(cells));
		}
		sheets.push({
			name: worksheet.name,
			rows,
			truncatedRows: rowCount > limits.maxRows,
			truncatedColumns: columnCount > limits.maxColumns,
			totalRows: rowCount,
		});
	}
	return { sheets, truncatedSheets: all.length > limits.maxSheets };
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
): Promise<ReadableText> {
	if (bytes.length === 0 || bytes.length > MAX_READ_BYTES) return { text: null, truncated: false };
	try {
		switch (familyOf(fileName)) {
			case "pdf":
				return isPdfBytes(bytes) ? cut((await readText(bytes)) ?? "", limit) : { text: null, truncated: false };
			case "word": {
				if (!isZipBytes(bytes)) return { text: null, truncated: false };
				const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
				return cut(result.value, limit);
			}
			case "sheet":
			case "csv": {
				const { sheets } = await readSheets(bytes, fileName);
				const lines = sheets.flatMap((sheet) => [
					...(sheets.length > 1 ? [`# ${sheet.name}`] : []),
					...sheet.rows.map((row) => row.join("\t")),
				]);
				return cut(lines.join("\n"), limit);
			}
			case "text":
			case "svg":
				return looksBinary(bytes) ? { text: null, truncated: false } : cut(decodeText(bytes), limit);
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
