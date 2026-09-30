/**
 * Stamps a signature onto a PDF, appends the audit page and, when asked, seals
 * the whole file with a cryptographic signature.
 *
 * No Electron import, so the stamp geometry, the audit page and the seal are
 * covered by tests in plain Node.
 *
 * Two different things are written and the audit page says which:
 *
 * - The **stamp** is a picture, a name and a time, with a SHA-256 hash of the
 *   unsigned bytes. It shows who signed and lets a changed file be noticed.
 * - The **digital signature** is a PAdES detached signature (CMS, SHA-256) made
 *   with the person's own certificate over every byte of the final file, so
 *   any later edit breaks it in a PDF reader. It is as trustworthy as the
 *   certificate. Decision 8 still binds: nothing here is a qualified electronic
 *   signature under eIDAS, and no text may say it is.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import signpdf from "@signpdf/signpdf";
import type { StampPlacement } from "../../shared/types";
import { STAMP_DEFAULT_WIDTH, stampMetrics } from "../../shared/stamp";
import { formatDateTime } from "./document-context";

export interface DigitalOptions {
	p12: Uint8Array;
	passphrase: string;
	subject: string;
	issuer: string;
	fingerprint: string;
	validTo: string;
}

export interface SignOptions {
	pdfPath: string;
	outputPath: string;
	signatureImagePath: string | null;
	signerName: string;
	signerRole?: string | null;
	signedAt: string;
	documentTitle: string;
	templateName: string;
	templateVersion: number | null;
	isSpecimen: boolean;
	placement?: StampPlacement;
	digital?: DigitalOptions | null;
}

export interface SignResult {
	documentHash: string;
	audit: Record<string, unknown>;
}

const DEFAULT_PLACEMENT = { x: 0.08, y: 0.86, width: STAMP_DEFAULT_WIDTH };

/**
 * Standard fonts only encode Latin-1. A certificate subject or a signer name
 * with anything outside it would make pdf-lib throw halfway through the file,
 * so text is reduced to what the font can draw before it is written.
 */
function drawable(text: string, font: PDFFont): string {
	try {
		font.encodeText(text);
		return text;
	} catch {
		const plain = text.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
		return plain || "?";
	}
}

/** The largest size at or below `size` that keeps `value` inside `maxWidth`. */
function fitted(value: string, font: PDFFont, size: number, maxWidth: number): number {
	const width = font.widthOfTextAtSize(value, size);
	return width <= maxWidth ? size : size * (maxWidth / width);
}

