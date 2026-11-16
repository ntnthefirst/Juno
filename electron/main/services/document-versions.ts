/**
 * The files a document has been, oldest to newest.
 *
 * A version is never replaced and never edited. Generating, importing, stamping
 * and signing each add one, and the document's `pdf_path` always follows the
 * newest, so everything that opens, sends or signs a document gets the latest
 * file without knowing versions exist.
 *
 * Newest is decided by `file_date`, then by when the row was written, then by
 * id, which is a UUIDv7 and so breaks the last tie in creation order
 * (.claude/rules/data.md section 2).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type {
	DigitalSignatureInfo,
	DocumentLatestVersion,
	DocumentVersion,
	DocumentVersionKind,
	DocumentVersionSource,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documentSignatures, documentVersions, documents } from "../db/schema";

type Row = typeof documentVersions.$inferSelect;

export interface NewVersion {
	documentId: string;
	kind: DocumentVersionKind;
	source: DocumentVersionSource;
	pdfPath: string;
	fileDate: string;
	fileName?: string | null;
	/** Defaults to a PDF, which is what every caller wrote before any file could be a version. */
	mediaType?: string | null;
	byteSize?: number | null;
	fileHash?: string | null;
	textContent?: string | null;
	signatureId?: string | null;
	mailAttachmentId?: string | null;
}

export interface VersionSummary {
	count: number;
	latest: DocumentLatestVersion;
}

export const PDF = "application/pdf";

export function hashBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Oldest first. The same order every caller sees, so a number means one thing. */
function byAge(a: Pick<Row, "fileDate" | "createdAt" | "id">, b: Pick<Row, "fileDate" | "createdAt" | "id">): number {
	return (
		a.fileDate.localeCompare(b.fileDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
	);
}

/** Live rows for some documents, without the text, which can be long and is only for matching. */
function liveRows(documentIds: string[], db: Db) {
	if (documentIds.length === 0) return [];
	return db
		.select({
			id: documentVersions.id,
			documentId: documentVersions.documentId,
			kind: documentVersions.kind,
			fileDate: documentVersions.fileDate,
			createdAt: documentVersions.createdAt,
			pdfPath: documentVersions.pdfPath,
			fileName: documentVersions.fileName,
			mediaType: documentVersions.mediaType,
			byteSize: documentVersions.byteSize,
		})
		.from(documentVersions)
		.where(and(inArray(documentVersions.documentId, documentIds), isNull(documentVersions.deletedAt)))
		.all();
}

export function summaries(documentIds: string[], db: Db = getDb()): Map<string, VersionSummary> {
	const grouped = new Map<string, ReturnType<typeof liveRows>>();
	for (const row of liveRows(documentIds, db)) {
		const list = grouped.get(row.documentId) ?? [];
		list.push(row);
		grouped.set(row.documentId, list);
	}
	const out = new Map<string, VersionSummary>();
	for (const [documentId, rows] of grouped) {
		const latest = rows.sort(byAge).at(-1)!;
		out.set(documentId, {
			count: rows.length,
			latest: {
				id: latest.id,
				kind: latest.kind as DocumentVersionKind,
				fileDate: latest.fileDate,
				fileName: latest.fileName,
				mediaType: latest.mediaType ?? PDF,
				byteSize: latest.byteSize,
			},
		});
	}
	return out;
}

/** Points the document at its newest version. Called after every change to the set. */
export function refreshLatest(documentId: string, db: Db = getDb()): void {
	const latest = liveRows([documentId], db).sort(byAge).at(-1);
	db.update(documents)
		.set({ pdfPath: latest?.pdfPath ?? null, updatedAt: now() })
		.where(eq(documents.id, documentId))
		.run();
}

export function record(input: NewVersion, db: Db = getDb()): DocumentVersion {
	const [row] = db
		.insert(documentVersions)
		.values({
			documentId: input.documentId,
			kind: input.kind,
			source: input.source,
			pdfPath: input.pdfPath,
			fileDate: input.fileDate,
			fileName: input.fileName ?? null,
			mediaType: input.mediaType ?? PDF,
			byteSize: input.byteSize ?? null,
			fileHash: input.fileHash ?? null,
			textContent: input.textContent ?? null,
			signatureId: input.signatureId ?? null,
			mailAttachmentId: input.mailAttachmentId ?? null,
		})
		.returning()
		.all();
	refreshLatest(input.documentId, db);
	const created = list(input.documentId, db).find((version) => version.id === row!.id);
	if (!created) throw new Error("The version was written but could not be read back.");
	return created;
}

function digitalOf(auditJson: string | null): DigitalSignatureInfo | null {
	if (!auditJson) return null;
	try {
		return (JSON.parse(auditJson) as { digital?: DigitalSignatureInfo | null }).digital ?? null;
	} catch {
		return null;
	}
}

/** Newest first, numbered from the oldest. */
export function list(documentId: string, db: Db = getDb()): DocumentVersion[] {
	const rows = db
		.select({ version: documentVersions, signature: documentSignatures })
		.from(documentVersions)
		.leftJoin(documentSignatures, eq(documentVersions.signatureId, documentSignatures.id))
		.where(and(eq(documentVersions.documentId, documentId), isNull(documentVersions.deletedAt)))
		.all()
		.sort((a, b) => byAge(a.version, b.version));

	return rows
		.map(({ version, signature }, index): DocumentVersion => ({
			id: version.id,
			ownerId: version.ownerId,
			createdAt: version.createdAt,
			updatedAt: version.updatedAt,
			deletedAt: version.deletedAt,
			documentId: version.documentId,
			kind: version.kind as DocumentVersionKind,
			source: version.source as DocumentVersionSource,
			fileName: version.fileName,
			mediaType: version.mediaType ?? PDF,
			byteSize: version.byteSize,
			fileDate: version.fileDate,
			fileHash: version.fileHash,
			signatureId: version.signatureId,
			mailAttachmentId: version.mailAttachmentId,
			number: index + 1,
			isLatest: index === rows.length - 1,
			signerName: signature?.signerName ?? null,
			digital: signature ? digitalOf(signature.auditJson) : null,
			hasCertificate: Boolean(signature?.certificatePdfPath),
		}))
		.reverse();
}

/** One version with its number and whether it is the newest, and the document's other versions counted. */
export function get(versionId: string, db: Db = getDb()): { version: DocumentVersion; total: number } {
	const row = db
		.select({ documentId: documentVersions.documentId })
		.from(documentVersions)
		.where(and(eq(documentVersions.id, versionId), isNull(documentVersions.deletedAt)))
		.get();
	if (!row) throw new Error("That version no longer exists.");
	const all = list(row.documentId, db);
	const version = all.find((candidate) => candidate.id === versionId);
	if (!version) throw new Error("That version no longer exists.");
	return { version, total: all.length };
}

/**
 * Soft deletes one version and points the document at what is now newest. The
 * file stays on disk. The last version cannot go: a document with no file is
 * deleted as a document instead.
 */
export function remove(versionId: string, db: Db = getDb()): DocumentVersion {
	const { version, total } = get(versionId, db);
	if (total <= 1) {
		throw new Error("This is the only version. Delete the document instead.");
	}
	db.update(documentVersions)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documentVersions.id, versionId))
		.run();
	refreshLatest(version.documentId, db);
	return version;
}

