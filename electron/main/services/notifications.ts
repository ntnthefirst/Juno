/**
 * The one notification Juno sends: what needs attention, once a day.
 *
 * Deliberately quiet, per brand/BRAND.md. One notification, summarising, never
 * one per reminder. An app that fires five notifications on launch gets its
 * notifications turned off, and then the feature is worth nothing.
 *
 * It is a summary and a nudge, not an action. Clicking it opens the window.
 */
import { BrowserWindow, Notification } from "electron";
import { todayIsoDate } from "./document-context";
import * as reminders from "./reminders";
import * as settings from "./settings";

/** Checked this often so a machine left running overnight still gets told. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

function summarise(rows: reminders.ReminderRecord[]): { title: string; body: string } | null {
	const overdue = rows.filter((r) => r.bucket === "overdue");
	const today = rows.filter((r) => r.bucket === "today");
	if (overdue.length === 0 && today.length === 0) return null;

	const parts: string[] = [];
	if (overdue.length > 0) {
		parts.push(`${overdue.length} overdue`);
	}
	if (today.length > 0) {
		parts.push(`${today.length} due today`);
	}

	// Naming the first one makes the notification worth reading. A bare count is
	// something people learn to dismiss without looking.
	const first = overdue[0] ?? today[0]!;
	const rest = overdue.length + today.length - 1;
	const body =
		rest > 0 ? `${first.title}, and ${rest} more.` : first.title;

	return { title: `Juno: ${parts.join(", ")}`, body };
}

async function check(): Promise<void> {
	if (!Notification.isSupported()) return;

	const last = await settings.getLastNotifiedOn();
	const today = todayIsoDate();
	// Once a day. A reminder that was not urgent enough to act on this morning is
	// not more urgent at four in the afternoon.
	if (last === today) return;

	const rows = await reminders.list({ actionableOnly: true });
	const summary = summarise(rows);
	await settings.setLastNotifiedOn(today);
	if (!summary) return;

	const notification = new Notification({
		title: summary.title,
		body: summary.body,
		silent: false,
	});

	notification.on("click", () => {
		const [window] = BrowserWindow.getAllWindows();
		if (!window) return;
		if (window.isMinimized()) window.restore();
		window.show();
		window.focus();
	});

	notification.show();
}

/**
 * Called once from main.ts. The first check is delayed so it cannot compete with
 * the window painting, and so a launch-and-quit does not fire anything.
 */
export function start(): void {
	if (timer) return;
	setTimeout(() => void check(), 8000);
	timer = setInterval(() => void check(), CHECK_EVERY_MS);
}

export function stop(): void {
	if (timer) clearInterval(timer);
	timer = null;
}

/** Test seam, and what the settings screen calls to show what it would send. */
export { summarise };
