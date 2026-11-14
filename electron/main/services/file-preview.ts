/**
 * Every file has a preview, made here in the main process and handed to the
 * window as something to draw, never as a path (decision 76).
 *
 * What a file is decides what it becomes: a PDF its bytes, a picture or an
 * SVG an address on `app://preview/`, a Word file sanitised HTML at such an
 * address, a spreadsheet its cells, text its text, an iWork file the picture
 * it carries, and anything else the thumbnail Windows makes for it. A file
 * that has none of these says so and still has its name, size and type.
 *
 * An address on `app://preview/` is an opaque token for one preview, held in
 * memory for a while and never a name of a file. `servePreview` is what
 * `main/scheme.ts` asks for a token, and every answer carries its own
 * Content-Security-Policy, so a Word file's HTML never runs anything and an
 * SVG is only ever a picture.
 *
 * The one call that needs Electron, making a thumbnail, is handed in at
 * startup (`configurePreview`), the way documents-folder.ts is, so this module
 * stays testable in plain Node.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import JSZip from "jszip";
import { extensionOf } from "../../shared/mime";
import type { FilePreview, FilePreviewForAgent, FilePreviewMeta, FilePreviewSource } from "../../shared/types";
import { getDb, type Db } from "../db";
import * as versions from "./document-versions";
import {
	familyOf,
	isPdfBytes,
	isZipBytes,
	mediaTypeFor,
	safeExtensionOf,
	ZIP_LIMITS,
	zipEntrySizes,
	zipWithin,
	type FileFamily,
} from "./file-kind";
import { sanitiseDocumentHtml } from "./file-jobs";
import { FileReadError, readInWorker, type ReadOptions } from "./file-reader";
import { PREVIEW_LIMITS, readableText, readSheets } from "./file-text";
import { MAX_IMPORT_BYTES } from "./document-import";
import { get as getDocument } from "./documents";
import { attachmentPath } from "./mail-threads";
import * as projectAssets from "./project-assets";

/** A preview reads a file into memory. Past this it shows the file's details and a thumbnail instead. */
const MAX_PREVIEW_BYTES = 60 * 1024 * 1024;
/** A Word file past this is shown by its thumbnail. Mammoth holds the whole document while it reads. */
const MAX_WORD_BYTES = 30 * 1024 * 1024;
/** How many preview addresses are kept at once. The oldest goes first. */
const MAX_TOKENS = 40;
/** How long an address answers. A preview open longer than this is drawn again when it is asked for. */
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
/** The most bytes the addresses hold in memory at once, together. A file Juno keeps is read when asked and does not count. */
export const MAX_HELD_BYTES = 128 * 1024 * 1024;

type Hooks = {
	/** A PNG of the file as the operating system draws it, or null when it has none. */
	thumbnail: (path: string) => Promise<Buffer | null>;
};

let hooks: Hooks | null = null;

export function configurePreview(next: Hooks | null): void {
	hooks = next;
}

/* --------------------------------------------------------------- tokens */

interface Served {
	contentType: string;
	csp: string;
	/** Held in memory, for HTML made here and bytes the window handed over. */
	body?: Buffer;
	/** Read when asked, for a file Juno keeps. */
	path?: string;
	expires: number;
}

const served = new Map<string, Served>();

const IMAGE_CSP = "default-src 'none'; sandbox";
/** An SVG is a document: styles inside it may apply, and nothing else may run or load. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
/**
 * A Word file's page. `sandbox` with no allowances makes it an opaque origin
 * that runs no script, submits no form and cannot navigate the window, so the
 * policy holds even where the sanitiser let something through.
 */
const HTML_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
/** The page repeats the policy in a meta tag too, where `sandbox` is not allowed, so it is added to the header only. */
const HTML_CSP = `${HTML_POLICY}; sandbox`;

function heldBytes(): number {
	let total = 0;
	for (const value of served.values()) total += value.body?.length ?? 0;
	return total;
}

function issue(entry: Omit<Served, "expires">): string {
	const clock = Date.now();
	for (const [token, value] of served) if (value.expires < clock) served.delete(token);
	// Forty addresses of sixty megabytes each would be gigabytes in the main
	// process, so what is held in memory has a ceiling of its own.
	const incoming = entry.body?.length ?? 0;
	while (served.size > 0 && heldBytes() + incoming > MAX_HELD_BYTES) {
		const oldest = served.keys().next().value;
		if (oldest === undefined) break;
		served.delete(oldest);
	}
	while (served.size >= MAX_TOKENS) {
		const oldest = served.keys().next().value;
		if (oldest === undefined) break;
		served.delete(oldest);
	}
	const token = randomBytes(24).toString("hex");
	served.set(token, { ...entry, expires: clock + TOKEN_LIFETIME_MS });
	return token;
}

