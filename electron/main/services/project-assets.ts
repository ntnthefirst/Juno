/**
 * The files that belong to a project: screenshots, exports, briefs, a video of
 * the thing working.
 *
 * Two ways to hold one, and the difference is the whole point of the three-dot
 * menu:
 *
 * - **Managed.** The file is copied into the project's folder and Juno owns it.
 *   It moves when the folder moves, it is backed up with the folder, and
 *   deleting the row deletes the file.
 * - **Linked.** The file stays where it is and the row points at it. Nothing is
 *   copied, which is what a four-gigabyte render wants, and deleting the row
 *   leaves the file alone. The cost is that moving the original breaks the row,
 *   which is why `exists` is on every asset that comes out of here.
 *
 * A caller names a project and a source file. It never names a destination: the
 * path inside the project folder is built here, from the project's id, so
 * nothing outside this module can steer a write.
 */
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { copyFileSync, existsSync, rmSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import type {
	ProjectAsset,
	ProjectAssetKind,
	ProjectAssetPatch,
	ProjectAssetStorage,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { projectAssets, projects } from "../db/schema";
import { ensureFolder, folderFor, resolveInside, uniqueNameIn } from "./project-storage";
import { requireProject } from "./projects";

/**
 * Extension to kind and media type. Deliberately short: this decides whether a
 * thumbnail is attempted and which placeholder is drawn, not what the file is.
 * Guessing wrong costs a generic icon, so the list does not need to be complete.
 */
const TYPES: Record<string, { kind: ProjectAssetKind; mime: string }> = {
	".png": { kind: "image", mime: "image/png" },
	".jpg": { kind: "image", mime: "image/jpeg" },
	".jpeg": { kind: "image", mime: "image/jpeg" },
	".gif": { kind: "image", mime: "image/gif" },
	".webp": { kind: "image", mime: "image/webp" },
	".avif": { kind: "image", mime: "image/avif" },
	".bmp": { kind: "image", mime: "image/bmp" },
	".svg": { kind: "image", mime: "image/svg+xml" },
	".pdf": { kind: "pdf", mime: "application/pdf" },
	".mp4": { kind: "video", mime: "video/mp4" },
	".mov": { kind: "video", mime: "video/quicktime" },
	".webm": { kind: "video", mime: "video/webm" },
	".mp3": { kind: "audio", mime: "audio/mpeg" },
	".wav": { kind: "audio", mime: "audio/wav" },
	".m4a": { kind: "audio", mime: "audio/mp4" },
	".zip": { kind: "archive", mime: "application/zip" },
	".rar": { kind: "archive", mime: "application/vnd.rar" },
	".7z": { kind: "archive", mime: "application/x-7z-compressed" },
};

export function classify(fileName: string): { kind: ProjectAssetKind; mime: string | null } {
	const found = TYPES[extname(fileName).toLowerCase()];
	return found ? { kind: found.kind, mime: found.mime } : { kind: "file", mime: null };
}

/**
 * An SVG is an image and also a document that can carry script. It is never
 * served to the renderer as a picture for that reason; it gets the file
 * placeholder and opens in the system viewer like any other document.
 */
export function previewable(asset: { kind: ProjectAssetKind; mimeType: string | null }): boolean {
	return asset.kind === "image" && asset.mimeType !== "image/svg+xml";
}

type Row = typeof projectAssets.$inferSelect;

function toAsset(row: Row, folder: string): ProjectAsset {
	const absolutePath =
		row.storage === "managed" ? resolveInside(folder, row.path) : row.path;
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		projectId: row.projectId,
		fileName: row.fileName,
		storage: row.storage as ProjectAssetStorage,
		path: row.path,
		byteSize: row.byteSize,
		mimeType: row.mimeType,
		kind: row.kind as ProjectAssetKind,
		caption: row.caption,
		sortOrder: row.sortOrder,
		absolutePath,
		exists: existsSync(absolutePath),
	};
}

function folderOf(projectId: string, db: Db): string {
	return folderFor(requireProject(projectId, db));
}

export async function listForProject(projectId: string, db: Db = getDb()): Promise<ProjectAsset[]> {
	const folder = folderOf(projectId, db);
	const rows = db
		.select()
		.from(projectAssets)
		.where(and(eq(projectAssets.projectId, projectId), isNull(projectAssets.deletedAt)))
		.orderBy(asc(projectAssets.sortOrder), asc(projectAssets.id))
		.all() as Row[];
	return rows.map((row) => toAsset(row, folder));
}

export async function get(id: string, db: Db = getDb()): Promise<ProjectAsset | null> {
	const row = db
		.select()
		.from(projectAssets)
		.where(and(eq(projectAssets.id, id), isNull(projectAssets.deletedAt)))
		.get() as Row | undefined;
	if (!row) return null;
	return toAsset(row, folderOf(row.projectId, db));
}

export interface AddAssetInput {
	projectId: string;
	/** An absolute path to a file that exists on this machine. */
	sourcePath: string;
	/** managed copies it in, linked points at it where it is. */
	storage?: ProjectAssetStorage;
	/** What to call it on screen. Defaults to the file's own name. */
	fileName?: string;
	caption?: string | null;
}

function nextSortOrder(projectId: string, db: Db): number {
	const row = db
		.select({ highest: max(projectAssets.sortOrder) })
		.from(projectAssets)
		.where(and(eq(projectAssets.projectId, projectId), isNull(projectAssets.deletedAt)))
		.get();
	return (row?.highest ?? -1) + 1;
}

/**
 * Brings a file in. The file is copied before the row is written, so a failed
 * copy leaves no record of a file that is not there.
 */
export async function add(input: AddAssetInput, db: Db = getDb()): Promise<ProjectAsset> {
	const project = requireProject(input.projectId, db);
	const source = input.sourcePath?.trim() ?? "";
	if (!source) throw new Error("Pick a file to add.");
	if (!isAbsolute(source)) throw new Error("Give the full path to the file.");
	if (!existsSync(source)) throw new Error(`There is no file at ${source}.`);

	const stat = statSync(source);
	if (!stat.isFile()) throw new Error(`${source} is a folder, not a file. Add it as a link instead.`);

	const displayName = (input.fileName ?? basename(source)).trim() || basename(source);
	const storage: ProjectAssetStorage = input.storage === "linked" ? "linked" : "managed";
	const folder = folderFor(project);
	let path = source;

	if (storage === "managed") {
		ensureFolder(folder);
		const name = uniqueNameIn(folder, basename(source));
		copyFileSync(source, join(folder, name));
		path = name;
	}

	const type = classify(displayName);
	return toAsset(
		db
			.insert(projectAssets)
			.values({
				projectId: project.id,
				fileName: displayName,
				storage,
				path,
				byteSize: stat.size,
				mimeType: type.mime,
				kind: type.kind,
				caption: input.caption ?? null,
				sortOrder: nextSortOrder(project.id, db),
			})
			.returning()
			.get() as Row,
		folder,
	);
}

export async function update(
	id: string,
	patch: ProjectAssetPatch,
	db: Db = getDb(),
): Promise<ProjectAsset> {
	const values: Partial<typeof projectAssets.$inferInsert> = { updatedAt: now() };
	if (patch.fileName !== undefined) {
		const name = patch.fileName.trim();
		if (!name) throw new Error("A file needs a name.");
		values.fileName = name;
		// The name on screen changed, and with it what kind of file the list
		// believes this is. The file on disk keeps the name it was copied under.
		const type = classify(name);
		values.kind = type.kind;
		values.mimeType = type.mime;
	}
	if (patch.caption !== undefined) values.caption = patch.caption;
	if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

	const row = db
		.update(projectAssets)
		.set(values)
		.where(and(eq(projectAssets.id, id), isNull(projectAssets.deletedAt)))
		.returning()
		.get() as Row | undefined;
	if (!row) throw new Error(`No file with id "${id}" to update. It may have been deleted.`);
	return toAsset(row, folderOf(row.projectId, db));
}

/**
 * Soft deletes the row. A managed file stays on disk until `purge`, because a
 * delete with an undo behind it must be undoable, and a file that is gone is
 * not. A linked file is never touched here or anywhere else.
 */
export async function remove(id: string, db: Db = getDb()): Promise<ProjectAsset> {
	const stamp = now();
	const row = db
		.update(projectAssets)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(projectAssets.id, id), isNull(projectAssets.deletedAt)))
		.returning()
		.get() as Row | undefined;
	if (!row) throw new Error(`No file with id "${id}" to delete. It may already be deleted.`);

	// A cover that just went is a card with a hole in it on the next read.
	db.update(projects)
		.set({ coverAssetId: null, updatedAt: stamp })
		.where(and(eq(projects.id, row.projectId), eq(projects.coverAssetId, row.id)))
		.run();

	return toAsset(row, folderOf(row.projectId, db));
}

