/**
 * Every IPC registration, in one place.
 *
 * `installLockGuard()` runs first and must keep running first: it replaces
 * `ipcMain.handle` for everything registered after it, which is what stops a new
 * channel from being reachable while the app is locked. Adding a registration
 * above that line silently opens a hole.
 */
import { installLockGuard } from "./lock-guard";
import { registerAgentIpc } from "./agent";
import { registerAppIpc } from "./app";
import { registerBackupIpc } from "./backup";
import { registerCalendarIpc } from "./calendar";
import { registerClientAddressesIpc } from "./client-addresses";
import { registerClientEmailsIpc } from "./client-emails";
import { registerClientPhonesIpc } from "./client-phones";
import { registerClientsIpc } from "./clients";
import { registerDocumentsIpc } from "./documents";
import { registerContactsIpc } from "./contacts";
import { registerGeocodingIpc } from "./geocoding";
import { registerLockIpc } from "./lock";
import { registerMailIpc } from "./mail";
import { registerProjectsIpc } from "./projects";
import { registerReferenceIpc } from "./reference";
import { registerRemindersIpc } from "./reminders";
import { registerSearchIpc } from "./search";
import { registerSettingsIpc } from "./settings";
import { registerTemplatesIpc } from "./templates";
import { registerWindowIpc } from "./window";

export function registerAllIpc(userDataDir: string): void {
	installLockGuard();

	registerAppIpc();
	registerWindowIpc();
	registerLockIpc();
	registerSettingsIpc();

	registerClientsIpc();
	registerClientEmailsIpc();
	registerClientPhonesIpc();
	registerClientAddressesIpc();
	registerContactsIpc();
	registerProjectsIpc();
	registerSearchIpc();
	registerReferenceIpc();
	registerBackupIpc();
	registerTemplatesIpc();
	registerDocumentsIpc();
	registerRemindersIpc();
	registerMailIpc();
	registerCalendarIpc();
	registerGeocodingIpc();
	registerAgentIpc(userDataDir);
}
