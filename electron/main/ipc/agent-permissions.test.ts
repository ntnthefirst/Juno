import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The IPC route to the permission levels. The handlers are captured from a
 * stand-in `ipcMain`, so what runs is the real registration in `agent.ts` and
 * the real service behind it.
 */
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
			handlers.set(channel, handler);
		},
	},
	BrowserWindow: { getAllWindows: () => [] },
	app: { getPath: () => tmpdir(), getVersion: () => "0.0.0", isPackaged: false },
	shell: {},
}));
vi.mock("../windows", () => ({ getMainWindow: () => null, getSettingsWindow: () => null }));
vi.mock("../services/lock", () => ({ isLocked: () => false }));

const { registerAgentIpc } = await import("./agent");
const settings = await import("../services/settings");

function call(channel: string, ...args: unknown[]): Promise<unknown> {
	const handler = handlers.get(channel);
	if (!handler) throw new Error(`No handler for ${channel}.`);
	return Promise.resolve().then(() => handler({}, ...args));
}

beforeEach(() => {
	settings.configureSettings(mkdtempSync(join(tmpdir(), "juno-ipc-")));
	handlers.clear();
	registerAgentIpc();
});

describe("agent.permissions over IPC", () => {
	it("returns the five rows and where each is set", async () => {
		const view = (await call("agent.permissions.get")) as {
			rows: { kind: string; locked: boolean }[];
			levels: Record<string, string>;
		};
		expect(view.rows.map((row) => row.kind)).toEqual(["read", "change", "drafts", "send", "delete"]);
		expect(view.rows.filter((row) => row.locked).map((row) => row.kind)).toEqual(["send", "delete"]);
		expect(view.levels).toEqual({ read: "allow", change: "ask", drafts: "allow", send: "ask", delete: "ask" });
	});

	it("saves a level a row may have", async () => {
		const view = (await call("agent.permissions.set", { change: "allow" })) as { levels: Record<string, string> };
		expect(view.levels.change).toBe("allow");
	});

	it("refuses allow for send, sign, file and delete, and keeps what was there", async () => {
		await expect(call("agent.permissions.set", { send: "allow" })).rejects.toThrow(/cannot be set to Allow/);
		await expect(call("agent.permissions.set", { delete: "allow" })).rejects.toThrow(/cannot be set to Allow/);
		await expect(call("agent.permissions.set", { read: "allow", send: "allow" })).rejects.toThrow();
		const view = (await call("agent.permissions.get")) as { levels: Record<string, string> };
		expect(view.levels.send).toBe("ask");
		expect(view.levels.delete).toBe("ask");
	});

	it("refuses a row or a level it does not know", async () => {
		await expect(call("agent.permissions.set", { everything: "allow" })).rejects.toThrow(/not a permission row/);
		await expect(call("agent.permissions.set", { read: "sometimes" })).rejects.toThrow(/not a level/);
	});

	it("cannot approve a request by any permission channel", () => {
		expect([...handlers.keys()].filter((channel) => channel.startsWith("agent.permissions"))).toEqual([
			"agent.permissions.get",
			"agent.permissions.set",
		]);
	});
});

describe("agent.instructions over IPC", () => {
	it("keeps what was written, trims it to a known area, and hands back the areas", async () => {
		const view = (await call("agent.instructions.set", {
			everyone: "Write in Dutch.",
			mail: "Sign with my name.",
			areas: [
				{ area: "clients", text: "Use u." },
				{ area: "nonsense", text: "dropped" },
				{ area: "clients", text: "twice" },
			],
		})) as { instructions: { everyone: string; areas: { area: string }[] }; areas: { id: string }[] };
		expect(view.instructions.everyone).toBe("Write in Dutch.");
		expect(view.instructions.areas.map((entry) => entry.area)).toEqual(["clients"]);
		expect(view.areas.map((area) => area.id)).toContain("projects");
		const again = (await call("agent.instructions.get")) as typeof view;
		expect(again.instructions.mail).toBe("Sign with my name.");
	});
});
