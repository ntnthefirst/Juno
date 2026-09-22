/**
 * IPC for application settings.
 *
 * The one thing that happens here and not in the service: setting
 * `nativeTheme.themeSource` alongside the stored theme. It is Electron-specific,
 * and settings.ts has to stay loadable in a plain Node process. Writing only the
 * setting leaves a light title bar over a dark window (decision 14).
 */
import { BrowserWindow, ipcMain, nativeTheme } from "electron";
import type { OnboardingPatch, OwnerProfile, ThemeSetting } from "../../shared/types";
import * as settings from "../services/settings";
import * as signature from "../services/signature";
import { refreshOverlayTheme } from "../windows/chrome";

/**
 * Stores the theme and tells Electron about it, in that order. Both adapters
 * call this one function, so the agent and the interface cannot end up applying
 * a different pair of writes.
 */
export async function applyTheme(theme: ThemeSetting): Promise<ThemeSetting> {
	const saved = await settings.setTheme(theme);
	nativeTheme.themeSource = saved;
	// Three writes, not two, now that the caption buttons are drawn by the OS.
	// Leaving this out gives a dark close button on a light bar until restart.
	refreshOverlayTheme();
	// The change is usually made in the settings window, so the main window
	// behind it has to be told rather than left on the old theme until reload.
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send("settings.themeChanged", saved);
	}
	return saved;
}

/** Applies the stored theme to the native surfaces at startup, before any window. */
export async function applyStoredTheme(): Promise<ThemeSetting> {
	return applyTheme(await settings.getTheme());
}

export function registerSettingsIpc(): void {
	ipcMain.handle("settings.getAccountingTool", () => settings.getAccountingTool());
	ipcMain.handle("settings.setAccountingTool", (_event, patch) => settings.setAccountingTool(patch));
	ipcMain.handle("settings.getSignaturePath", () => signature.getPath());
	ipcMain.handle("settings.getSignatureImage", () => signature.getDataUrl());
	ipcMain.handle("settings.chooseSignature", () => signature.choose());
	ipcMain.handle("settings.clearSignature", () => signature.clear());

	ipcMain.handle("settings.get", () => settings.get());
	ipcMain.handle("settings.getTheme", () => settings.getTheme());
	ipcMain.handle("settings.setTheme", (_event, theme: ThemeSetting) => applyTheme(theme));
	ipcMain.handle("settings.getOwner", () => settings.getOwner());
	ipcMain.handle("settings.setOwner", (_event, patch: Partial<OwnerProfile>) =>
		settings.setOwner(patch),
	);

	ipcMain.handle("settings.getOnboarding", () => settings.getOnboarding());
	ipcMain.handle("settings.setOnboarding", (_event, patch: OnboardingPatch) =>
		settings.setOnboarding(patch),
	);
	ipcMain.handle("settings.needsOnboarding", () => settings.needsOnboarding());
}
