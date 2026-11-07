/**
 * Pages. A page is a document of kind `page` (decision 61): written in blocks
 * rather than generated from a template or imported as a PDF, and kept like any
 * other document, so its owner, its listing, its timeline and its delete are
 * the ones documents already have.
 *
 * The blocks are stored as JSON and `body_html` is compiled from them on every
 * save, so anything that reads a document's body keeps working. A page has no
 * PDF and no signature, and `documents.ts` is where it is listed and removed.
 */
import { and, eq, isNull } from "drizzle-orm";
import { blocksToHtml, cleanBlocks, newBlockId, type Block } from "../../shared/blocks";
import type { PageDetail, PageInput, PagePatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documents } from "../db/schema";
import { resolveOwner } from "./document-owner";
import * as docs from "./documents";

const MAX_TITLE = 300;

function cleanTitle(value: unknown): string {
	if (typeof value !== "string") throw new Error("A page title is text.");
	const title = value.replace(/\s+/g, " ").trim();
	if (title.length > MAX_TITLE) throw new Error(`A page title can be at most ${MAX_TITLE} characters.`);
	return title;
}

/** A new page starts with one empty line to type in, which is what the editor shows. */
function emptyBlocks(): Block[] {
	return [{ id: newBlockId(), type: "text", text: "" }];
}

function readBlocks(json: string | null): Block[] {
	if (!json) return [];
	try {
		return cleanBlocks(JSON.parse(json));
	} catch {
		return [];
	}
}

export async function create(input: PageInput = {}, db: Db = getDb()): Promise<PageDetail> {
	const title = input.title === undefined ? "Untitled page" : cleanTitle(input.title) || "Untitled page";
	const blocks = input.blocks === undefined ? emptyBlocks() : cleanBlocks(input.blocks);
	const owner = resolveOwner(input, db);
	const stamp = now();
	const row = db
		.insert(documents)
		.values({
			clientId: owner.clientId,
			projectId: owner.projectId,
			title,
			bodyHtml: blocksToHtml(blocks),
			blocksJson: JSON.stringify(blocks),
			isSpecimen: false,
			sourceKind: "page",
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get();
	return get(row.id, db);
}

export async function get(id: string, db: Db = getDb()): Promise<PageDetail> {
	const row = db
		.select()
		.from(documents)
		.where(and(eq(documents.id, id), isNull(documents.deletedAt), eq(documents.sourceKind, "page")))
		.get();
	if (!row) throw new Error(`No page with id "${id}". It may have been deleted, or it is not a page.`);
	const record = await docs.get(id, db);
	if (!record) throw new Error(`No page with id "${id}". It may have been deleted.`);
	return { document: record, blocks: readBlocks(row.blocksJson) };
}

/** Fields left out are untouched. Saved as it is typed, so there is no draft. */
export async function update(id: string, patch: PagePatch, db: Db = getDb()): Promise<PageDetail> {
	const current = await get(id, db);
	const set: Partial<typeof documents.$inferInsert> = { updatedAt: now() };
	if (patch.title !== undefined) set.title = cleanTitle(patch.title) || "Untitled page";
	if (patch.blocks !== undefined) {
		const blocks = cleanBlocks(patch.blocks);
		set.blocksJson = JSON.stringify(blocks);
		set.bodyHtml = blocksToHtml(blocks);
	}
	if (patch.clientId !== undefined || patch.projectId !== undefined) {
		const owner = resolveOwner(
			{
				clientId: patch.clientId !== undefined ? patch.clientId : current.document.clientId,
				projectId: patch.projectId !== undefined ? patch.projectId : current.document.projectId,
			},
			db,
		);
		set.clientId = owner.clientId;
		set.projectId = owner.projectId;
	}
	db.update(documents)
		.set(set)
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.run();
	return get(id, db);
}
