/**
 * The certificate a digital signature is made with.
 *
 * A PKCS#12 file (.p12 or .pfx) holds a certificate and its private key,
 * protected by a passphrase. That is the form a certificate authority hands one
 * out in, and the form Juno accepts. Two rules follow from what it is:
 *
 * - The file goes into the OS keychain through the credential store, as it
 *   arrived. It is already encrypted by its own passphrase, and the keychain
 *   adds a second lock.
 * - **The passphrase is never stored.** It is asked for at every signature, so
 *   a signature is an act by the person at the keyboard and not something an
 *   unlocked window can do alone. Only what is public about the certificate is
 *   kept next to it, so settings can show it without the passphrase.
 *
 * Nothing here is returned across IPC except that public part. There is no tool
 * for it either: an agent may not sign (see mcp/documents.ts).
 *
 * This module has no Electron import so the parsing rules are tested in plain
 * Node. The file picker is in signing-certificate-actions.ts.
 */
import forge from "node-forge";
import { createHash } from "node:crypto";
import type { SigningCertificateInfo } from "../../shared/types";
import { credentialStore } from "./mail-credentials";

const P12_KEY = "signing-certificate";
const INFO_KEY = "signing-certificate-info";

const MAX_P12_BYTES = 256 * 1024;

export interface OpenedCertificate {
	info: Omit<SigningCertificateInfo, "importedAt">;
}

function nameOf(attributes: forge.pki.CertificateField[]): string {
	const pick = (short: string) => attributes.find((entry) => entry.shortName === short)?.value;
	const parts = [pick("CN"), pick("O")].filter((value): value is string => typeof value === "string" && value.length > 0);
	if (parts.length > 0) return parts.join(", ");
	return attributes.map((entry) => String(entry.value)).join(", ") || "Unnamed";
}

/**
 * Opens a PKCS#12 file and reads what is public about its certificate.
 *
 * Throws in plain words for every way it can fail, because each one has a
 * different fix: a wrong passphrase, a file that is not a certificate, a
 * certificate with no key to sign with, one that has expired, and one that is
 * not meant for signing.
 */
export function inspectP12(
	p12: Uint8Array,
	passphrase: string,
	at: Date = new Date(),
): OpenedCertificate {
	if (p12.length === 0 || p12.length > MAX_P12_BYTES) {
		throw new Error("That file does not look like a certificate. Choose the .p12 or .pfx file you were given.");
	}

	let parsed: forge.pkcs12.Pkcs12Pfx;
	try {
		const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(p12).toString("binary")));
		parsed = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : "";
		if (/mac|password|passphrase|decrypt/i.test(message)) {
			throw new Error("The certificate passphrase was not accepted. Check it and try again.");
		}
		throw new Error("That file does not look like a certificate. Choose the .p12 or .pfx file you were given.");
	}

	const keyBags = [
		...(parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
		...(parsed.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
	];
	if (keyBags.length === 0 || !keyBags[0]?.key) {
		throw new Error("That certificate has no private key in it, so it cannot sign. Ask for the file that includes the key.");
	}

	const certBags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
	const certificates = certBags
		.map((bag) => bag.cert)
		.filter((cert): cert is forge.pki.Certificate => Boolean(cert));
	if (certificates.length === 0) {
		throw new Error("That file has no certificate in it. Choose the .p12 or .pfx file you were given.");
	}

	// The certificate that belongs to the key, not one of the chain above it.
	const keyPublic = forge.pki.setRsaPublicKey(
		(keyBags[0].key as forge.pki.rsa.PrivateKey).n,
		(keyBags[0].key as forge.pki.rsa.PrivateKey).e,
	);
	const wanted = forge.pki.publicKeyToPem(keyPublic);
	const own = certificates.find((cert) => forge.pki.publicKeyToPem(cert.publicKey) === wanted);
	if (!own) {
		throw new Error("The private key in that file does not match any certificate in it.");
	}

	if (at < own.validity.notBefore) {
		throw new Error(`That certificate is not valid until ${own.validity.notBefore.toISOString().slice(0, 10)}.`);
	}
	if (at > own.validity.notAfter) {
		throw new Error(`That certificate expired on ${own.validity.notAfter.toISOString().slice(0, 10)}. Ask for a new one.`);
	}

	const usage = own.getExtension("keyUsage") as { digitalSignature?: boolean; nonRepudiation?: boolean } | null;
	if (usage && !usage.digitalSignature && !usage.nonRepudiation) {
		throw new Error("That certificate is not meant for signing documents.");
	}

	const der = forge.asn1.toDer(forge.pki.certificateToAsn1(own)).getBytes();
	return {
		info: {
			subject: nameOf(own.subject.attributes),
			issuer: nameOf(own.issuer.attributes),
			serialNumber: own.serialNumber,
			fingerprint: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex"),
			validFrom: own.validity.notBefore.toISOString(),
			validTo: own.validity.notAfter.toISOString(),
		},
	};
}

export function get(): SigningCertificateInfo | null {
	const raw = credentialStore().get(INFO_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as SigningCertificateInfo;
	} catch {
		return null;
	}
}

/** The stored file, for the signing step only. Never crosses IPC. */
export function readP12(): Buffer | null {
	const raw = credentialStore().get(P12_KEY);
	return raw ? Buffer.from(raw, "base64") : null;
}

export function save(p12: Uint8Array, passphrase: string, now: Date = new Date()): SigningCertificateInfo {
	const store = credentialStore();
	if (!store.isAvailable()) {
		throw new Error("The operating system keychain is unavailable, so the certificate cannot be stored safely.");
	}
	const { info } = inspectP12(p12, passphrase, now);
	const stored: SigningCertificateInfo = { ...info, importedAt: now.toISOString() };
	store.set(P12_KEY, Buffer.from(p12).toString("base64"));
	store.set(INFO_KEY, JSON.stringify(stored));
	return stored;
}

export function remove(): void {
	const store = credentialStore();
	store.delete(P12_KEY);
	store.delete(INFO_KEY);
}
