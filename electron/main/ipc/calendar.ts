/**
 * Calendar channels. Thin: the rules live in ../services/calendar.ts.
 *
 * The two file channels own the dialogs, because a dialog belongs to a window
 * and a service never sees one. The service takes and returns text.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import type {
	CalendarEditTarget,
	CalendarEventInput,
	CalendarEventPatch,
	CalendarRangeQuery,
} from "../../shared/types";
import * as calendar from "../services/calendar";

export function registerCalendarIpc(): void {
	ipcMain.handle("calendar.list", (_event, query: CalendarRangeQuery) => calendar.listRange(query));
	ipcMain.handle("calendar.get", (_event, id: string) => calendar.get(id));
	ipcMain.handle("calendar.create", (_event, input: CalendarEventInput) => calendar.create(input));
	ipcMain.handle(
		"calendar.update",
		(_event, id: string, patch: CalendarEventPatch, target?: CalendarEditTarget) =>
			calendar.update(id, patch, target),
	);
	ipcMain.handle("calendar.remove", (_event, id: string, target?: CalendarEditTarget) =>
		calendar.remove(id, target),
	);
	ipcMain.handle("calendar.restore", (_event, id: string) => calendar.restore(id));

	ipcMain.handle("calendar.exportIcs", async (event, query: CalendarRangeQuery) => {
		const text = await calendar.exportIcs(query);
		const owner = BrowserWindow.fromWebContents(event.sender);
		const options = {
			defaultPath: `juno-${query.from}-${query.to}.ics`,
			filters: [{ name: "Calendar", extensions: ["ics"] }],
		};
		const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
		if (result.canceled || !result.filePath) return null;
		writeFileSync(result.filePath, text, "utf8");
		return result.filePath;
	});

	ipcMain.handle("calendar.importIcs", async (event) => {
		const owner = BrowserWindow.fromWebContents(event.sender);
		const options: Electron.OpenDialogOptions = {
			properties: ["openFile"],
			filters: [{ name: "Calendar", extensions: ["ics", "ical", "ifb", "icalendar"] }],
		};
		const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
		const path = result.filePaths[0];
		if (result.canceled || !path) return null;
		return calendar.importIcs(readFileSync(path, "utf8"));
	});
}
