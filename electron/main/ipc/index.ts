/**
 * Every IPC registration, in one place.
 *
 * `installLockGuard()` runs first and must keep running first: it replaces
 * `ipcMain.handle` for everything registered after it, which is what stops a new
 * channel from being reachable while the app is locked.
 */
import { installLockGuard } from "./lock-guard";
import { registerAppIpc } from "./app";
import { registerLockIpc } from "./lock";

export function registerAllIpc(): void {
	installLockGuard();

	registerAppIpc();
	registerLockIpc();
}
