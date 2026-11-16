/**
 * Moving, duplicating, copying and renaming a document (decision 75).
 *
 * - **Move** puts a document in a folder, or directly in a place. A folder
 *   under another client or project relinks it through the owner rule
 *   (document-owner.ts), so the tree and the client's page agree.
 * - **Duplicate** makes a new document from the newest version, in the same
 *   place. **Copy to** does the same into another place. The file is copied on
 *   disk under a name the service builds, keeping its extension; the copy has
 *   one version and none of the original's history, signatures included. A
 *   page is copied with its blocks and its own copies of its pictures.
 * - **Rename** changes the title and nothing on disk.
 *
 * A duplicate of a document made from an unreviewed template, while there
 * were templates, is still a specimen, because what it says has not changed.
 *
 * No Electron import, so every rule here is covered by a test.
 */
import { and, eq, isNull } from "drizzle-orm";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extensionOf } from "../../shared/mime";
import type { DocumentMoveInput, DocumentPlace } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documents } from "../db/schema";
import { assertTitleFree, availableTitle, resolvePlace } from "./document-place";
import * as versions from "./document-versions";
import * as pages from "./pages";
import { documentStorageDir, fileNameFor, get, type DocumentRecord } from "./documents";

const MAX_TITLE = 200;

function requireDocument(id: string, db: Db) {
	const row = db
		.select()
		.from(documents)
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.get();
	if (!row) throw new Error("That document no longer exists.");
	return row;
}

async function read(id: string, db: Db): Promise<DocumentRecord> {
	const record = await get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	return record;
}

/** Keeps a document under another client or project, by the owner rule. */
export async function move(id: string, input: DocumentMoveInput, db: Db = getDb()): Promise<DocumentRecord> {
	const row = requireDocument(id, db);
	const place = resolvePlace(input, db);
	if (place.clientId !== row.clientId || place.projectId !== row.projectId) {
		assertTitleFree(place, row.title, db, id);
	}
	db.update(documents)
		.set({ clientId: place.clientId, projectId: place.projectId, updatedAt: now() })
		.where(eq(documents.id, id))
		.run();
	return read(id, db);
}

export async function rename(id: string, title: string, db: Db = getDb()): Promise<DocumentRecord> {
	const row = requireDocument(id, db);
	const clean = String(title ?? "").replace(/\s+/g, " ").trim();
	if (!clean) throw new Error("A document needs a name.");
	if (clean.length > MAX_TITLE) throw new Error(`A document name can be at most ${MAX_TITLE} characters. Shorten it.`);
	assertTitleFree(resolvePlace({ clientId: row.clientId, projectId: row.projectId }, db), clean, db, id);
	db.update(documents).set({ title: clean, updatedAt: now() }).where(eq(documents.id, id)).run();
	return read(id, db);
}

/** "Offerte (copy)", or the first of "Offerte (copy 2)" and on that is free in the place. */
function copyTitle(place: { clientId: string | null; projectId: string | null }, title: string, db: Db): string {
	const base = `${title} (copy)`;
	const candidate = availableTitle(place, base, db);
	return candidate === base ? base : candidate.replace(/\(copy\) \((\d+)\)$/, "(copy $1)");
}

async function copyInto(id: string, target: Partial<DocumentPlace>, sameTitleWhenFree: boolean, db: Db) {
	const row = requireDocument(id, db);
	const place = resolvePlace(target, db);
	const title =
		sameTitleWhenFree && availableTitle(place, row.title, db) === row.title.trim()
			? row.title.trim()
			: copyTitle(place, row.title.trim(), db);
	if (row.sourceKind === "page") return (await pages.copyPage(id, place, title, db)).document;

	const latest = versions.summaries([id], db).get(id)?.latest ?? null;
	const file = latest ? versions.fileOf(latest.id, db) : null;
	if (file && !existsSync(file.path)) {
		throw new Error(`The file of "${row.title}" is no longer on this machine, so it cannot be copied.`);
	}

	const stamp = now();
	let destination: string | null = null;
	if (file) {
		destination = join(documentStorageDir(), fileNameFor(title, "-kopie", extensionOf(file.fileName || file.path)));
		copyFileSync(file.path, destination);
	}

	const [created] = db
		.insert(documents)
		.values({
			clientId: place.clientId,
			projectId: place.projectId,
			templateId: row.templateId,
			templateVersion: row.templateVersion,
			title,
			statusId: row.statusId,
			bodyHtml: row.bodyHtml,
			variablesJson: row.variablesJson,
			issuedOn: row.issuedOn,
			pdfPath: destination,
			// What the copy says is what the original said, so an unreviewed
			// template's words stay a specimen in the copy too.
			isSpecimen: row.isSpecimen,
			sourceKind: row.sourceKind,
		})
		.returning()
		.all();

	if (file && destination) {
		const textContent = versions.textOf(file.versionId, db);
		versions.record(
			{
				documentId: created!.id,
				kind: file.kind === "generated" ? "generated" : "imported",
				source: "duplicate",
				pdfPath: destination,
				fileName: file.fileName,
				mediaType: file.mediaType,
				byteSize: versions.sizeOf(destination),
				fileDate: stamp,
				fileHash: file.fileHash,
				textContent,
			},
			db,
		);
	}
	return read(created!.id, db);
}

/** A new document from the newest version, in the same place, named "<title> (copy)". */
export async function duplicate(id: string, db: Db = getDb()): Promise<DocumentRecord> {
	const row = requireDocument(id, db);
	return copyInto(id, { clientId: row.clientId, projectId: row.projectId }, false, db);
}

/**
 * A new document from the newest version, in another client, project or
 * folder. It keeps its title when that is free there.
 */
export async function copyTo(id: string, target: DocumentMoveInput, db: Db = getDb()): Promise<DocumentRecord> {
	return copyInto(id, target, true, db);
}
