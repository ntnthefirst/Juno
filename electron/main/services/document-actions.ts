/**
 * The document operations that need Electron: previewing, rendering a PDF and
 * signing one.
 *
 * Kept apart from documents.ts so that the record logic stays testable in plain
 * Node. This module is the seam where the database meets the printer.
 */
import { BrowserWindow, dialog, shell } from "electron";
import { copyFileSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { eq } from "drizzle-orm";
import type {
	DocumentSignature,
	PickedFile,
	PickedPdf,
	SignDocumentInput,
	StampPlacement,
	VersionUse,
} from "../../shared/types";
import { STAMP_MAX_WIDTH, STAMP_MIN_WIDTH } from "../../shared/stamp";
import { getDb, type Db } from "../db";
import { documentSignatures } from "../db/schema";
import * as pdf from "./document-pdf";
import { MAX_IMPORT_BYTES } from "./document-import";
import * as versions from "./document-versions";
import * as working from "./document-working";
import { mediaTypeFor, safeExtensionOf } from "./file-kind";
import { extensionOf } from "../../shared/mime";
import { extractText } from "./pdf-text";
import { signPdf } from "./pdf-sign";
import * as certificate from "./signing-certificate";
import { documentShell } from "./document-style";
import * as documents from "./documents";
import { fileNameFor } from "./documents";
import * as signature from "./signature";

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
 * Asks for any files (decision 75) and hands their bytes back, for the window
 * to add through the same questions a drop asks. Empty when cancelled.
 */
export async function pickFiles(): Promise<PickedFile[]> {
	const parent = BrowserWindow.getFocusedWindow();
	const options = { title: "Add files", properties: ["openFile" as const, "multiSelections" as const] };
	const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
	if (result.canceled) return [];
	return result.filePaths.map((path) => {
		const stat = statSync(path);
		if (stat.size > MAX_IMPORT_BYTES) {
			throw new Error(`"${basename(path)}" is larger than 100 MB. Keep it in a project's files instead, which can link to it.`);
		}
		return {
			fileName: basename(path),
			data: new Uint8Array(readFileSync(path)),
			fileDate: stat.mtime.toISOString(),
			mediaType: mediaTypeFor(basename(path)),
		};
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
			throw new Error(`"${basename(path)}" is larger than 100 MB. Split it or compress it first.`);
		}
		return { fileName: basename(path), data: new Uint8Array(readFileSync(path)), fileDate: stat.mtime.toISOString() };
	});
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
			// The name and size a Documents tab lists, as every other version records them.
			fileName: `${record.title.trim() || "Document"}.pdf`,
			mediaType: "application/pdf",
			byteSize: bytes.length,
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
		templateName: null,
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
			fileName: `${record.title.trim() || "Document"}.pdf`,
			mediaType: "application/pdf",
			byteSize: signed.length,
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

/**
 * Opens the newest version, which is what opening a document means, in the
 * operating system's app for it: a working copy Juno watches for edits, or a
 * read-only copy of a signed one (document-working.ts).
 */
export async function openPdf(id: string, db: Db = getDb()): Promise<{ readOnly: boolean }> {
	return working.openDocument(id, db);
}

/** One version in particular, from the version list. Anything but the newest opens read only. */
export async function openVersion(versionId: string, db: Db = getDb()): Promise<{ readOnly: boolean }> {
	return working.openVersion(versionId, db);
}

/** The bytes of one version, for the viewer. Resolved from its id, never from a path. */
export async function readVersion(versionId: string, db: Db = getDb()): Promise<Uint8Array> {
	return new Uint8Array(readFileSync(versions.pathOf(versionId, db)));
}

/**
 * Saves a copy of one version where the person chooses. Null when the dialog is
 * cancelled, which is not an error. The newest keeps the document's plain name;
 * an older one carries its number so the two do not collide in a folder.
 */
export async function downloadVersion(versionId: string, db: Db = getDb()): Promise<string | null> {
	const { version } = versions.get(versionId, db);
	const record = await documents.get(version.documentId, db);
	if (!record) throw new Error("That document no longer exists.");
	const file = versions.fileOf(versionId, db);
	const source = file.path;
	// The file keeps its own kind: a Word version downloads as Word.
	const extension = safeExtensionOf(extensionOf(file.fileName || file.path)) || "pdf";

	const base = record.title.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "").trim() || "document";
	const parent = BrowserWindow.getFocusedWindow();
	const options = {
		title: "Download a copy",
		defaultPath: `${base}${version.isLatest ? "" : `-v${version.number}`}.${extension}`,
		filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
	};
	const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
	if (result.canceled || !result.filePath) return null;
	copyFileSync(source, result.filePath);
	return result.filePath;
}

/** Saves a copy of the newest version, which is what a list row stands for. */
export async function downloadLatest(id: string, db: Db = getDb()): Promise<string | null> {
	const latest = versions.list(id, db).find((version) => version.isLatest);
	if (!latest) throw new Error("This document has no file yet.");
	return downloadVersion(latest.id, db);
}

/**
 * Asks, in a native dialog, whether to go on when the version being looked at is
 * not the newest. True straight away for the newest.
 *
 * The wording says what will really happen. Downloading saves the version that
 * is on screen. Sending by email and signing both work on the newest whichever
 * version is on screen, so for those the question is whether the newest is what
 * was meant.
 */
export async function confirmVersionUse(versionId: string, use: VersionUse, db: Db = getDb()): Promise<boolean> {
	const { version, total } = versions.get(versionId, db);
	if (version.isLatest) return true;

	const detail =
		use === "download"
			? `This saves version ${version.number}, the one you are looking at. Download it anyway?`
			: use === "email"
				? `Sending by email attaches the latest version (${total}), not version ${version.number}. Continue?`
				: `Signing stamps the latest version (${total}), not version ${version.number}. Continue?`;
	const options = {
		type: "question" as const,
		title: "Not the latest version",
		message: `You are looking at version ${version.number} of ${total}, not the latest.`,
		detail,
		buttons: ["Yes", "No"],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	};
	const parent = BrowserWindow.getFocusedWindow();
	const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
	return result.response === 0;
}

/**
 * Deletes one version after a native yes or no. False when the person says no.
 * The question lives here, not in the window, so the agent's tool goes through
 * the same gate.
 */
export async function deleteVersion(versionId: string, db: Db = getDb()): Promise<boolean> {
	const { version, total } = versions.get(versionId, db);
	if (total <= 1) throw new Error("This is the only version. Delete the document instead.");

	const options = {
		type: "warning" as const,
		title: "Delete version",
		message: `Delete version ${version.number} of ${total}?`,
		detail: version.isLatest
			? "It is the latest version, so the document will open as the one before it."
			: "The other versions are not changed.",
		buttons: ["Delete", "Cancel"],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	};
	const parent = BrowserWindow.getFocusedWindow();
	const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
	if (result.response !== 0) return false;
	versions.remove(versionId, db);
	return true;
}

/** The signing details of one signed version, as their own PDF. */
export async function openCertificate(versionId: string, db: Db = getDb()): Promise<void> {
	await openPath(versions.certificatePathOf(versionId, db));
}

async function openPath(path: string): Promise<void> {
	const error = await shell.openPath(path);
	if (error) throw new Error(error);
}
