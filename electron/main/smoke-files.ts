/**
 * The file worker in `npm run smoke`. Never loaded outside it.
 *
 * `checkFileWorker` previews a Word file and a workbook and reads a PDF's text
 * through the worker, which is the one proof that its file was compiled,
 * packed into the archive and can load its libraries from there: nothing else
 * in a source run notices a worker that a packaged build cannot start.
 *
 * `measureFileBlocking` is for the timing run (`smoke-perf.ts`). It makes a
 * workbook and a Word file of several megabytes, parses each once on the main
 * process the way Juno used to, and once through a preview, which goes to the
 * worker, and says how long the main process was held each time.
 */
import { Workbook } from "exceljs";
import JSZip from "jszip";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { FilePreview } from "../shared/types";
import { runFileJob } from "./services/file-jobs";
import { preview } from "./services/file-preview";
import { PREVIEW_LIMITS } from "./services/file-text";
import { readText } from "./services/pdf-text";

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A Word file with one paragraph per entry, every other one in bold: the parts a package needs and nothing else. */
async function wordFile(paragraphs: string[]): Promise<Uint8Array> {
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
			"</Types>",
	);
	zip.file(
		"_rels/.rels",
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
			'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
			"</Relationships>",
	);
	const body = paragraphs
		.map((text, index) =>
			index % 2 === 0
				? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
				: `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
		)
		.join("");
	zip.file(
		"word/document.xml",
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
	);
	return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function workbookFile(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
	const workbook = new Workbook();
	for (const [name, rows] of Object.entries(sheets)) workbook.addWorksheet(name).addRows(rows);
	return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function pdfFile(lines: string[]): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage();
	lines.forEach((line, index) => page.drawText(line, { x: 40, y: 780 - index * 14, size: 9, font }));
	return doc.save();
}

/** Throws unless the preview is the kind expected. */
function expectKind<K extends FilePreview["kind"]>(shown: FilePreview, kind: K): Extract<FilePreview, { kind: K }> {
	if (shown.kind !== kind) {
		const reason = shown.kind === "none" ? `: ${shown.reason}` : "";
		throw new Error(`Smoke: the file worker made a ${shown.kind} preview instead of ${kind}${reason}`);
	}
	return shown as Extract<FilePreview, { kind: K }>;
}

export async function checkFileWorker(): Promise<void> {
	const word = expectKind(
		await preview({ kind: "bytes", fileName: "Offerte.docx", data: await wordFile(["Offerte voor de website", "Totaal"]) }),
		"html",
	);
	if (!word.url.startsWith("app://preview/")) throw new Error(`Smoke: a Word preview is served from ${word.url}`);
	const table = expectKind(
		await preview({
			kind: "bytes",
			fileName: "Uren.xlsx",
			data: await workbookFile({ Uren: [["Dag", "Uren"], ["maandag", 7]] }),
		}),
		"table",
	);
	if (table.sheets[0]?.rows[1]?.join(" ") !== "maandag 7") {
		throw new Error(`Smoke: the workbook read as ${JSON.stringify(table.sheets[0]?.rows)}`);
	}
	const text = await readText(await pdfFile(["Overeenkomst voor hosting"]));
	if (!text?.includes("Overeenkomst voor hosting")) throw new Error(`Smoke: the PDF's text read as ${JSON.stringify(text)}`);
	console.log("SMOKE_FILES worker word=html sheet=table pdf=text");
}

/* --------------------------------------------------------------- timing */

const WORDS = [
	"offerte", "factuur", "levering", "opdrachtgever", "website", "onderhoud", "termijn", "betaling", "artikel",
	"overeenkomst", "Gent", "Brussel", "Antwerpen", "project", "uren", "planning", "ontwerp", "afspraak", "btw",
	"klant", "datum", "bedrag", "opmerking", "voorwaarden", "bijlage", "contract", "handtekening", "verzending",
];

/** A fixed sequence of words, so every run times the same file. */
function sentences(count: number, wordsEach: number): string[] {
	let seed = 76;
	const next = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed;
	};
	return Array.from({ length: count }, (_, index) => {
		const words = Array.from({ length: wordsEach }, () => WORDS[next() % WORDS.length]!);
		return `${index + 1}. ${words.join(" ")} ${next() % 100000}.`;
	});
}

