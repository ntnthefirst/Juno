import { app, ipcMain } from "electron";
import type { AppInfo } from "../../shared/types";
import { databasePath } from "../db/paths";

export function registerAppIpc(): void {
	ipcMain.handle(
		"app.info",
		(): AppInfo => ({
			version: app.getVersion(),
			databasePath: databasePath(),
			isDev: Boolean(process.env.JUNO_DEV),
			platform: process.platform,
		}),
	);

	// Performed on the window that asked, so the command lands on whatever has
	// focus there. Nothing is read back: the renderer never sees the clipboard.
	ipcMain.handle("app.edit.cut", (event) => {
		event.sender.cut();
	});
	ipcMain.handle("app.edit.copy", (event) => {
		event.sender.copy();
	});
	ipcMain.handle("app.edit.paste", (event) => {
		event.sender.paste();
	});
	ipcMain.handle("app.edit.selectAll", (event) => {
		event.sender.selectAll();
	});
}
