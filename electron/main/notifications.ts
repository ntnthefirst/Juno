/**
 * Draws the toasts services/notifications.ts decides on, and hands a press on
 * one back to it. Windows only.
 *
 * The toast and its buttons carry an index into a closed list of actions, not
 * an id or a callback with reach: whatever a button does is one of the three
 * things `ToastAction` names, and each of them goes through a service function.
 */
import { BrowserWindow, Notification } from "electron";
import * as lock from "./services/lock";
import * as notifications from "./services/notifications";
import { openJuno, isWindows } from "./tray";
import { requestShell } from "./windows";

/** Electron drops a notification that nothing references, and its buttons with it. */
const alive = new Set<Notification>();

function present(toast: notifications.Toast): void {
	if (!isWindows || !Notification.isSupported()) return;
	const shown = new Notification({
		title: toast.title,
		body: toast.body,
		silent: false,
		actions: toast.buttons.map((button) => ({ type: "button" as const, text: button.label })),
	});
	alive.add(shown);
	const release = () => alive.delete(shown);

	shown.on("click", () => {
		release();
		void notifications.runToastAction(toast.onClick);
	});
	shown.on("action", (details) => {
		release();
		const button = toast.buttons[details.actionIndex];
		if (button) void notifications.runToastAction(button.action);
	});
	shown.on("close", release);
	shown.on("failed", release);
	shown.show();
}

export function installNotifications(isDev: boolean): void {
	notifications.configure({
		isLocked: () => lock.isLocked(),
		present,
		focusWindow: () => openJuno(isDev),
		openAgent: () => requestShell({ kind: "agent" }),
		hasFocusedWindow: () => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused()),
	});
	// A button pressed while locked waits for the person to unlock.
	lock.onChange((state) => {
		if (!state.locked) void notifications.runDeferred();
	});
}
