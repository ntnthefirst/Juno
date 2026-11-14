/**
 * Where a document is kept: a client, a project, both or neither, by the owner
 * rule (decision 48, document-owner.ts). There are no folders (decision 81):
 * the place is the record, and a document is listed on that record's
 * Documents tab.
 *
 * Titles are unique within a place (decision 48). That is what keeps the
 * same-name match of an incoming file meaningful wherever it is dropped.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documents } from "../db/schema";
import { resolveOwner, type DocumentOwner } from "./document-owner";

export type ResolvedPlace = DocumentOwner;

export function resolvePlace(input: { clientId?: string | null; projectId?: string | null }, db: Db = getDb()): ResolvedPlace {
	return resolveOwner({ clientId: input.clientId, projectId: input.projectId }, db);
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
export function assertTitleFree(place: ResolvedPlace, title: string, db: Db, exceptId?: string): void {
	if (documentTitled(place, title, db, exceptId)) {
		const where = place.clientName ?? place.projectName;
		throw new Error(
			`${where ? `${where} already has` : "There is already"} a document named "${title}". Add the file as a new version of it, or give it another name.`,
		);
	}
}

/**
 * Brings a project's documents under the client the project has now. A
 * project's documents are kept under its client by the owner rule (decision
 * 48), so when the project changes client they follow it, or the old client's
 * tab would still list them and the new one would not. Call it in the
 * transaction that changed the project. Refused, before anything is written,
 * when the new client already has a document of the same title.
 */
export function carryProjectToClient(projectId: string, db: Db = getDb()): void {
	const owner = resolveOwner({ projectId }, db);
	const stamp = now();
	db.transaction((tx) => {
		const live = tx
			.select({ title: documents.title })
			.from(documents)
			.where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
			.all();
		for (const { title } of live) {
			if (documentTitled(owner, title, tx)) {
				const where = owner.clientName ?? `"${owner.projectName}"`;
				throw new Error(
					`${where} already has a document named "${title}". Rename one of the two, then change the client of "${owner.projectName}".`,
				);
			}
		}
		tx.update(documents)
			.set({ clientId: owner.clientId, updatedAt: stamp })
			.where(eq(documents.projectId, projectId))
			.run();
	});
}
