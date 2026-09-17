/**
 * IPC for application settings.
 *
 * The one thing that happens here and not in the service: setting
 * `nativeTheme.themeSource` alongside the stored theme. It is Electron-specific,
 * and settings.ts has to stay loadable in a plain Node process. Writing only the
 * setting leaves a light title bar over a dark window (decision 14).
 */
import { ipcMain, nativeTheme } from "electron";
import type { OwnerProfile, ThemeSetting } from "../../shared/types";
import * as settings from "../services/settings";

/**
 * Stores the theme and tells Electron about it, in that order. Both adapters
 * call this one function, so the agent and the interface cannot end up applying
 * a different pair of writes.
 */
export async function applyTheme(theme: ThemeSetting): Promise<ThemeSetting> {
	const saved = await settings.setTheme(theme);
	nativeTheme.themeSource = saved;
	return saved;
}

/** Applies the stored theme to the native surfaces at startup, before any window. */
export async function applyStoredTheme(): Promise<ThemeSetting> {
	return applyTheme(await settings.getTheme());
}

export function registerSettingsIpc(): void {
	ipcMain.handle("settings.get", () => settings.get());
	ipcMain.handle("settings.getTheme", () => settings.getTheme());
	ipcMain.handle("settings.setTheme", (_event, theme: ThemeSetting) => applyTheme(theme));
	ipcMain.handle("settings.getOwner", () => settings.getOwner());
	ipcMain.handle("settings.setOwner", (_event, patch: Partial<OwnerProfile>) =>
		settings.setOwner(patch),
	);
}
