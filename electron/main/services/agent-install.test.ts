import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { installIn as install, sameEntry, targetsIn as targets } from "./agent-install";
import type { McpServerStatus } from "../../shared/types";

const STATUS: McpServerStatus = {
	running: true,
	address: String.raw`\\.\pipe\juno-mcp-test`,
	connections: 0,
	command: "node",
	args: [String.raw`C:\juno\scripts\mcp-bridge.mjs`, "--user-data-dir", String.raw`C:\data`],
	env: {},
	configJson: "{}",
	error: null,
	toolCount: 9,
};

let home: string;

/** The Claude Desktop config on Windows, which is where most of these tests aim. */
function claudeDesktopPath(): string {
	return join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
}

function codexPath(): string {
	return join(home, ".codex", "config.toml");
}

function antigravityCandidates(): string[] {
	return [
		join(home, ".gemini", "config", "mcp_config.json"),
		join(home, ".gemini", "antigravity", "mcp_config.json"),
		join(home, ".gemini", "antigravity-ide", "mcp_config.json"),
	];
}

function write(path: string, text: string) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text, "utf8");
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "juno-install-"));
});

describe("json clients", () => {
	it("reports a client as not installed when none of its markers are on the machine", () => {
		const target = targets(STATUS, home, "win32").find((t) => t.id === "claude-code")!;
		expect(target.installed).toBe(false);
		expect(target.hasConfigFile).toBe(false);
		expect(target.configured).toBe(false);
	});

	it("tells installed and has-config-file apart: a client can be on the machine with no file yet", () => {
		// The client's own data directory exists, but it has never had an MCP
		// server added, so there is no config file yet.
		mkdirSync(join(home, ".claude"), { recursive: true });

		const target = targets(STATUS, home, "win32").find((t) => t.id === "claude-code")!;
		expect(target.installed).toBe(true);
		expect(target.hasConfigFile).toBe(false);
		expect(target.configured).toBe(false);
	});

	it("keeps every other server and every other key in the file", () => {
		write(
			claudeDesktopPath(),
			JSON.stringify({
				globalShortcut: "Alt+Space",
				mcpServers: { filesystem: { command: "npx", args: ["-y", "mcp-fs"] } },
			}),
		);

		install("claude-desktop", STATUS, home, "win32");

		const written = JSON.parse(readFileSync(claudeDesktopPath(), "utf8"));
		expect(written.globalShortcut).toBe("Alt+Space");
		expect(written.mcpServers.filesystem).toEqual({ command: "npx", args: ["-y", "mcp-fs"] });
		expect(written.mcpServers.juno.command).toBe("node");

		const target = targets(STATUS, home, "win32").find((t) => t.id === "claude-desktop")!;
		expect(target.installed).toBe(true);
		expect(target.hasConfigFile).toBe(true);
		expect(target.configured).toBe(true);
		expect(target.upToDate).toBe(true);
	});

	it("reports an existing juno entry that no longer matches as configured but not up to date", () => {
		install("claude-desktop", STATUS, home, "win32");

		const moved = { ...STATUS, args: ["/elsewhere"] };
		const target = targets(moved, home, "win32").find((t) => t.id === "claude-desktop")!;
		expect(target.configured).toBe(true);
		expect(target.upToDate).toBe(false);
	});

	it("creates the file when the client has never been opened", () => {
		const result = install("claude-desktop", STATUS, home, "win32");
		expect(result.created).toBe(true);
		expect(result.backupPath).toBeNull();
		const written = JSON.parse(readFileSync(claudeDesktopPath(), "utf8"));
		expect(written.mcpServers.juno).toEqual({ command: "node", args: STATUS.args });
	});

	it("backs the file up before rewriting it", () => {
		write(claudeDesktopPath(), JSON.stringify({ mcpServers: { old: { command: "x", args: [] } } }));
		const result = install("claude-desktop", STATUS, home, "win32");
		expect(result.backupPath).toBe(`${claudeDesktopPath()}.juno-backup.json`);
		const backup = JSON.parse(readFileSync(result.backupPath!, "utf8"));
		expect(backup.mcpServers.old).toBeDefined();
	});

	it("replaces its own entry rather than adding a second one", () => {
		install("claude-desktop", STATUS, home, "win32");
		install("claude-desktop", { ...STATUS, args: ["/new/path.mjs"] }, home, "win32");
		const written = JSON.parse(readFileSync(claudeDesktopPath(), "utf8"));
		expect(Object.keys(written.mcpServers)).toEqual(["juno"]);
		expect(written.mcpServers.juno.args).toEqual(["/new/path.mjs"]);
	});

	/**
	 * A parse error almost always means the file is in a format Juno has not
	 * seen, not that it is junk. Overwriting it would destroy a configuration.
	 */
	it("refuses a file it cannot parse instead of replacing it", () => {
		write(claudeDesktopPath(), "{ this is not json");
		expect(() => install("claude-desktop", STATUS, home, "win32")).toThrow(/not valid JSON/);
		expect(readFileSync(claudeDesktopPath(), "utf8")).toBe("{ this is not json");
	});

	it("writes VS Code under its own key", () => {
		install("vscode", STATUS, home, "win32");
		const path = join(home, "AppData", "Roaming", "Code", "User", "mcp.json");
		const written = JSON.parse(readFileSync(path, "utf8"));
		expect(written.servers.juno).toBeDefined();
		expect(written.mcpServers).toBeUndefined();
	});

	it("carries the environment a packaged bridge needs", () => {
		install("claude-desktop", { ...STATUS, env: { ELECTRON_RUN_AS_NODE: "1" } }, home, "win32");
		const written = JSON.parse(readFileSync(claudeDesktopPath(), "utf8"));
		expect(written.mcpServers.juno.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
	});

	it("leaves the env out entirely when there is none", () => {
		install("claude-desktop", STATUS, home, "win32");
		const written = JSON.parse(readFileSync(claudeDesktopPath(), "utf8"));
		expect("env" in written.mcpServers.juno).toBe(false);
	});

	it("will not point a client at a server that is not listening", () => {
		expect(() => install("claude-desktop", { ...STATUS, running: false }, home, "win32")).toThrow(
			/not listening/,
		);
	});

	it("reports which clients are present, configured and current", () => {
		expect(targets(STATUS, home, "win32").find((t) => t.id === "claude-desktop")).toMatchObject({
			installed: false,
			hasConfigFile: false,
			configured: false,
		});

		install("claude-desktop", STATUS, home, "win32");
		expect(targets(STATUS, home, "win32").find((t) => t.id === "claude-desktop")).toMatchObject({
			installed: true,
			hasConfigFile: true,
			configured: true,
			upToDate: true,
		});
	});
});

describe("antigravity", () => {
	it("picks the real config file when it exists, even alongside a later candidate", () => {
		const [real, symlinked] = antigravityCandidates();
		write(real, JSON.stringify({ mcpServers: {} }));
		write(symlinked, JSON.stringify({ mcpServers: {} }));

		const target = targets(STATUS, home, "win32").find((t) => t.id === "antigravity")!;
		expect(target.path).toBe(real);
	});

	it("falls back to the first candidate as the write target when none exists yet", () => {
		const [real] = antigravityCandidates();

		const target = targets(STATUS, home, "win32").find((t) => t.id === "antigravity")!;
		expect(target.path).toBe(real);
		expect(target.hasConfigFile).toBe(false);

		const result = install("antigravity", STATUS, home, "win32");
		expect(result.path).toBe(real);
		expect(result.created).toBe(true);
	});

	it("writes to the second candidate when only that one exists", () => {
		const [, symlinked] = antigravityCandidates();
		write(symlinked, JSON.stringify({ mcpServers: {} }));

		const result = install("antigravity", STATUS, home, "win32");
		expect(result.path).toBe(symlinked);
	});
});

describe("codex (toml)", () => {
	it("appends the section to an existing config.toml without touching the lines already in it", () => {
		const original = ['[profile.default]', 'approval_policy = "never"', "", "[mcp_servers.other]", 'command = "foo"', ""].join(
			"\n",
		);
		write(codexPath(), original);

		const result = install("codex", STATUS, home, "win32");
		expect(result.created).toBe(false);
		expect(result.backupPath).toBe(`${codexPath()}.juno-backup.toml`);

		const written = readFileSync(codexPath(), "utf8");
		expect(written).toContain(original.trimEnd());
		expect(written).toContain("[mcp_servers.juno]");
		expect(written).toContain('command = "node"');
	});

	it("replaces an existing [mcp_servers.juno] section including its env sub-section", () => {
		const original = [
			"[profile.default]",
			'approval_policy = "never"',
			"",
			"[mcp_servers.other]",
			'command = "foo"',
			"",
			"[mcp_servers.juno]",
			'command = "old-node"',
			'args = ["old"]',
			"",
			"[mcp_servers.juno.env]",
			'OLD_VAR = "1"',
			"",
			"[mcp_servers.another]",
			'command = "bar"',
			"",
		].join("\n");
		write(codexPath(), original);

		install("codex", { ...STATUS, env: { ELECTRON_RUN_AS_NODE: "1" } }, home, "win32");

		const written = readFileSync(codexPath(), "utf8");
		expect(written).toContain('[profile.default]\napproval_policy = "never"');
		expect(written).toContain('[mcp_servers.other]\ncommand = "foo"');
		expect(written).toContain('[mcp_servers.another]\ncommand = "bar"');
		expect(written).toContain('command = "node"');
		expect(written).not.toContain("old-node");
		expect(written).not.toContain("OLD_VAR");
		expect(written).toContain('ELECTRON_RUN_AS_NODE = "1"');
	});

	it("detects an up-to-date entry correctly, and a changed one as configured but stale", () => {
		install("codex", STATUS, home, "win32");

		const current = targets(STATUS, home, "win32").find((t) => t.id === "codex")!;
		expect(current.configured).toBe(true);
		expect(current.upToDate).toBe(true);

		const moved = targets({ ...STATUS, args: ["/elsewhere"] }, home, "win32").find((t) => t.id === "codex")!;
		expect(moved.configured).toBe(true);
		expect(moved.upToDate).toBe(false);
	});

	it("escapes a Windows path in the command and args", () => {
		install("codex", STATUS, home, "win32");
		const written = readFileSync(codexPath(), "utf8");

		const expectedArg = `"${STATUS.args[0].replace(/\\/g, "\\\\")}"`;
		expect(written).toContain(expectedArg);

		// It has to round trip: what was written reads back as up to date.
		const target = targets(STATUS, home, "win32").find((t) => t.id === "codex")!;
		expect(target.upToDate).toBe(true);
	});

	it("refuses a file that declares mcp_servers as an inline table", () => {
		const original = 'mcp_servers = { juno = { command = "x" } }\n';
		write(codexPath(), original);

		expect(() => install("codex", STATUS, home, "win32")).toThrow(/cannot safely edit/);
		expect(readFileSync(codexPath(), "utf8")).toBe(original);
	});

	it("creates config.toml when the client has never been opened", () => {
		const result = install("codex", STATUS, home, "win32");
		expect(result.created).toBe(true);
		expect(result.backupPath).toBeNull();
		const written = readFileSync(codexPath(), "utf8");
		expect(written).toContain("[mcp_servers.juno]");
		expect(written).toContain('command = "node"');
	});
});

describe("telling a configured client from a changed one", () => {
	it("treats a reordered entry as the same entry", () => {
		// An editor or another tool can rewrite the file with its keys sorted
		// without changing a word of what it says. Reporting that as "pointing
		// somewhere else" sends a person looking for a problem that is not there.
		expect(sameEntry({ command: "node", args: ["a", "b"] }, { args: ["a", "b"], command: "node" })).toBe(
			true,
		);
	});

	it("still sees a real difference", () => {
		expect(sameEntry({ command: "node", args: ["a"] }, { command: "node", args: ["b"] })).toBe(false);
		expect(sameEntry({ command: "node" }, { command: "node", env: {} })).toBe(false);
	});

	it("does not treat a reordered argument list as the same", () => {
		// Order is meaningless between keys and load-bearing inside an array:
		// --user-data-dir and its value are a pair, in that order.
		expect(sameEntry({ args: ["a", "b"] }, { args: ["b", "a"] })).toBe(false);
	});

	it("says a client reports the key its own file uses", () => {
		const rows = targets(STATUS, home, "win32");
		expect(rows.find((row) => row.id === "vscode")?.configKey).toBe("servers");
		expect(rows.find((row) => row.id === "codex")?.configKey).toBe("mcp_servers");
		expect(rows.find((row) => row.id === "claude-desktop")?.configKey).toBe("mcpServers");
	});
});
