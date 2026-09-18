/**
 * The credential store backed by Electron safeStorage: Windows DPAPI, the macOS
 * Keychain, or libsecret. One file per key under the user data directory, each
 * holding nothing but the encrypted secret.
 *
 * The same two rules as vault.ts apply. safeStorage is unusable before
 * `app.whenReady()`, so every entry point asserts readiness, and a store that
 * cannot encrypt refuses to write rather than falling back to plaintext.
 */
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStore } from "./services/mail-credentials";

function directory(): string {
	const dir = join(app.getPath("userData"), "credentials");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function fileFor(key: string): string {
	// Keys are UUIDs the service generated. Anything else is a bug upstream, and
	// refusing it keeps a key from ever becoming a path.
	if (!/^[a-z0-9-]+$/i.test(key)) throw new Error("A credential key has to be an id.");
	return join(directory(), `${key}.bin`);
}

function assertReady(): void {
	if (!app.isReady()) {
		throw new Error("The credential store was used before the app was ready.");
	}
}

export const safeStorageCredentialStore: CredentialStore = {
	isAvailable() {
		assertReady();
		return safeStorage.isEncryptionAvailable();
	},

	set(key, secret) {
		assertReady();
		if (!safeStorage.isEncryptionAvailable()) {
			throw new Error(
				"The operating system keychain is unavailable, so the password cannot be stored.",
			);
		}
		const path = fileFor(key);
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, safeStorage.encryptString(secret));
		renameSync(tmp, path);
	},

	get(key) {
		assertReady();
		const path = fileFor(key);
		if (!existsSync(path)) return null;
		try {
			return safeStorage.decryptString(readFileSync(path));
		} catch {
			// Written by a different OS user or on a different machine. The account
			// exists but its password does not, which the sync reports as such.
			return null;
		}
	},

	delete(key) {
		assertReady();
		const path = fileFor(key);
		if (existsSync(path)) unlinkSync(path);
	},
};
