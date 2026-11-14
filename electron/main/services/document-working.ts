/**
 * Opening a document in the app the operating system uses for it, and keeping
 * what is saved there (decision 75).
 *
 * A version's file is never written to after it is kept. Opening the newest
 * version for editing opens a working copy instead, in a folder of its own
 * under the documents folder (`.working/<document id>/`), named after the
 * document so the other app's title bar reads right. When the copy's bytes
 * differ from what was last recorded, they are kept as a new version, "Edited
 * outside Juno", and the copy carries on as the copy of that version.
 *
 * A signed or stamped newest version, and any older version, open as a copy
 * marked read only, so the other app cannot save over it and nothing is
 * picked up from it.
 *
 * The check runs when the main window gains focus and when a document is
 * opened. It is cheap: the size and the modified time are compared with what
 * was recorded, and a file is read and hashed only when one of them moved.
 *
 * Opening a file is the one call that needs Electron; it is handed in at
 * startup (`configureWorkingCopies`), so this module stays testable in plain
 * Node. Every path opened is one this module built from ids.
 */
import { and, eq, isNull } from "drizzle-orm";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extensionOf } from "../../shared/mime";
import type { DocumentVersion } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documentWorkingCopies, documents } from "../db/schema";
import { announce } from "./document-events";
import * as versions from "./document-versions";
import { documentStorageDir, fileNameFor, get } from "./documents";
import { mediaTypeFor, readableFileName } from "./file-kind";
import { matchText } from "./file-text";

type Hooks = {
	/** Opens a file Juno wrote in the operating system's default app. Resolves to an error message, empty on success. */
	openPath: (path: string) => Promise<string>;
};

let hooks: Hooks | null = null;

export function configureWorkingCopies(next: Hooks | null): void {
	hooks = next;
}

/** The most working copies one check looks at. More than this have not been opened in a long while. */
const MAX_CHECKED = 200;

type Row = typeof documentWorkingCopies.$inferSelect;

function workingDir(documentId: string): string {
	// The id is a UUID the database made; it is checked anyway, because it
	// becomes part of a path.
	if (!/^[a-z0-9-]+$/i.test(documentId)) throw new Error("That document id is not valid.");
	const dir = join(documentStorageDir(), ".working", documentId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function isSigned(kind: string): boolean {
	return kind === "stamped" || kind === "signed";
}

function liveRow(documentId: string, db: Db): Row | undefined {
	return db
		.select()
		.from(documentWorkingCopies)
		.where(and(eq(documentWorkingCopies.documentId, documentId), isNull(documentWorkingCopies.deletedAt)))
		.get();
}

function retire(row: Row, db: Db): void {
	db.update(documentWorkingCopies)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documentWorkingCopies.id, row.id))
		.run();
}

function makeWritable(path: string): void {
	try {
		chmodSync(path, 0o644);
	} catch {
		// A file that is not there has nothing to change.
	}
}

/**
 * The name and type an edit is kept under: those of the version the copy was
 * made from, or, when that version has since been deleted, the copy's own
 * name, which is the document's title with the same extension. An edit is
 * never lost because the version it started from went.
 */
function baseOf(row: Row, db: Db): { fileName: string; mediaType: string } {
	try {
		const file = versions.fileOf(row.versionId, db);
		return { fileName: file.fileName, mediaType: file.mediaType };
	} catch {
		const fileName = basename(row.path);
		return { fileName, mediaType: mediaTypeFor(fileName) };
	}
}

export interface CheckResult {
	/** The documents that gained a version from an edit. */
	changed: string[];
}

/**
 * Looks at one working copy and keeps it as a new version when its bytes
 * changed. Returns the new version, or null when nothing changed. A file the
 * other app still holds locked is left for the next look.
 */
