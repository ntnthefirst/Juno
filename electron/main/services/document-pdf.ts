/**
 * Turns a rendered document into a PDF, and stamps a signature onto one.
 *
 * This is the only part of document generation that needs Electron, so it is
 * kept apart from documents.ts, which stays testable in plain Node.
 *
 * The signature is a PNG, a timestamp and a hash of the exact bytes that were
 * signed. Decision 8 is binding on what that is worth: appropriate for
 * low-stakes and internal documents, and NOT a qualified electronic signature
 * under eIDAS. Nothing here should imply otherwise.
 */
import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatDateTime } from "./document-context";
import { documentShell } from "./document-style";

let documentsDir = "";

export function configureDocuments(directory: string): void {
	documentsDir = directory;
}

function outputDir(): string {
	if (!documentsDir) {
		throw new Error("configureDocuments() was not called before a document was rendered.");
	}
	if (!existsSync(documentsDir)) mkdirSync(documentsDir, { recursive: true });
	return documentsDir;
}

/**
 * The document faces, inlined as data URIs. An offscreen window cannot see the
 * renderer's bundled assets, and a contract that falls back to a system font
 * looks different on every machine.
 */
let fontCss: string | null = null;

function embeddedFontCss(): string {
	if (fontCss !== null) return fontCss;
	const dir = join(__dirname, "..", "..", "fonts");
	const face = (file: string, weight: number) => {
		const path = join(dir, file);
		if (!existsSync(path)) return "";
		const base64 = readFileSync(path).toString("base64");
		return `@font-face{font-family:"Inter";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${base64}) format("woff2");}`;
	};
	fontCss =
		face("inter-latin-400-normal.woff2", 400) + face("inter-latin-600-normal.woff2", 600);
	return fontCss;
}

export interface RenderOptions {
	title: string;
	bodyHtml: string;
	isSpecimen: boolean;
	language?: string;
	fileName: string;
}

/**
 * Renders HTML to a PDF file and returns its path.
 *
 * The waiting matters. printToPDF on a window that has not finished loading
 * produces a blank or half-rendered page and does not error, which is the single
 * most likely way for this to fail silently. See .claude/rules/verify.md.
 */
