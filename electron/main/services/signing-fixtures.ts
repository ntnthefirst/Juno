/** A throwaway certificate for tests. Never imported by application code. */
import forge from "node-forge";
import { generateKeyPairSync } from "node:crypto";

export function makeP12(options: {
	passphrase: string;
	commonName?: string;
	notBefore?: Date;
	notAfter?: Date;
	digitalSignature?: boolean;
}): Uint8Array {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const cert = forge.pki.createCertificate();
	cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
	cert.serialNumber = "01";
	cert.validity.notBefore = options.notBefore ?? new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = options.notAfter ?? new Date(Date.now() + 365 * 86_400_000);
	const subject = [
		{ name: "commonName", value: options.commonName ?? "Test Signer" },
		{ name: "organizationName", value: "Juno Tests" },
	];
	cert.setSubject(subject);
	cert.setIssuer(subject);
	cert.setExtensions([
		{ name: "keyUsage", digitalSignature: options.digitalSignature ?? true, nonRepudiation: options.digitalSignature ?? true },
	]);
	const key = forge.pki.privateKeyFromPem(privateKey);
	cert.sign(key, forge.md.sha256.create());
	const asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert], options.passphrase, { algorithm: "3des" });
	return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}
