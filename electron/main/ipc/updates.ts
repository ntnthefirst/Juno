import { app, BrowserWindow, ipcMain } from "electron";
import type { UpdateStatus } from "../../shared/types";
import * as updates from "../services/updates";
import { closeUpdateWindow, setUpdateWindow, showUpdateWindow, updateWindowOpen } from "../windows/update-window";

/**
 * The window that says what an install is doing, driven by the same status the
 * settings page reads. It appears when an install is asked for, follows the
 * download, and says so when Juno is closing. The application quits behind it.
 */
function followInstall(status: UpdateStatus): void {
	if (status.stage === "error") {
		if (!updateWindowOpen()) return;
		setUpdateWindow({ step: "The update did not finish", percent: 0, error: status.error });
		setTimeout(closeUpdateWindow, 8000);
		return;
	}
	if (!status.installRequested) return;
	if (!updateWindowOpen()) showUpdateWindow(app.getVersion(), status.newVersion);
	if (status.stage === "downloading") {
		setUpdateWindow({ step: `Downloading version ${status.newVersion ?? ""}`.trim(), percent: status.percent });
	} else {
		setUpdateWindow({ step: "Closing Juno", percent: null });
	}
}

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
		followInstall(status);
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("updates.changed", status);
		}
	});
}
