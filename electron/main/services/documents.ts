/**
 * Documents: one generated instance of a template, frozen at generation.
 *
 * The body is stored, not re-rendered. A contract has to still read the way it
 * read when it was sent, even after the template it came from is edited, and
 * especially after the client data it quoted has changed.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type {
	Client,
	Contact,
	DocumentLatestVersion,
	DocumentPlace,
	DocumentSourceKind,
	Project,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import {
	clientAddresses,
	clientEmails,
	clientPhones,
	clients,
	contacts,
	documentFolders,
	documents,
	projects,
	referenceItems,
} from "../db/schema";
import { buildContext, todayIsoDate } from "./document-context";
import { resolveOwner } from "./document-owner";
import { resolvePlace } from "./document-place";
import * as templates from "./document-templates";
import * as versions from "./document-versions";
import { isPdfMediaType, safeExtensionOf } from "./file-kind";
import * as settings from "./settings";

/** The primary row of each, or null. A client need not have any of them yet. */
function primaryDetails(clientId: string, db: Db) {
	const primaryEmail =
		db
			.select()
			.from(clientEmails)
			.where(
				and(
					eq(clientEmails.clientId, clientId),
					eq(clientEmails.isPrimary, true),
					isNull(clientEmails.deletedAt),
				),
			)
			.get() ?? null;
	const primaryPhone =
		db
			.select()
			.from(clientPhones)
			.where(
				and(
					eq(clientPhones.clientId, clientId),
					eq(clientPhones.isPrimary, true),
					isNull(clientPhones.deletedAt),
				),
			)
			.get() ?? null;
	const primaryAddress =
		db
			.select()
			.from(clientAddresses)
			.where(
				and(
					eq(clientAddresses.clientId, clientId),
					eq(clientAddresses.isPrimary, true),
					isNull(clientAddresses.deletedAt),
				),
			)
			.get() ?? null;
	return { primaryEmail, primaryPhone, primaryAddress };
}

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
	/** A folder the owner made, inside the place the document is kept. */
	folderId: string | null;
}

export interface GenerateInput {
	/** Optional: a project with a client brings its client along (document-owner.ts). */
	clientId?: string | null;
	templateId: string;
	projectId?: string | null;
	title?: string;
	issuedOn?: string;
	/** Values the operator typed for this document, such as an addendum summary. */
	extras?: Record<string, string>;
	/** A folder the owner made. Its client and project win; naming others is refused (document-place.ts). */
	folderId?: string | null;
}

