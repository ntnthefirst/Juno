/**
 * The document operations that need Electron: previewing, rendering a PDF and
 * signing one.
 *
 * Kept apart from documents.ts so that the record logic stays testable in plain
 * Node. This module is the seam where the database meets the printer.
 */
import { dialog, shell } from "electron";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { eq } from "drizzle-orm";
import type { DocumentSignature, PickedPdf, SignDocumentInput, StampPlacement } from "../../shared/types";
import { STAMP_MAX_WIDTH, STAMP_MIN_WIDTH } from "../../shared/stamp";
import { getDb, type Db } from "../db";
import { documentSignatures } from "../db/schema";
import * as pdf from "./document-pdf";
import { MAX_IMPORT_BYTES } from "./document-import";
import * as versions from "./document-versions";
import { extractText } from "./pdf-text";
import { signPdf } from "./pdf-sign";
import * as certificate from "./signing-certificate";
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
 * Asks for one or more PDFs and hands their bytes back, for the window to
 * import through the same questions a drop asks. Empty when the picker is
 * cancelled, which is not an error.
 *
 * The files go back as bytes rather than paths: the window may not hold a
 * path, and the import it runs next only takes what it was given.
 */
export async function pickPdfs(): Promise<PickedPdf[]> {
	const result = await dialog.showOpenDialog({
		title: "Kies een PDF",
		properties: ["openFile", "multiSelections"],
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (result.canceled) return [];
	return result.filePaths.map((path) => {
		const stat = statSync(path);
		if (stat.size > MAX_IMPORT_BYTES) {
			throw new Error(`"${basename(path)}" is larger than 50 MB. Split it or compress it first.`);
		}
		return { fileName: basename(path), data: new Uint8Array(readFileSync(path)), fileDate: stat.mtime.toISOString() };
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

	const bytes = readFileSync(path);
	versions.record(
		{
			documentId: id,
			kind: "generated",
			source: "generate",
			pdfPath: path,
			fileDate: new Date().toISOString(),
			fileHash: versions.hashBytes(bytes),
			textContent: await extractText(bytes),
		},
		db,
	);
	const updated = await documents.get(id, db);
	if (!updated) throw new Error("That document no longer exists.");
	return updated;
}

type SignatureRow = typeof documentSignatures.$inferSelect;

/** The certificate recorded in the audit JSON, or null for a stamp-only signature. */
function digitalOf(auditJson: string | null): DocumentSignature["digital"] {
	if (!auditJson) return null;
	try {
		const digital = (JSON.parse(auditJson) as { digital?: DocumentSignature["digital"] }).digital;
		return digital ?? null;
	} catch {
		return null;
	}
}

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
		certificatePdfPath: row.certificatePdfPath,
		digital: digitalOf(row.auditJson),
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

/** Refuses a placement that is not numbers on the page, then keeps the stamp on it. */
function validPlacement(placement: StampPlacement): StampPlacement {
	const { page, x, y, width } = placement;
	if (!Number.isInteger(page) || page < 1) throw new Error("Choose a page for the stamp.");
	if (![x, y, width].every(Number.isFinite)) throw new Error("The stamp position is not valid.");
	const clamped = Math.min(STAMP_MAX_WIDTH, Math.max(STAMP_MIN_WIDTH, width));
	return {
		page,
		width: clamped,
		x: Math.min(1 - clamped, Math.max(0, x)),
		y: Math.min(1, Math.max(0, y)),
	};
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

	// The newest version is what gets stamped, so a copy the client signed and
	// sent back is countersigned rather than the original. Rendered first when
	// there is no PDF at all, so the bytes that get hashed are bytes that exist.
	const withPdf = record.pdfPath ? record : await renderPdf(record.id, db);
	if (!withPdf.pdfPath) throw new Error("The document has no PDF to sign.");

	const template = record.templateId ? await templates.get(record.templateId, db) : null;
	const imagePath = input.useSignatureImage === false ? null : await signature.getPath();
	const signedAt = new Date().toISOString();

	const placement = input.placement ? validPlacement(input.placement) : undefined;
	const outputPath = pdf.outputPathFor(fileNameFor(record.title, "-ondertekend"));

	let digital: Parameters<typeof signPdf>[0]["digital"] = null;
	if (input.digital) {
		const info = certificate.get();
		const p12 = certificate.readP12();
		if (!info || !p12) {
			throw new Error("No signing certificate is set up. Import one under Settings > Documents.");
		}
		// Opened here as well as at signing, so an expired certificate or a wrong
		// passphrase is refused before anything is written.
		certificate.inspectP12(p12, input.digital.passphrase);
		digital = {
			p12,
			passphrase: input.digital.passphrase,
			subject: info.subject,
			issuer: info.issuer,
			fingerprint: info.fingerprint,
			validTo: info.validTo,
		};
	}

	const result = await signPdf({
		pdfPath: withPdf.pdfPath,
		outputPath,
		placement,
		showDetails: input.showDetails,
		digital,
		signatureImagePath: imagePath,
		signerName,
		signerRole: input.signerRole ?? null,
		signedAt,
		documentTitle: record.title,
		templateName: template?.name ?? "onbekend",
		templateVersion: record.templateVersion,
		isSpecimen: record.isSpecimen,
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
			signedPdfPath: outputPath,
			certificatePdfPath: result.certificatePath,
			auditJson: JSON.stringify(result.audit),
		})
		.returning()
		.all();

	const signed = readFileSync(outputPath);
	versions.record(
		{
			documentId: record.id,
			kind: digital ? "signed" : "stamped",
			source: "sign",
			pdfPath: outputPath,
			fileDate: signedAt,
			fileHash: versions.hashBytes(signed),
			textContent: await extractText(signed),
			signatureId: row!.id,
		},
		db,
	);

	return toSignature(row!);
}

/** The PDF to place a stamp on, written first when the document has none yet. */
export async function readPdf(id: string, db: Db = getDb()): Promise<Uint8Array> {
	const record = await documents.get(id, db);
	if (!record) throw new Error("That document no longer exists.");
	if (!record.pdfPath) await renderPdf(id, db);
	return documents.readPdfBytes(id, db);
}

/** Opens the newest version, which is what opening a document means. */
export async function openPdf(id: string, db: Db = getDb()): Promise<void> {
	await openPath(await latestPdfPath(id, db));
}

export async function revealPdf(id: string, db: Db = getDb()): Promise<void> {
	shell.showItemInFolder(await latestPdfPath(id, db));
}

/** One version in particular, from the version list. Resolved from its id. */
export async function openVersion(versionId: string, db: Db = getDb()): Promise<void> {
	await openPath(versions.pathOf(versionId, db));
}

export async function revealVersion(versionId: string, db: Db = getDb()): Promise<void> {
	shell.showItemInFolder(versions.pathOf(versionId, db));
}

/** The signing details of one signed version, as their own PDF. */
export async function openCertificate(versionId: string, db: Db = getDb()): Promise<void> {
	await openPath(versions.certificatePathOf(versionId, db));
}

async function openPath(path: string): Promise<void> {
	const error = await shell.openPath(path);
	if (error) throw new Error(error);
}

async function latestPdfPath(id: string, db: Db): Promise<string> {
	const record = await documents.get(id, db);
	if (!record?.pdfPath) throw new Error("This document has no PDF yet. Create one first.");
	return record.pdfPath;
}
