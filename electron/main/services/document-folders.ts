/**
 * The documents tree (decision 75): a node per client holding a node per
 * project, a node per project of the owner's own, Unfiled, and Templates. Those
 * nodes are the owner rule drawn (decision 48) and are not rows. Inside any of
 * the first three the owner may make folders of their own, which are rows of
 * `document_folders`.
 *
 * A folder carries the place it sits in. Moving it to another place moves
 * everything in it there too, through the same owner rule, so a document is
 * never drawn under a client it is not kept under.
 *
 * Templates holds document templates, read from the templates service as they
 * are. A folder cannot be made there: templates have no folder, and the tables
 * they live in stay as they are.
 *
 * No Electron import, so every rule here is covered by a test.
 */
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type {
	DocumentFolder,
	DocumentFolderInput,
	DocumentFolderMove,
	DocumentTree,
	DocumentTreeNode,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, documentFolders, documents, projects } from "../db/schema";
import { resolveOwner } from "./document-owner";
import { assertTitleFree, folderRow } from "./document-place";
import * as templates from "./document-templates";

type Row = typeof documentFolders.$inferSelect;

const MAX_NAME = 120;

function toFolder(row: Row): DocumentFolder {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		name: row.name,
		parentId: row.parentId,
		clientId: row.clientId,
		projectId: row.projectId,
		sortOrder: row.sortOrder,
	};
}

function cleanName(name: string): string {
	const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
	if (!trimmed) throw new Error("A folder needs a name.");
	if (trimmed.length > MAX_NAME) throw new Error(`A folder name can be at most ${MAX_NAME} characters. Shorten it.`);
	return trimmed;
}

function liveFolders(db: Db): Row[] {
	return db.select().from(documentFolders).where(isNull(documentFolders.deletedAt)).all();
}

/** The folders that sit directly where this one would: the same parent, or the same place with no parent. */
function siblings(place: { parentId: string | null; clientId: string | null; projectId: string | null }, db: Db): Row[] {
	return liveFolders(db).filter((row) =>
		place.parentId
			? row.parentId === place.parentId
			: row.parentId === null && row.clientId === place.clientId && row.projectId === place.projectId,
	);
}

function assertNameFree(
	name: string,
	place: { parentId: string | null; clientId: string | null; projectId: string | null },
	db: Db,
	exceptId?: string,
): void {
	const wanted = name.toLowerCase();
	if (siblings(place, db).some((row) => row.id !== exceptId && row.name.toLowerCase() === wanted)) {
		throw new Error(`There is already a folder named "${name}" here. Give this one another name.`);
	}
}

/** Where a folder would sit: inside its parent's place, or the place given by the owner rule. */
function placeFor(
	input: { parentId?: string | null; clientId?: string | null; projectId?: string | null },
	db: Db,
): { parentId: string | null; clientId: string | null; projectId: string | null } {
	if (input.parentId) {
		const parent = folderRow(input.parentId, db);
		return { parentId: parent.id, clientId: parent.clientId, projectId: parent.projectId };
	}
	const owner = resolveOwner({ clientId: input.clientId, projectId: input.projectId }, db);
	return { parentId: null, clientId: owner.clientId, projectId: owner.projectId };
}

export async function list(db: Db = getDb()): Promise<DocumentFolder[]> {
	return liveFolders(db)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
		.map(toFolder);
}

export async function get(id: string, db: Db = getDb()): Promise<DocumentFolder | null> {
	const row = db
		.select()
		.from(documentFolders)
		.where(and(eq(documentFolders.id, id), isNull(documentFolders.deletedAt)))
		.get();
	return row ? toFolder(row) : null;
}

export async function create(input: DocumentFolderInput, db: Db = getDb()): Promise<DocumentFolder> {
	const name = cleanName(input.name);
	const place = placeFor(input, db);
	assertNameFree(name, place, db);
	const last = siblings(place, db).reduce((max, row) => Math.max(max, row.sortOrder), -1);
	const [row] = db
		.insert(documentFolders)
		.values({ name, ...place, sortOrder: last + 1 })
		.returning()
		.all();
	return toFolder(row!);
}

export async function rename(id: string, name: string, db: Db = getDb()): Promise<DocumentFolder> {
	const row = folderRow(id, db);
	const clean = cleanName(name);
	assertNameFree(clean, row, db, id);
	const [updated] = db
		.update(documentFolders)
		.set({ name: clean, updatedAt: now() })
		.where(eq(documentFolders.id, id))
		.returning()
		.all();
	return toFolder(updated!);
}