async function checkRow(row: Row, db: Db): Promise<DocumentVersion | null> {
	let stat;
	try {
		stat = statSync(row.path);
	} catch {
		// Not there now. That is how a copy looks for a moment while Word or
		// Excel saves (a temporary file, the original removed, then a rename),
		// so the copy stays watched: forgetting it here would let the next open
		// write the version over the edit that is about to land. A copy the
		// person really deleted costs one failed look per check, and the next
		// open makes it again.
		return null;
	}
	if (stat.size === row.byteSize && Math.round(stat.mtimeMs) === row.modifiedMs) return null;

	let bytes: Buffer;
	try {
		bytes = readFileSync(row.path);
	} catch {
		return null;
	}
	const hash = versions.hashBytes(bytes);
	if (hash === row.fileHash) {
		db.update(documentWorkingCopies)
			.set({ byteSize: stat.size, modifiedMs: Math.round(stat.mtimeMs), updatedAt: now() })
			.where(eq(documentWorkingCopies.id, row.id))
			.run();
		return null;
	}

	const record = await get(row.documentId, db);
	if (!record) {
		retire(row, db);
		return null;
	}
	const base = baseOf(row, db);
	// The copy is kept as it is now, under a name the service builds. The
	// working copy itself stays where the other app has it open.
	const destination = join(documentStorageDir(), fileNameFor(record.title, "-bewerkt", extensionOf(row.path)));
	writeFileSync(destination, bytes);
	const version = versions.record(
		{
			documentId: row.documentId,
			kind: "edited",
			source: "external",
			pdfPath: destination,
			fileName: base.fileName,
			mediaType: base.mediaType,
			byteSize: bytes.length,
			fileDate: new Date().toISOString(),
			fileHash: hash,
			textContent: await matchText(bytes, base.fileName),
		},
		db,
	);
	db.update(documentWorkingCopies)
		.set({
			versionId: version.id,
			fileHash: hash,
			byteSize: stat.size,
			modifiedMs: Math.round(stat.mtimeMs),
			updatedAt: now(),
		})
		.where(eq(documentWorkingCopies.id, row.id))
		.run();
	return version;
}

/** Checks one document's working copy. Announces the change when there was one. */
export async function checkDocument(documentId: string, db: Db = getDb()): Promise<DocumentVersion | null> {
	const row = liveRow(documentId, db);
	if (!row) return null;
	const version = await checkRow(row, db);
	if (version) announce([documentId], "edited-outside");
	return version;
}

/**
 * A document as it is now, with any edit saved in another app kept first. This
 * is what opening a document reads, so the newest version shown is the newest
 * there is.
 */
export async function getChecked(documentId: string, db: Db = getDb()) {
	try {
		await checkDocument(documentId, db);
	} catch {
		// A copy that cannot be read now is read on the next focus; the document
		// still opens.
	}
	return get(documentId, db);
}

let running: Promise<CheckResult> | null = null;

/**
 * Checks every working copy, newest first and at most `MAX_CHECKED` of them.
 * Called when the main window gains focus; a second call while one is running
 * waits for the first instead of starting another.
 */
export function checkAll(db: Db = getDb()): Promise<CheckResult> {
	running ??= (async () => {
		const rows = db
			.select({ row: documentWorkingCopies })
			.from(documentWorkingCopies)
			.innerJoin(documents, eq(documentWorkingCopies.documentId, documents.id))
			.where(and(isNull(documentWorkingCopies.deletedAt), isNull(documents.deletedAt)))
			.all()
			.map(({ row }) => row)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, MAX_CHECKED);
		const changed: string[] = [];
		for (const row of rows) {
			try {
				if (await checkRow(row, db)) changed.push(row.documentId);
			} catch {
				// One copy that cannot be read must not stop the others.
			}
		}
		if (changed.length > 0) announce(changed, "edited-outside");
		return { changed };
	})().finally(() => {
		running = null;
	});
	return running;
}