export async function signPdf(options: SignOptions): Promise<SignResult> {
	const originalBytes = readFileSync(options.pdfPath);
	const documentHash = createHash("sha256").update(originalBytes).digest("hex");

	const pdf = await PDFDocument.load(originalBytes);
	const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
	const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const text = (value: string, bold = false) => drawable(value, bold ? helveticaBold : helvetica);

	const pages = pdf.getPages();
	const placement = options.placement ?? { page: pages.length, ...DEFAULT_PLACEMENT };
	const page = pages[placement.page - 1];
	if (!page) throw new Error(`The document has no page ${placement.page}.`);
	if (page.getRotation().angle !== 0) {
		throw new Error(`Page ${placement.page} is rotated. Rotate it upright in a PDF editor first.`);
	}

	const image =
		options.signatureImagePath === null ? null : await pdf.embedPng(readFileSync(options.signatureImagePath));
	const box = page.getMediaBox();
	const stampWidth = box.width * placement.width;
	const metrics = stampMetrics(stampWidth, image ? image.height / image.width : null);

	// Top left of the stamp, in PDF space where y grows upward.
	const left = box.x + box.width * placement.x;
	const top = box.y + box.height - box.height * placement.y;
	let cursor = top - metrics.padding;
	if (image) {
		const scale = Math.min((stampWidth - metrics.padding * 2) / image.width, metrics.imageHeight / image.height);
		const drawWidth = image.width * scale;
		const drawHeight = image.height * scale;
		page.drawImage(image, { x: left + metrics.padding, y: cursor - drawHeight, width: drawWidth, height: drawHeight });
		cursor -= metrics.imageHeight + metrics.gap;
	}
	const who = text(`${options.signerName}${options.signerRole ? `, ${options.signerRole}` : ""}`, true);
	const inner = stampWidth - metrics.padding * 2;
	page.drawText(who, {
		x: left + metrics.padding,
		y: cursor - metrics.nameSize,
		size: fitted(who, helveticaBold, metrics.nameSize, inner),
		font: helveticaBold,
		color: rgb(0.07, 0.07, 0.07),
	});
	cursor -= metrics.nameSize * 1.2 + metrics.gap;
	const when = text(`Ondertekend op ${formatDateTime(options.signedAt)}`);
	page.drawText(when, {
		x: left + metrics.padding,
		y: cursor - metrics.dateSize,
		size: fitted(when, helvetica, metrics.dateSize, inner),
		font: helvetica,
		color: rgb(0.35, 0.35, 0.35),
	});

	// The audit page. Plain, complete, and explicit about what this signature is
	// not, because that sentence is the whole point of it being here.
	const audit = pdf.addPage();
	const { height } = audit.getSize();
	let y = height - 70;
	const line = (value: string, size = 9, bold = false, gap = 14) => {
		audit.drawText(text(value, bold), {
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
	line(`Ondertekenaar: ${who}`);
	line(`Tijdstip: ${formatDateTime(options.signedAt)}`);
	line(`Tijdstip (UTC, exact): ${options.signedAt}`, 8);
	line(`Plaats van de stempel: pagina ${placement.page} van ${pages.length}`, 9, false, 20);
	line("SHA-256 van het bestand voor ondertekening:", 9, true);
	// Split, because a 64 character hash does not fit on one line at this size.
	line(documentHash.slice(0, 32), 9);
	line(documentHash.slice(32), 9, false, 22);

	if (options.digital) {
		line("Digitale handtekening", 11, true, 18);
		line(`Certificaat van: ${options.digital.subject}`);
		line(`Uitgegeven door: ${options.digital.issuer}`);
		line(`Geldig tot: ${options.digital.validTo.slice(0, 10)}`);
		line("SHA-256 van het certificaat:");
		line(options.digital.fingerprint.slice(0, 32));
		line(options.digital.fingerprint.slice(32), 9, false, 22);
	}

	line("Wat deze ondertekening is", 11, true, 18);
	for (const value of options.digital
		? [
				"Een stempel met naam en tijdstip, een controlegetal van het bestand en een",
				"digitale handtekening (PAdES) gemaakt met het certificaat hierboven. Een PDF-lezer",
				"toont of het bestand sinds de ondertekening is gewijzigd en door wie het is getekend.",
			]
		: [
				"Een afbeelding van een handtekening, een tijdstip en een controlegetal van",
				"het ondertekende bestand. Daarmee is achteraf vast te stellen of het bestand",
				"nadien is gewijzigd.",
			]) {
		line(value);
	}
	y -= 6;
	line("Wat deze ondertekening niet is", 11, true, 18);
	for (const value of [
		"Dit is geen gekwalificeerde elektronische handtekening in de zin van de",
		"eIDAS-verordening. Voor overeenkomsten waar dat vereist is, gebruik een",
		"daartoe erkende dienstverlener.",
	]) {
		line(value);
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

	let output: Uint8Array;
	if (options.digital) {
		// Object streams off: the signature has to be able to find its own
		// placeholder by byte offset, and a compressed object cannot be found.
		pdflibAddPlaceholder({
			pdfDoc: pdf,
			reason: "Ondertekend met Juno",
			contactInfo: "",
			name: text(options.signerName),
			location: "",
			signingTime: new Date(options.signedAt),
			// A certificate chain from a certificate authority can be several kB.
			signatureLength: 20000,
			appName: "Juno",
		});
		const unsealed = await pdf.save({ useObjectStreams: false });
		try {
			const signer = new P12Signer(options.digital.p12, { passphrase: options.digital.passphrase });
			output = await signpdf.sign(unsealed, signer, new Date(options.signedAt));
		} catch (cause) {
			// The library reports a wrong passphrase in the words of the PKCS#12 spec.
			if (cause instanceof Error && /mac|password|passphrase/i.test(cause.message)) {
				throw new Error("The certificate passphrase was not accepted. Check it and try again.");
			}
			throw cause;
		}
	} else {
		output = await pdf.save();
	}

	writeFileSync(options.outputPath, output);

	return {
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
			signatureImage: image ? "embedded" : "none",
			placement,
			digital: options.digital
				? {
						subject: options.digital.subject,
						issuer: options.digital.issuer,
						fingerprint: options.digital.fingerprint,
						validTo: options.digital.validTo,
					}
				: null,
		},
	};
}
