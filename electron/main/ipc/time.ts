import { BrowserWindow, ipcMain } from "electron";
import type { TimeEntryInput, TimeEntryPatch } from "../../shared/types";
import * as time from "../services/time-entries";

export function registerTimeIpc(): void {
	ipcMain.handle("time.list", (_event, projectId: string) => time.list(projectId));
	ipcMain.handle("time.total", (_event, projectId: string) => time.total(projectId));
	ipcMain.handle("time.running", () => time.running());
	ipcMain.handle("time.start", (_event, projectId: string, note?: string | null) =>
		time.start(projectId, note),
	);
	ipcMain.handle("time.stop", (_event, note?: string | null) => time.stop(note));
	ipcMain.handle("time.create", (_event, input: TimeEntryInput) => time.create(input));
	ipcMain.handle("time.update", (_event, id: string, patch: TimeEntryPatch) =>
		time.update(id, patch),
	);
	ipcMain.handle("time.remove", (_event, id: string) => time.remove(id));

	// Pushed, because an agent can start or stop the timer while another screen is open.
	time.onTimerChange((running) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("time.runningChanged", running);
		}
	});
}
