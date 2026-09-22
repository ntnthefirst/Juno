/**
 * Documents: one generated instance of a template, frozen at generation.
 *
 * The body is stored, not re-rendered. A contract has to still read the way it
 * read when it was sent, even after the template it came from is edited, and
 * especially after the client data it quoted has changed.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Client, Contact, DocumentSourceKind, ImportDocumentInput, Project } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import {
	clientAddresses,
	clientEmails,
	clientPhones,
	clients,
	contacts,
	documents,
	projects,
	referenceItems,
} from "../db/schema";
import { buildContext, todayIsoDate } from "./document-context";
import * as templates from "./document-templates";
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
	clientId: string;
	clientName: string;
	projectId: string | null;
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
}

export interface GenerateInput {
	clientId: string;
	templateId: string;
	projectId?: string | null;
	title?: string;
	issuedOn?: string;
	/** Values the operator typed for this document, such as an addendum summary. */
	extras?: Record<string, string>;
}

export interface GenerateResult {
	document: DocumentRecord;
	/** Placeholders the template wanted and the records could not fill. */
	missing: string[];
}

type Row = typeof documents.$inferSelect;

function toRecord(row: Row, clientName: string): DocumentRecord {
	return {
		id: row.id,
		ownerId: row.ownerId,
		deletedAt: row.deletedAt,
		clientId: row.clientId,
		clientName,
		projectId: row.projectId,
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
 */
export function fileNameFor(title: string, suffix: string): string {
	const safe = title
		.normalize("NFKD")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 60)
		.toLowerCase();
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${safe || "document"}-${stamp}${suffix}.pdf`;
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

function importStorageDir(): string {
	if (!importDirectory) {
		throw new Error("configureDocumentStorage() was not called before a document was imported.");
	}
	if (!existsSync(importDirectory)) mkdirSync(importDirectory, { recursive: true });
	return importDirectory;
}

/** True when the file at `path` starts with the five bytes every PDF starts with. */
function looksLikePdf(path: string): boolean {
	const fd = openSync(path, "r");
	try {
		const header = Buffer.alloc(5);
		const read = readSync(fd, header, 0, 5, 0);
		return read === 5 && header.toString("latin1") === "%PDF-";
	} finally {
		closeSync(fd);
	}
}

export async function list(
	query: { clientId?: string } = {},
	db: Db = getDb(),
): Promise<DocumentRecord[]> {
	const rows = db
		.select({ document: documents, clientName: clients.name })
		.from(documents)
		.innerJoin(clients, eq(documents.clientId, clients.id))
		.where(
			query.clientId
				? and(isNull(documents.deletedAt), eq(documents.clientId, query.clientId))
				: isNull(documents.deletedAt),
		)
		.orderBy(desc(documents.createdAt))
		.all();
	return rows.map((row) => toRecord(row.document, row.clientName));
}

export async function get(id: string, db: Db = getDb()): Promise<DocumentRecord | null> {
	const row = db
		.select({ document: documents, clientName: clients.name })
		.from(documents)
		.innerJoin(clients, eq(documents.clientId, clients.id))
		.where(and(eq(documents.id, id), isNull(documents.deletedAt)))
		.get();
	return row ? toRecord(row.document, row.clientName) : null;
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
): Promise<GenerateResult> {
	const template = await templates.get(input.templateId, db);
	if (!template) throw new Error("That template no longer exists.");

	const client = db
		.select()
		.from(clients)
		.where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
		.get();
	if (!client) throw new Error("That client no longer exists.");

	const primaryContact = db
		.select()
		.from(contacts)
		.where(
			and(
				eq(contacts.clientId, client.id),
				eq(contacts.isPrimary, true),
				isNull(contacts.deletedAt),
			),
		)
		.get();

	const project = input.projectId
		? db
				.select()
				.from(projects)
				.where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
				.get()
		: null;

	if (input.projectId && !project) throw new Error("That project no longer exists.");
	if (project && project.clientId !== client.id) {
		throw new Error("That project belongs to a different client.");
	}

	const owner = await settings.getOwner();
	const issuedOn = input.issuedOn ?? todayIsoDate();
	const title = input.title?.trim() || `${template.name} ${client.name}`;

	const context = buildContext({
		owner,
		client: client as unknown as Client,
		...primaryDetails(client.id, db),
		primaryContact: (primaryContact ?? null) as unknown as Contact | null,
		project: (project ?? null) as unknown as Project | null,
		extras: input.extras,
		issuedOn,
		title,
	});

	const rendered = templates.renderTemplate(template, context);

	const status = db
		.select()
		.from(referenceItems)
		.where(eq(referenceItems.key, "draft"))
		.get();

	const [row] = db
		.insert(documents)
		.values({
			clientId: client.id,
			projectId: project?.id ?? null,
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

	return { document: toRecord(row!, client.name), missing: rendered.missing };
}

/**
 * Brings in a PDF that already exists, rather than one Juno generated. The
 * original file is copied, never moved and never deleted, and the copy is what
 * the record points at from then on.
 */
export async function importPdf(
	input: ImportDocumentInput,
	db: Db = getDb(),
): Promise<DocumentRecord> {
	const client = db
		.select()
		.from(clients)
		.where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
		.get();
	if (!client) throw new Error("That client no longer exists.");

	if (input.projectId) {
		const project = db
			.select()
			.from(projects)
			.where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
			.get();
		if (!project) throw new Error("That project no longer exists.");
		if (project.clientId !== client.id) {
			throw new Error("That project belongs to a different client.");
		}
	}

	const fileLabel = basename(input.sourcePath);
	if (!existsSync(input.sourcePath) || !statSync(input.sourcePath).isFile()) {
		throw new Error(`Could not find "${fileLabel}". Check the file still exists at that location.`);
	}
	if (!looksLikePdf(input.sourcePath)) {
		throw new Error(`"${fileLabel}" is not a PDF. Choose a file that starts with a PDF header.`);
	}

	const title = input.title?.trim() || basename(input.sourcePath, ".pdf") || "Document";
	const issuedOn = input.issuedOn ?? todayIsoDate();

	// The destination name comes from the title through fileNameFor, never from
	// the source path, so a title carrying "../" cannot walk the copy outside
	// the configured directory.
	const destination = join(importStorageDir(), fileNameFor(title, "-import"));
	copyFileSync(input.sourcePath, destination);

	const [row] = db
		.insert(documents)
		.values({
			clientId: client.id,
			projectId: input.projectId ?? null,
			templateId: null,
			templateVersion: null,
			title,
			bodyHtml: "",
			issuedOn,
			pdfPath: destination,
			isSpecimen: false,
			sourceKind: "imported",
		})
		.returning()
		.all();

	return toRecord(row!, client.name);
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
export function assertSignable(record: Pick<DocumentRecord, "isSpecimen">): void {
	if (record.isSpecimen) {
		throw new Error(
			"This document came from a template that has not been reviewed, so it cannot be signed. " +
				"Rewrite the template with your own text and mark it as reviewed first.",
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

export async function setPdfPath(
	id: string,
	pdfPath: string,
	db: Db = getDb(),
): Promise<DocumentRecord> {
	db.update(documents)
		.set({ pdfPath, updatedAt: now() })
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
