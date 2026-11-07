/**
 * The pictures in a page.
 *
 * A page's image is a file, kept like any other document file: under the
 * documents folder, which sits in the user data root and goes into a backup
 * with it, in a folder named for the page. The block stores the relative path
 * (`pages/<page id>/<file>`) and never the bytes, so a page stays small and a
 * file can be seen in the folder.
 *
 * A caller hands over a file name and bytes. It never names a path: the name
 * on disk is built here from a fresh id and an extension read from the bytes
 * themselves, so nothing outside this module can steer a write or a read. A
 * page that is deleted keeps its pictures, the way a deleted document keeps its
 * file, because the delete can be undone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { IMAGE_PATH, newBlockId, type ImageBlock } from "../../shared/blocks";
import { getDb, type Db } from "../db";
import { uuidv7 } from "../db/columns";
import { documents } from "../db/schema";
import { documentStorageDir } from "./documents";
import { MAX_ASSET_BYTES, sniffImage } from "./document-template-assets";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function pageFolder(pageId: string): string {
	const root = resolve(documentStorageDir(), "pages");
	const folder = resolve(root, pageId);
	if (!folder.startsWith(root + sep)) throw new Error("That is not a page.");
	return folder;
}

/** The absolute path of a block's picture, checked to be inside that page's folder. */
export function absolutePath(relative: string): string {
	const match = IMAGE_PATH.exec(relative);
	if (!match) throw new Error("That is not a picture Juno keeps for a page.");
	const file = resolve(pageFolder(match[1]!), match[2]!);
	if (!file.startsWith(pageFolder(match[1]!) + sep)) throw new Error("That is not a picture Juno keeps for a page.");
	return file;
}

/** Whether a block's picture is still on this machine. */
export function exists(relative: string): boolean {
	try {
		return existsSync(absolutePath(relative));
	} catch {
		return false;
	}
}

/** The file a url like app://asset/page/<page>/<name> asks for, with its type. Throws for anything else. */
export function serve(pageId: string, name: string): { path: string; mimeType: string } {
	const relative = `pages/${pageId}/${name}`;
	const path = absolutePath(relative);
	if (!existsSync(path)) throw new Error("That picture is no longer on this machine.");
	return { path, mimeType: MIME[name.slice(name.lastIndexOf(".") + 1)] ?? "application/octet-stream" };
}

/**
 * Keeps a picture for a page and returns the block that shows it. The type is
 * read from the bytes, an SVG is refused (it can carry script), and the size is
 * capped like a template's picture.
 */
export function store(
	pageId: string,
	input: { fileName: string; data: Uint8Array },
	db: Db = getDb(),
): ImageBlock {
	const page = db
		.select({ id: documents.id })
		.from(documents)
		.where(and(eq(documents.id, pageId), isNull(documents.deletedAt), eq(documents.sourceKind, "page")))
		.get();
	if (!page) throw new Error("That page no longer exists, so the picture has nowhere to go.");
	if (input.data.byteLength > MAX_ASSET_BYTES) throw new Error("That picture is larger than 10 MB. Shrink it first.");
	const kind = sniffImage(input.data);
	if (!kind) throw new Error("A page can hold a PNG, JPEG, GIF or WebP picture. That file is none of them.");

	const folder = pageFolder(pageId);
	mkdirSync(folder, { recursive: true });
	const name = `${uuidv7()}.${kind.extension}`;
	writeFileSync(join(folder, name), input.data);
	const label = input.fileName.replace(/\.[^.]+$/, "").replace(/[<>"]/g, "").trim().slice(0, 100);
	return { id: newBlockId(), type: "image", path: `pages/${pageId}/${name}`, alt: label };
}

/** The bytes behind a block, for a page that is exported or checked. Null when the file has gone. */
export function read(relative: string): Uint8Array | null {
	try {
		return new Uint8Array(readFileSync(absolutePath(relative)));
	} catch {
		return null;
	}
}
