/**
 * Documents: any file Juno keeps, a page written in it, or a document made
 * from a template while there were templates (decision 82).
 *
 * The body of one made from a template is stored, not re-rendered. A contract
 * has to still read the way it read when it was sent, even after the client
 * data it quoted has changed.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { DocumentLatestVersion, DocumentSourceKind } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, documents, projects } from "../db/schema";
import { resolveOwner } from "./document-owner";
import * as versions from "./document-versions";
import { isPdfMediaType, safeExtensionOf } from "./file-kind";

export interface DocumentRecord {
	id: string;
	ownerId: string;
	deletedAt: string | null;
	/** Null for a document that belongs to a project of the owner's own, or to nothing. */
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	templateId: string | null;
	templateVersion: number | null;
	title: string;
	statusId: string | null;
	bodyHtml: string;
	issuedOn: string | null;
	pdfPath: string | null;
	isSpecimen: boolean;
	createdAt: string;
	updatedAt: string;
	/**
	 * `imported` is a PDF that already existed and was brought in. It has no body
	 * to render and no template behind it, so anything that re-renders or
	 * re-generates has to check this before it tries.
	 */
	sourceKind: DocumentSourceKind;
	versionCount: number;
	latestVersion: DocumentLatestVersion | null;
}

type Row = typeof documents.$inferSelect;

function toRecord(
	row: Row,
	names: { clientName: string | null; projectName: string | null },
	summary?: versions.VersionSummary,
): DocumentRecord {
	return {
		id: row.id,
		ownerId: row.ownerId,
		deletedAt: row.deletedAt,
		clientId: row.clientId,
		clientName: names.clientName,
		projectId: row.projectId,
		projectName: names.projectName,
		templateId: row.templateId,
		templateVersion: row.templateVersion,
		title: row.title,
		statusId: row.statusId,
		bodyHtml: row.bodyHtml,
		issuedOn: row.issuedOn,
		pdfPath: row.pdfPath,
		isSpecimen: row.isSpecimen,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		sourceKind: row.sourceKind as DocumentSourceKind,
		versionCount: summary?.count ?? 0,
		latestVersion: summary?.latest ?? null,
	};
}

/**
 * A filename that sorts usefully and is legal on every platform.
 *
 * The title never reaches the filesystem as typed: everything outside word
 * characters, spaces and hyphens is stripped, which removes `/`, `\` and `.`
 * along with anything else a path could be built from. A title of `../../etc`
 * comes out as `etc`, so joining this onto a directory can never leave it.
 * Shared with document-actions.ts, which renders and signs PDFs under the same
 * scheme, so there is exactly one naming rule rather than two that can drift.
 *
 * The extension is the file's own (decision 75), kept to letters and digits;
 * one that is anything else is dropped rather than trusted.
 */
export function fileNameFor(title: string, suffix: string, extension = "pdf"): string {
	const safe = title
		.normalize("NFKD")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 60)
		.toLowerCase();
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	// The time alone repeats within a millisecond, and two documents of one
	// title (under two clients, or a batch of copies) would then share a file,
	// the second write replacing the first.
	const unique = randomBytes(4).toString("hex");
	const ending = safeExtensionOf(extension);
	return `${safe || "document"}-${stamp}-${unique}${suffix}${ending ? `.${ending}` : ""}`;
}

let importDirectory = "";

/**
 * Where an imported PDF is copied to. Injected once at startup, from the same
 * folder a generated document's PDF is written to, so no service here has to
 * import `electron` and every one stays testable in plain Node.
 */
export function configureDocumentStorage(directory: string): void {
	importDirectory = directory;
}

/** The folder imported files and new versions are copied into. */
export function documentStorageDir(): string {
	if (!importDirectory) {
		throw new Error("configureDocumentStorage() was not called before a document was imported.");
	}
	if (!existsSync(importDirectory)) mkdirSync(importDirectory, { recursive: true });
	return importDirectory;
}

/**
 * Left joins, because a document need not have a client or a project. An inner
 * join here would make one without either vanish from every list.
 */
function selectWithNames(db: Db) {
	return db
		.select({ document: documents, clientName: clients.name, projectName: projects.name })
		.from(documents)
		.leftJoin(clients, eq(documents.clientId, clients.id))
		.leftJoin(projects, eq(documents.projectId, projects.id));
}

