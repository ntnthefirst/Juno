import { app, ipcMain } from "electron";
import type { AppInfo } from "../../shared/types";
import { databasePath } from "../db/paths";

export function registerAppIpc(): void {
	ipcMain.handle(
		"app.info",
		(): AppInfo => ({
			version: app.getVersion(),
			databasePath: databasePath(),
			isDev: Boolean(process.env.BUREAU_DEV),
			platform: process.platform,
		}),
	);
}
