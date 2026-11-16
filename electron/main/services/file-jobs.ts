/**
 * The parsing that turns a file's bytes into something Juno can show or
 * compare: a Word file as sanitised HTML or as its raw text, a workbook or a
 * CSV as rows of cells, and a PDF as its text. Comparing two texts word by
 * word is here too, because two long ones take a good part of a second.
 *
 * Every one of these can hold a thread for seconds on a file that is within
 * every limit, so none of them runs on the main process, where that thread is
 * also every window. They run in the file worker (`workers/file-worker.ts`),
 * and `file-reader.ts` is how the main process hands a job over. The checks
 * that refuse a file before it is read (its size, what its ZIP says it unpacks
 * to) stay with the caller, in the main process, so a file that is turned away
 * never reaches the worker at all.
 *
 * No Electron import and no database: a worker thread has neither.
 */
import JSZip from "jszip";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import type { PreviewSheet } from "../../shared/types";
import { parseCsv } from "./csv";
import { readIworkText, type IwaFile, type IworkApp, type IworkText } from "./iwork-read";
import { diffWords, type WordDiff } from "./text-diff";

/** How much of a workbook or a CSV is read: the sheets, rows and columns, and how long a cell may be. */
export interface SheetLimits {
	maxSheets: number;
	maxRows: number;
	maxColumns: number;
	maxCellCharacters: number;
}

export interface SheetsResult {
	sheets: PreviewSheet[];
	truncatedSheets: boolean;
}

/** One piece of work for the file worker. The bytes travel beside it. */
export type FileJob =
	/** A `.docx` as the sanitised HTML of its body. */
	| { kind: "word-html" }
	/** A `.docx` as the text a person reads in it. */
	| { kind: "word-text" }
	/** An `.xlsx` as rows of the text its cells show. */
	| { kind: "workbook"; limits: SheetLimits }
	/** The start of a CSV as one sheet. `cut` says the caller kept only the start. */
	| { kind: "csv"; sheetName: string; cut: boolean; limits: SheetLimits }
	/** A PDF's text, a line per line of the page, or null when it has none. */
	| { kind: "pdf-text" }
	/** Which words `after` adds to `before` and leaves out (`text-diff.ts`). Takes no bytes. */
	| { kind: "word-diff"; before: string; after: string }
	/** The words in a Pages, Numbers or Keynote file (`iwork-read.ts`), cut at `limit` characters. */
	| { kind: "iwork-text"; app: IworkApp; limit: number };

/** What each kind of job answers with. Plain data, so it crosses between threads as it is. */
export interface FileJobOutput {
	"word-html": string;
	"word-text": string;
	workbook: SheetsResult;
	csv: SheetsResult;
	"pdf-text": string | null;
	"word-diff": WordDiff;
	"iwork-text": IworkText;
}

export type FileJobKind = FileJob["kind"];

/** What the main process posts to the worker. */
export interface FileJobRequest {
	id: number;
	job: FileJob;
	bytes: Uint8Array;
}

/** What the worker posts back, once per request. */
export type FileJobReply =
	| { id: number; ok: true; value: FileJobOutput[FileJobKind] }
	| { id: number; ok: false; message: string };

/** What the worker posts once, when its libraries are loaded and it can take a job. */
export interface FileWorkerReady {
	ready: true;
}

/* ----------------------------------------------------------------- text */

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

/* ----------------------------------------------------------------- Word */

const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/**
 * Mammoth's HTML, cut to the elements a document is made of. Pictures stay
 * only as inline PNG, JPEG, GIF or WebP; links lose their address, because a
 * preview is read, not followed. No attribute that styles or runs survives.
 */
export function sanitiseDocumentHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [
			"p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "sub", "sup", "br",
			"ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "a", "img", "blockquote", "pre", "code",
		],
		allowedAttributes: { img: ["src", "alt"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
		allowedSchemes: [],
		allowedSchemesByTag: { img: ["data"] },
		allowProtocolRelative: false,
		exclusiveFilter: (frame) => frame.tag === "img" && !SAFE_IMAGE.test(frame.attribs.src ?? ""),
	});
}

