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

export function familyOf(fileName: string): FileFamily {
	const extension = extensionOf(fileName);
	if (extension === "pdf") return "pdf";
	if (extension === "docx" || extension === "docm") return "word";
	if (LEGACY_WORD.has(extension)) return "legacy-word";
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
			.slice(0, 80) || "Document";
	// Windows refuses these as names whatever follows the dot.
	const base = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? `${cleaned} document` : cleaned;
	const safeExtension = safeExtensionOf(extension);
	return safeExtension ? `${base}.${safeExtension}` : base;
}

/** An extension that is only letters and digits, at most ten of them. Empty otherwise. */
export function safeExtensionOf(extension: string): string {
	const lower = extension.toLowerCase().replace(/^\./, "");
	return /^[a-z0-9]{1,10}$/.test(lower) ? lower : "";
}