/** Every folder under this one, at any depth, not including itself. */
function descendantsOf(id: string, all: Row[]): Row[] {
	const out: Row[] = [];
	const queue = [id];
	while (queue.length > 0) {
		const parent = queue.shift()!;
		for (const row of all) {
			if (row.parentId === parent) {
				out.push(row);
				queue.push(row.id);
			}
		}
	}
	return out;
}

/**
 * Moves a folder into another folder, or directly into a place. When the place
 * changes, the folders inside it and every document in any of them move to
 * the new place too, in one transaction.
 */
export async function move(id: string, target: DocumentFolderMove, db: Db = getDb()): Promise<DocumentFolder> {
	const row = folderRow(id, db);
	if (target.parentId === id) throw new Error("A folder cannot be moved into itself.");
	const all = liveFolders(db);
	const inside = descendantsOf(id, all);
	if (target.parentId && inside.some((folder) => folder.id === target.parentId)) {
		throw new Error("A folder cannot be moved into a folder inside it. Pick a folder outside it.");
	}
	const place = placeFor(target, db);
	assertNameFree(row.name, place, db, id);
	const last = siblings(place, db)
		.filter((sibling) => sibling.id !== id)
		.reduce((max, sibling) => Math.max(max, sibling.sortOrder), -1);
	const stamp = now();
	const affected = [id, ...inside.map((folder) => folder.id)];

	// The documents go with the folder, so each title has to be free where
	// they land, by the same rule a single move or an import keeps (decision 48).
	if (place.clientId !== row.clientId || place.projectId !== row.projectId) {
		const owner = resolveOwner({ clientId: place.clientId, projectId: place.projectId }, db);
		const moving = db
			.select({ id: documents.id, title: documents.title })
			.from(documents)
			.where(and(inArray(documents.folderId, affected), isNull(documents.deletedAt)))
			.all();
		for (const document of moving) assertTitleFree(owner, document.title, db, document.id);
	}

	db.transaction((tx) => {
		tx.update(documentFolders)
			.set({ ...place, sortOrder: last + 1, updatedAt: stamp })
			.where(eq(documentFolders.id, id))
			.run();
		if (place.clientId !== row.clientId || place.projectId !== row.projectId) {
			tx.update(documentFolders)
				.set({ clientId: place.clientId, projectId: place.projectId, updatedAt: stamp })
				.where(inArray(documentFolders.id, affected))
				.run();
			tx.update(documents)
				.set({ clientId: place.clientId, projectId: place.projectId, updatedAt: stamp })
				.where(and(inArray(documents.folderId, affected), isNull(documents.deletedAt)))
				.run();
		}
	});
	return toFolder(folderRow(id, db));
}

/**
 * Soft deletes an empty folder. One that still holds documents or folders is
 * refused with what is in it, because deleting the contents with it is a
 * decision the person makes one document at a time.
 */
export async function remove(id: string, db: Db = getDb()): Promise<DocumentFolder> {
	const row = folderRow(id, db);
	const folders = siblings({ parentId: id, clientId: row.clientId, projectId: row.projectId }, db).length;
	const held =
		db
			.select({ n: count() })
			.from(documents)
			.where(and(eq(documents.folderId, id), isNull(documents.deletedAt)))
			.get()?.n ?? 0;
	if (folders > 0 || held > 0) {
		const parts = [
			held > 0 ? `${held} ${held === 1 ? "document" : "documents"}` : "",
			folders > 0 ? `${folders} ${folders === 1 ? "folder" : "folders"}` : "",
		].filter(Boolean);
		throw new Error(`"${row.name}" still holds ${parts.join(" and ")}. Move or delete them first.`);
	}
	const [updated] = db
		.update(documentFolders)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documentFolders.id, id))
		.returning()
		.all();
	return toFolder(updated!);
}

export async function restore(id: string, db: Db = getDb()): Promise<DocumentFolder> {
	const row = db.select().from(documentFolders).where(eq(documentFolders.id, id)).get();
	if (!row) throw new Error("That folder does not exist.");
	if (row.parentId) folderRow(row.parentId, db);
	// A folder of the same name may have been made beside it since.
	assertNameFree(row.name, row, db, id);
	db.update(documentFolders).set({ deletedAt: null, updatedAt: now() }).where(eq(documentFolders.id, id)).run();
	return toFolder(folderRow(id, db));
}

