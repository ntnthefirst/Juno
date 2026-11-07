/**
 * Window control for the renderer.
 *
 * There is no service behind this one, and that is correct rather than an
 * exception: which windows are open is not a business capability. An agent has
 * no reason to open a settings window, and .claude/rules/mcp.md says not to give
 * it one ("don't add a tool that drives the UI").
 *
 * Which window a renderer *is* does not go through here. It reads its own URL,
 * so the shell paints on the first frame instead of after a round trip, and so a
 * locked application still knows what it is drawing.
 */
import { ipcMain } from "electron";
import { cleanPrefill, isNewRecordKind } from "../../shared/new-record";
import type { SettingsSection } from "../../shared/types";
import {
	closeNewRecordWindow,
	closeSettingsWindow,
	closeSetupWindow,
	isSettingsOpen,
	isSetupOpen,
	openNewRecordWindow,
	openSettingsWindow,
	openSetupWindow,
} from "../windows";

export function registerWindowIpc(): void {
	ipcMain.handle("window.isSettingsOpen", () => isSettingsOpen());
	ipcMain.handle("window.openSettings", (_event, section?: SettingsSection) => {
		openSettingsWindow(section);
	});
	ipcMain.handle("window.closeSettings", () => {
		closeSettingsWindow();
	});

	ipcMain.handle("window.openNewRecord", (_event, kind: string, prefill: unknown) => {
		// The kind and the prefill come from a renderer, so both are checked here
		// before either reaches a window address.
		if (!isNewRecordKind(kind)) return;
		openNewRecordWindow(kind, cleanPrefill(prefill));
	});
	ipcMain.handle("window.closeNewRecord", (_event, created: boolean) => {
		closeNewRecordWindow(created === true);
	});

	ipcMain.handle("window.isSetupOpen", () => isSetupOpen());
	ipcMain.handle("window.openSetup", () => {
		openSetupWindow();
	});
	ipcMain.handle("window.closeSetup", () => {
		closeSetupWindow();
	});
}