export async function list(
	query: { clientId?: string; projectId?: string } = {},
	db: Db = getDb(),
): Promise<DocumentRecord[]> {
	const rows = selectWithNames(db)
		.where(
			and(
				isNull(documents.deletedAt),
				query.clientId ? eq(documents.clientId, query.clientId) : undefined,
				query.projectId ? eq(documents.projectId, query.projectId) : undefined,
			),
		)
		.orderBy(desc(documents.createdAt), desc(documents.id))
		.all();
	const summaries = versions.summaries(
		rows.map((row) => row.document.id),
		db,
	);
	return rows.map((row) => toRecord(row.document, row, summaries.get(row.document.id)));
}

/**
 * The documents kept under no client and no project, newest first: the Files
 * place on the rail, the owner's own (decision 82).
 */
export async function listUnfiled(db: Db = getDb()): Promise<DocumentRecord[]> {
	const rows = selectWithNames(db)
		.where(and(isNull(documents.deletedAt), isNull(documents.clientId), isNull(documents.projectId)))
		.orderBy(desc(documents.createdAt), desc(documents.id))
		.all();
	const summaries = versions.summaries(
		rows.map((row) => row.document.id),
		db,
	);
	return rows.map((row) => toRecord(row.document, row, summaries.get(row.document.id)));
}

export async function get(id: string, db: Db = getDb()): Promise<DocumentRecord | null> {
	const row = selectWithNames(db)
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.get();
	if (!row) return null;
	return toRecord(row.document, row, versions.summaries([id], db).get(id));
}

/**
 * Moves a document to a client, a project, both, or nothing. Only where it is
 * kept changes: the file, its versions and its signatures stay as they are.
 */
export async function link(
	id: string,
	input: { clientId?: string | null; projectId?: string | null },
	db: Db = getDb(),
): Promise<DocumentRecord> {
	const owner = resolveOwner(input, db);
	const row = db
		.update(documents)
		.set({
			clientId: owner.clientId,
			projectId: owner.projectId,
			updatedAt: now(),
		})
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error("That document no longer exists.");
	return (await get(row.id, db))!;
}

/**
 * The bytes of a document's PDF, for the placement page. Resolved from the id,
 * so the renderer never names a file.
 */
export async function readPdfBytes(id: string, db: Db = getDb()): Promise<Uint8Array> {
	const record = await get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	if (!record.pdfPath || !existsSync(record.pdfPath)) {
		throw new Error("This document has no PDF yet. Create one first.");
	}
	assertNewestIsPdf(record);
	return new Uint8Array(readFileSync(record.pdfPath));
}

/**
 * Throws unless the document may be signed.
 *
 * Lives here, in a module with no Electron import, so the rule that stops an
 * invented contract being signed is covered by a test rather than only by the
 * interface that happens to call it.
 */
export function assertSignable(record: Pick<DocumentRecord, "isSpecimen" | "title" | "latestVersion">): void {
	if (record.isSpecimen) {
		throw new Error(
			"This document came from a template that was never reviewed, so it cannot be signed. " +
				"Write it with your own checked text as a new document and sign that.",
		);
	}
	assertNewestIsPdf(record);
}

/**
 * Throws when the newest version is a file of another kind (decision 77):
 * a stamp goes on a PDF page, so a Word file is converted first, and the
 * conversion is kept as a version of its own.
 */
export function assertNewestIsPdf(record: Pick<DocumentRecord, "title" | "latestVersion">): void {
	const latest = record.latestVersion;
	if (latest && !isPdfMediaType(latest.mediaType)) {
		throw new Error(
			`The newest version of "${record.title}" is not a PDF. Convert it to PDF first, then sign the PDF.`,
		);
	}
}

export async function setStatus(
	id: string,
	statusId: string | null,
	db: Db = getDb(),
): Promise<DocumentRecord> {
	db.update(documents)
		.set({ statusId, updatedAt: now() })
		.where(eq(documents.id, id))
		.run();
	const record = await get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	return record;
}

export async function remove(id: string, db: Db = getDb()): Promise<DocumentRecord> {
	const record = await get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	db.update(documents)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documents.id, id))
		.run();
	return record;
}

export async function restore(id: string, db: Db = getDb()): Promise<DocumentRecord> {
	db.update(documents)
		.set({ deletedAt: null, updatedAt: now() })
		.where(eq(documents.id, id))
		.run();
	const record = await get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	return record;
}
