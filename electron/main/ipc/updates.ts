import { BrowserWindow, ipcMain } from "electron";
import * as updates from "../services/updates";

export function registerUpdatesIpc(): void {
	ipcMain.handle("updates.status", () => updates.status());
	// A person pressed the button, which is the only thing the rate limit
	// applies to. The interval checks without going through here.
	ipcMain.handle("updates.check", () => updates.check({ manual: true }));
	ipcMain.handle("updates.install", () => updates.install());
	ipcMain.handle("updates.setAutoInstall", (_event, value: boolean) =>
		updates.setAutoInstall(value === true),
	);

	// Progress is pushed rather than polled, the same way the lock is. A
	// download takes minutes and the settings window has to follow it.
	updates.onChange((status) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("updates.changed", status);
		}
	});
}
