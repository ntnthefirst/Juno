import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { instructionsText } from "../../shared/agent-permissions";
import type { AgentActionSource, AgentLevel } from "../../shared/types";
import * as permissions from "./agent-permissions";
import * as settings from "./settings";

let dir = "";

function store(agentPermissions?: Record<string, string>): void {
	dir = mkdtempSync(join(tmpdir(), "juno-perm-"));
	if (agentPermissions) writeFileSync(join(dir, "settings.json"), JSON.stringify({ agentPermissions }), "utf8");
	settings.configureSettings(dir);
}

const SOURCES: AgentActionSource[] = ["mcp", "assistant", "automation"];
const LEVELS: AgentLevel[] = ["off", "ask", "allow"];

beforeEach(() => store());

describe("gate", () => {
	it("parks send, sign, file and delete from every source and at every stored level, or refuses when off", async () => {
		for (const level of LEVELS) {
			store({ send: level, delete: level });
			for (const source of SOURCES) {
				for (const name of ["mail.send", "mail.file.archive", "clients.delete", "mail.file.delete"]) {
					const outcome = permissions.gate({ name, readOnly: false, source });
					if (level === "off") await expect(outcome).rejects.toThrow(/turned off/);
					else await expect(outcome).resolves.toBe("park");
				}
			}
		}
	});

	it("runs a change at allow and parks it at ask, for a person asking", async () => {
		await permissions.setPermissions({ change: "allow" });
		expect(await permissions.gate({ name: "clients.update", readOnly: false, source: "mcp" })).toBe("run");
		await permissions.setPermissions({ change: "ask" });
		expect(await permissions.gate({ name: "clients.update", readOnly: false, source: "mcp" })).toBe("park");
	});

	it("parks an automation step that writes, at allow too", async () => {
		await permissions.setPermissions({ change: "allow", drafts: "allow" });
		for (const name of ["clients.update", "time.start", "mail.blocks.create", "mail.draft", "mail.reply"]) {
			expect(await permissions.gate({ name, readOnly: false, source: "automation" }), name).toBe("park");
		}
		expect(await permissions.gate({ name: "clients.list", readOnly: true, source: "automation" })).toBe("run");
	});

	it("refuses an unclassified tool", async () => {
		await expect(permissions.gate({ name: "clients.invented", readOnly: false, source: "mcp" })).rejects.toThrow(
			/no permission row/,
		);
	});
});

describe("the stored levels", () => {
	it("read a locked row stored as allow as ask first", async () => {
		store({ read: "allow", send: "allow", delete: "allow", change: "allow" });
		expect(await permissions.getPermissions()).toEqual({
			read: "allow",
			change: "allow",
			drafts: "allow",
			send: "ask",
			delete: "ask",
		});
	});

	it("fall back to the defaults for junk", async () => {
		store({ read: "maybe", change: "yes" });
		expect(await permissions.getPermissions()).toMatchObject({ read: "allow", change: "ask" });
	});
});

describe("the instructions text", () => {
	it("is empty when nothing was written", () => {
		expect(instructionsText({ everyone: "  ", mail: "", areas: [] })).toBe("");
	});

	it("puts the owner's words under a heading each", () => {
		const text = instructionsText({
			everyone: "Write in Dutch.",
			mail: "Sign with my name.",
			areas: [{ area: "clients", text: "Use u." }],
		});
		expect(text).toContain("For every task:\nWrite in Dutch.");
		expect(text).toContain("For mail:\nSign with my name.");
		expect(text).toContain("For clients:\nUse u.");
	});
});
