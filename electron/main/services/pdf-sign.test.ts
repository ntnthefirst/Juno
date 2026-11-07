import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { createHash } from "node:crypto";
import { PDFDocument, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { stampMetrics } from "../../shared/stamp";
import { signPdf, visibleFrame } from "./pdf-sign";
import { inspectP12 } from "./signing-certificate";
import { makeP12 } from "./signing-fixtures";

async function fixture(pages = 2): Promise<{ dir: string; path: string }> {
	const dir = mkdtempSync(join(tmpdir(), "juno-sign-"));
	const doc = await PDFDocument.create();
	for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]);
	const path = join(dir, "in.pdf");
	writeFileSync(path, await doc.save());
	return { dir, path };
}

const base = {
	signatureImagePath: null,
	signerName: "Nathan Perron",
	signedAt: "2026-09-30T09:00:00.000Z",
	documentTitle: "Contract",
	templateName: "NDA",
	templateVersion: 1,
	isSpecimen: false,
};

describe("signPdf", () => {
	it("stamps on the chosen page and leaves the page count alone", async () => {
		const { dir, path } = await fixture(2);
		const outputPath = join(dir, "out.pdf");
		const result = await signPdf({
			...base,
			pdfPath: path,
			outputPath,
			placement: { page: 1, x: 0.1, y: 0.2, width: 0.3 },
		});
		const out = await PDFDocument.load(readFileSync(outputPath));
		expect(out.getPageCount()).toBe(2);
		expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
		expect(result.audit.digital).toBeNull();
		expect(result.audit.placement).toEqual({ page: 1, x: 0.1, y: 0.2, width: 0.3 });
	});

	it("writes the signing details as a .cert.pdf beside the signed file", async () => {
		const { dir, path } = await fixture(2);
		const outputPath = join(dir, "contract-ondertekend.pdf");
		const result = await signPdf({ ...base, pdfPath: path, outputPath });
		expect(result.certificatePath).toBe(join(dir, "contract-ondertekend.cert.pdf"));
		const cert = await PDFDocument.load(readFileSync(result.certificatePath));
		expect(cert.getPageCount()).toBe(1);
		// The hash of the signed file is what lets the certificate be checked against it.
		expect(result.signedHash).toBe(createHash("sha256").update(readFileSync(outputPath)).digest("hex"));
		expect(result.signedHash).not.toBe(result.documentHash);
	});

	it("leaves the name and the date off when asked, with the image alone", async () => {
		const { dir, path } = await fixture(1);
		// A 1x1 transparent PNG, enough to be an image to place.
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
			"base64",
		);
		const imagePath = join(dir, "signature.png");
		writeFileSync(imagePath, png);
		const withDetails = join(dir, "with.pdf");
		const without = join(dir, "without.pdf");
		await signPdf({ ...base, pdfPath: path, outputPath: withDetails, signatureImagePath: imagePath });
		await signPdf({ ...base, pdfPath: path, outputPath: without, signatureImagePath: imagePath, showDetails: false });
		// Two lines of text fewer in the page content, so the file is smaller.
		expect(readFileSync(without).length).toBeLessThan(readFileSync(withDetails).length);
	});

	it("refuses to stamp nothing", async () => {
		const { dir, path } = await fixture(1);
		await expect(
			signPdf({ ...base, pdfPath: path, outputPath: join(dir, "o.pdf"), showDetails: false }),
		).rejects.toThrow(/needs a signature image/);
	});

	it("refuses a page that does not exist", async () => {
		const { dir, path } = await fixture(1);
		await expect(
			signPdf({ ...base, pdfPath: path, outputPath: join(dir, "o.pdf"), placement: { page: 4, x: 0, y: 0, width: 0.3 } }),
		).rejects.toThrow(/no page 4/);
	});

	it("seals the file with a signature that covers every byte", async () => {
		const { dir, path } = await fixture(1);
		const outputPath = join(dir, "sealed.pdf");
		const p12 = makeP12({ passphrase: "pw" });
		const { info } = inspectP12(p12, "pw");
		const result = await signPdf({
			...base,
			pdfPath: path,
			outputPath,
			digital: { p12, passphrase: "pw", ...info },
		});
		const bytes = readFileSync(outputPath).toString("latin1");
		expect(bytes).toContain("/Type /Sig");
		expect(bytes).toContain("adbe.pkcs7.detached");
		// The byte range must be filled in and end exactly at the end of the file.
		const range = /\/ByteRange \[\s*0 (\d+) (\d+) (\d+)\s*\]/.exec(bytes);
		expect(range).not.toBeNull();
		expect(Number(range![2]) + Number(range![3])).toBe(readFileSync(outputPath).length);
		expect((result.audit.digital as { fingerprint: string }).fingerprint).toBe(info.fingerprint);
	});

	it("produces a signature that verifies against the certificate, and breaks when a byte changes", async () => {
		const { dir, path } = await fixture(1);
		const outputPath = join(dir, "verify.pdf");
		const p12 = makeP12({ passphrase: "pw" });
		const { info } = inspectP12(p12, "pw");
		await signPdf({ ...base, pdfPath: path, outputPath, digital: { p12, passphrase: "pw", ...info } });

		const file = readFileSync(outputPath);
		expect(verifies(file)).toBe(true);

		// Flip one byte inside the signed range: the signature has to stop holding.
		const tampered = Buffer.from(file);
		tampered[20] = tampered[20]! ^ 0xff;
		expect(verifies(tampered)).toBe(false);
	});

	it("does not write a file when the passphrase is wrong", async () => {
		const { dir, path } = await fixture(1);
		const p12 = makeP12({ passphrase: "pw" });
		await expect(
			signPdf({
				...base,
				pdfPath: path,
				outputPath: join(dir, "never.pdf"),
				digital: { p12, passphrase: "wrong", subject: "x", issuer: "y", fingerprint: "0".repeat(64), validTo: "2030-01-01T00:00:00.000Z" },
			}),
		).rejects.toThrow(/passphrase was not accepted/);
		expect(() => readFileSync(join(dir, "never.pdf"))).toThrow();
	});
});

