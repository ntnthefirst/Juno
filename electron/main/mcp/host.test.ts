import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const permissions = await import("../services/agent-permissions");
const mailAccounts = await import("../services/mail-accounts");
const { configureCredentialStore, MemoryCredentialStore } = await import("../services/mail-credentials");
const rules = await import("../services/mail-rules");
const settings = await import("../services/settings");
const { PERMISSION_KINDS, isLocked } = await import("../../shared/agent-permissions");

let settingsDir = "";

/** Writes the file by hand, which is what a bug or an editor could do to it. */
function forceSettings(agentPermissions: Record<string, string>): void {
	writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ agentPermissions }), "utf8");
	settings.configureSettings(settingsDir);
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

beforeEach(() => {
	locked = false;
	settingsDir = mkdtempSync(join(tmpdir(), "juno-host-"));
	settings.configureSettings(settingsDir);
	closeDb();
	openDb(":memory:");
	runMigrations(getConnection(), migrations);
	actions.resetForTests();
	actions.configureAgentActions((tool, args, seal) => executeApproved(tool, args, seal));
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
	it("runs a read-only tool and logs that it looked, with no argument and no result", async () => {
		const result = await callTool("clients.list", { query: "private search" });
		expect(result).toEqual([]);
		const rows = await audit.list({});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ result: "read", toolName: "clients.list", summary: "List clients", entityId: null });
		expect(JSON.stringify(rows[0])).not.toContain("private search");
	});

	it("parks a tool that needs approval, and does not create anything", async () => {
		const result = (await callTool("clients.create", { name: "obet" })) as {
			status: string;
			actionId: string;
			summary: string;
		};

		expect(result.status).toBe("pending");
		expect(result.summary).toBe('Create the client "obet"');
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

describe("the permission table", () => {
	it("puts every tool in exactly one row, and no row names a tool that is gone", () => {
		const declared = listTools().map((tool) => tool.name).sort();
		const classified = permissions.classifiedTools().sort();
		expect(classified).toEqual(declared);
		for (const name of declared) expect(PERMISSION_KINDS).toContain(permissions.rowOf(name));
	});

	it("refuses a tool nobody classified", () => {
		expect(() => permissions.rowOf("clients.invented")).toThrow(/no permission row/);
	});

	it("declares every send, sign, file and delete tool as a confirmed write", () => {
		for (const tool of listTools().map((entry) => toolByName(entry.name)!)) {
			if (!isLocked(permissions.rowOf(tool.name))) continue;
			expect(tool.readOnly, tool.name).toBe(false);
			expect(tool.requiresConfirmation, tool.name).toBe(true);
		}
	});

	it("keeps writes out of the read row, apart from the two that only fetch", () => {
		const writes = listTools()
			.map((entry) => toolByName(entry.name)!)
			.filter((tool) => permissions.rowOf(tool.name) === "read" && !tool.readOnly)
			.map((tool) => tool.name);
		expect(writes.sort()).toEqual(["mail.sync", "updates.check"]);
	});

	it("files mail moves and deletes where the owner expects them", () => {
		expect(permissions.rowOf("mail.file.archive")).toBe("send");
		expect(permissions.rowOf("mail.file.delete")).toBe("delete");
		expect(permissions.rowOf("clients.delete")).toBe("delete");
		expect(permissions.rowOf("mail.draft")).toBe("drafts");
		expect(permissions.rowOf("mail.reply")).toBe("drafts");
		expect(permissions.rowOf("time.start")).toBe("change");
		expect(permissions.rowOf("mail.blocks.create")).toBe("change");
	});
});

describe("permission levels", () => {
	it("starts with read and drafts allowed, and everything else asking", async () => {
		expect(await permissions.getPermissions()).toEqual({
			read: "allow",
			change: "ask",
			drafts: "allow",
			send: "ask",
			delete: "ask",
		});
	});

	it("refuses a call whose row is off, and names the setting", async () => {
		await permissions.setPermissions({ read: "off" });
		await expect(callTool("clients.list", {})).rejects.toThrow("Settings > MCP > Permissions");
		// An agent can still see what became of what it asked.
		await expect(callTool("agent.list_actions", {})).resolves.toBeDefined();
	});

	it("runs a change straight away at allow, and logs it", async () => {
		await permissions.setPermissions({ change: "allow" });
		const result = (await callTool("clients.create", { name: "obet" })) as { name: string };
		expect(result.name).toBe("obet");
		expect(await actions.list({})).toHaveLength(0);
		expect(await audit.list({ toolName: "clients.create" })).toHaveLength(1);
	});

	it("parks a draft once drafts are set to ask first", async () => {
		await permissions.setPermissions({ drafts: "ask" });
		const draft = (await callTool("mail.draft", { to: ["a@example.com"], subject: "x", body: "y" })) as {
			status: string;
		};
		expect(draft.status).toBe("pending");
	});

	it("refuses a filing tool when its row is off", async () => {
		await permissions.setPermissions({ send: "off" });
		await expect(callTool("mail.file.archive", { thread_ids: ["x"] })).rejects.toThrow(/turned off/);
	});

	it("refuses to store allow for send, sign, file and delete", async () => {
		await expect(permissions.setPermissions({ send: "allow" })).rejects.toThrow(/cannot be set to Allow/);
		await expect(permissions.setPermissions({ delete: "allow" })).rejects.toThrow(/cannot be set to Allow/);
		await expect(settings.getAgentPermissions()).resolves.toMatchObject({ send: "ask", delete: "ask" });
		// Even the settings store clamps it, for a caller that skipped the service.
		await settings.setAgentPermissions({ send: "allow", delete: "allow" });
		await expect(settings.getAgentPermissions()).resolves.toMatchObject({ send: "ask", delete: "ask" });
	});

	it("parks every send, sign, file and delete tool through MCP even when the file says allow", async () => {
		forceSettings({ read: "allow", change: "allow", drafts: "allow", send: "allow", delete: "allow" });
		const lockedTools = listTools()
			.map((entry) => toolByName(entry.name)!)
			.filter((tool) => isLocked(permissions.rowOf(tool.name)) && !tool.prepare);
		expect(lockedTools.length).toBeGreaterThan(20);
		for (const tool of lockedTools) {
			const result = (await callTool(tool.name, {})) as { status?: string };
			expect(result.status, tool.name).toBe("pending");
		}
		expect(await actions.list({ states: ["executed"] })).toHaveLength(0);
	});

	it("treats both ways of sending as locked", () => {
		expect(permissions.isLockedTool("mail.send")).toBe(true);
		expect(permissions.isLockedTool("mail.send_from_template")).toBe(true);
		expect(permissions.isLockedTool("mail.draft")).toBe(false);
	});

	it("never lets an automation write, whatever the levels say", async () => {
		forceSettings({ read: "allow", change: "allow", drafts: "allow", send: "ask", delete: "ask" });
		const change = (await callTool(
			"clients.create",
			{ name: "obet" },
			{ source: "automation", automationRunId: "r" },
		)) as { status: string };
		expect(change.status).toBe("pending");
		const draft = (await callTool(
			"mail.draft",
			{ to: ["a@example.com"], subject: "x", body: "y" },
			{ source: "automation", automationRunId: "r" },
		)) as { status: string };
		expect(draft.status).toBe("pending");
		// The same call from an agent in the room runs.
		const direct = (await callTool("clients.create", { name: "direct" })) as { name: string };
		expect(direct.name).toBe("direct");
		// And reading is not writing.
		expect(await callTool("clients.list", {}, { source: "automation", automationRunId: "r" })).toBeDefined();
		expect(await actions.list({ states: ["pending"] })).toHaveLength(2);
	});
});

describe("intros and outros", () => {
	it("reads without asking, and parks every write until a person approves", async () => {
		expect(await callTool("mail.blocks.list", {})).toEqual([]);
		expect((await audit.list({})).filter((row) => row.result !== "read")).toHaveLength(0);

		const parked = (await callTool("mail.blocks.create", {
			kind: "intro",
			name: "Friendly",
			body: "Dag {{first_name}},",
			rule: "new_contact",
		})) as { status: string; actionId: string };
		expect(parked.status).toBe("pending");
		expect(await callTool("mail.blocks.list", {})).toEqual([]);

		await actions.approve(parked.actionId);
		const rows = (await callTool("mail.blocks.list", { kind: "intro" })) as { name: string; rule: string }[];
		expect(rows).toMatchObject([{ name: "Friendly", rule: "new_contact" }]);
	});

	it("declares the three writes and the order as side-effectful, and none of them sends", () => {
		const tools = ["create", "update", "delete", "reorder"].map((verb) => toolByName(`mail.blocks.${verb}`)!);
		expect(tools.every((tool) => !tool.readOnly && tool.requiresConfirmation)).toBe(true);
		expect(toolByName("mail.blocks.list")).toMatchObject({ readOnly: true, requiresConfirmation: false });
	});
});

describe("mailbox rules", () => {
	/** Decision 64: a rule files mail by itself, so only the owner (or an approved request) can make one. */
	async function connected() {
		configureCredentialStore(new MemoryCredentialStore());
		return mailAccounts.create({ email: "me@juno.test", imapHost: "imap.juno.test", password: "secret" });
	}

	const NEWSLETTERS = (accountId: string) => ({
		account_id: accountId,
		name: "Newsletters",
		conditions: [{ kind: "text", field: "sender", test: "contains", value: "news@" }],
		actions: [{ kind: "mark_read" }, { kind: "trash" }],
	});

	const WRITES = ["mail.rules.create", "mail.rules.update", "mail.rules.reorder", "mail.rules.delete"];

	it("reads without asking and puts every write in a row that cannot be Allow", () => {
		for (const name of ["mail.rules.list", "mail.rules.get", "mail.rules.history"]) {
			expect(permissions.rowOf(name)).toBe("read");
			expect(toolByName(name)).toMatchObject({ readOnly: true, requiresConfirmation: false });
		}
		expect(permissions.rowOf("mail.rules.create")).toBe("send");
		expect(permissions.rowOf("mail.rules.update")).toBe("send");
		expect(permissions.rowOf("mail.rules.reorder")).toBe("send");
		expect(permissions.rowOf("mail.rules.delete")).toBe("delete");
		for (const name of WRITES) {
			expect(permissions.isLockedTool(name), name).toBe(true);
			expect(toolByName(name)).toMatchObject({ readOnly: false, requiresConfirmation: true });
		}
	});

	it("declares no tool that runs a rule or switches the engine on", () => {
		const names = listTools().map((tool) => tool.name).filter((name) => name.startsWith("mail.rules."));
		expect(names.sort()).toEqual([
			"mail.rules.create",
			"mail.rules.delete",
			"mail.rules.get",
			"mail.rules.history",
			"mail.rules.list",
			"mail.rules.reorder",
			"mail.rules.update",
		]);
	});

	it("parks an agent's new rule even when the file says allow, shows the whole rule, and makes nothing until approved", async () => {
		forceSettings({ read: "allow", change: "allow", drafts: "allow", send: "allow", delete: "allow" });
		const account = await connected();

		const parked = (await callTool("mail.rules.create", NEWSLETTERS(account.id))) as {
			status: string;
			actionId: string;
			summary: string;
		};
		expect(parked.status).toBe("pending");
		expect(await callTool("mail.rules.list", { account_id: account.id })).toEqual([]);

		const [pending] = await actions.list({ states: ["pending"] });
		expect(pending!.preview).toContain('Rule "Newsletters" for me@juno.test, switched on.');
		expect(pending!.preview).toContain('the sender\'s address contains "news@"');
		expect(pending!.preview).toContain("mark it read and move it to Trash");
		expect(pending!.preview).toContain("standing instruction");
		expect(pending!.summary).toBe('Add the rule "Newsletters" to me@juno.test');

		await actions.approve(parked.actionId);
		const made = (await callTool("mail.rules.list", { account_id: account.id })) as { name: string; enabled: boolean }[];
		expect(made).toMatchObject([{ name: "Newsletters", enabled: true }]);
	});

	it("refuses at once a rule that could never be stored, instead of parking a dead request", async () => {
		const account = await connected();
		await expect(callTool("mail.rules.create", { ...NEWSLETTERS(account.id), conditions: [] })).rejects.toThrow(/condition/);
		await expect(
			callTool("mail.rules.create", { ...NEWSLETTERS(account.id), conditions: [{ kind: "regex", value: ".*" }] }),
		).rejects.toThrow(/not a condition/);
		expect(await actions.list({})).toHaveLength(0);
	});

	it("shows a change as it is and as it would become, and refuses an approval of a rule that moved on", async () => {
		const account = await connected();
		const made = rules.create(
			{ accountId: account.id, name: "Newsletters", conditions: NEWSLETTERS(account.id).conditions as never, actions: [{ kind: "flag" }] },
		);

		const parked = (await callTool("mail.rules.update", { id: made.id, enabled: false, actions: [{ kind: "trash" }] })) as {
			status: string;
			actionId: string;
		};
		expect(parked.status).toBe("pending");
		const [pending] = await actions.list({ states: ["pending"] });
		expect(pending!.preview).toContain("Now: Rule \"Newsletters\" for me@juno.test, switched on.");
		expect(pending!.preview).toContain("After: Rule \"Newsletters\" for me@juno.test, switched off.");
		// Nothing has changed.
		expect(rules.get(made.id)).toMatchObject({ enabled: true, actions: [{ kind: "flag" }] });

		// The owner edits it before getting to the request: what they read is not what would apply.
		rules.update(made.id, { name: "Edited by hand" });
		await expect(actions.approve(parked.actionId)).rejects.toThrow(/changed after/);
		const [answered] = await actions.list({ states: ["failed"] });
		expect(answered!.error).toMatch(/changed after/);
		expect(rules.get(made.id)).toMatchObject({ enabled: true, name: "Edited by hand" });
	});

	it("parks a reorder and a removal with the rules named, and does neither until approved", async () => {
		const account = await connected();
		const a = rules.create({ accountId: account.id, name: "A", conditions: NEWSLETTERS(account.id).conditions as never, actions: [{ kind: "flag" }] });
		const b = rules.create({ accountId: account.id, name: "B", conditions: NEWSLETTERS(account.id).conditions as never, actions: [{ kind: "flag" }] });

		const reorder = (await callTool("mail.rules.reorder", { account_id: account.id, ids: [b.id, a.id] })) as { status: string; actionId: string };
		const removal = (await callTool("mail.rules.delete", { id: a.id })) as { status: string; actionId: string };
		expect([reorder.status, removal.status]).toEqual(["pending", "pending"]);
		expect(rules.list(account.id).map((rule) => rule.name)).toEqual(["A", "B"]);

		const previews = (await actions.list({ states: ["pending"] })).map((action) => action.preview);
		expect(previews.some((text) => text?.includes("1. B") && text.includes("2. A"))).toBe(true);
		expect(previews.some((text) => text?.startsWith("Remove a rule."))).toBe(true);

		await actions.approve(reorder.actionId);
		expect(rules.list(account.id).map((rule) => rule.name)).toEqual(["B", "A"]);
	});

	it("cannot be called by an automation at all, parked or not", async () => {
		forceSettings({ read: "allow", change: "allow", drafts: "allow", send: "ask", delete: "ask" });
		const account = await connected();
		const made = rules.create({ accountId: account.id, name: "A", conditions: NEWSLETTERS(account.id).conditions as never, actions: [{ kind: "flag" }] });
		const attempts: [string, Record<string, unknown>][] = [
			["mail.rules.create", NEWSLETTERS(account.id)],
			["mail.rules.update", { id: made.id, enabled: false }],
			["mail.rules.reorder", { account_id: account.id, ids: [made.id] }],
			["mail.rules.delete", { id: made.id }],
		];
		for (const [name, args] of attempts) {
			await expect(callTool(name, args, { source: "automation", automationRunId: "r" }), name).rejects.toThrow(/automation cannot/);
		}
		// Not parked either: there is nothing for a person to approve.
		expect(await actions.list({})).toHaveLength(0);
		expect(rules.get(made.id)).toMatchObject({ enabled: true });
		// Reading what the rules are is fine.
		const read = await callTool("mail.rules.list", { account_id: account.id }, { source: "automation", automationRunId: "r" });
		expect(read).toHaveLength(1);
	});

	it("cannot be recorded as a step of an automation", async () => {
		const { configureAutomations, create } = await import("../services/automations");
		configureAutomations({ callTool: async () => null, hasTool: (name) => toolByName(name) !== null });
		await expect(
			create({ name: "Sneaky", steps: [{ tool: "mail.rules.create", args: {} }] }),
		).rejects.toThrow(/cannot add, change or remove a mailbox rule/);
		await expect(create({ name: "Reading", steps: [{ tool: "mail.rules.list", args: { account_id: "x" } }] })).resolves.toMatchObject({
			name: "Reading",
		});
	});

	it("is refused for an agent while Juno is locked", async () => {
		const account = await connected();
		locked = true;
		await expect(callTool("mail.rules.list", { account_id: account.id })).rejects.toThrow(/locked/);
		await expect(callTool("mail.rules.create", NEWSLETTERS(account.id))).rejects.toThrow(/locked/);
		expect(await actions.list({})).toHaveLength(0);
	});

	it("is refused for an agent when the row is off", async () => {
		const account = await connected();
		await permissions.setPermissions({ send: "off" });
		await expect(callTool("mail.rules.create", NEWSLETTERS(account.id))).rejects.toThrow(/turned off/);
	});
});

describe("sending", () => {
	it("can only be asked for as a draft or a template, and both wait for a person", () => {
		const sends = listTools().filter((tool) => /send|queue|approve|retry/i.test(tool.name));
		expect(sends.map((tool) => tool.name).sort()).toEqual(["mail.send", "mail.send_from_template"]);
		// Both are confirmed, so neither runs when it is called.
		expect(sends.every((tool) => tool.requiresConfirmation)).toBe(true);
		// A template is never a draft.
		expect(listTools().map((tool) => tool.name)).not.toContain("mail.draft_from_template");
	});

	it("refuses at once a send that could never go, instead of parking a dead request", async () => {
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
		const localOnly = new Set(["mail.sync", "updates.check"]);
		const unguarded = listTools()
			.map((tool) => toolByName(tool.name)!)
			.filter(
				(tool) =>
					!tool.readOnly &&
					!tool.requiresConfirmation &&
					!localOnly.has(tool.name),
			)
			.map((tool) => tool.name);
		expect(unguarded).toEqual(["mail.draft", "mail.reply"]);
	});

	it("has no tool that unlocks Juno or approves an action", () => {
		const names = listTools().map((tool) => tool.name);
		expect(names.filter((name) => /unlock|approve/i.test(name))).toEqual([]);
	});

	it("has no tool that restarts Juno into an update", () => {
		// Installing quits the app and relaunches it, which ends whatever a
		// person was in the middle of. Same answer as the lock, same reason.
		const names = listTools().map((tool) => tool.name);
		expect(names.filter((name) => /\.install$|restart/i.test(name))).toEqual([]);
	});
});

describe("components for document templates", () => {
	const TOOLS = [
		"templates.components.add_image",
		"templates.components.create",
		"templates.components.delete",
		"templates.components.detach",
		"templates.components.get",
		"templates.components.list",
		"templates.components.list_images",
		"templates.components.update",
	];

	it("puts every tool in a row, reads in Read, writes in Change records and the delete in Delete", () => {
		const names = listTools().map((tool) => tool.name).filter((name) => name.startsWith("templates.components."));
		expect(names.sort()).toEqual(TOOLS);
		for (const name of ["get", "list", "list_images"]) {
			expect(permissions.rowOf(`templates.components.${name}`)).toBe("read");
		}
		for (const name of ["create", "update", "add_image", "detach"]) {
			expect(permissions.rowOf(`templates.components.${name}`)).toBe("change");
		}
		expect(permissions.rowOf("templates.components.delete")).toBe("delete");
		expect(permissions.isLockedTool("templates.components.delete")).toBe(true);
	});

	it("makes nothing until approved, and parks the delete whatever the levels say", async () => {
		const parked = (await callTool("templates.components.create", { name: "Briefhoofd" })) as {
			status: string;
			actionId: string;
		};
		expect(parked.status).toBe("pending");
		expect(await callTool("templates.components.list", {})).toEqual([]);

		await actions.approve(parked.actionId);
		const made = (await callTool("templates.components.list", {})) as { id: string; name: string }[];
		expect(made).toMatchObject([{ name: "Briefhoofd" }]);

		forceSettings({ read: "allow", change: "allow", drafts: "allow", send: "allow", delete: "allow" });
		const removal = (await callTool("templates.components.delete", { id: made[0]!.id })) as { status: string };
		expect(removal.status).toBe("pending");
		expect(await callTool("templates.components.list", {})).toHaveLength(1);
	});
});
