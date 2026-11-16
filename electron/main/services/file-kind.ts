/**
 * What a file is, for deciding how to read it, preview it and convert it
 * (decisions 75 to 77). Judged from the name, because that is what every
 * caller has, and checked against the bytes where a wrong guess would matter:
 * a PDF has to start like one before it is handed to pdf.js as one.
 *
 * No Electron import, so every rule here is covered by a test.
 */
import { extensionOf, mimeTypeOf } from "../../shared/mime";

export type FileFamily =
	| "pdf"
	| "word"
	| "legacy-word"
	/** A slide deck, which only PowerPoint draws. */
	| "presentation"
	| "sheet"
	| "csv"
	| "text"
	| "image"
	| "svg"
	| "iwork"
	| "other";

/** Pictures every window can draw from bytes as they are. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

/** Read as text: prose, notes, data and code. HTML is here too: it is shown as its source, never drawn. */
const TEXT_EXTENSIONS = new Set([
	"txt",
	"text",
	"md",
	"markdown",
	"log",
	"json",
	"xml",
	"yaml",
	"yml",
	"toml",
	"ini",
	"cfg",
	"conf",
	"env",
	"html",
	"htm",
	"css",
	"scss",
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"py",
	"rb",
	"php",
	"java",
	"kt",
	"swift",
	"go",
	"rs",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"sql",
	"sh",
	"ps1",
	"bat",
	"vcf",
	"ics",
	"tsv",
]);

/** Word formats Word itself opens, and that Juno can only convert through it. */
const LEGACY_WORD = new Set(["doc", "rtf", "odt"]);

/** Slide decks PowerPoint opens: its own formats, a show, and an OpenDocument presentation. */
const PRESENTATIONS = new Set(["pptx", "pptm", "ppt", "pps", "ppsx", "odp"]);

export function familyOf(fileName: string): FileFamily {
	const extension = extensionOf(fileName);
	if (extension === "pdf") return "pdf";
	if (extension === "docx" || extension === "docm") return "word";
	if (LEGACY_WORD.has(extension)) return "legacy-word";
	if (PRESENTATIONS.has(extension)) return "presentation";
	if (extension === "xlsx" || extension === "xlsm") return "sheet";
	if (extension === "csv") return "csv";
	if (extension === "svg") return "svg";
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	if (extension === "pages" || extension === "numbers" || extension === "key") return "iwork";
	if (TEXT_EXTENSIONS.has(extension)) return "text";
	return "other";
}

/** The media type a version is recorded with. */
export function mediaTypeFor(fileName: string): string {
	const extension = extensionOf(fileName);
	if (extension === "svg") return "image/svg+xml";
	if (familyOf(fileName) === "text" && mimeTypeOf(fileName) === "application/octet-stream") return "text/plain";
	return mimeTypeOf(fileName);
}