function urlFor(token: string): string {
	return `app://preview/${token}`;
}

/**
 * What `app://preview/<token>` answers with, or null for a token that is
 * unknown, expired or malformed. Called by the scheme handler only.
 */
export function servePreview(token: string): { body: Buffer; contentType: string; csp: string } | null {
	if (!/^[a-f0-9]{48}$/.test(token)) return null;
	const entry = served.get(token);
	if (!entry || entry.expires < Date.now()) {
		served.delete(token);
		return null;
	}
	try {
		const body = entry.body ?? (entry.path ? readFileSync(entry.path) : null);
		return body ? { body, contentType: entry.contentType, csp: entry.csp } : null;
	} catch {
		return null;
	}
}

/** Forgets every address, for a lock: a locked window must not be able to read one back. */
export function forgetPreviews(): void {
	served.clear();
}

/* ------------------------------------------------------------- the file */

interface SourceFile {
	name: string;
	mediaType: string;
	size: number;
	modified: string | null;
	/** A file Juno keeps. Null for bytes the window handed over. */
	path: string | null;
	bytes: Buffer | null;
}

function statOf(path: string): { size: number; modified: string | null } {
	try {
		const stat = statSync(path);
		return { size: stat.size, modified: stat.mtime.toISOString() };
	} catch {
		throw new Error("The file is no longer on this machine.");
	}
}

/** The only place a preview source becomes a file. Each kind is resolved from its id. */
async function resolve(source: FilePreviewSource, db: Db): Promise<SourceFile> {
	switch (source.kind) {
		case "document":
		case "version": {
			const file =
				source.kind === "document" ? versions.latestFileOf(source.documentId, db) : versions.fileOf(source.versionId, db);
			// A version outlives its document's soft delete, and what is deleted is
			// not shown, to the window or to an agent (data.md section 6).
			if (!(await getDocument(file.documentId, db))) throw new Error("That document no longer exists.");
			const { size, modified } = statOf(file.path);
			return { name: file.fileName, mediaType: file.mediaType, size, modified, path: file.path, bytes: null };
		}
		case "attachment": {
			const { path, filename } = attachmentPath(source.attachmentId, db);
			const { size, modified } = statOf(path);
			return { name: filename, mediaType: mediaTypeFor(filename), size, modified, path, bytes: null };
		}
		case "asset": {
			const asset = await projectAssets.get(source.assetId, db);
			if (!asset) throw new Error("That file is no longer in this project.");
			const { path } = projectAssets.pathOf(source.assetId, db);
			const { size, modified } = statOf(path);
			return { name: asset.fileName, mediaType: mediaTypeFor(asset.fileName), size, modified, path, bytes: null };
		}
		case "bytes": {
			const bytes = Buffer.from(source.data);
			if (bytes.length > MAX_IMPORT_BYTES) throw new Error("That file is larger than 100 MB.");
			const name = basename(String(source.fileName ?? "")).trim() || "File";
			return {
				name,
				mediaType: mediaTypeFor(name),
				size: bytes.length,
				modified: source.fileDate ?? null,
				path: null,
				bytes,
			};
		}
		default:
			throw new Error("A preview is made from a document, a version, an attachment or a project file.");
	}
}

function metaOf(file: SourceFile): FilePreviewMeta {
	return {
		name: file.name,
		size: file.size,
		mediaType: file.mediaType,
		extension: extensionOf(file.name),
		modified: file.modified,
	};
}

function bytesOf(file: SourceFile): Buffer {
	return file.bytes ?? readFileSync(file.path!);
}

/**
 * Whether the bytes `bytesOf` hands back are read afresh for the one call,
 * so they can be moved to the file worker rather than copied. Bytes the
 * window handed over are not: a failed preview writes them out again for the
 * system thumbnail.
 */
function ownBytes(file: SourceFile): boolean {
	return file.bytes === null;
}

/* -------------------------------------------------------- Word as HTML */

