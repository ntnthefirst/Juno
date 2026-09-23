/**
 * The window registry, and the only place allowed to construct a window.
 *
 * Two rules it exists to enforce:
 *
 * 1. There is exactly one main window. A second one would be a second renderer
 *    against one SQLite file, with two caches of the same rows and no way to
 *    tell which is stale. A second launch, a dock click or a tray click focuses
 *    the window that exists instead of making another.
 * 2. Settings is a modal child, and so is the first-run setup. While either is
 *    open the operating system refuses input to the main window, so it has to
 *    be closed before the application is usable again. Asking for one twice
 *    focuses the one already open, and setup closes settings on its way in:
 *    two modal children of one parent fight over focus.
 *
 * Locking closes both children. They hold mail accounts and owner details, so
 * leaving either painted over a locked application would defeat the lock
 * (decision 15).
 */
import { BrowserWindow } from "electron";
import * as lock from "../services/lock";
import { createMainWindow } from "./main-window";
import { createSettingsWindow } from "./settings-window";
import { createSetupWindow } from "./setup-window";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
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
		if (!state.locked) return;
		// Both children hold owner details and mail accounts, so either one left
		// painted over a locked application would defeat the lock (decision 15).
		closeSettingsWindow();
		closeSetupWindow();
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
	const child = getSetupWindow() ?? getSettingsWindow();
	if (child) child.focus();
}

/**
 * One of the modal children closed.
 *
 * Focus comes back by hand because the parent was disabled while the modal
 * lived, and on Windows it does not always return on its own. The event is
 * what the main window acts on: neither child has a channel back, so this is
 * how a setting changed in one of them, and setup finishing, reach the
 * application behind it (src/app/App.tsx).
 */
function childClosed(): void {
	const main = getMainWindow();
	if (!main) return;
	main.focus();
	main.webContents.send("window.childClosed");
}

export function getSettingsWindow(): BrowserWindow | null {
	return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
}

export function isSettingsOpen(): boolean {
	return getSettingsWindow() !== null;
}

export function openSettingsWindow(section?: string): void {
	const existing = getSettingsWindow();
	if (existing) {
		// Already open, so the section cannot ride in the URL any more. Telling
		// the window rather than reloading it keeps whatever was half-typed.
		if (section) existing.webContents.send("settings.showSection", section);
		existing.focus();
		return;
	}

	const parent = getMainWindow();
	if (!parent) return;

	// Setup reaches settings for one thing, adding a mail account, and hands
	// over rather than stacking: one modal child of one parent at a time.
	closeSetupWindow();

	settingsWindow = createSettingsWindow(parent, devMode, section);
	settingsWindow.on("closed", () => {
		settingsWindow = null;
		childClosed();
	});
}

export function closeSettingsWindow(): void {
	getSettingsWindow()?.close();
}

export function getSetupWindow(): BrowserWindow | null {
	return setupWindow && !setupWindow.isDestroyed() ? setupWindow : null;
}

export function isSetupOpen(): boolean {
	return getSetupWindow() !== null;
}

/**
 * The first run, in front of the application it configures. Settings is closed
 * first: two modal children of one parent fight over focus, and on Windows the
 * loser is not reliably the one the person is looking at.
 */
export function openSetupWindow(): void {
	const existing = getSetupWindow();
	if (existing) {
		existing.focus();
		return;
	}

	const parent = getMainWindow();
	if (!parent) return;

	closeSettingsWindow();

	setupWindow = createSetupWindow(parent, devMode);
	setupWindow.on("closed", () => {
		setupWindow = null;
		childClosed();
	});
}

export function closeSetupWindow(): void {
	getSetupWindow()?.close();
}

/** Which window a renderer call came from, so it can draw the right shell. */
export function windowKindOf(contents: Electron.WebContents): "main" | "settings" | "setup" {
	const window = BrowserWindow.fromWebContents(contents);
	if (window && window === getSetupWindow()) return "setup";
	return window && window === getSettingsWindow() ? "settings" : "main";
}