function placeKey(clientId: string | null, projectId: string | null, folderId: string | null): string {
	return `${clientId ?? ""}|${projectId ?? ""}|${folderId ?? ""}`;
}

/**
 * The whole tree, read in a handful of queries: clients, projects, folders and
 * one count of documents per place. Clients and projects sort by name, the
 * owner's folders by their order and then by name.
 */
export async function tree(db: Db = getDb()): Promise<DocumentTree> {
	const clientRows = db
		.select({ id: clients.id, name: clients.name })
		.from(clients)
		.where(isNull(clients.deletedAt))
		.all()
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
	const projectRows = db
		.select({ id: projects.id, name: projects.name, clientId: projects.clientId })
		.from(projects)
		.where(isNull(projects.deletedAt))
		.orderBy(asc(projects.name), asc(projects.id))
		.all()
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
	const folders = (await list(db)).filter((folder) => folder.deletedAt === null);

	const counts = new Map<string, number>();
	for (const row of db
		.select({
			clientId: documents.clientId,
			projectId: documents.projectId,
			folderId: documents.folderId,
			n: count(),
		})
		.from(documents)
		.where(isNull(documents.deletedAt))
		.groupBy(documents.clientId, documents.projectId, documents.folderId)
		.all()) {
		const key = row.folderId ? placeKey(null, null, row.folderId) : placeKey(row.clientId, row.projectId, null);
		counts.set(key, (counts.get(key) ?? 0) + row.n);
	}

	const folderNode = (folder: DocumentFolder): DocumentTreeNode => ({
		key: `folder:${folder.id}`,
		kind: "folder",
		name: folder.name,
		place: { clientId: folder.clientId, projectId: folder.projectId, folderId: folder.id },
		documentCount: counts.get(placeKey(null, null, folder.id)) ?? 0,
		folderId: folder.id,
		clientId: folder.clientId,
		projectId: folder.projectId,
		children: folders.filter((child) => child.parentId === folder.id).map(folderNode),
	});
	const foldersAt = (clientId: string | null, projectId: string | null) =>
		folders
			.filter((folder) => folder.parentId === null && folder.clientId === clientId && folder.projectId === projectId)
			.map(folderNode);
	const projectNode = (project: { id: string; name: string; clientId: string | null }): DocumentTreeNode => ({
		key: `project:${project.id}`,
		kind: "project",
		name: project.name,
		place: { clientId: project.clientId, projectId: project.id, folderId: null },
		documentCount: counts.get(placeKey(project.clientId, project.id, null)) ?? 0,
		folderId: null,
		clientId: project.clientId,
		projectId: project.id,
		children: foldersAt(project.clientId, project.id),
	});

	const clientIds = new Set(clientRows.map((client) => client.id));
	const roots: DocumentTreeNode[] = [
		...clientRows.map(
			(client): DocumentTreeNode => ({
				key: `client:${client.id}`,
				kind: "client",
				name: client.name,
				place: { clientId: client.id, projectId: null, folderId: null },
				documentCount: counts.get(placeKey(client.id, null, null)) ?? 0,
				folderId: null,
				clientId: client.id,
				projectId: null,
				children: [
					...projectRows.filter((project) => project.clientId === client.id).map(projectNode),
					...foldersAt(client.id, null),
				],
			}),
		),
		// A project of the owner's own has no client to sit under, so it sits at
		// the root, after the clients. One whose client is gone sits there too
		// rather than vanishing.
		...projectRows.filter((project) => !project.clientId || !clientIds.has(project.clientId)).map(projectNode),
		{
			key: "unfiled",
			kind: "unfiled",
			name: "Unfiled",
			place: { clientId: null, projectId: null, folderId: null },
			documentCount: counts.get(placeKey(null, null, null)) ?? 0,
			folderId: null,
			clientId: null,
			projectId: null,
			children: foldersAt(null, null),
		},
		{
			key: "templates",
			kind: "templates",
			name: "Templates",
			place: null,
			documentCount: 0,
			folderId: null,
			clientId: null,
			projectId: null,
			children: [],
		},
	];

	const templateEntries = (await templates.list(db)).map((template) => ({
		id: template.id,
		name: template.name,
		updatedAt: template.updatedAt,
		reviewedAt: template.reviewedAt,
		hasCanvas: template.canvas !== null,
	}));

	return { roots, templates: templateEntries };
}
