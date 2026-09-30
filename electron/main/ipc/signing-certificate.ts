/** Certificate channels. Thin: the rules are in ../services/signing-certificate.ts. */
import { ipcMain } from "electron";
import * as actions from "../services/signing-certificate-actions";
import * as certificate from "../services/signing-certificate";

export function registerSigningCertificateIpc(): void {
	ipcMain.handle("signingCertificate.get", () => certificate.get());
	ipcMain.handle("signingCertificate.choose", (_event, passphrase: string) => actions.choose(passphrase));
	ipcMain.handle("signingCertificate.remove", () => certificate.remove());
}