/** Writes a read-only copy of one version and returns its path. Rewritten each time, so it is the version's bytes. */
function readOnlyCopy(file: versions.VersionFile, title: string, label: string): string {
	const dir = join(workingDir(file.documentId), "read-only");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const path = join(dir, readableFileName(`${title} (${label})`, extensionOf(file.fileName || file.path)));
	makeWritable(path);
	copyFileSync(file.path, path);
	chmodSync(path, 0o444);
	return path;
}

/**
 * The working copy of a document's newest version, made or brought up to date.
 * Edits already saved in it are kept first, so nothing typed elsewhere is lost
 * by opening it again.
 */
async function workingCopy(documentId: string, db: Db): Promise<string> {
	const record = await get(documentId, db);
	if (!record) throw new Error("That document no longer exists.");
	await checkDocument(documentId, db);
	const latest = versions.latestFileOf(documentId, db);
	if (!existsSync(latest.path)) throw new Error(`The file of "${record.title}" is no longer on this machine.`);

	const existing = liveRow(documentId, db);
	if (existing && existing.versionId === latest.versionId && existsSync(existing.path)) return existing.path;

	const path = join(workingDir(documentId), readableFileName(record.title, extensionOf(latest.fileName || latest.path)));
	// The copy of an older version, unchanged since (the check above kept any
	// change), is replaced by the newest.
	makeWritable(path);
	copyFileSync(latest.path, path);
	const stat = statSync(path);
	const values = {
		versionId: latest.versionId,
		path,
		byteSize: stat.size,
		modifiedMs: Math.round(stat.mtimeMs),
		fileHash: latest.fileHash ?? versions.hashBytes(readFileSync(path)),
		updatedAt: now(),
	};
	if (existing) {
		if (existing.path !== path) rmSync(existing.path, { force: true });
		db.update(documentWorkingCopies).set(values).where(eq(documentWorkingCopies.id, existing.id)).run();
	} else {
		db.insert(documentWorkingCopies)
			.values({ documentId, ...values })
			.run();
	}
	return path;
}

/** Where opening a document leads, for a test to check without an operating system to open it. */
export async function pathToOpen(documentId: string, db: Db = getDb()): Promise<{ path: string; readOnly: boolean }> {
	const record = await get(documentId, db);
	if (!record) throw new Error("That document no longer exists.");
	const latest = versions.latestFileOf(documentId, db);
	if (isSigned(latest.kind)) {
		return { path: readOnlyCopy(latest, record.title, "signed"), readOnly: true };
	}
	return { path: await workingCopy(documentId, db), readOnly: false };
}

/** The same for one version: the newest opens as the document does, an older one read only. */
export async function versionPathToOpen(versionId: string, db: Db = getDb()): Promise<{ path: string; readOnly: boolean }> {
	const { version } = versions.get(versionId, db);
	if (version.isLatest) return pathToOpen(version.documentId, db);
	const record = await get(version.documentId, db);
	if (!record) throw new Error("That document no longer exists.");
	return { path: readOnlyCopy(versions.fileOf(versionId, db), record.title, `version ${version.number}`), readOnly: true };
}

async function open(path: string): Promise<void> {
	if (!hooks) throw new Error("configureWorkingCopies() was not called before a document was opened.");
	const error = await hooks.openPath(path);
	if (error) throw new Error("No app on this machine could open that file. Download a copy and open it from there.");
}

/** Opens a document's newest version in its default app: a working copy, or read only when it is signed. */
export async function openDocument(documentId: string, db: Db = getDb()): Promise<{ readOnly: boolean }> {
	const { path, readOnly } = await pathToOpen(documentId, db);
	await open(path);
	return { readOnly };
}

/** Opens one version in its default app. Anything but the newest is read only. */
export async function openVersion(versionId: string, db: Db = getDb()): Promise<{ readOnly: boolean }> {
	const { path, readOnly } = await versionPathToOpen(versionId, db);
	await open(path);
	return { readOnly };
}
