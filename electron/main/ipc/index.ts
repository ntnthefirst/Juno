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
import { registerClientLinksIpc } from "./client-links";
import { registerClientPhonesIpc } from "./client-phones";
import { registerClientsIpc } from "./clients";
import { registerDocumentsIpc } from "./documents";
import { registerContactsIpc } from "./contacts";
import { registerGeocodingIpc } from "./geocoding";
import { registerLockIpc } from "./lock";
import { registerMailIpc } from "./mail";
import { registerMenuIpc } from "./menu";
import { registerNotesIpc } from "./notes";
import { registerProjectsIpc } from "./projects";
import { registerReferenceIpc } from "./reference";
import { registerRemindersIpc } from "./reminders";
import { registerSigningCertificateIpc } from "./signing-certificate";
import { registerRecentIpc } from "./recent";
import { registerSearchIpc } from "./search";
import { registerSettingsIpc } from "./settings";
import { registerSuggestionsIpc } from "./suggestions";
import { registerTemplatesIpc } from "./templates";
import { registerTimeIpc } from "./time";
import { registerUpdatesIpc } from "./updates";
import { registerWindowIpc } from "./window";

export function registerAllIpc(): void {
	installLockGuard();

	registerAppIpc();
	registerWindowIpc();
	registerLockIpc();
	registerSettingsIpc();
	registerUpdatesIpc();

	registerClientsIpc();
	registerClientEmailsIpc();
	registerClientPhonesIpc();
	registerClientLinksIpc();
	registerClientAddressesIpc();
	registerContactsIpc();
	registerProjectsIpc();
	registerTimeIpc();
	registerNotesIpc();
	registerSearchIpc();
	registerRecentIpc();
	registerReferenceIpc();
	registerBackupIpc();
	registerTemplatesIpc();
	registerDocumentsIpc();
	registerSigningCertificateIpc();
	registerRemindersIpc();
	registerMailIpc();
	registerMenuIpc();
	registerSuggestionsIpc();
	registerCalendarIpc();
	registerGeocodingIpc();
	registerAgentIpc();
}
