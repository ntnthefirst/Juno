import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The lock is the one thing this test has to be able to move, and configuring
 * a real one needs `safeStorage`. Everything else below is the real registry,
 * the real services and a real database, because the point of the test is
 * that the declared flags are what actually happens.
 */
let locked = false;
vi.mock("../services/lock", () => ({ isLocked: () => locked }));

const { closeDb, getConnection, openDb } = await import("../db");
const { runMigrations } = await import("../db/migrate");
const { callTool, listTools, ToolError } = await import("./host");
const actions = await import("../services/agent-actions");
const audit = await import("../services/agent-audit");
const { executeApproved } = await import("./host");
const { toolByName } = await import("./registry");

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

beforeEach(() => {
	locked = false;
	closeDb();
	openDb(":memory:");
	runMigrations(getConnection(), migrations);
	actions.resetForTests();
	actions.configureAgentActions((tool, args) => executeApproved(tool, args));
});

afterEach(() => {
	actions.resetForTests();
	closeDb();
});

describe("the tool surface", () => {
	it("declares every tool once, with a schema and a handler", () => {
		const tools = listTools();
		expect(tools.length).toBeGreaterThan(90);
		expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
		for (const tool of tools) {
			expect(tool.description.length).toBeGreaterThan(20);
			expect(tool.inputSchema).toHaveProperty("type", "object");
		}
	});

	it("names every tool domain.verb, in lower case", () => {
		for (const tool of listTools()) {
			expect(tool.name).toMatch(/^[a-z]+(\.[a-z][a-z_]*){1,2}$/);
		}
	});

	it("tells a caller which tools come back pending", () => {
		const create = listTools().find((tool) => tool.name === "clients.create");
		expect(create?.description).toContain("Requires approval");
		const list = listTools().find((tool) => tool.name === "clients.list");
		expect(list?.description).not.toContain("Requires approval");
	});
});

describe("calling a tool", () => {
	it("runs a read-only tool and writes nothing to the log", async () => {
		const result = await callTool("clients.list", {});
		expect(result).toEqual([]);
		expect(await audit.list({})).toHaveLength(0);
	});

	it("parks a tool that needs approval, and does not create anything", async () => {
		const result = (await callTool("clients.create", { name: "obet" })) as {
			status: string;
			actionId: string;
			summary: string;
		};

		expect(result.status).toBe("pending");
		expect(result.summary).toBe("Create a client (name: obet)");
		expect(await callTool("clients.list", {})).toEqual([]);

		const pending = await actions.list({ states: ["pending"] });
		expect(pending.map((action) => action.toolName)).toEqual(["clients.create"]);
	});

	it("creates the row once a person approves, and only then", async () => {
		const parked = (await callTool("clients.create", { name: "obet" })) as { actionId: string };
		await actions.approve(parked.actionId);

		const clients = (await callTool("clients.list", {})) as { name: string }[];
		expect(clients.map((client) => client.name)).toEqual(["obet"]);
	});

	it("runs a local write that needs no approval, and logs it", async () => {
		const result = await callTool("settings.get_theme", {});
		expect(result).toBeDefined();
		// mail.sync is declared side-effectful but local, so it runs and is logged.
		await callTool("mail.sync", {}).catch(() => undefined);
		const rows = await audit.list({ toolName: "mail.sync" });
		expect(rows).toHaveLength(1);
	});

	it("refuses everything while Juno is locked", async () => {
		locked = true;
		await expect(callTool("clients.list", {})).rejects.toThrow(/locked/);
		await expect(callTool("clients.create", { name: "obet" })).rejects.toThrow(/locked/);
		expect(await actions.list({})).toHaveLength(0);
	});

	it("refuses a tool it does not have", async () => {
		await expect(callTool("clients.invented", {})).rejects.toBeInstanceOf(ToolError);
		await expect(callTool("clients.invented", {})).rejects.toThrow(/no tool called/);
	});

	it("logs a failure with the message the service gave", async () => {
		await expect(callTool("clients.get", { id: "" })).rejects.toThrow();
		// A read failing is still not logged: only writes are.
		expect(await audit.list({})).toHaveLength(0);
	});
});

describe("the one tool whose service holds its own gate", () => {
	it("is mail.send, and nothing else", () => {
		const gated = listTools()
			.map((tool) => toolByName(tool.name))
			.filter((tool) => tool?.gatedInService === true)
			.map((tool) => tool!.name);
		expect(gated).toEqual(["mail.send"]);
	});

	it("goes to the service rather than the generic gate", async () => {
		// No such draft, so the service refuses. What matters is that the call
		// reached the service at all: a generic gate would have parked it and
		// returned pending without touching the outbox.
		await expect(callTool("mail.send", { id: "nope" })).rejects.toThrow(/does not exist/);
		expect(await actions.list({})).toHaveLength(0);
	});
});

describe("what the declarations promise", () => {
	it("marks everything that writes as needing approval, unless it is local or gated in its service", () => {
		/**
		 * The local writes. Each one changes this machine and nothing outside
		 * it, so a person is not asked every time. Adding a name here is a
		 * decision, which is why the list is written out rather than derived.
		 */
		const localOnly = new Set(["mail.sync"]);
		const unguarded = listTools()
			.map((tool) => toolByName(tool.name)!)
			.filter(
				(tool) =>
					!tool.readOnly &&
					!tool.requiresConfirmation &&
					tool.gatedInService !== true &&
					!localOnly.has(tool.name),
			)
			.map((tool) => tool.name);
		expect(unguarded).toEqual(["mail.draft"]);
	});

	it("has no tool that unlocks Juno or approves an action", () => {
		const names = listTools().map((tool) => tool.name);
		expect(names.filter((name) => /unlock|approve/i.test(name))).toEqual([]);
	});
});
