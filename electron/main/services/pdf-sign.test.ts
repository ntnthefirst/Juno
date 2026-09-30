import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { signPdf } from "./pdf-sign";
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