export function isPdfBytes(bytes: Uint8Array): boolean {
	return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** A ZIP container: every Office Open XML file and every iWork file is one. */
export function isZipBytes(bytes: Uint8Array): boolean {
	return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export interface ZipEntrySize {
	name: string;
	/** The size the entry says it has once inflated. */
	inflated: number;
}

/**
 * What a ZIP's central directory says about its entries, read without
 * inflating anything, or null when the directory cannot be found or read.
 *
 * Mammoth, ExcelJS and JSZip inflate whatever a file holds, so a Word file of
 * a few kilobytes that unpacks to gigabytes would stop the file worker, or the
 * main process where JSZip still runs. Reading the sizes first, in the main
 * process, is how a file like that is turned away before any of them sees it.
 * A ZIP64 size is taken from its extra field.
 */
export function zipEntrySizes(bytes: Uint8Array): ZipEntrySize[] | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const length = bytes.byteLength;
	if (length < 22) return null;
	let end = -1;
	for (let at = length - 22; at >= Math.max(0, length - 22 - 0xffff); at -= 1) {
		if (view.getUint32(at, true) === 0x06054b50) {
			end = at;
			break;
		}
	}
	if (end < 0) return null;
	let count = view.getUint16(end + 10, true);
	let offset = view.getUint32(end + 16, true);
	if (count === 0xffff || offset === 0xffffffff) {
		const locator = end - 20;
		if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) return null;
		const record = Number(view.getBigUint64(locator + 8, true));
		if (record < 0 || record + 56 > length || view.getUint32(record, true) !== 0x06064b50) return null;
		count = Number(view.getBigUint64(record + 32, true));
		offset = Number(view.getBigUint64(record + 48, true));
	}
	const entries: ZipEntrySize[] = [];
	let at = offset;
	for (let index = 0; index < count; index += 1) {
		if (at + 46 > length || view.getUint32(at, true) !== 0x02014b50) return null;
		let inflated = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		if (at + 46 + nameLength + extraLength > length) return null;
		const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLength)).toString("utf8");
		if (inflated === 0xffffffff) {
			// The ZIP64 extra field: an id of 1, then the inflated size first.
			let extra = at + 46 + nameLength;
			const extraEnd = extra + extraLength;
			let found = false;
			while (extra + 4 <= extraEnd) {
				const id = view.getUint16(extra, true);
				const size = view.getUint16(extra + 2, true);
				if (id === 0x0001 && size >= 8 && extra + 12 <= extraEnd) {
					inflated = Number(view.getBigUint64(extra + 4, true));
					found = true;
					break;
				}
				extra += 4 + size;
			}
			if (!found) return null;
		}
		entries.push({ name, inflated });
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** The most a Word file or a workbook may unpack to, and how many parts it may have, before Juno reads it. */
export const ZIP_LIMITS = {
	word: { maxInflated: 256 * 1024 * 1024, maxEntries: 10_000 },
	sheet: { maxInflated: 64 * 1024 * 1024, maxEntries: 10_000 },
	/** One picture inside an iWork file. */
	picture: { maxInflated: 20 * 1024 * 1024, maxEntries: 100_000 },
	/** The `Index/*.iwa` entries of an iWork file together, which is all that is inflated to read its words. */
	iwork: { maxInflated: 64 * 1024 * 1024, maxEntries: 100_000 },
};

/**
 * Whether a ZIP is small enough, unpacked, to hand to a reader that inflates
 * all of it. A ZIP whose directory cannot be read is not.
 */
export function zipWithin(bytes: Uint8Array, limits: { maxInflated: number; maxEntries: number }): boolean {
	const entries = zipEntrySizes(bytes);
	if (!entries || entries.length > limits.maxEntries) return false;
	let total = 0;
	for (const entry of entries) {
		total += entry.inflated;
		if (total > limits.maxInflated) return false;
	}
	return true;
}

export function isPdfMediaType(mediaType: string | null | undefined): boolean {
	return !mediaType || mediaType === "application/pdf";
}

/**
 * A name a file can be written under on every platform, keeping the extension
 * it came with. Used for working copies, which the person sees in the title bar
 * of the app that opened them, so it reads as the document's title.
 */
export function readableFileName(title: string, extension: string): string {
	const printable = Array.from(title.normalize("NFC"))
		.map((character) => (character.charCodeAt(0) < 32 ? " " : character))
		.join("");
	const cleaned =
		printable
			.replace(/[\\/:*?"<>|]/g, " ")
			.replace(/\s+/g, " ")
			.replace(/^[.\s]+|[.\s]+$/g, "")
			.slice(0, 80)
			// Again after the cut: Windows drops a dot or a space at the end of a
			// name, and the file written would not be the one asked for.
			.replace(/[.\s]+$/, "") || "Document";
	// Windows takes these as a device whatever follows the first dot, so
	// "nul.tar" is refused as surely as "nul".
	const stem = cleaned.split(".")[0]!.trimEnd();
	const reserved = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i.test(stem);
	const base = reserved ? `${cleaned} document` : cleaned;
	const safeExtension = safeExtensionOf(extension);
	return safeExtension ? `${base}.${safeExtension}` : base;
}

/** An extension that is only letters and digits, at most ten of them. Empty otherwise. */
export function safeExtensionOf(extension: string): string {
	const lower = extension.toLowerCase().replace(/^\./, "");
	return /^[a-z0-9]{1,10}$/.test(lower) ? lower : "";
}
