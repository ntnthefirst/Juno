/**
 * The document operations that need Electron: previewing, rendering a PDF and
 * signing one.
 *
 * Kept apart from documents.ts so that the record logic stays testable in plain
 * Node. This module is the seam where the database meets the printer.
 */
import { shell } from "electron";
import { eq } from "drizzle-orm";
import type { DocumentSignature, SignDocumentInput } from "../../shared/types";
import { getDb, type Db } from "../db";
import { documentSignatures } from "../db/schema";
import * as pdf from "./document-pdf";
import { documentShell } from "./document-style";
import * as templates from "./document-templates";
import * as documents from "./documents";
import * as signature from "./signature";
import { render } from "./template-render";

/** A filename that sorts usefully and is legal on every platform. */
function fileNameFor(title: string, suffix: string): string {
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

export async function previewHtml(id: string, db: Db = getDb()): Promise<string> {
	const record = await documents.get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	return documentShell({
		title: record.title,
		bodyHtml: record.bodyHtml,
		isSpecimen: record.isSpecimen,
	});
}

/**
 * Renders a body against real records without storing anything, for the editor.
 *
 * Uses a real client when one is given, so the preview shows the gaps that will
 * actually appear rather than a tidy fiction.
 */
export async function previewTemplate(
	input: {
		bodyHtml: string;
		clientId?: string | null;
		projectId?: string | null;
		isSpecimen: boolean;
	},
	db: Db = getDb(),
): Promise<{ html: string; missing: string[] }> {
	const context = await documents.previewContext(
		{ clientId: input.clientId ?? null, projectId: input.projectId ?? null },
		db,
	);
	const rendered = render(input.bodyHtml, context);
	return {
		html: documentShell({
			title: "Voorbeeld",
			bodyHtml: rendered.html,
			isSpecimen: input.isSpecimen,
		}),
		missing: rendered.missing,
	};
}

export async function renderPdf(id: string, db: Db = getDb()) {
	const record = await documents.get(id, db);
	if (!record) throw new Error("That document no longer exists.");

	const path = await pdf.renderPdf({
		title: record.title,
		bodyHtml: record.bodyHtml,
		isSpecimen: record.isSpecimen,
		fileName: fileNameFor(record.title, ""),
	});

	return documents.setPdfPath(id, path, db);
}

type SignatureRow = typeof documentSignatures.$inferSelect;

function toSignature(row: SignatureRow): DocumentSignature {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		documentId: row.documentId,
		signerName: row.signerName,
		signerRole: row.signerRole,
		signedAt: row.signedAt,
		signatureImagePath: row.signatureImagePath,
		documentHash: row.documentHash,
		signedPdfPath: row.signedPdfPath,
	};
}

export async function signatures(
	documentId: string,
	db: Db = getDb(),
): Promise<DocumentSignature[]> {
	return db
		.select()
		.from(documentSignatures)
		.where(eq(documentSignatures.documentId, documentId))
		.all()
		.map(toSignature);
}

/**
 * Signs a document.
 *
 * Refuses a specimen. That check is here, in the service, rather than only in
 * the interface: an MCP tool or a future screen would otherwise be able to sign
 * an invented contract, which is the exact failure the specimen flag exists to
 * prevent. See .claude/rules/mcp.md and docs/templates.md.
 */
export async function sign(
	input: SignDocumentInput,
	db: Db = getDb(),
): Promise<DocumentSignature> {
	const record = await documents.get(input.documentId, db);
	if (!record) throw new Error("That document no longer exists.");

	documents.assertSignable(record);

	const signerName = input.signerName.trim();
	if (!signerName) throw new Error("A signature needs a name.");

	// Rendered now if it has not been, so the bytes that get hashed are the bytes
	// that exist, rather than a PDF from before the last edit.
	const withPdf = record.pdfPath ? record : await renderPdf(record.id, db);
	if (!withPdf.pdfPath) throw new Error("The document has no PDF to sign.");

	const template = record.templateId ? await templates.get(record.templateId, db) : null;
	const imagePath = input.useSignatureImage === false ? null : await signature.getPath();
	const signedAt = new Date().toISOString();

	const result = await pdf.signPdf({
		pdfPath: withPdf.pdfPath,
		signatureImagePath: imagePath,
		signerName,
		signerRole: input.signerRole ?? null,
		signedAt,
		documentTitle: record.title,
		templateName: template?.name ?? "onbekend",
		templateVersion: record.templateVersion,
		isSpecimen: record.isSpecimen,
		fileName: fileNameFor(record.title, "-ondertekend"),
	});

	const [row] = db
		.insert(documentSignatures)
		.values({
			documentId: record.id,
			signerName,
			signerRole: input.signerRole ?? null,
			signedAt,
			signatureImagePath: imagePath,
			documentHash: result.documentHash,
			signedPdfPath: result.signedPdfPath,
			auditJson: JSON.stringify(result.audit),
		})
		.returning()
		.all();

	return toSignature(row!);
}

export async function openPdf(id: string, db: Db = getDb()): Promise<void> {
	const path = await latestPdfPath(id, db);
	const error = await shell.openPath(path);
	if (error) throw new Error(error);
}

export async function revealPdf(id: string, db: Db = getDb()): Promise<void> {
	shell.showItemInFolder(await latestPdfPath(id, db));
}

/** The signed copy when there is one, because that is the one people want. */
async function latestPdfPath(id: string, db: Db): Promise<string> {
	const signed = await signatures(id, db);
	const newest = signed.filter((entry) => entry.signedPdfPath).at(-1);
	if (newest?.signedPdfPath) return newest.signedPdfPath;

	const record = await documents.get(id, db);
	if (!record?.pdfPath) throw new Error("This document has no PDF yet. Create one first.");
	return record.pdfPath;
}