/** The file behind one version, resolved from its id. */
export function pathOf(versionId: string, db: Db = getDb()): string {
	const row = db
		.select({ pdfPath: documentVersions.pdfPath })
		.from(documentVersions)
		.where(and(eq(documentVersions.id, versionId), isNull(documentVersions.deletedAt)))
		.get();
	if (!row) throw new Error("That version no longer exists.");
	return row.pdfPath;
}

export interface VersionFile {
	versionId: string;
	documentId: string;
	path: string;
	/** The name the file arrived with, or one made from the stored file's own. */
	fileName: string;
	mediaType: string;
	kind: DocumentVersionKind;
	fileDate: string;
	fileHash: string | null;
}

/** The file behind one version with what is known about it, resolved from its id. */
export function fileOf(versionId: string, db: Db = getDb()): VersionFile {
	const row = db
		.select()
		.from(documentVersions)
		.where(and(eq(documentVersions.id, versionId), isNull(documentVersions.deletedAt)))
		.get();
	if (!row) throw new Error("That version no longer exists.");
	return {
		versionId: row.id,
		documentId: row.documentId,
		path: row.pdfPath,
		fileName: row.fileName ?? row.pdfPath.split(/[\\/]/).pop() ?? "Document.pdf",
		mediaType: row.mediaType ?? PDF,
		kind: row.kind as DocumentVersionKind,
		fileDate: row.fileDate,
		fileHash: row.fileHash,
	};
}

/** The words recorded for a version, for a copy that says the same thing. */
export function textOf(versionId: string, db: Db = getDb()): string | null {
	return (
		db
			.select({ text: documentVersions.textContent })
			.from(documentVersions)
			.where(eq(documentVersions.id, versionId))
			.get()?.text ?? null
	);
}

/** A file's size in bytes, or null when it cannot be read. */
export function sizeOf(path: string): number | null {
	try {
		return statSync(path).size;
	} catch {
		return null;
	}
}

/** The newest version of a document as a file. Throws for a document with no file yet. */
export function latestFileOf(documentId: string, db: Db = getDb()): VersionFile {
	const latest = summaries([documentId], db).get(documentId)?.latest;
	if (!latest) throw new Error("This document has no file yet. Create one first.");
	return fileOf(latest.id, db);
}

/** The certificate beside one signed version. Older signatures have none: their details are on the file's last page. */
export function certificatePathOf(versionId: string, db: Db = getDb()): string {
	const row = db
		.select({ path: documentSignatures.certificatePdfPath })
		.from(documentVersions)
		.innerJoin(documentSignatures, eq(documentVersions.signatureId, documentSignatures.id))
		.where(and(eq(documentVersions.id, versionId), isNull(documentVersions.deletedAt)))
		.get();
	if (!row?.path) throw new Error("This version has no separate certificate.");
	if (!existsSync(row.path)) throw new Error("The certificate file is no longer on this machine.");
	return row.path;
}

/**
 * What each document's versions say and hash to, for recognising an incoming
 * file. Only the fields matching needs, for every live document.
 */
export function fingerprints(db: Db = getDb()) {
	return db
		.select({
			documentId: documentVersions.documentId,
			fileHash: documentVersions.fileHash,
			textContent: documentVersions.textContent,
		})
		.from(documentVersions)
		.innerJoin(documents, eq(documentVersions.documentId, documents.id))
		.where(and(isNull(documentVersions.deletedAt), isNull(documents.deletedAt)))
		.all();
}