export async function restore(id: string, db: Db = getDb()): Promise<ProjectAsset> {
	const row = db
		.update(projectAssets)
		.set({ deletedAt: null, updatedAt: now() })
		.where(eq(projectAssets.id, id))
		.returning()
		.get() as Row | undefined;
	if (!row) throw new Error(`No file with id "${id}" to restore.`);
	return toAsset(row, folderOf(row.projectId, db));
}

/**
 * Deletes the file behind a soft-deleted managed asset, and the row with it.
 *
 * This is the real delete, and it is separate because everything else in Juno
 * can be undone. Nothing calls it on a timer.
 */
export async function purge(id: string, db: Db = getDb()): Promise<void> {
	const row = db.select().from(projectAssets).where(eq(projectAssets.id, id)).get() as
		| Row
		| undefined;
	if (!row) return;

	if (row.storage === "managed") {
		const path = resolveInside(folderOf(row.projectId, db), row.path);
		rmSync(path, { force: true });
	}
	db.delete(projectAssets).where(eq(projectAssets.id, id)).run();
}

export async function reorder(
	projectId: string,
	orderedIds: string[],
	db: Db = getDb(),
): Promise<ProjectAsset[]> {
	const stamp = now();
	db.transaction((tx) => {
		orderedIds.forEach((id, index) => {
			tx.update(projectAssets)
				.set({ sortOrder: index, updatedAt: stamp })
				.where(and(eq(projectAssets.id, id), eq(projectAssets.projectId, projectId)))
				.run();
		});
	});
	return listForProject(projectId, db);
}

/**
 * The absolute path behind an asset, for the scheme handler and for opening one
 * in the system viewer. Throws rather than returning a missing path, so a caller
 * cannot pass "" to `shell.openPath` and get a silent nothing.
 */
export function pathOf(id: string, db: Db = getDb()): { path: string; mimeType: string | null } {
	const row = db
		.select()
		.from(projectAssets)
		.where(and(eq(projectAssets.id, id), isNull(projectAssets.deletedAt)))
		.get() as Row | undefined;
	if (!row) throw new Error("That file is no longer in this project.");

	const asset = toAsset(row, folderOf(row.projectId, db));
	if (!asset.exists) {
		throw new Error(
			asset.storage === "linked"
				? `${asset.fileName} is not at ${asset.absolutePath} any more. It may have been moved.`
				: `${asset.fileName} is missing from the project's folder.`,
		);
	}
	return { path: asset.absolutePath, mimeType: asset.mimeType };
}
