/**
 * Copy and paste of documents, through the system clipboard (decision 82).
 *
 * Copying documents in Juno remembers them here, in the main process, and
 * puts a copy of each one's newest file on the system clipboard as files, so
 * they paste into Explorer too. Pasting reads the system clipboard here and
 * never in the window, which only says where to paste. In this order:
 *
 * 1. Documents copied in Juno, while the clipboard still holds what that copy
 *    put there: pasted as copies into the place (or moved, after a cut).
 * 2. Files copied in Explorer: handed back as bytes, to go through the same
 *    questions as Add files, so the type, the size limit and a likely
 *    version are checked the same way.
 * 3. A picture: a PNG named "Pasted image <date and time>".
 * 4. Text: a text file named "Pasted text <date and time>".
 *
 * Reading the clipboard is something the window does for a person, so the
 * paste has no agent tool, for the reason a right-click menu has none. What a
 * paste makes is made by service functions an agent can call: duplicate,
 * copy and `createFile`.
 *
 * The system clipboard is behind a seam, so every rule here is tested without
 * Electron (clipboard-system.ts is the real one).
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ClipboardCopyResult, DocumentPlace, PasteResult, PickedFile } from "../../shared/types";
import { getDb, type Db } from "../db";
import { MAX_IMPORT_BYTES } from "./document-import";
import * as organise from "./document-organise";
import { dragFileNames } from "./drag-name";
import * as documents from "./documents";
import { mediaTypeFor } from "./file-kind";

export type SystemClipboard = {
	/** Paths of the files copied in Explorer, in order. Empty when the clipboard holds no files. */
	readFiles(): Promise<string[]>;
	/** A picture on the clipboard, as PNG bytes, or null. */
	readImage(): Uint8Array | null;
	readText(): string;
	/** Whether there is anything at all to paste, without the cost of reading it. */
	hasContent(): boolean;
	/** Puts these files on the clipboard. False when the platform would not take them. */
	writeFiles(paths: string[]): Promise<boolean>;
};

const NOTHING: SystemClipboard = {
	readFiles: async () => [],
	readImage: () => null,
	readText: () => "",
	hasContent: () => false,
	writeFiles: async () => false,
};

/**
 * A clipboard of its own, for a test and for the smoke run, which must not
 * overwrite what the person running it has copied.
 */
export function memoryClipboard(start: { files?: string[]; image?: Uint8Array | null; text?: string } = {}) {
	const state = { files: start.files ?? [], image: start.image ?? null, text: start.text ?? "" };
	const clip: SystemClipboard & { state: typeof state } = {
		state,
		readFiles: async () => [...state.files],
		readImage: () => state.image,
		readText: () => state.text,
		hasContent: () => state.files.length > 0 || state.image !== null || state.text.trim() !== "",
		writeFiles: async (paths) => {
			state.files = [...paths];
			state.image = null;
			state.text = "";
			return true;
		},
	};
	return clip;
}

let system: SystemClipboard = NOTHING;
let copyRoot = join(tmpdir(), "juno-clipboard");

/** Startup hands over the real clipboard; a test hands over one of its own. */
export function configureClipboard(next: SystemClipboard, root?: string): void {
	system = next;
	if (root) copyRoot = root;
	held = null;
}

/** More than this at once is not a copy a person means. */
export const MAX_COPY = 200;

type Held = {
	mode: "copy" | "cut";
	ids: string[];
	/** What the system clipboard held straight after the copy. Anything else means something newer was copied. */
	mark: string;
};

let held: Held | null = null;

/** A short fingerprint of what is on the system clipboard now. */
async function markOf(): Promise<string> {
	const files = await system.readFiles();
	const image = system.readImage();
	const hash = createHash("sha256");
	hash.update(JSON.stringify(files));
	hash.update("\u0000");
	hash.update(system.readText());
	hash.update("\u0000");
	if (image) hash.update(image);
	return hash.digest("hex");
}

function clearEarlierCopies(): void {
	if (!existsSync(copyRoot)) return;
	for (const entry of readdirSync(copyRoot)) {
		try {
			rmSync(join(copyRoot, entry), { recursive: true, force: true });
		} catch {
			// Still open in the app it was pasted into. It goes with the next copy.
		}
	}
}

/**
 * The files the system clipboard is given for these documents: a copy of each
 * newest version, named by its title, in a folder of its own. Never the kept
 * file itself, which an app it is pasted into could save over (decision 75).
 */
async function filesFor(ids: readonly string[], db: Db): Promise<string[]> {
	const records = [];
	for (const id of ids) {
		const record = await documents.get(id, db);
		if (record?.latestVersion && record.pdfPath && existsSync(record.pdfPath)) records.push(record);
	}
	if (records.length === 0) return [];
	clearEarlierCopies();
	mkdirSync(copyRoot, { recursive: true });
	const folder = mkdtempSync(join(copyRoot, "copy-"));
	const names = dragFileNames(
		records.map((record) => ({ title: record.title, storedName: record.latestVersion!.fileName ?? basename(record.pdfPath!) })),
	);
	return records.map((record, at) => {
		const target = join(folder, names[at]!);
		copyFileSync(record.pdfPath!, target);
		return target;
	});
}