const DOCUMENT_CSS = `
html { background: #ffffff; }
body { margin: 0 auto; max-width: 760px; padding: 40px 48px; color: #1c1b19; background: #ffffff;
  font: 15px/1.6 "Segoe UI", -apple-system, Inter, sans-serif; word-wrap: break-word; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.2em 0 0.5em; }
p { margin: 0 0 0.8em; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 0 0 1em; max-width: 100%; }
td, th { border: 1px solid #d9d6cf; padding: 4px 8px; vertical-align: top; }
`;

/** Lives with the parsing, in the file worker. Exported here too, where it was first written. */
export { sanitiseDocumentHtml };

function documentPage(title: string, body: string): string {
	const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
	return (
		`<!doctype html><html><head><meta charset="utf-8">` +
		`<meta http-equiv="Content-Security-Policy" content="${HTML_POLICY}">` +
		`<title>${escapedTitle}</title><style>${DOCUMENT_CSS}</style></head><body>${body}</body></html>`
	);
}

/**
 * A `.docx` as a page of sanitised HTML, the way decision 76 draws one. Read
 * and sanitised in the file worker; only the size check runs here.
 */
export async function wordToHtml(
	bytes: Uint8Array,
	title: string,
	options: Pick<ReadOptions, "transfer"> = {},
): Promise<string> {
	if (!zipWithin(bytes, ZIP_LIMITS.word)) throw new Error(`"${title}" unpacks to more than Juno reads.`);
	const body = await readInWorker({ kind: "word-html" }, bytes, { fileName: title, transfer: options.transfer });
	return documentPage(title, body);
}

/** What a person is told when a file could not be read: the reader's own sentence, when it has one. */
function reasonFor(error: unknown, otherwise: string): string {
	return error instanceof FileReadError ? error.message : otherwise;
}

/* ------------------------------------------------- pictures in files */

const IWORK_PICTURES = ["preview.jpg", "QuickLook/Preview.jpg", "QuickLook/Thumbnail.jpg", "preview-web.jpg"];

/** The preview picture an iWork file carries in its zip, or null. */
export async function iworkPicture(bytes: Uint8Array): Promise<Buffer | null> {
	if (!isZipBytes(bytes)) return null;
	// The rest of the package can be large (a presentation's films). Only the
	// picture is inflated, so only its size counts.
	const entries = zipEntrySizes(bytes);
	if (!entries || entries.length > ZIP_LIMITS.picture.maxEntries) return null;
	const sizes = new Map(entries.map((entry) => [entry.name, entry.inflated]));
	try {
		const zip = await JSZip.loadAsync(bytes);
		for (const name of IWORK_PICTURES) {
			const entry = zip.file(name);
			if (!entry) continue;
			const size = sizes.get(name);
			if (size === undefined || size > ZIP_LIMITS.picture.maxInflated) return null;
			return Buffer.from(await entry.async("uint8array"));
		}
	} catch {
		// A damaged zip has no picture; the thumbnail below may still.
	}
	return null;
}

async function systemThumbnail(file: SourceFile): Promise<Buffer | null> {
	if (!hooks) return null;
	if (file.path) return hooks.thumbnail(file.path).catch(() => null);
	// Bytes the window handed over have no place on disk, so they get one for
	// as long as the operating system takes to look at them.
	const extension = safeExtensionOf(extensionOf(file.name));
	const temporary = join(tmpdir(), `juno-preview-${randomBytes(8).toString("hex")}${extension ? `.${extension}` : ""}`);
	try {
		writeFileSync(temporary, file.bytes!);
		return await hooks.thumbnail(temporary);
	} catch {
		return null;
	} finally {
		rmSync(temporary, { force: true });
	}
}

/* ------------------------------------------------------------ preview */

const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
};

async function fallback(file: SourceFile, meta: FilePreviewMeta, reason: string): Promise<FilePreview> {
	const picture = await systemThumbnail(file);
	if (picture && picture.length > 0) {
		return { kind: "thumbnail", meta, from: "system", url: urlFor(issue({ contentType: "image/png", csp: IMAGE_CSP, body: picture })) };
	}
	return { kind: "none", meta, reason };
}

