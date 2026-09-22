import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import {
	approve,
	configureAgentActions,
	EXPIRES_AFTER_MS,
	expireStale,
	get,
	list,
	onChange,
	pendingCount,
	reject,
	remove,
	request,
	resetForTests,
} from "./agent-actions";
import { digestArgs, list as auditList } from "./agent-audit";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

let db: Db;

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, migrations);
	db = createDrizzle(connection);
	resetForTests();
});

afterEach(() => {
	vi.useRealTimers();
	resetForTests();
});

async function park(tool = "clients.create", args: Record<string, unknown> = { name: "obet" }) {
	return request({ toolName: tool, args, summary: `Create a client (name: ${args.name})`, source: "mcp" }, db);
}

describe("the gate", () => {
	it("parks a call without running it", async () => {
		const ran = vi.fn();
		configureAgentActions(async (...call) => ran(...call));

		const action = await park();
		expect(action.state).toBe("pending");
		expect(action.args).toEqual({ name: "obet" });
		expect(ran).not.toHaveBeenCalled();
		expect(await pendingCount(db)).toBe(1);
	});

	it("runs the tool only once a person approves, and keeps the result", async () => {
		configureAgentActions(async (tool, args) => ({ id: "made-1", tool, echoed: args.name }));
		const action = await park();

		const done = await approve(action.id, db);
		expect(done.state).toBe("executed");
		expect(done.result).toEqual({ id: "made-1", tool: "clients.create", echoed: "obet" });
		expect(done.executedAt).not.toBeNull();
		expect(await pendingCount(db)).toBe(0);
	});

	it("does not run a rejected call, and will not approve it afterwards", async () => {
		const ran = vi.fn(async () => ({}));
		configureAgentActions(ran);
		const action = await park();

		const rejected = await reject(action.id, db);
		expect(rejected.state).toBe("rejected");
		expect(ran).not.toHaveBeenCalled();
		await expect(approve(action.id, db)).rejects.toThrow(/already rejected/);
	});

	it("refuses to approve the same call twice", async () => {
		const ran = vi.fn(async () => ({ id: "x" }));
		configureAgentActions(ran);
		const action = await park();

		await approve(action.id, db);
		await expect(approve(action.id, db)).rejects.toThrow(/already executed/);
		expect(ran).toHaveBeenCalledTimes(1);
	});

	it("records the failure and leaves the action failed when the service throws", async () => {
		configureAgentActions(async () => {
			throw new Error("A client needs a name.");
		});
		const action = await park();

		await expect(approve(action.id, db)).rejects.toThrow(/needs a name/);
		const after = await get(action.id, db);
		expect(after?.state).toBe("failed");
		expect(after?.error).toBe("A client needs a name.");
	});

	it("expires a request nobody answered, and an expired one cannot be approved", async () => {
		configureAgentActions(async () => ({}));
		const action = await park();

		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.now() + EXPIRES_AFTER_MS + 60_000));
		expect(expireStale(db)).toBe(1);

		const after = await get(action.id, db);
		expect(after?.state).toBe("expired");
		await expect(approve(action.id, db)).rejects.toThrow(/too old/);
	});

	it("refuses to approve when nothing can run it", async () => {
		const action = await park();
		await expect(approve(action.id, db)).rejects.toThrow(/not ready/);
	});

	it("tells the app about every change", async () => {
		configureAgentActions(async () => ({ id: "x" }));
		const seen: string[] = [];
		const off = onChange((action) => seen.push(action.state));

		const action = await park();
		await approve(action.id, db);
		off();

		expect(seen).toEqual(["pending", "executed"]);
	});

	it("filters by state and clears only answered requests", async () => {
		configureAgentActions(async () => ({ id: "x" }));
		const first = await park();
		const second = await park("clients.delete", { id: "abc" });
		await approve(second.id, db);

		expect((await list({ states: ["pending"] }, db)).map((a) => a.id)).toEqual([first.id]);
		expect((await list({ states: ["executed"] }, db)).map((a) => a.id)).toEqual([second.id]);
		await expect(remove(first.id, db)).rejects.toThrow(/Answer this request/);
		await remove(second.id, db);
		expect((await list({}, db)).map((a) => a.id)).toEqual([first.id]);
	});
});

describe("the audit log", () => {
	it("writes a row for every step of a request's life", async () => {
		configureAgentActions(async () => ({ id: "made-1" }));
		const action = await park();
		await approve(action.id, db);

		const rows = await auditList({}, db);
		expect(rows.map((row) => row.result)).toEqual(["ok", "pending"]);
		expect(rows.every((row) => row.toolName === "clients.create")).toBe(true);
		expect(rows[0]!.entityId).toBe("made-1");
		expect(rows[0]!.actionId).toBe(action.id);
	});

	it("keeps the arguments out of the log but can still tell two calls apart", async () => {
		configureAgentActions(async () => ({}));
		await park("clients.create", { name: "obet", vatNumber: "BE0123456789" });
		await park("clients.create", { name: "bodhi", vatNumber: "BE0987654321" });

		const rows = await auditList({ toolName: "clients.create" }, db);
		expect(rows).toHaveLength(2);
		// No argument object is stored, so a value that was not in the summary
		// cannot be read back out of the log.
		expect(rows[0]).not.toHaveProperty("args");
		expect(JSON.stringify(rows)).not.toContain("BE0987654321");
		// Two different calls are still distinguishable, which is the digest's job.
		expect(rows[0]!.argsDigest).not.toBe(rows[1]!.argsDigest);
		// The summary is the readable part, and it is written on purpose.
		expect(rows[0]!.summary).toContain("bodhi");
	});

	it("digests the same arguments the same way whatever order they arrived in", () => {
		expect(digestArgs({ a: 1, b: [2, { c: 3 }] })).toBe(digestArgs({ b: [2, { c: 3 }], a: 1 }));
		expect(digestArgs({ a: 1 })).not.toBe(digestArgs({ a: 2 }));
		// An absent key and an undefined one are the same call.
		expect(digestArgs({ a: 1, b: undefined })).toBe(digestArgs({ a: 1 }));
	});

	it("filters by actor and by when", async () => {
		configureAgentActions(async () => ({}));
		await park();
		expect(await auditList({ actor: "agent" }, db)).toHaveLength(1);
		expect(await auditList({ actor: "user" }, db)).toHaveLength(0);
		expect(await auditList({ since: new Date(Date.now() + 60_000).toISOString() }, db)).toHaveLength(0);
	});
});
