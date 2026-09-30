/** The file picker for the signing certificate, kept apart so the rules stay testable. */
import { dialog } from "electron";
import { readFileSync, statSync } from "node:fs";
import type { SigningCertificateInfo } from "../../shared/types";
import * as certificate from "./signing-certificate";

/** Null when the picker is cancelled, which is not an error and stores nothing. */
export async function choose(passphrase: string): Promise<SigningCertificateInfo | null> {
	if (!passphrase) throw new Error("Enter the certificate passphrase first.");
	const result = await dialog.showOpenDialog({
		title: "Kies een certificaat",
		properties: ["openFile"],
		filters: [{ name: "Certificaat", extensions: ["p12", "pfx"] }],
	});
	if (result.canceled || result.filePaths.length === 0) return null;

	const path = result.filePaths[0]!;
	if (statSync(path).size > 256 * 1024) {
		throw new Error("That file is too large to be a certificate. Choose the .p12 or .pfx file you were given.");
	}
	return certificate.save(readFileSync(path), passphrase);
}
