/**
 * IPC for backups.
 *
 * `revealFolder` is here rather than in the service because opening a folder in
 * the file manager is an Electron call, and a service that imported `shell`
 * could not be tested in a plain Node process. The service answers where the
 * folder is; this decides what to do with that.
 */
import { ipcMain, shell } from "electron";
import * as backup from "../services/backup";

export function registerBackupIpc(): void {
	ipcMain.handle("backup.create", () => backup.create());
	ipcMain.handle("backup.list", () => backup.list());
	ipcMain.handle("backup.restore", (_event, path: string) => backup.restore(path));
	ipcMain.handle("backup.revealFolder", async () => {
		await shell.openPath(backup.backupsFolder());
	});
}
