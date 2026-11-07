/**
 * IPC for application settings.
 *
 * The one thing that happens here and not in the service: setting
 * `nativeTheme.themeSource` alongside the stored theme. It is Electron-specific,
 * and settings.ts has to stay loadable in a plain Node process. Writing only the
 * setting leaves a light title bar over a dark window (decision 14).
 */
import { ipcMain, nativeTheme } from "electron";
import type {
	OnboardingPatch,
	OwnerEmailInput,
	OwnerEmailPatch,
	OwnerPhoneInput,
	OwnerPhonePatch,
	OwnerProfilePatch,
	ProjectsView,
	ThemeSetting,
} from "../../shared/types";
import * as documentsFolder from "../services/documents-folder";
import * as documentsFolderPicker from "../services/documents-folder-picker";
import * as settings from "../services/settings";
import * as signature from "../services/signature";
import { refreshNativeTheme } from "../windows/chrome";
import { sendThemeToPages, themeApplied } from "../windows/theme-switch";

/**
 * Stores the theme, puts it on every page, and then tells Electron about it,
 * in that order. Both adapters call this one function, so the agent and the
 * interface cannot end up applying a different set of writes.
 *
 * The pages go first and the native surfaces after them (windows/theme-switch.ts):
 * the other way round, the caption buttons flip a visible moment before the
 * page does. Three native writes, not two, now that the caption buttons are
 * drawn by the OS: the theme source, the overlay and the window background.
 */
export async function applyTheme(theme: ThemeSetting): Promise<ThemeSetting> {
	const saved = await settings.setTheme(theme);
	await sendThemeToPages(saved);
	nativeTheme.themeSource = saved;
	refreshNativeTheme();
	return saved;
}

/**
 * Sets the stored theme on the native surfaces at startup, before any window,
 * so the splash, the window background and the first frame of the page are
 * already in it. Without this an explicit choice that differs from the OS
 * opened in the OS colours and changed once the page had read the setting.
 */
export async function applyStoredTheme(): Promise<ThemeSetting> {
	const stored = await settings.getTheme();
	nativeTheme.themeSource = stored;
	return stored;
}

export function registerSettingsIpc(): void {
	ipcMain.handle("settings.getAccountingTool", () => settings.getAccountingTool());
	ipcMain.handle("settings.setAccountingTool", (_event, patch) => settings.setAccountingTool(patch));
	ipcMain.handle("settings.getSignaturePath", () => signature.getPath());
	ipcMain.handle("settings.getSignatureImage", () => signature.getDataUrl());
	ipcMain.handle("settings.chooseSignature", () => signature.choose());
	ipcMain.handle("settings.clearSignature", () => signature.clear());
	ipcMain.handle("settings.getDocumentsFolder", () => documentsFolder.current());
	ipcMain.handle("settings.chooseDocumentsFolder", () => documentsFolderPicker.choose());
	ipcMain.handle("settings.resetDocumentsFolder", () => documentsFolder.reset());

	ipcMain.handle("settings.get", () => settings.get());
	ipcMain.handle("settings.getTheme", () => settings.getTheme());
	ipcMain.handle("settings.setTheme", (_event, theme: ThemeSetting) => applyTheme(theme));
	ipcMain.handle("settings.themeApplied", (event) => themeApplied(event.sender));
	ipcMain.handle("settings.getProjectsView", () => settings.getProjectsView());
	ipcMain.handle("settings.setProjectsView", (_event, patch: Partial<ProjectsView>) =>
		settings.setProjectsView(patch),
	);
	ipcMain.handle("settings.getOwner", () => settings.getOwner());
	ipcMain.handle("settings.setOwner", (_event, patch: OwnerProfilePatch) =>
		settings.setOwner(patch),
	);
	ipcMain.handle("settings.addOwnerEmail", (_event, input: OwnerEmailInput) =>
		settings.addOwnerEmail(input),
	);
	ipcMain.handle("settings.updateOwnerEmail", (_event, id: string, patch: OwnerEmailPatch) =>
		settings.updateOwnerEmail(id, patch),
	);
	ipcMain.handle("settings.removeOwnerEmail", (_event, id: string) => settings.removeOwnerEmail(id));
	ipcMain.handle("settings.addOwnerPhone", (_event, input: OwnerPhoneInput) =>
		settings.addOwnerPhone(input),
	);
	ipcMain.handle("settings.updateOwnerPhone", (_event, id: string, patch: OwnerPhonePatch) =>
		settings.updateOwnerPhone(id, patch),
	);
	ipcMain.handle("settings.removeOwnerPhone", (_event, id: string) => settings.removeOwnerPhone(id));

	ipcMain.handle("settings.getOnboarding", () => settings.getOnboarding());
	ipcMain.handle("settings.setOnboarding", (_event, patch: OnboardingPatch) =>
		settings.setOnboarding(patch),
	);
	ipcMain.handle("settings.needsOnboarding", () => settings.needsOnboarding());
}
