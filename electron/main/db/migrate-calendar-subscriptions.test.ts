/**
 * Migration 0031 adds `calendar_subscriptions` and
 * `calendar_subscription_events`, on top of everything up to 0030. It rebuilds
 * no table, but a subscription points at a mail account and the calendar
 * already holds events, so it runs against a database that has both: an empty
 * one proves nothing about what is already there (data.md section 3).
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");
const BEFORE = "0030_mail_account_auth_kind.sql";
const STAMP = "2026-01-01T00:00:00.000Z";

let folder: string;

function upTo(last: string): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-migrations-"));
	for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
		if (file > last) continue;
		copyFileSync(join(MIGRATIONS, file), join(dir, file));
	}
	return dir;
}

type Column = { name: string; type: string; notnull: number; dflt_value: unknown };

function insert(connection: ShimDatabase, table: string, values: Record<string, unknown>): void {
	const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as Column[];
	const row: Record<string, unknown> = { ...values };
	for (const column of columns) {
		if (column.name in row || column.notnull === 0 || column.dflt_value !== null) continue;
		if (column.name === "owner_id") row[column.name] = "owner";
		else if (column.name.endsWith("_at")) row[column.name] = STAMP;
		else row[column.name] = column.type.toLowerCase().includes("int") ? 0 : "x";
	}
	const names = Object.keys(row);
	connection
		.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
		.run(...names.map((name) => row[name]));
}

function count(connection: ShimDatabase, table: string): number {
	return (connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

beforeEach(() => {
	folder = upTo(BEFORE);
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

describe("migration 0031", () => {
	it("keeps the calendar and the mail accounts, and adds the subscription tables", () => {
		const connection = openDatabase(":memory:");
		connection.exec("PRAGMA foreign_keys = ON");
		runMigrations(connection, folder);

		insert(connection, "mail_accounts", { id: "account-1", label: "Work", email: "me@example.com" });
		insert(connection, "calendar_events", {
			id: "event-1",
			title: "Kitchen visit",
			start_local: "2026-11-12T09:00:00",
			end_local: "2026-11-12T10:00:00",
			timezone: "Europe/Brussels",
			start_utc: "2026-11-12T08:00:00.000Z",
			end_utc: "2026-11-12T09:00:00.000Z",
			ical_uid: "event-1@juno",
		});

		const result = runMigrations(connection, MIGRATIONS);
		expect(result.applied).toEqual(["0031_calendar_subscriptions.sql"]);
		expect(count(connection, "calendar_events")).toBe(1);
		expect(count(connection, "mail_accounts")).toBe(1);

		insert(connection, "calendar_subscriptions", {
			id: "sub-1",
			name: "Google Calendar",
			host: "calendar.google.com",
			url_hash: "hash-1",
			credential_key: "calendar-subscription:sub-1",
			colour: "accent",
			mail_account_id: "account-1",
		});
		insert(connection, "calendar_subscription_events", {
			id: "feed-1",
			subscription_id: "sub-1",
			ical_uid: "abc@google.com",
			title: "Dentist",
			start_local: "2026-11-13",
			end_local: "2026-11-14",
			timezone: "Europe/Brussels",
			start_utc: "2026-11-12T23:00:00.000Z",
			end_utc: "2026-11-13T23:00:00.000Z",
		});
		const row = connection.prepare("SELECT refresh_minutes, shown, event_count FROM calendar_subscriptions").get();
		expect(row).toEqual({ refresh_minutes: 60, shown: 1, event_count: 0 });

		// One live subscription per address, and a removed one does not count.
		expect(() =>
			insert(connection, "calendar_subscriptions", {
				id: "sub-2",
				name: "Twice",
				host: "calendar.google.com",
				url_hash: "hash-1",
				credential_key: "k",
				colour: "accent",
			}),
		).toThrow(/UNIQUE/);
		connection.prepare("UPDATE calendar_subscriptions SET deleted_at = ? WHERE id = 'sub-1'").run(STAMP);
		insert(connection, "calendar_subscriptions", {
			id: "sub-2",
			name: "Again",
			host: "calendar.google.com",
			url_hash: "hash-1",
			credential_key: "k",
			colour: "accent",
		});

		// A feed event points at a subscription that exists.
		expect(() =>
			insert(connection, "calendar_subscription_events", { id: "feed-2", subscription_id: "missing", ical_uid: "x" }),
		).toThrow(/FOREIGN KEY/);
	});
});