export interface GenerateResult {
	document: DocumentRecord;
	/** Placeholders the template wanted and the records could not fill. */
	missing: string[];
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
		folderId: row.folderId,
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
 * The documents directly in one node of the tree (decision 75): in a folder
 * the owner made, or, without one, kept under exactly that client and project
 * and in no folder. A client's node does not list its projects' documents;
 * those are in the project's node below it.
 */
export async function listIn(place: DocumentPlace, db: Db = getDb()): Promise<DocumentRecord[]> {
	const where = place.folderId
		? eq(documents.folderId, place.folderId)
		: and(
				place.clientId ? eq(documents.clientId, place.clientId) : isNull(documents.clientId),
				place.projectId ? eq(documents.projectId, place.projectId) : isNull(documents.projectId),
				isNull(documents.folderId),
			);
	const rows = selectWithNames(db)
		.where(and(isNull(documents.deletedAt), where))
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
	const current = db
		.select({ folderId: documents.folderId })
		.from(documents)
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.get();
	if (!current) throw new Error("That document no longer exists.");
	// A folder belongs to one place. Moving the document out of that place
	// takes it out of the folder too, or the tree would draw it somewhere it
	// is not kept.
	const folder = current.folderId
		? db
				.select({ clientId: documentFolders.clientId, projectId: documentFolders.projectId })
				.from(documentFolders)
				.where(and(eq(documentFolders.id, current.folderId), isNull(documentFolders.deletedAt)))
				.get()
		: undefined;
	const keepsFolder = folder && folder.clientId === owner.clientId && folder.projectId === owner.projectId;
	const row = db
		.update(documents)
		.set({
			clientId: owner.clientId,
			projectId: owner.projectId,
			folderId: keepsFolder ? current.folderId : null,
			updatedAt: now(),
		})
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error("That document no longer exists.");
	return (await get(row.id, db))!;
}

/**
 * Renders a template against a client and stores the result.
 *
 * Missing placeholders do not stop generation. They are rendered as a visible
 * marker and reported, because a half-filled draft the operator can see and fix
 * is more useful than a refusal, and a silently blank contract is worse than
 * both.
 */
export async function generate(
	input: GenerateInput,
	db: Db = getDb(),
	/** The fonts a canvas document carries inline. Worked out by document-actions.ts, never taken from a caller. */
	options: { fontCss?: string } = {},
): Promise<GenerateResult> {
	const template = await templates.get(input.templateId, db);
	if (!template) throw new Error("That template no longer exists.");

	// A folder decides the client and the project, so a document made from a
	// template while a folder is open is kept in it in the same write.
	const belongsTo = resolvePlace({ clientId: input.clientId, projectId: input.projectId, folderId: input.folderId }, db);
	const client = belongsTo.clientId
		? db.select().from(clients).where(eq(clients.id, belongsTo.clientId)).get()
		: undefined;

	const primaryContact = client
		? db
				.select()
				.from(contacts)
				.where(
					and(
						eq(contacts.clientId, client.id),
						eq(contacts.isPrimary, true),
						isNull(contacts.deletedAt),
					),
				)
				.get()
		: undefined;

	const project = belongsTo.projectId
		? db.select().from(projects).where(eq(projects.id, belongsTo.projectId)).get()
		: undefined;

	const owner = await settings.getOwner();
	const issuedOn = input.issuedOn ?? todayIsoDate();
	const title =
		input.title?.trim() || [template.name, client?.name ?? project?.name].filter(Boolean).join(" ");

	// An older template that reads a client gets an empty one when there is
	// none, the same as a preview, so the gaps are marked rather than invented.
	const context = buildContext({
		owner,
		client: (client ?? { name: "" }) as unknown as Client,
		...(client ? primaryDetails(client.id, db) : {}),
		primaryContact: (primaryContact ?? null) as unknown as Contact | null,
		project: (project ?? null) as unknown as Project | null,
		extras: input.extras,
		issuedOn,
		title,
	});

	// A canvas template fills in what was typed for it and nothing else
	// (docs/templates.md), so the records gathered above only decide who the
	// document belongs to and what it is called.
	const rendered = template.canvas
		? templates.renderCanvas(
				{
					templateId: template.id,
					canvas: template.canvas,
					inputs: template.inputs,
					values: input.extras ?? {},
					fontCss: options.fontCss,
				},
				db,
			)
		: templates.renderTemplate(template, context);

	const status = db
		.select()
		.from(referenceItems)
		.where(eq(referenceItems.key, "draft"))
		.get();

	const [row] = db
		.insert(documents)
		.values({
			clientId: belongsTo.clientId,
			projectId: belongsTo.projectId,
			folderId: belongsTo.folderId,
			templateId: template.id,
			templateVersion: template.version,
			title,
			statusId: status?.id ?? null,
			bodyHtml: rendered.html,
			variablesJson: JSON.stringify({
				used: rendered.used,
				missing: rendered.missing,
				extras: input.extras ?? {},
			}),
			issuedOn,
			// Carried onto the document rather than looked up later. Reviewing the
			// template afterwards must not silently reclassify a document that has
			// already gone out.
			isSpecimen: template.reviewedAt === null,
		})
		.returning()
		.all();

	return { document: toRecord(row!, belongsTo), missing: rendered.missing };
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
 * The same context a real generation would get, for previewing a template.
 * Falls back to empty records rather than inventing plausible ones, so a preview
 * shows exactly the gaps a real document would.
 */
export async function previewContext(
	input: { clientId?: string | null; projectId?: string | null },
	db: Db = getDb(),
): Promise<Record<string, unknown>> {
	const client = input.clientId
		? db.select().from(clients).where(eq(clients.id, input.clientId)).get()
		: undefined;

	const primaryContact = client
		? db
				.select()
				.from(contacts)
				.where(and(eq(contacts.clientId, client.id), eq(contacts.isPrimary, true)))
				.get()
		: undefined;

	const project = input.projectId
		? db.select().from(projects).where(eq(projects.id, input.projectId)).get()
		: undefined;

	return buildContext({
		owner: await settings.getOwner(),
		client: (client ?? { name: "" }) as unknown as Client,
		...(client ? primaryDetails(client.id, db) : {}),
		primaryContact: (primaryContact ?? null) as unknown as Contact | null,
		project: (project ?? null) as unknown as Project | null,
	});
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
			"This document came from a template that has not been reviewed, so it cannot be signed. " +
				"Rewrite the template with your own text and mark it as reviewed first.",
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
	// The folder it was in may have been deleted while it was gone. It comes
	// back to the folder's place instead, or the tree would hold it nowhere.
	const current = db.select({ folderId: documents.folderId }).from(documents).where(eq(documents.id, id)).get();
	const folderAlive = current?.folderId
		? Boolean(
				db
					.select({ id: documentFolders.id })
					.from(documentFolders)
					.where(and(eq(documentFolders.id, current.folderId), isNull(documentFolders.deletedAt)))
					.get(),
			)
		: true;
	db.update(documents)
		.set({ deletedAt: null, updatedAt: now(), ...(folderAlive ? {} : { folderId: null }) })
		.where(eq(documents.id, id))
		.run();
	const record = await get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	return record;
}
