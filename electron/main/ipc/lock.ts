/**
 * The lock channels. Thin, like every adapter: the state machine is in
 * ../services/lock.ts and the secret handling is in ../vault.ts.
 *
 * Note what is missing. There is no channel that returns a secret, a verifier,
 * a salt or the vault path. The renderer can offer a secret and be told yes or
 * no, and that is the whole surface.
 */
import { ipcMain } from "electron";
import type { LockSettings } from "../../shared/types";
import * as lock from "../services/lock";

export function registerLockIpc(): void {
	ipcMain.handle("lock.state", () => lock.state());
	ipcMain.handle("lock.getSettings", () => lock.getSettings());

	ipcMain.handle("lock.setSettings", (_event, patch: Partial<LockSettings>) =>
		lock.applySettings(patch),
	);

	ipcMain.handle(
		"lock.configure",
		(_event, input: { method: "passphrase" | "pin"; secret: string; currentSecret?: string }) =>
			lock.configure(input),
	);

	ipcMain.handle("lock.disable", (_event, currentSecret: string) => lock.disable(currentSecret));

	ipcMain.handle("lock.lock", () => lock.lock());

	ipcMain.handle("lock.unlock", (_event, secret: string) => lock.unlock(secret));
}
