/**
 * What Juno tells someone who is not looking at it: a summary of what is due,
 * once a day, and a note when agent requests are waiting.
 *
 * Deliberately quiet, per brand/BRAND.md. One notification, summarising, never
 * one per reminder. An app that fires five notifications on launch gets its
 * notifications turned off, and then the feature is worth nothing.
 *
 * This file decides what a toast says and what its buttons do. Showing one is
 * the presenter's job (../notifications.ts), injected through `configure`, so
 * nothing here needs a window and the rules are tested without Electron.
 *
 * Three rules that hold for every toast:
 * - **A button runs the same service function a click would**, so it passes the
 *   same checks. Review only brings the Agent screen up. A toast never approves.
 * - **A locked Juno says nothing about the business.** The text is generic and
 *   carries no buttons (decision 15). A button on a toast made before the lock
 *   came on is held until a person has unlocked.
 * - Nothing here leaves the machine.
 */
import type { AgentAction } from "../../shared/types";
import { todayIsoDate } from "./document-context";
import * as agentActions from "./agent-actions";
import * as reminders from "./reminders";
import { addDays } from "./recurrence";
import * as settings from "./settings";

/** Checked this often so a machine left running overnight still gets told. */
const CHECK_EVERY_MS = 60 * 60 * 1000;
const AGENT_CHECK_EVERY_MS = 1000;
const AGENT_AGE_THRESHOLD_MS = 60 * 1000;
const AGENT_COUNT_THRESHOLD = 10;
/** A button pressed while locked waits this long for an unlock, then is dropped. */
const DEFERRED_FOR_MS = 10 * 60 * 1000;

/** What a toast, or a button on one, can ask for. The set is closed on purpose. */
export type ToastAction =
	| { kind: "reminder.complete"; reminderId: string }
	| { kind: "reminder.snooze"; reminderId: string }
	| { kind: "agent.review" };

export type Toast = {
	title: string;
	body: string;
	/** What pressing the toast itself does. */
	onClick: ToastAction | { kind: "open" };
	/** At most two, in this order. */
	buttons: { label: string; action: ToastAction }[];
};

export type NotificationDeps = {
	isLocked(): boolean;
	/** Draw a toast. */
	present(toast: Toast): void;
	/** Bring the main window up, without asking it to do anything. */
	focusWindow(): void;
	/** Bring the main window up on the Agent screen. */
	openAgent(): void;
	hasFocusedWindow(): boolean;
	/** For tests: the clock. */
	now?(): number;
};

let deps: NotificationDeps | null = null;
let timer: NodeJS.Timeout | null = null;
let agentTimer: NodeJS.Timeout | null = null;
let stopAgentListener: (() => void) | null = null;
let agentNotificationSent = false;
let agentCheckInFlight = false;
let deferred: { action: ToastAction; at: number } | null = null;

export function configure(next: NotificationDeps | null): void {
	deps = next;
}

function clock(): number {
	return deps?.now?.() ?? Date.now();
}

export function agentNotificationReason(
	pending: readonly Pick<AgentAction, "createdAt">[],
	now = Date.now(),
): "count" | "age" | null {
	if (pending.length >= AGENT_COUNT_THRESHOLD) return "count";
	const oldest = pending.reduce((earliest, action) => {
		const createdAt = Date.parse(action.createdAt);
		return Number.isNaN(createdAt) || createdAt >= earliest ? earliest : createdAt;
	}, Number.POSITIVE_INFINITY);
	return now - oldest >= AGENT_AGE_THRESHOLD_MS ? "age" : null;
}

/** What a toast says while Juno is locked. No client, mail or record text, and no way to act. */
export function lockedToast(): Toast {
	return {
		title: "Juno",
		body: "Something needs your attention. Unlock Juno to see it.",
		onClick: { kind: "open" },
		buttons: [],
	};
}

export function agentToast(count: number, locked: boolean): Toast {
	if (locked) return lockedToast();
	return {
		title: "Juno: Agent requests",
		body: `${count} request${count === 1 ? "" : "s"} waiting for you.`,
		onClick: { kind: "agent.review" },
		buttons: [{ label: "Review", action: { kind: "agent.review" } }],
	};
}

export function summarise(rows: reminders.ReminderRecord[]): { title: string; body: string } | null {
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
	const body = rest > 0 ? `${first.title}, and ${rest} more.` : first.title;

	return { title: `Juno: ${parts.join(", ")}`, body };
}

/**
 * The daily summary. With exactly one reminder to act on it carries Complete
 * and Snooze, because then a button can only mean that one. With several a
 * button would have to guess, so it is a plain summary that opens the window.
 */