async function previewOf(file: SourceFile, family: FileFamily): Promise<FilePreview> {
	const meta = metaOf(file);
	if (file.size > MAX_PREVIEW_BYTES) {
		return fallback(file, meta, "This file is too large to preview. Open it to see it.");
	}
	switch (family) {
		case "pdf": {
			const bytes = bytesOf(file);
			if (!isPdfBytes(bytes)) return fallback(file, meta, "This file is not a PDF Juno can read. Open it to see it.");
			return { kind: "pdf", meta, data: new Uint8Array(bytes) };
		}
		case "image": {
			const contentType = IMAGE_TYPES[meta.extension] ?? "application/octet-stream";
			const token = issue(
				file.path ? { contentType, csp: IMAGE_CSP, path: file.path } : { contentType, csp: IMAGE_CSP, body: file.bytes! },
			);
			return { kind: "image", meta, url: urlFor(token) };
		}
		case "svg": {
			const contentType = "image/svg+xml";
			const token = issue(
				file.path ? { contentType, csp: SVG_CSP, path: file.path } : { contentType, csp: SVG_CSP, body: file.bytes! },
			);
			return { kind: "image", meta, url: urlFor(token) };
		}
		case "word": {
			if (file.size > MAX_WORD_BYTES) return fallback(file, meta, "This Word file is too large to preview. Open it to see it.");
			const word = bytesOf(file);
			if (isZipBytes(word) && !zipWithin(word, ZIP_LIMITS.word)) {
				return fallback(file, meta, "This Word file is too large to preview. Open it to see it.");
			}
			try {
				const html = await wordToHtml(word, file.name, { transfer: ownBytes(file) });
				const token = issue({ contentType: "text/html; charset=utf-8", csp: HTML_CSP, body: Buffer.from(html, "utf8") });
				return { kind: "html", meta, url: urlFor(token) };
			} catch (error) {
				return fallback(file, meta, reasonFor(error, "This Word file could not be read. Open it in Word to see it."));
			}
		}
		case "sheet":
		case "csv": {
			try {
				const { sheets, truncatedSheets } = await readSheets(bytesOf(file), file.name, PREVIEW_LIMITS, {
					transfer: ownBytes(file),
				});
				return { kind: "table", meta, sheets, truncatedSheets };
			} catch (error) {
				return fallback(file, meta, reasonFor(error, "This spreadsheet could not be read. Open it to see it."));
			}
		}
		case "text": {
			const { text, truncated } = await readableText(bytesOf(file), file.name);
			if (text === null) return fallback(file, meta, "This file has no text Juno can show. Open it to see it.");
			return { kind: "text", meta, text, truncated };
		}
		case "iwork": {
			const picture = await iworkPicture(bytesOf(file));
			if (picture) {
				const token = issue({ contentType: "image/jpeg", csp: IMAGE_CSP, body: picture });
				return { kind: "thumbnail", meta, from: "iwork", url: urlFor(token) };
			}
			return fallback(file, meta, "This file carries no preview. Open it to see it.");
		}
		default:
			return fallback(file, meta, "Juno has no preview for this kind of file. Open it to see it.");
	}
}

/** What the window draws for a file. */
export async function preview(source: FilePreviewSource, db: Db = getDb()): Promise<FilePreview> {
	const file = await resolve(source, db);
	return previewOf(file, familyOf(file.name));
}

/**
 * The same decision for an agent: the file's details, which kind of preview
 * it has, and its words or cells, never an address (mcp.md section 3).
 */
export async function previewForAgent(source: FilePreviewSource, db: Db = getDb()): Promise<FilePreviewForAgent> {
	const file = await resolve(source, db);
	const meta = metaOf(file);
	const family = familyOf(file.name);
	const kind: FilePreview["kind"] =
		family === "pdf"
			? "pdf"
			: family === "image" || family === "svg"
				? "image"
				: family === "word"
					? "html"
					: family === "sheet" || family === "csv"
						? "table"
						: family === "text"
							? "text"
							: family === "iwork"
								? "thumbnail"
								: "none";
	if (file.size > MAX_PREVIEW_BYTES) return { meta, kind: "none", text: null, truncated: false, sheets: null };
	if (family === "sheet" || family === "csv") {
		try {
			const { sheets } = await readSheets(bytesOf(file), file.name, PREVIEW_LIMITS, { transfer: ownBytes(file) });
			return { meta, kind, text: null, truncated: false, sheets };
		} catch {
			return { meta, kind: "none", text: null, truncated: false, sheets: null };
		}
	}
	if (family === "image" || family === "svg" || family === "iwork" || family === "other" || family === "legacy-word") {
		return { meta, kind, text: null, truncated: false, sheets: null };
	}
	const { text, truncated } = await readableText(bytesOf(file), file.name, PREVIEW_LIMITS.maxTextCharacters, {
		transfer: ownBytes(file),
	});
	return { meta, kind, text, truncated, sheets: null };
}