/**
 * Ctrl C or Ctrl X on documents. A cut is moved by the next paste; a copy is
 * copied by every paste until something else is copied.
 */
export async function copy(ids: readonly string[], mode: "copy" | "cut", db: Db = getDb()): Promise<ClipboardCopyResult> {
	const live: string[] = [];
	for (const id of [...new Set(ids)].slice(0, MAX_COPY)) {
		if (await documents.get(id, db)) live.push(id);
	}
	if (live.length === 0) throw new Error("Those documents no longer exist, so there is nothing to copy.");
	let toSystem = false;
	try {
		const paths = await filesFor(live, db);
		toSystem = paths.length > 0 && (await system.writeFiles(paths));
	} catch {
		// The copy still works inside Juno; only pasting into Explorer is lost.
		toSystem = false;
	}
	held = { mode, ids: live, mark: await markOf() };
	return { count: live.length, mode, toSystem };
}

/** The ids held by a copy or a cut, while the system clipboard still holds what it put there. */
export async function heldDocuments(): Promise<{ mode: "copy" | "cut"; ids: string[] } | null> {
	if (!held) return null;
	if ((await markOf()) !== held.mark) return null;
	return { mode: held.mode, ids: [...held.ids] };
}

/** Whether a paste would find anything, for the right-click menu. Cheap: nothing is read in full. */
export function canPaste(): boolean {
	return held !== null || system.hasContent();
}

/** "2026-11-16 14.05", in the computer's own time: a file name, so no colons. */
export function stampOf(at: Date): string {
	const two = (value: number) => String(value).padStart(2, "0");
	return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`;
}

function readFile(path: string): PickedFile {
	const stat = statSync(path);
	if (!stat.isFile()) throw new Error(`"${basename(path)}" is a folder. Copy the files in it instead.`);
	if (stat.size > MAX_IMPORT_BYTES) {
		throw new Error(`"${basename(path)}" is larger than 100 MB. Keep it in a project's files instead, which can link to it.`);
	}
	return {
		fileName: basename(path),
		data: new Uint8Array(readFileSync(path)),
		fileDate: stat.mtime.toISOString(),
		mediaType: mediaTypeFor(basename(path)),
	};
}

/** Whether a document is listed in a place: on a client's tab with its projects', on a project's tab, or in Files. */
function isIn(record: { clientId: string | null; projectId: string | null }, place: DocumentPlace): boolean {
	if (place.clientId) return record.clientId === place.clientId;
	if (place.projectId) return record.projectId === place.projectId;
	return record.clientId === null && record.projectId === null;
}

/**
 * Ctrl V in a place. Documents copied in Juno are pasted here and now; files,
 * a picture or text come back as files, for the window to add the way Add
 * files does. `now` names a pasted picture or text.
 */
export async function paste(place: DocumentPlace, db: Db = getDb(), now: Date = new Date()): Promise<PasteResult> {
	const own = await heldDocuments();
	if (own) {
		const made = [];
		if (own.mode === "copy") {
			for (const id of own.ids) made.push(await organise.copyTo(id, place, db));
		} else {
			for (const id of own.ids) {
				const record = await documents.get(id, db);
				if (!record) continue;
				// Cut and pasted where it already is: nothing moves, as in Explorer.
				if (isIn(record, place)) continue;
				made.push(await organise.move(id, place, db));
			}
			held = null;
		}
		return { kind: "documents", mode: own.mode, documents: made };
	}

	const paths = await system.readFiles();
	if (paths.length > 0) return { kind: "files", source: "files", files: paths.slice(0, MAX_COPY).map(readFile) };

	const image = system.readImage();
	if (image && image.byteLength > 0) {
		if (image.byteLength > MAX_IMPORT_BYTES) throw new Error("The picture on the clipboard is larger than 100 MB.");
		return {
			kind: "files",
			source: "image",
			files: [{ fileName: `Pasted image ${stampOf(now)}.png`, data: image, fileDate: now.toISOString(), mediaType: "image/png" }],
		};
	}

	const text = system.readText();
	if (text.trim()) {
		const data = new Uint8Array(Buffer.from(text, "utf8"));
		if (data.byteLength > MAX_IMPORT_BYTES) throw new Error("The text on the clipboard is larger than 100 MB.");
		return {
			kind: "files",
			source: "text",
			files: [{ fileName: `Pasted text ${stampOf(now)}.txt`, data, fileDate: now.toISOString(), mediaType: "text/plain" }],
		};
	}

	return { kind: "empty" };
}