export async function renderPdf(options: RenderOptions): Promise<string> {
	const html = documentShell({
		title: options.title,
		bodyHtml: options.bodyHtml,
		isSpecimen: options.isSpecimen,
		language: options.language,
	}).replace("<style>", `<style>${embeddedFontCss()}`);

	const window = new BrowserWindow({
		show: false,
		width: 900,
		height: 1200,
		webPreferences: {
			offscreen: true,
			// Nothing in a document may run. The body is rendered from the operator's
			// own template, but it quotes client data, and a contract has no reason
			// to execute anything.
			javascript: false,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	try {
		await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
		// loadURL resolves on did-finish-load, but layout with a just-decoded font
		// settles a frame later. Without this the first page can print in the
		// fallback face.
		await new Promise((resolve) => setTimeout(resolve, 350));

		const pdf = await window.webContents.printToPDF({
			pageSize: "A4",
			printBackground: true,
			// The stylesheet owns the margins through @page, so Electron adds none.
			margins: { marginType: "none" },
		});

		const path = join(outputDir(), options.fileName);
		writeFileSync(path, pdf);
		return path;
	} finally {
		// An offscreen window that is never closed leaks a renderer process, and
		// generating a few documents in a row would leave several running.
		if (!window.isDestroyed()) window.destroy();
	}
}

export function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface SignOptions {
	pdfPath: string;
	signatureImagePath: string | null;
	signerName: string;
	signerRole?: string | null;
	signedAt: string;
	documentTitle: string;
	templateName: string;
	templateVersion: number | null;
	isSpecimen: boolean;
	fileName: string;
}

export interface SignResult {
	signedPdfPath: string;
	documentHash: string;
	audit: Record<string, unknown>;
}

/**
 * Stamps the signature onto the last page and appends an audit page.
 *
 * The hash is taken of the unsigned file, before anything is added, so it
 * identifies exactly what the person was looking at when they signed.
 */
export async function signPdf(options: SignOptions): Promise<SignResult> {
	const originalBytes = readFileSync(options.pdfPath);
	const documentHash = createHash("sha256").update(originalBytes).digest("hex");

	const pdf = await PDFDocument.load(originalBytes);
	const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
	const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

	const pages = pdf.getPages();
	const last = pages[pages.length - 1]!;

	if (options.signatureImagePath && existsSync(options.signatureImagePath)) {
		const image = await pdf.embedPng(readFileSync(options.signatureImagePath));
		const maxWidth = 160;
		const scale = Math.min(1, maxWidth / image.width);
		const width = image.width * scale;
		const height = image.height * scale;
		last.drawImage(image, {
			x: 60,
			y: 90,
			width,
			height,
		});
	}

	last.drawText(`${options.signerName}${options.signerRole ? `, ${options.signerRole}` : ""}`, {
		x: 60,
		y: 74,
		size: 9,
		font: helveticaBold,
		color: rgb(0.07, 0.07, 0.07),
	});
	last.drawText(`Ondertekend op ${formatDateTime(options.signedAt)}`, {
		x: 60,
		y: 62,
		size: 8,
		font: helvetica,
		color: rgb(0.35, 0.35, 0.35),
	});

	// The audit page. Plain, complete, and explicit about what this signature is
	// not, because that sentence is the whole point of it being here.
	const audit = pdf.addPage();
	const { height } = audit.getSize();
	let y = height - 70;
	const line = (text: string, size = 9, bold = false, gap = 14) => {
		audit.drawText(text, {
			x: 60,
			y,
			size,
			font: bold ? helveticaBold : helvetica,
			color: rgb(0.1, 0.1, 0.1),
		});
		y -= gap;
	};

	line("Ondertekeningsgegevens", 13, true, 26);
	line(`Document: ${options.documentTitle}`);
	line(`Sjabloon: ${options.templateName}${options.templateVersion ? ` (versie ${options.templateVersion})` : ""}`);
	line(`Ondertekenaar: ${options.signerName}${options.signerRole ? `, ${options.signerRole}` : ""}`);
	line(`Tijdstip: ${formatDateTime(options.signedAt)}`);
	line(`Tijdstip (UTC, exact): ${options.signedAt}`, 8);
	y -= 6;
	line("SHA-256 van het ondertekende bestand:", 9, true);
	// Split, because a 64 character hash does not fit on one line at this size.
	line(documentHash.slice(0, 32), 9);
	line(documentHash.slice(32), 9, false, 22);

	line("Wat deze handtekening is", 11, true, 18);
	for (const text of [
		"Een afbeelding van een handtekening, een tijdstip en een controlegetal van",
		"het ondertekende bestand. Daarmee is achteraf vast te stellen of het bestand",
		"nadien is gewijzigd.",
	]) {
		line(text);
	}
	y -= 6;
	line("Wat deze handtekening niet is", 11, true, 18);
	for (const text of [
		"Dit is geen gekwalificeerde elektronische handtekening in de zin van de",
		"eIDAS-verordening. Voor overeenkomsten waar dat vereist is, gebruik een",
		"daartoe erkende dienstverlener.",
	]) {
		line(text);
	}

	if (options.isSpecimen) {
		y -= 10;
		audit.drawText("LET OP: VOORBEELDDOCUMENT, NIET JURIDISCH NAGEKEKEN.", {
			x: 60,
			y,
			size: 10,
			font: helveticaBold,
			color: rgb(0.56, 0.13, 0.13),
		});
	}

	const signedPdfPath = join(outputDir(), options.fileName);
	writeFileSync(signedPdfPath, await pdf.save());

	return {
		signedPdfPath,
		documentHash,
		audit: {
			documentTitle: options.documentTitle,
			templateName: options.templateName,
			templateVersion: options.templateVersion,
			signerName: options.signerName,
			signerRole: options.signerRole ?? null,
			signedAt: options.signedAt,
			documentHash,
			isSpecimen: options.isSpecimen,
			signatureImage: options.signatureImagePath ? "embedded" : "none",
		},
	};
}
