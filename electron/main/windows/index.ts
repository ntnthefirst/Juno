/**
 * The window registry, and the only place allowed to construct a window.
 *
 * Two rules it exists to enforce:
 *
 * 1. There is exactly one main window. A second one would be a second renderer
 *    against one SQLite file, with two caches of the same rows and no way to
 *    tell which is stale. A second launch, a dock click or a tray click focuses
 *    the window that exists instead of making another.
 * 2. Settings is a modal child. While it is open the operating system refuses
 *    input to the main window, so it has to be closed before the application is
 *    usable again. Asking for it twice focuses the one already open.
 *
 * Locking closes settings. It holds mail accounts and owner details, so leaving
 * it painted over a locked application would defeat the lock (decision 15).
 */
import { BrowserWindow } from "electron";
import * as lock from "../services/lock";
import { createMainWindow } from "./main-window";
import { createSettingsWindow } from "./settings-window";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let devMode = false;

export function openMainWindow(isDev: boolean): BrowserWindow {
	devMode = isDev;

	if (mainWindow && !mainWindow.isDestroyed()) {
		focusMainWindow();
		return mainWindow;
	}

	mainWindow = createMainWindow(isDev);
	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	lock.watchWindow(mainWindow);
	lock.onChange((state) => {
		if (state.locked) closeSettingsWindow();
	});

	return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
	return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** What `second-instance` and a dock activation both want. */
export function focusMainWindow(): void {
	const window = getMainWindow();
	if (!window) return;
	if (window.isMinimized()) window.restore();
	window.focus();

	// A modal child keeps the parent disabled, so focusing the parent alone
	// looks like a frozen application. Bring the thing actually taking input.
	const settings = getSettingsWindow();
	if (settings) settings.focus();
}

export function getSettingsWindow(): BrowserWindow | null {
	return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
}

export function isSettingsOpen(): boolean {
	return getSettingsWindow() !== null;
}

export function openSettingsWindow(): void {
	const existing = getSettingsWindow();
	if (existing) {
		existing.focus();
		return;
	}

	const parent = getMainWindow();
	if (!parent) return;

	settingsWindow = createSettingsWindow(parent, devMode);
	settingsWindow.on("closed", () => {
		settingsWindow = null;
		// Returning focus by hand: the parent was disabled while the modal lived,
		// and on Windows it does not always come back on its own.
		const main = getMainWindow();
		if (main) main.focus();
	});
}

export function closeSettingsWindow(): void {
	getSettingsWindow()?.close();
}

/** Which window a renderer call came from, so it can draw the right shell. */
export function windowKindOf(contents: Electron.WebContents): "main" | "settings" {
	const window = BrowserWindow.fromWebContents(contents);
	return window && window === getSettingsWindow() ? "settings" : "main";
}
