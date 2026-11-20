import { describe, expect, it } from "vitest";
import type { MailAccount, MailOutboxCounts } from "@shared/types";
import { statusLines, summarise } from "./mail-status";

function account(id: string, label: string, over: Partial<MailAccount> = {}): MailAccount {
	return {
		id,
		label,
		lastSyncAt: "2026-11-20T15:55:00.000Z",
		lastSyncError: null,
		...over,
	} as MailAccount;
}

const none: MailOutboxCounts = { pending: 0, queued: 0, failed: 0, drafts: 0 };
const noop = () => undefined;

function read(accounts: MailAccount[], outbox: MailOutboxCounts = none, online = true) {
	const lines = statusLines(accounts, {}, online, outbox, noop, noop);
	return { lines, summary: summarise(lines, accounts) };
}

describe("the mail status line", () => {
	it("is green when nothing needs you, and lists every account as up to date", () => {
		const { lines, summary } = read([account("a", "juno"), account("b", "admin")]);
		expect(summary.tone).toBe("ok");
		expect(summary.text).toMatch(/^Up to date, synced /);
		expect(lines.map((line) => line.text)).toEqual(["juno is up to date", "admin is up to date"]);
	});

	it("is yellow for one thing, and says what it is", () => {
		const { summary } = read([account("a", "juno")], { ...none, failed: 1 });
		expect(summary).toMatchObject({ tone: "warn", text: "1 message was not sent" });
	});

	it("is red for more than one thing, and puts the problems first in the list", () => {
		const { lines, summary } = read(
			[account("a", "juno"), account("b", "admin", { lastSyncError: "Could not reach mail.parrel.dev." })],
			{ ...none, failed: 1 },
		);
		expect(summary).toMatchObject({ tone: "risk", text: "2 things need you" });
		expect(lines.map((line) => line.problem)).toEqual([true, true, false]);
		expect(lines[2]!.text).toBe("juno is up to date");
	});

	it("is red for one thing that stops everything: offline, or no account syncing at all", () => {
		expect(read([account("a", "juno")], none, false).summary).toMatchObject({ tone: "risk", text: "Offline" });
		expect(read([account("a", "juno", { lastSyncError: "Refused." })]).summary).toMatchObject({
			tone: "risk",
			text: "juno did not sync",
		});
	});

	it("does not count a message waiting to send as a problem", () => {
		const { summary } = read([account("a", "juno")], { ...none, queued: 2 });
		expect(summary).toMatchObject({ tone: "ok", text: "2 waiting to send", busy: true });
	});
});
