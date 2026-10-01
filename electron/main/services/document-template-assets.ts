/**
 * The pictures a document template carries.
 *
 * A mail template links its pictures, because a message that carries them
 * inline is a message that gets filed as spam (docs/editors.md). A document is
 * printed here, on this machine, so its pictures are real files: a logo, a
 * signature line, a photo. Each is copied into the assets folder under a name
 * built from its id, and the canvas names it as `{{asset.<key>}}`. When the
 * template is rendered the bytes are written into the document inline, so a
 * generated PDF and its frozen body never depend on a file that can move.
 *
 * A caller hands over a file name and bytes. It never names a path: the path
 * is built here, so nothing outside this module can steer a write.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import { assetKey, assetToken, assetUrl } from "../../shared/paper";
import type { DocumentTemplateAsset, DocumentTemplateAssetInput } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import { documentTemplateAssets, documentTemplates } from "../db/schema";

/** A logo is tens of kilobytes and a photo a few megabytes. Past this it is not a picture for a contract. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

let assetsDirectory = "";

export function configureTemplateAssets(directory: string): void {
	assetsDirectory = directory;
}

function assetsDir(): string {
	if (!assetsDirectory) throw new Error("configureTemplateAssets() was not called before a picture was stored.");
	if (!existsSync(assetsDirectory)) mkdirSync(assetsDirectory, { recursive: true });
	return assetsDirectory;
}

/**
 * The type a file really is, read from its first bytes rather than its name.
 * An SVG is not on the list: it is a document that can carry script, and a
 * picture in a contract has no need to be one.
 */
export function sniffImage(bytes: Uint8Array): { mime: string; extension: string } | null {
	const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", extension: "png" };
	if (starts(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", extension: "jpg" };
	if (starts(0x47, 0x49, 0x46, 0x38)) return { mime: "image/gif", extension: "gif" };
	if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
		return { mime: "image/webp", extension: "webp" };
	}
	return null;
}

type Row = typeof documentTemplateAssets.$inferSelect;

function toAsset(row: Row): DocumentTemplateAsset {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		templateId: row.templateId,
		fileName: row.fileName,
		mimeType: row.mimeType,
		byteSize: row.byteSize,
		token: assetToken(row.id),
		url: assetUrl(row.id),
	};
}

function cleanName(fileName: string): string {
	// Only for showing: the file on disk is named after the id.
	const printable = [...fileName].filter((char) => char.charCodeAt(0) >= 0x20).join("");
	return printable.replace(/[\\/]/g, "").trim().slice(0, 200) || "picture";
}

/**
 * Stores a picture for a template. The same bytes added to the same template
 * twice give back the picture it already has, so a canvas that pastes one logo
 * on every page holds one file.
 */
export async function add(input: DocumentTemplateAssetInput, db: Db = getDb()): Promise<DocumentTemplateAsset> {
	const template = db
		.select({ id: documentTemplates.id })
		.from(documentTemplates)
		.where(and(eq(documentTemplates.id, input.templateId), isNull(documentTemplates.deletedAt)))
		.get();
	if (!template) throw new Error("That template no longer exists.");

	const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data as ArrayLike<number>);
	if (bytes.byteLength === 0) throw new Error(`"${cleanName(input.fileName)}" is empty. Choose another picture.`);
	if (bytes.byteLength > MAX_ASSET_BYTES) {
		throw new Error(`"${cleanName(input.fileName)}" is larger than 10 MB. Make it smaller first.`);
	}
	const type = sniffImage(bytes);
	if (!type) {
		throw new Error(`"${cleanName(input.fileName)}" is not a PNG, JPEG, GIF or WebP picture. Save it as one of those first.`);
	}

	const fileHash = createHash("sha256").update(bytes).digest("hex");
	const existing = db
		.select()
		.from(documentTemplateAssets)
		.where(
			and(
				eq(documentTemplateAssets.templateId, input.templateId),
				eq(documentTemplateAssets.fileHash, fileHash),
				isNull(documentTemplateAssets.deletedAt),
			),
		)
		.get();
	if (existing && existsSync(join(assetsDir(), existing.relativePath))) return toAsset(existing);

	const id = uuidv7();
	const relativePath = `${id}.${type.extension}`;
	writeFileSync(join(assetsDir(), relativePath), bytes);

	const [row] = db
		.insert(documentTemplateAssets)
		.values({
			id,
			templateId: input.templateId,
			fileName: cleanName(input.fileName),
			mimeType: type.mime,
			byteSize: bytes.byteLength,
			fileHash,
			relativePath,
		})
		.returning()
		.all();
	return toAsset(row!);
}

export async function list(templateId: string, db: Db = getDb()): Promise<DocumentTemplateAsset[]> {
	return db
		.select()
		.from(documentTemplateAssets)
		.where(and(eq(documentTemplateAssets.templateId, templateId), isNull(documentTemplateAssets.deletedAt)))
		.orderBy(asc(documentTemplateAssets.createdAt), asc(documentTemplateAssets.id))
		.all()
		.map(toAsset);
}

/**
 * Takes a picture out of a template's list. The file stays on disk: a document
 * already generated carries its own copy, and a template restored from an undo
 * in the editor may still name it.
 */
export async function remove(id: string, db: Db = getDb()): Promise<DocumentTemplateAsset> {
	const [row] = db
		.update(documentTemplateAssets)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documentTemplateAssets.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That picture no longer exists.");
	return toAsset(row);
}

/**
 * The file behind an id and its type, for the app scheme to serve. Deleted
 * pictures still resolve: the editor's undo can bring back a block that names
 * one, and it should still draw.
 */
export function pathOf(id: string, db: Db = getDb()): { path: string; mimeType: string } {
	const row = db.select().from(documentTemplateAssets).where(eq(documentTemplateAssets.id, id)).get();
	if (!row) throw new Error("That picture no longer exists.");
	return { path: join(assetsDir(), row.relativePath), mimeType: row.mimeType };
}

/**
 * Every picture a template has ever had, as `data:` addresses keyed the way
 * `{{asset.<key>}}` names them, for rendering. Deleted ones are included for
 * the same reason as in `pathOf`. A file that has gone from disk is left out
 * and shows as a marked gap.
 */
export function dataUrls(templateId: string, db: Db = getDb()): Record<string, string> {
	const rows = db.select().from(documentTemplateAssets).where(eq(documentTemplateAssets.templateId, templateId)).all();
	const out: Record<string, string> = {};
	for (const row of rows) {
		const path = join(assetsDir(), row.relativePath);
		if (!existsSync(path)) continue;
		out[assetKey(row.id)] = `data:${row.mimeType};base64,${readFileSync(path).toString("base64")}`;
	}
	return out;
}