/**
 * Checks a detached PKCS#7 signature by hand: the digest in the signed
 * attributes has to match the byte range, and the signature over those
 * attributes has to verify with the certificate that came with it.
 */
function verifies(file: Buffer): boolean {
	const text = file.toString("latin1");
	const range = /\/ByteRange \[\s*(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(text)!;
	const [start1, length1, start2, length2] = range.slice(1).map(Number) as [number, number, number, number];
	const signed = Buffer.concat([file.subarray(start1, start1 + length1), file.subarray(start2, start2 + length2)]);

	const hex = text.slice(start1 + length1 + 1, start2 - 1).replace(/0+$/, "");
	const der = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
	const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der.toString("binary")))) as unknown as {
		certificates: forge.pki.Certificate[];
		rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
	};

	const attributes = p7.rawCapture.authenticatedAttributes;
	const digestAttribute = attributes.find((node) => {
		const value = node.value as forge.asn1.Asn1[];
		return forge.asn1.derToOid(value[0]!.value as string) === forge.pki.oids.messageDigest;
	})!;
	const digest = ((digestAttribute.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[])[0]!.value as string;
	if (Buffer.from(digest, "binary").toString("hex") !== createHash("sha256").update(signed).digest("hex")) {
		return false;
	}

	const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attributes);
	const md = forge.md.sha256.create();
	md.update(forge.asn1.toDer(set).getBytes());
	return (p7.certificates[0]!.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), p7.rawCapture.signature);
}

/** The first text matrix on the page, which is where the stamp's name starts and which way it runs. */
async function firstTextMatrix(bytes: Uint8Array): Promise<number[]> {
	const doc = await PDFDocument.load(bytes);
	for (const [, object] of doc.context.enumerateIndirectObjects()) {
		if (!(object instanceof PDFRawStream)) continue;
		const text = Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
		const found = /(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) Tm/.exec(text);
		if (found) return found.slice(1, 7).map(Number);
	}
	throw new Error("No text on the page.");
}

/** Where a point of the stored page shows up for a viewer that turns the page clockwise. */
function seenAt(angle: number, w: number, h: number, px: number, py: number): { u: number; v: number } {
	if (angle === 90) return { u: py, v: w - px };
	if (angle === 180) return { u: w - px, v: h - py };
	if (angle === 270) return { u: h - py, v: px };
	return { u: px, v: py };
}

describe("signPdf on a rotated page", () => {
	const placement = { page: 1, x: 0.1, y: 0.2, width: 0.3 };

	for (const angle of [0, 90, 180, 270]) {
		it(`puts the stamp at the same place on the page as seen, turned ${angle} degrees`, async () => {
			const dir = mkdtempSync(join(tmpdir(), "juno-sign-rot-"));
			const doc = await PDFDocument.create();
			doc.addPage([595, 842]).setRotation(degrees(angle));
			const path = join(dir, "in.pdf");
			writeFileSync(path, await doc.save());
			const outputPath = join(dir, "out.pdf");
			const result = await signPdf({ ...base, pdfPath: path, outputPath, placement });

			const [a, b, , , e, f] = await firstTextMatrix(readFileSync(outputPath));
			// The text runs along the viewer's horizontal: turned by the page's own angle.
			expect((Math.round(Math.atan2(b!, a!) * (180 / Math.PI)) + 360) % 360).toBe(angle);

			const sideways = angle === 90 || angle === 270;
			const visibleWidth = sideways ? 842 : 595;
			const visibleHeight = sideways ? 595 : 842;
			const metrics = stampMetrics(visibleWidth * placement.width, null, true);
			const seen = seenAt(angle, 595, 842, e!, f!);
			expect(seen.u).toBeCloseTo(visibleWidth * placement.x + metrics.padding, 3);
			expect(seen.v).toBeCloseTo(visibleHeight - visibleHeight * placement.y - metrics.padding - metrics.nameSize, 3);

			// The audit page keeps the placement as the owner chose it, and the hash is of the original file.
			expect(result.audit.placement).toEqual(placement);
			expect(result.documentHash).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
		});
	}

	it("refuses a page turned by something that is not a quarter turn", async () => {
		expect(() => visibleFrame({ x: 0, y: 0, width: 10, height: 20 }, 45)).toThrow(/quarter turns/);
		expect(visibleFrame({ x: 0, y: 0, width: 10, height: 20 }, -90).rotation).toBe(270);
	});

	it("keeps a media box that does not start at zero", () => {
		const frame = visibleFrame({ x: 50, y: 100, width: 200, height: 300 }, 90);
		expect(frame.width).toBe(300);
		expect(frame.toPage(0, 0)).toEqual({ x: 250, y: 100 });
		expect(frame.toPage(300, 200)).toEqual({ x: 50, y: 400 });
	});
});
