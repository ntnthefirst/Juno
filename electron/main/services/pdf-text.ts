/**
 * The words in a PDF, and whether two PDFs say the same thing.
 *
 * Used to notice that a file arriving by mail or by a drop is a document Juno
 * already has: the client's signed copy of a contract, or the same offer
 * printed again. What is compared is the text, not the bytes, because a
 * signature, a stamp or a re-save changes every byte and not one word.
 *
 * No Electron import. pdf.js runs here as a plain library with no worker and
 * no fonts loaded, which is enough to read the text layer.
 */

/** A contract is a few thousand words. Anything past this is not needed to recognise it. */
const MAX_TEXT_LENGTH = 200_000;
const MAX_PAGES = 60;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loaded: Promise<PdfJs> | null = null;

/**
 * pdf.js ships as an ES module. The main process compiles to CommonJS, which
 * turns this import into a require, and Electron's Node can require an ES
 * module that has no top-level await, which pdf.js does not.
 */
function pdfjs(): Promise<PdfJs> {
	loaded ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return loaded;
}

/**
 * The text of a PDF, normalised for comparing: lower case, one space between
 * words. Null when the file has no text layer (a scan) or cannot be read,
 * which only means it cannot be matched, never that it cannot be imported.
 */
export async function extractText(bytes: Uint8Array): Promise<string | null> {
	const lib = await pdfjs();
	const task = lib.getDocument({
		data: new Uint8Array(bytes),
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: lib.VerbosityLevel.ERRORS,
	});
	try {
		const pdf = await task.promise;
		const parts: string[] = [];
		let length = 0;
		for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number += 1) {
			const content = await (await pdf.getPage(number)).getTextContent();
			for (const item of content.items) {
				const text = "str" in item ? item.str : "";
				if (text.length === 0) continue;
				parts.push(text);
				length += text.length + 1;
			}
			if (length > MAX_TEXT_LENGTH) break;
		}
		const text = normalise(parts.join(" "));
		return text.length > 0 ? text.slice(0, MAX_TEXT_LENGTH) : null;
	} catch {
		return null;
	} finally {
		await task.destroy().catch(() => undefined);
	}
}

export function normalise(text: string): string {
	return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Takes out what signing adds, so a signed copy compares equal to the file it
 * was made from: Juno's own audit page, which starts with its heading, and the
 * date line on a stamp.
 */
export function withoutSigning(text: string): string {
	const audit = text.indexOf("ondertekeningsgegevens");
	const body = audit >= 0 ? text.slice(0, audit) : text;
	return body.replace(/ondertekend op \d{2}\/\d{2}\/\d{4} om \d{2}:\d{2}/g, " ");
}

function words(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const word of withoutSigning(text).split(/[^\p{L}\p{N}]+/u)) {
		if (word.length < 2) continue;
		counts.set(word, (counts.get(word) ?? 0) + 1);
	}
	return counts;
}

export interface TextMatch {
	/** 0 to 1. How much of the shorter text the longer one also contains. */
	score: number;
	/** True when the two read as the same document. */
	same: boolean;
}

/** Fewer words than this and a match says nothing: every cover letter looks alike. */
const MIN_WORDS = 20;

/**
 * Whether two texts are the same document with at most a signature, a name or
 * a date changed. Counted per word, so reflowed lines and a moved stamp do not
 * matter, and the sizes have to be close, so a one-page letter is not taken for
 * the contract it quotes.
 */
export function compareText(a: string, b: string): TextMatch {
	const left = words(a);
	const right = words(b);
	let leftTotal = 0;
	let rightTotal = 0;
	for (const count of left.values()) leftTotal += count;
	for (const count of right.values()) rightTotal += count;
	if (leftTotal < MIN_WORDS || rightTotal < MIN_WORDS) return { score: 0, same: false };

	let common = 0;
	for (const [word, count] of left) common += Math.min(count, right.get(word) ?? 0);

	const smaller = Math.min(leftTotal, rightTotal);
	const larger = Math.max(leftTotal, rightTotal);
	const score = common / smaller;
	return { score, same: score >= 0.9 && smaller / larger >= 0.8 };
}
