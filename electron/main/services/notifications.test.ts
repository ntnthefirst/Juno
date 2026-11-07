import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getConnection, openDb } from "../db";
import { runMigrations } from "../db/migrate";
import { todayIsoDate } from "./document-context";
import * as reminders from "./reminders";
import { addDays } from "./recurrence";
import * as settings from "./settings";
import {
	agentNotificationReason,
	agentToast,
	configure,
	hasDeferred,
	lockedToast,
	reminderToast,
	runDeferred,
	runToastAction,
	type Toast,
	type ToastAction,
} from "./notifications";

const now = Date.parse("2026-09-23T12:00:00.000Z");

function pending(createdAt: string) {
	return [{ createdAt }];
}

describe("agent request notifications", () => {
	it("uses the count threshold without also needing the age threshold", () => {
		const requests = Array.from({ length: 10 }, () => ({ createdAt: new Date(now).toISOString() }));

		expect(agentNotificationReason(requests, now)).toBe("count");
	});

	it("uses the oldest request threshold when fewer than ten are waiting", () => {
		expect(agentNotificationReason(pending(new Date(now - 60_000).toISOString()), now)).toBe("age");
		expect(agentNotificationReason(pending(new Date(now - 59_999).toISOString()), now)).toBeNull();
	});
});

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let locked = false;
let clock = now;
let shown: Toast[] = [];
let focused = 0;
let openedAgent = 0;

beforeEach(() => {
	settings.configureSettings(mkdtempSync(join(tmpdir(), "juno-toast-")));
	closeDb();
	openDb(":memory:");
	runMigrations(getConnection(), migrations);
	locked = false;
	clock = now;
	shown = [];
	focused = 0;
	openedAgent = 0;
	configure({
		isLocked: () => locked,
		present: (toast) => shown.push(toast),
		focusWindow: () => {
			focused += 1;
		},
		openAgent: () => {
			openedAgent += 1;
		},
		hasFocusedWindow: () => false,
		now: () => clock,
	});
});

afterEach(() => {
	configure(null);
	closeDb();
});

async function dueToday(title: string) {
	return reminders.create({ title, dueOn: todayIsoDate() });
}

describe("what a toast says", () => {
	it("gives Complete and Snooze for exactly one due reminder", async () => {
		const only = await dueToday("Send the quote to Peeters");
		const toast = reminderToast(await reminders.list({ actionableOnly: true }), false)!;
		expect(toast.body).toBe("Send the quote to Peeters");
		expect(toast.buttons.map((b) => b.action)).toEqual([
			{ kind: "reminder.complete", reminderId: only.id },
			{ kind: "reminder.snooze", reminderId: only.id },
		]);
	});

	it("gives no buttons for several, where a button would have to guess", async () => {
		await dueToday("One");
		await dueToday("Two");
		const toast = reminderToast(await reminders.list({ actionableOnly: true }), false)!;
		expect(toast.buttons).toEqual([]);
	});

	it("names no client, mail or record while locked, and offers nothing to press", async () => {
		await dueToday("Call Janssens about the lease");
		const rows = await reminders.list({ actionableOnly: true });
		for (const toast of [reminderToast(rows, true)!, agentToast(3, true)]) {
			expect(toast).toEqual(lockedToast());
			expect(JSON.stringify(toast)).not.toMatch(/Janssens|lease|3 request/);
			expect(toast.buttons).toEqual([]);
		}
	});

	it("gives Review for agent requests, and Review only", () => {
		const toast = agentToast(2, false);
		expect(toast.body).toBe("2 requests waiting for you.");
		expect(toast.buttons).toEqual([{ label: "Review", action: { kind: "agent.review" } }]);
	});
});

describe("pressing a button", () => {
	it("completes the reminder through the reminders service", async () => {
		const row = await dueToday("File the VAT form");
		expect(await runToastAction({ kind: "reminder.complete", reminderId: row.id })).toBe("done");
		expect((await reminders.get(row.id))?.bucket).toBe("done");
	});

	it("snoozes the reminder to tomorrow", async () => {
		const row = await dueToday("Water the plants");
		expect(await runToastAction({ kind: "reminder.snooze", reminderId: row.id })).toBe("done");
		const after = await reminders.get(row.id);
		expect(after?.snoozedUntil).toBe(addDays(todayIsoDate(), 1));
		expect(after?.bucket).toBe("snoozed");
	});

	it("only brings the Agent screen up for Review, and approves nothing", async () => {
		expect(await runToastAction({ kind: "agent.review" })).toBe("done");
		expect(openedAgent).toBe(1);
	});

	it("says so, without record text, when the reminder is gone", async () => {
		expect(await runToastAction({ kind: "reminder.complete", reminderId: "nope" })).toBe("failed");
		expect(shown).toHaveLength(1);
		expect(shown[0]!.body).toMatch(/no longer exists/);
	});

	it("does not run while locked, and runs once after the unlock", async () => {
		const row = await dueToday("Pay the accountant");
		const action: ToastAction = { kind: "reminder.complete", reminderId: row.id };
		locked = true;

		expect(await runToastAction(action)).toBe("held");
		expect(focused).toBe(1);
		expect((await reminders.get(row.id))?.bucket).toBe("today");
		// Still locked: nothing runs, and the action keeps waiting.
		expect(await runDeferred()).toBeNull();
		expect(hasDeferred()).toBe(true);
	});

	it("runs a held action when the person unlocks", async () => {
		const row = await dueToday("Pay the accountant");
		locked = true;
		await runToastAction({ kind: "reminder.complete", reminderId: row.id });
		locked = false;
		expect(await runDeferred()).toBe("done");
		expect((await reminders.get(row.id))?.bucket).toBe("done");
		expect(await runDeferred()).toBeNull();
	});

	it("drops a held action that waited too long", async () => {
		const row = await dueToday("Old news");
		locked = true;
		await runToastAction({ kind: "reminder.complete", reminderId: row.id });
		locked = false;
		clock += 11 * 60_000;
		expect(await runDeferred()).toBeNull();
		expect((await reminders.get(row.id))?.bucket).toBe("today");
	});

	it("opening a toast only focuses the window", async () => {
		expect(await runToastAction({ kind: "open" })).toBe("done");
		expect(focused).toBe(1);
	});
});