interface Held {
	/** From the call to its answer. */
	took: number;
	/** The longest the main process went without turning its event loop, by a timer of its own. */
	longest: number;
	/** Every stall a person would notice (over 50 ms), added up. */
	held: number;
	/**
	 * The longest delay `monitorEventLoopDelay` saw. Kept beside the timer's
	 * figure because in Electron's main process, whose loop is Chromium's with
	 * libuv polled inside it, the histogram misses stalls the timer sees.
	 */
	histogramMax: number;
}

const TICK_MS = 10;
const NOTICED_MS = 50;

/** How long the main process was held while `work` ran. */
async function heldWhile(work: () => Promise<unknown>): Promise<Held> {
	const histogram = monitorEventLoopDelay({ resolution: 10 });
	let held = 0;
	let longest = 0;
	let last = performance.now();
	const count = () => {
		const now = performance.now();
		const stall = now - last - TICK_MS;
		if (stall > NOTICED_MS) held += stall;
		longest = Math.max(longest, stall);
		last = now;
	};
	const ticker = setInterval(count, TICK_MS);
	histogram.enable();
	const started = performance.now();
	try {
		await work();
	} finally {
		count();
		clearInterval(ticker);
		histogram.disable();
	}
	return { took: performance.now() - started, longest, held, histogramMax: histogram.max / 1e6 };
}

function figures(prefix: string, held: Held): Record<string, number> {
	return {
		[`${prefix}_took_ms`]: Math.round(held.took),
		[`${prefix}_longest_stall_ms`]: Math.round(held.longest),
		[`${prefix}_held_ms`]: Math.round(held.held),
		[`${prefix}_loop_delay_max_ms`]: Math.round(held.histogramMax),
	};
}

/**
 * A multi-megabyte workbook and Word file, each parsed on the main process as
 * before and then previewed through the worker, with what each held the main
 * process for. Returns one set of figures per file, for a `SMOKE_PERF` line.
 */
export async function measureFileBlocking(): Promise<Record<string, Record<string, number>>> {
	const rows: (string | number)[][] = [["Nr", "Klant", "Omschrijving", "Uren", "Bedrag", "Plaats", "Status", "Opmerking"]];
	const lines = sentences(60_000, 6);
	for (let index = 0; index < 60_000; index += 1) {
		const words = lines[index]!.split(" ");
		rows.push([index + 1, words[1]!, lines[index]!, (index % 9) + 0.5, (index * 37) % 100_000, words[2]!, words[3]!, words[4]!]);
	}
	const workbook = await workbookFile({ Boekhouding: rows });
	const word = await wordFile(sentences(120_000, 14));

	// Both libraries loaded on both sides first, so neither figure counts a first require.
	await runFileJob({ kind: "workbook", limits: PREVIEW_LIMITS }, await workbookFile({ A: [["a"]] }));
	await runFileJob({ kind: "word-html" }, await wordFile(["a"]));
	await preview({ kind: "bytes", fileName: "warm.xlsx", data: await workbookFile({ A: [["a"]] }) });
	await preview({ kind: "bytes", fileName: "warm.docx", data: await wordFile(["a"]) });

	let inlineRows = 0;
	const workbookInline = await heldWhile(async () => {
		const result = await runFileJob({ kind: "workbook", limits: PREVIEW_LIMITS }, workbook);
		inlineRows = typeof result === "object" && result !== null && "sheets" in result ? (result.sheets[0]?.rows.length ?? 0) : 0;
	});
	let workerRows = 0;
	const workbookWorker = await heldWhile(async () => {
		const shown = expectKind(await preview({ kind: "bytes", fileName: "Boekhouding.xlsx", data: workbook }), "table");
		workerRows = shown.sheets[0]?.rows.length ?? 0;
	});
	if (inlineRows !== workerRows || workerRows !== PREVIEW_LIMITS.maxRows) {
		throw new Error(`Smoke: the workbook read as ${inlineRows} rows here and ${workerRows} in the worker`);
	}

	const wordInline = await heldWhile(() => runFileJob({ kind: "word-html" }, word));
	const wordWorker = await heldWhile(async () => {
		expectKind(await preview({ kind: "bytes", fileName: "Verslag.docx", data: word }), "html");
	});

	return {
		"files.workbook": {
			bytes: workbook.byteLength,
			...figures("main", workbookInline),
			...figures("worker", workbookWorker),
		},
		"files.word": {
			bytes: word.byteLength,
			...figures("main", wordInline),
			...figures("worker", wordWorker),
		},
	};
}
