/**
 * Where a mail password goes, and the only way it comes back.
 *
 * Decision 6: the database stores a key, the store holds the secret, and the
 * secret is only ever read in the main process by the code opening the IMAP
 * connection. No IPC channel and no MCP tool returns one, masked or otherwise.
 *
 * The interface lives here, Electron-free, so the account service and its
 * tests can run in plain Node against the in-memory store. The real store,
 * wrapped by safeStorage, is in ../credential-store.ts and is injected at
 * startup.
 */

export interface CredentialStore {
	/** False when the OS keychain is unavailable. Then nothing may be stored. */
	isAvailable(): boolean;
	set(key: string, secret: string): void;
	/** Null when nothing is stored under the key. */
	get(key: string): string | null;
	delete(key: string): void;
}

export class MemoryCredentialStore implements CredentialStore {
	private readonly secrets = new Map<string, string>();

	isAvailable(): boolean {
		return true;
	}

	set(key: string, secret: string): void {
		this.secrets.set(key, secret);
	}

	get(key: string): string | null {
		return this.secrets.get(key) ?? null;
	}

	delete(key: string): void {
		this.secrets.delete(key);
	}
}

let store: CredentialStore | null = null;

export function configureCredentialStore(next: CredentialStore): void {
	store = next;
}

export function credentialStore(): CredentialStore {
	if (!store) {
		throw new Error("The credential store was used before the app configured it.");
	}
	return store;
}
