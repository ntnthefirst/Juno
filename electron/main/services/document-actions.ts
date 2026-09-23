/**
 * The document operations that need Electron: previewing, rendering a PDF and
 * signing one.
 *
 * Kept apart from documents.ts so that the record logic stays testable in plain
 * Node. This module is the seam where the database meets the printer.
 */
import { dialog, shell } from "electron";
import { eq } from "drizzle-orm";
import type { DocumentSignature, SignDocumentInput } from "../../shared/types";
import type { DocumentRecord } from "./documents";
import { getDb, type Db } from "../db";
import { documentSignatures } from "../db/schema";
import * as pdf from "./document-pdf";
import { documentShell } from "./document-style";
import * as templates from "./document-templates";
import * as documents from "./documents";
import { fileNameFor } from "./documents";
import * as signature from "./signature";
import { render } from "./template-render";

export async function previewHtml(id: string, db: Db = getDb()): Promise<string> {
	const record = await documents.get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	if (record.sourceKind === "imported") {
		throw new Error("This document was imported as a PDF and has no body to preview. Open the PDF instead.");
	}
	return documentShell({
		title: record.title,
		bodyHtml: record.bodyHtml,
		isSpecimen: record.isSpecimen,
	});
}

/**
 * Asks for a PDF and imports it for a client. Returns null when the picker is
 * cancelled, which is not an error and writes nothing.
 *
 * The dialog lives here rather than in the IPC adapter or in documents.ts:
 * documents.ts stays free of Electron so its record logic is testable in plain
 * Node, and the adapter stays a one-line call, the same shape as
 * settings.chooseSignature in ipc/settings.ts.
 */
export async function chooseImportPdf(
	clientId: string,
	db: Db = getDb(),
): Promise<DocumentRecord | null> {
	const result = await dialog.showOpenDialog({
		title: "Kies een PDF",
		properties: ["openFile"],
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (result.canceled || result.filePaths.length === 0) return null;

	return documents.importPdf({ sourcePath: result.filePaths[0]!, clientId }, db);
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

/**
 * Generates a document and writes its PDF in one step.
 *
 * A document is a PDF (docs/editors.md section 5), so a record whose file does
 * not exist yet is a half-made thing that every screen then has to describe:
 * "generated, no PDF" is a state nobody asked for. Both adapters call this
 * rather than generating and rendering in sequence themselves, because a
 * two-step operation sequenced in an adapter is a step the other adapter
 * forgets.
 *
 * The PDF failing does not lose the document. The record is already written and
 * is returned with `pdfPath` still null, so the person can try again from the
 * detail view rather than losing what they filled in.
 */
export async function generate(
	input: documents.GenerateInput,
	db: Db = getDb(),
): Promise<documents.GenerateResult & { pdfError: string | null }> {
	const result = await documents.generate(input, db);

	try {
		const withPdf = await renderPdf(result.document.id, db);
		return { document: withPdf, missing: result.missing, pdfError: null };
	} catch (cause) {
		return {
			document: result.document,
			missing: result.missing,
			pdfError: cause instanceof Error ? cause.message : "The PDF could not be written.",
		};
	}
}

export async function renderPdf(id: string, db: Db = getDb()) {
	const record = await documents.get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	if (record.sourceKind === "imported") {
		throw new Error(
			"This document was imported as a PDF and has no body to render. It already has the PDF it was imported with.",
		);
	}

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
