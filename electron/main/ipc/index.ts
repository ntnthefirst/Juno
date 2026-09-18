/**
 * Every IPC registration, in one place.
 *
 * `installLockGuard()` runs first and must keep running first: it replaces
 * `ipcMain.handle` for everything registered after it, which is what stops a new
 * channel from being reachable while the app is locked. Adding a registration
 * above that line silently opens a hole.
 */
import { installLockGuard } from "./lock-guard";
import { registerAppIpc } from "./app";
import { registerBackupIpc } from "./backup";
import { registerClientsIpc } from "./clients";
import { registerDocumentsIpc } from "./documents";
import { registerContactsIpc } from "./contacts";
import { registerLockIpc } from "./lock";
import { registerProjectsIpc } from "./projects";
import { registerReferenceIpc } from "./reference";
import { registerRemindersIpc } from "./reminders";
import { registerSearchIpc } from "./search";
import { registerSettingsIpc } from "./settings";
import { registerTemplatesIpc } from "./templates";

export function registerAllIpc(): void {
	installLockGuard();

	registerAppIpc();
	registerLockIpc();
	registerSettingsIpc();

	registerClientsIpc();
	registerContactsIpc();
	registerProjectsIpc();
	registerSearchIpc();
	registerReferenceIpc();
	registerBackupIpc();
	registerTemplatesIpc();
	registerDocumentsIpc();
	registerRemindersIpc();
}