/** The bytes as a Buffer over the same memory, which is what Mammoth reads. */
function asBuffer(bytes: Uint8Array): Buffer {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function wordHtml(bytes: Uint8Array): Promise<string> {
	const result = await mammoth.convertToHtml({ buffer: asBuffer(bytes) });
	return sanitiseDocumentHtml(result.value);
}

async function wordText(bytes: Uint8Array): Promise<string> {
	const result = await mammoth.extractRawText({ buffer: asBuffer(bytes) });
	return result.value;
}

/* --------------------------------------------------------------- sheets */

function formatCell(value: unknown, text: string, limits: SheetLimits): string {
	const date =
		value instanceof Date
			? value
			: value && typeof value === "object" && "result" in value && value.result instanceof Date
				? value.result
				: null;
	const shown = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : text;
	return shown.length > limits.maxCellCharacters ? `${shown.slice(0, limits.maxCellCharacters)}...` : shown;
}

/** Drops the empty cells at the end of a row, so a sheet with one wide row does not pad every other. */
function trimRow(row: string[]): string[] {
	let end = row.length;
	while (end > 0 && row[end - 1] === "") end -= 1;
	return row.slice(0, end);
}

type ExcelJs = typeof import("exceljs");

let excel: Promise<ExcelJs> | null = null;

/**
 * ExcelJS is loaded the first time a workbook is read, not when the worker
 * starts. It is CommonJS that fills `module.exports` through a require, so its
 * names reach an ES import only through `default`, and reach the compiled
 * code directly; both are accepted.
 */
function exceljs(): Promise<ExcelJs> {
	excel ??= import("exceljs").then((module) => (module as ExcelJs & { default?: ExcelJs }).default ?? module);
	return excel;
}

async function workbookSheets(bytes: Uint8Array, limits: SheetLimits): Promise<SheetsResult> {
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
				cells.push(formatCell(cell.value, cell.text ?? "", limits));
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

function csvSheets(bytes: Uint8Array, sheetName: string, cut: boolean, limits: SheetLimits): SheetsResult {
	const parsed = parseCsv(decodeText(bytes), { maxRows: limits.maxRows, maxColumns: limits.maxColumns });
	return {
		sheets: [
			{
				name: sheetName,
				rows: parsed.rows.map((row) => trimRow(row.map((cell) => formatCell(null, cell, limits)))),
				truncatedRows: parsed.truncatedRows || cut,
				truncatedColumns: parsed.truncatedColumns,
				totalRows: parsed.totalRows,
			},
		],
		truncatedSheets: false,
	};
}

/* ------------------------------------------------------------------ PDF */

/** A contract is a few thousand words. Anything past this is not needed to recognise it or to read it. */
export const MAX_PDF_TEXT_LENGTH = 200_000;
const MAX_PDF_PAGES = 60;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfLoaded: Promise<PdfJs> | null = null;

/**
 * pdf.js ships as an ES module. The main process compiles to CommonJS, which
 * turns this import into a require, and Electron's Node can require an ES
 * module that has no top-level await, which pdf.js does not. It runs as a
 * plain library with no worker of its own and no fonts loaded, which is enough
 * to read the text layer.
 */
function pdfjs(): Promise<PdfJs> {
	pdfLoaded ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfLoaded;
}

/** The text of a PDF as it reads, or null when it has none or cannot be read. */
async function pdfText(bytes: Uint8Array): Promise<string | null> {
	const lib = await pdfjs();
	const task = lib.getDocument({
		data: bytes,
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: lib.VerbosityLevel.ERRORS,
	});
	try {
		const pdf = await task.promise;
		const parts: string[] = [];
		let length = 0;
		for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES); number += 1) {
			const content = await (await pdf.getPage(number)).getTextContent();
			for (const item of content.items) {
				const text = "str" in item ? item.str : "";
				const breaks = "hasEOL" in item && item.hasEOL;
				if (text.length === 0 && !breaks) continue;
				parts.push(breaks ? `${text}\n` : `${text} `);
				length += text.length + 1;
			}
			parts.push("\n");
			if (length > MAX_PDF_TEXT_LENGTH) break;
		}
		const text = parts
			.join("")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		return text.length > 0 ? text.slice(0, MAX_PDF_TEXT_LENGTH) : null;
	} catch {
		return null;
	} finally {
		await task.destroy().catch(() => undefined);
	}
}

/* ---------------------------------------------------------------- iWork */

/**
 * The `Index/*.iwa` entries of an iWork zip, inflated, then read for their
 * words. The caller has checked, in the main process, what those entries say
 * they unpack to; nothing else in the zip is inflated.
 */
async function iworkText(bytes: Uint8Array, app: IworkApp, limit: number): Promise<IworkText> {
	const zip = await JSZip.loadAsync(bytes);
	const files: IwaFile[] = [];
	for (const name of Object.keys(zip.files)) {
		const entry = zip.files[name];
		if (!entry || entry.dir || !/^Index\/.+\.iwa$/i.test(name)) continue;
		files.push({ name, bytes: await entry.async("uint8array") });
	}
	if (files.length === 0) throw new Error("This file has no text Juno can read.");
	return readIworkText(files, app, limit);
}

/* ------------------------------------------------------------------ run */

/**
 * Does one job. Throws what the library threw for a file it cannot read; the
 * caller in the main process decides what a person is told.
 */
export async function runFileJob(job: FileJob, bytes: Uint8Array): Promise<FileJobOutput[FileJobKind]> {
	switch (job.kind) {
		case "word-html":
			return wordHtml(bytes);
		case "word-text":
			return wordText(bytes);
		case "workbook":
			return workbookSheets(bytes, job.limits);
		case "csv":
			return csvSheets(bytes, job.sheetName, job.cut, job.limits);
		case "pdf-text":
			return pdfText(bytes);
		case "word-diff":
			return diffWords(job.before, job.after);
		case "iwork-text":
			return iworkText(bytes, job.app, job.limit);
		default:
			throw new Error("The file worker was asked for a job it does not know.");
	}
}
