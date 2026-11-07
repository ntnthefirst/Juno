/**
 * Juno at the edge of the Windows desktop: the tray icon, the taskbar badge
 * and the one global shortcut. The settings page and the agent both go through
 * here, and so do the tray menu and the shortcut when they ask for a new note.
 *
 * Nothing in this file imports Electron. What it needs from the machine comes in
 * through `configure`, so the rules are tested with a fake desktop:
 * - **A new note asks the lock first.** Locked, the window comes up on the lock
 *   screen and no note is made, whichever door the request came through.
 * - **A shortcut that cannot be taken says so.** The page reads the reason from
 *   `getView`, so a combination another program already owns is never silent.
 * - **Off means off.** Turning the shortcut off, or quitting, releases it.
 */
import { normaliseAccelerator } from "../../shared/accelerator";
import type { DesktopPatch, DesktopView, ShellRequest, ShortcutStatus } from "../../shared/types";
import * as settings from "./settings";

export type DesktopPorts = {
	/** Only Windows has any of this. */
	supported: boolean;
	isLocked(): boolean;
	/** Bring the main window up, opening it if none exists. */
	focusWindow(): void;
	/** Ask the main window to do something once it can. */
	requestShell(request: ShellRequest): void;
	/** Take a key combination for every program. False when something else holds it. */
	registerShortcut(accelerator: string, run: () => void): boolean;
	releaseShortcut(accelerator: string): void;
	/** The tray icon and the badge follow the settings. */
	syncSurfaces(): void | Promise<void>;
};

let ports: DesktopPorts | null = null;
let held: string | null = null;
let problem: string | null = null;

export function configure(next: DesktopPorts | null): void {
	ports = next;
	held = null;
	problem = null;
}

function need(): DesktopPorts {
	if (!ports) throw new Error("The desktop integration has not started.");
	return ports;
}

/**
 * A new note was asked for by the tray menu or the shortcut. Locked, it only
 * brings the lock screen up: a note made behind a lock is a record written by
 * someone who has not unlocked.
 */
export function newNote(): "requested" | "locked" {
	const desktop = need();
	if (desktop.isLocked()) {
		desktop.focusWindow();
		return "locked";
	}
	desktop.requestShell({ kind: "new-note" });
	return "requested";
}

/** Takes or releases the shortcut so it matches the settings. Safe to call at any time. */
export async function applyShortcut(): Promise<ShortcutStatus> {
	const desktop = need();
	const wanted = (await settings.getDesktop()).newNoteShortcut;

	if (held) {
		desktop.releaseShortcut(held);
		held = null;
	}
	problem = null;

	if (!desktop.supported || !wanted.enabled) return status();

	const accelerator = normaliseAccelerator(wanted.accelerator);
	if (!accelerator) {
		problem = "That is not a shortcut Juno can use. It needs Ctrl, Alt, Shift or Win and one key.";
		return status();
	}
	const taken = desktop.registerShortcut(accelerator, () => void newNote());
	if (taken) held = accelerator;
	else problem = `${accelerator} is already used by another program. Pick a different combination.`;
	return status();
}

/** On quit. The operating system frees it anyway, but a shortcut left held across a relaunch is a bug that looks like another program. */
export function releaseShortcut(): void {
	if (held && ports) ports.releaseShortcut(held);
	held = null;
}

function status(): ShortcutStatus {
	return { registered: held !== null, problem };
}

export async function getView(): Promise<DesktopView> {
	const stored = await settings.get();
	return {
		settings: await settings.getDesktop(),
		shortcut: status(),
		keepRunning: stored.mcpServer.background,
		supported: ports?.supported ?? false,
	};
}

/** Saves, then brings the tray, the badge and the shortcut in line. */
export async function update(patch: DesktopPatch): Promise<DesktopView> {
	await settings.setDesktop(patch);
	await need().syncSurfaces();
	await applyShortcut();
	return getView();
}
