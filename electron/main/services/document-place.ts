/**
 * Where a document is kept, as the tree draws it (decision 75): a client, a
 * project, both or neither, by the owner rule (decision 48, document-owner.ts),
 * and optionally a folder the owner made inside that place.
 *
 * A folder carries its place, so naming a folder decides the client and the
 * project too; naming a folder and a different client is refused, the way
 * naming a project and a client it does not belong to is.
 *
 * Titles are unique within a place (decision 48), not within a folder: two
 * folders of one client still hold one "Offerte". That is what keeps the
 * same-name match of an incoming file meaningful wherever it is dropped.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { documentFolders, documents } from "../db/schema";
import { resolveOwner, type DocumentOwner } from "./document-owner";

export interface ResolvedPlace extends DocumentOwner {
	folderId: string | null;
}

export function folderRow(folderId: string, db: Db = getDb()) {
	const row = db
		.select()
		.from(documentFolders)
		.where(and(eq(documentFolders.id, folderId), isNull(documentFolders.deletedAt)))
		.get();
	if (!row) throw new Error("That folder no longer exists. Pick another one.");
	return row;
}

export function resolvePlace(
	input: { clientId?: string | null; projectId?: string | null; folderId?: string | null },
	db: Db = getDb(),
): ResolvedPlace {
	if (input.folderId) {
		const folder = folderRow(input.folderId, db);
		const clashes =
			(input.clientId !== undefined && input.clientId !== null && input.clientId !== folder.clientId) ||
			(input.projectId !== undefined && input.projectId !== null && input.projectId !== folder.projectId);
		if (clashes) {
			throw new Error("That folder is kept under another client or project. Pick the folder alone, or another folder.");
		}
		const owner = resolveOwner({ clientId: folder.clientId, projectId: folder.projectId }, db);
		return { ...owner, folderId: folder.id };
	}
	return { ...resolveOwner({ clientId: input.clientId, projectId: input.projectId }, db), folderId: null };
}

/**
 * The live document with this title in the same place: under the same client,
 * or, for one with no client, under the same project, or among the documents
 * kept under nothing. Compared the way a person would: trimmed, any case.
 */
export function documentTitled(
	place: { clientId: string | null; projectId: string | null },
	title: string,
	db: Db = getDb(),
	exceptId?: string,
): { id: string; title: string } | null {
	const wanted = title.trim().toLowerCase();
	const where = place.clientId
		? eq(documents.clientId, place.clientId)
		: place.projectId
			? and(isNull(documents.clientId), eq(documents.projectId, place.projectId))
			: and(isNull(documents.clientId), isNull(documents.projectId));
	return (
		db
			.select({ id: documents.id, title: documents.title })
			.from(documents)
			.where(and(where, isNull(documents.deletedAt)))
			.all()
			.find((row) => row.id !== exceptId && row.title.trim().toLowerCase() === wanted) ?? null
	);
}

/** The title, or the first of "title (2)", "title (3)" and on that is free in the place. */
export function availableTitle(
	place: { clientId: string | null; projectId: string | null },
	title: string,
	db: Db = getDb(),
): string {
	const base = title.trim() || "Document";
	if (!documentTitled(place, base, db)) return base;
	for (let n = 2; n < 1000; n += 1) {
		const candidate = `${base} (${n})`;
		if (!documentTitled(place, candidate, db)) return candidate;
	}
	return `${base} (${Date.now()})`;
}

/** Throws the sentence decision 48 asks for when the title is taken in the place. */
export function assertTitleFree(place: ResolvedPlace | DocumentOwner, title: string, db: Db, exceptId?: string): void {
	if (documentTitled(place, title, db, exceptId)) {
		const where = place.clientName ?? place.projectName;
		throw new Error(
			`${where ? `${where} already has` : "There is already"} a document named "${title}". Add the file as a new version of it, or give it another name.`,
		);
	}
}