export function reminderToast(rows: reminders.ReminderRecord[], locked: boolean): Toast | null {
	const summary = summarise(rows);
	if (!summary) return null;
	if (locked) return lockedToast();
	const due = rows.filter((r) => r.bucket === "overdue" || r.bucket === "today");
	const only = due.length === 1 ? due[0]! : null;
	return {
		...summary,
		onClick: { kind: "open" },
		buttons: only
			? [
					{ label: "Complete", action: { kind: "reminder.complete", reminderId: only.id } },
					{ label: "Snooze a day", action: { kind: "reminder.snooze", reminderId: only.id } },
				]
			: [],
	};
}

export type ActionResult = "done" | "held" | "failed";

async function execute(action: ToastAction, tools: NotificationDeps): Promise<void> {
	switch (action.kind) {
		case "reminder.complete":
			await reminders.complete(action.reminderId);
			return;
		case "reminder.snooze":
			await reminders.snooze(action.reminderId, addDays(todayIsoDate(), 1));
			return;
		case "agent.review":
			// Opens the screen the requests are on. Approving stays a click there.
			tools.openAgent();
			return;
	}
}

/**
 * A button on a toast, or the toast itself, was pressed. While locked nothing
 * runs: the window comes up on the lock screen, and the action waits for the
 * unlock the person is about to do.
 */
export async function runToastAction(action: ToastAction | { kind: "open" }): Promise<ActionResult> {
	if (!deps) return "failed";
	if (action.kind === "open") {
		deps.focusWindow();
		return "done";
	}
	if (deps.isLocked()) {
		deferred = { action, at: clock() };
		deps.focusWindow();
		return "held";
	}
	try {
		await execute(action, deps);
		return "done";
	} catch (error) {
		deps.present({
			title: "Juno",
			body: error instanceof Error ? error.message : "That did not work.",
			onClick: { kind: "open" },
			buttons: [],
		});
		return "failed";
	}
}

/** Called when Juno unlocks. Runs the one action that was waiting, if it is still fresh. */
export async function runDeferred(): Promise<ActionResult | null> {
	// Still locked: the action keeps waiting for the real unlock.
	if (!deferred || !deps || deps.isLocked()) return null;
	const waiting = deferred;
	deferred = null;
	if (clock() - waiting.at > DEFERRED_FOR_MS) return null;
	return runToastAction(waiting.action);
}

export function hasDeferred(): boolean {
	return deferred !== null;
}

async function show(toast: Toast): Promise<void> {
	if (!deps) return;
	if (!(await settings.getDesktop()).toasts) return;
	deps.present(toast);
}

async function checkAgentRequests(): Promise<void> {
	if (agentCheckInFlight || !deps) return;
	agentCheckInFlight = true;
	try {
		const pending = await agentActions.list({ states: ["pending"], limit: 500 });
		if (pending.length === 0) {
			agentNotificationSent = false;
			return;
		}
		if (agentNotificationSent || deps.hasFocusedWindow()) return;
		if (!agentNotificationReason(pending, clock())) return;

		// Latch before showing so the action listener and interval cannot produce
		// two notifications for the same waiting queue.
		agentNotificationSent = true;
		await show(agentToast(pending.length, deps.isLocked()));
	} finally {
		agentCheckInFlight = false;
	}
}

async function check(): Promise<void> {
	if (!deps) return;

	const last = await settings.getLastNotifiedOn();
	const today = todayIsoDate();
	// Once a day. A reminder that was not urgent enough to act on this morning is
	// not more urgent at four in the afternoon.
	if (last === today) return;

	const rows = await reminders.list({ actionableOnly: true });
	await settings.setLastNotifiedOn(today);
	const toast = reminderToast(rows, deps.isLocked());
	if (toast) await show(toast);
}

/**
 * Called once from main.ts. The first check is delayed so it cannot compete with
 * the window painting, and so a launch-and-quit does not fire anything.
 */
export function start(): void {
	if (timer) return;
	setTimeout(() => void check(), 8000);
	timer = setInterval(() => void check(), CHECK_EVERY_MS);
	stopAgentListener = agentActions.onChange(() => void checkAgentRequests());
	setTimeout(() => void checkAgentRequests(), 1000);
	agentTimer = setInterval(() => void checkAgentRequests(), AGENT_CHECK_EVERY_MS);
}

export function stop(): void {
	if (timer) clearInterval(timer);
	if (agentTimer) clearInterval(agentTimer);
	stopAgentListener?.();
	timer = null;
	agentTimer = null;
	stopAgentListener = null;
	agentNotificationSent = false;
	agentCheckInFlight = false;
	deferred = null;
}
