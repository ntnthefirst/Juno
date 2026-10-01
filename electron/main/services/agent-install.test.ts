import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { installIn as install, sameEntry, targetsIn as targets, type ServerInfo } from "./agent-install";

const STATUS: ServerInfo = { enabled: true, running: true, url: "http://127.0.0.1:5866/mcp" };

let home: string;

/** Claude Code keeps its servers in one file in the home folder, on every platform. */
function claudeCodePath(): string {
	return join(home, ".claude.json");
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

function read(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "juno-install-"));
});

describe("which clients are offered", () => {
	it("leaves out Claude Desktop, which cannot be given an address", () => {
		expect(targets(STATUS, home, "win32").map((target) => target.id)).toEqual([
			"claude-code",
			"cursor",
			"windsurf",
			"vscode",
			"codex",
			"antigravity",
		]);
	});

	it("gives each client the shape of entry it reads", () => {
		const byId = Object.fromEntries(targets(STATUS, home, "win32").map((target) => [target.id, target.snippet]));
		const url = STATUS.url;

		expect(JSON.parse(byId["claude-code"])).toEqual({ mcpServers: { juno: { type: "http", url } } });
		expect(JSON.parse(byId.cursor)).toEqual({ mcpServers: { juno: { url } } });
		expect(JSON.parse(byId.windsurf)).toEqual({ mcpServers: { juno: { serverUrl: url } } });
		expect(JSON.parse(byId.vscode)).toEqual({ servers: { juno: { type: "http", url } } });
		expect(JSON.parse(byId.antigravity)).toEqual({ mcpServers: { juno: { serverUrl: url } } });
		expect(byId.codex).toBe(`[mcp_servers.juno]\nurl = "${url}"`);
	});

	it("says a client reports the key its own file uses", () => {
		const rows = targets(STATUS, home, "win32");
		expect(rows.find((row) => row.id === "vscode")?.configKey).toBe("servers");
		expect(rows.find((row) => row.id === "codex")?.configKey).toBe("mcp_servers");
		expect(rows.find((row) => row.id === "cursor")?.configKey).toBe("mcpServers");
	});
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
			claudeCodePath(),
			JSON.stringify({
				theme: "dark",
				mcpServers: { filesystem: { command: "npx", args: ["-y", "mcp-fs"] } },
			}),
		);

		install("claude-code", STATUS, home, "win32");

		const written = read(claudeCodePath());
		expect(written.theme).toBe("dark");
		expect(written.mcpServers.filesystem).toEqual({ command: "npx", args: ["-y", "mcp-fs"] });
		expect(written.mcpServers.juno).toEqual({ type: "http", url: STATUS.url });

		const target = targets(STATUS, home, "win32").find((t) => t.id === "claude-code")!;
		expect(target).toMatchObject({ installed: true, hasConfigFile: true, configured: true, upToDate: true });
	});

	it("reports an entry from the design before this one as configured but not up to date", () => {
		write(
			claudeCodePath(),
			JSON.stringify({ mcpServers: { juno: { command: "node", args: ["C:\\juno\\scripts\\mcp-bridge.mjs"] } } }),
		);
		const target = targets(STATUS, home, "win32").find((t) => t.id === "claude-code")!;
		expect(target.configured).toBe(true);
		expect(target.upToDate).toBe(false);
	});

	it("reports an entry pointing at another port as stale", () => {
		install("claude-code", STATUS, home, "win32");
		const moved = targets({ ...STATUS, url: "http://127.0.0.1:6001/mcp" }, home, "win32").find(
			(t) => t.id === "claude-code",
		)!;
		expect(moved.configured).toBe(true);
		expect(moved.upToDate).toBe(false);
	});

	it("creates the file when the client has never been opened", () => {
		const result = install("claude-code", STATUS, home, "win32");
		expect(result.created).toBe(true);
		expect(result.backupPath).toBeNull();
		expect(read(claudeCodePath()).mcpServers.juno).toEqual({ type: "http", url: STATUS.url });
	});

	it("backs the file up before rewriting it", () => {
		write(claudeCodePath(), JSON.stringify({ mcpServers: { old: { command: "x", args: [] } } }));
		const result = install("claude-code", STATUS, home, "win32");
		expect(result.backupPath).toBe(`${claudeCodePath()}.juno-backup.json`);
		expect(read(result.backupPath!).mcpServers.old).toBeDefined();
	});

	it("replaces its own entry rather than adding a second one", () => {
		install("claude-code", STATUS, home, "win32");
		install("claude-code", { ...STATUS, url: "http://127.0.0.1:6001/mcp" }, home, "win32");
		const written = read(claudeCodePath());
		expect(Object.keys(written.mcpServers)).toEqual(["juno"]);
		expect(written.mcpServers.juno.url).toBe("http://127.0.0.1:6001/mcp");
	});

	/**
	 * A parse error almost always means the file is in a format Juno has not
	 * seen, not that it is junk. Overwriting it would destroy a configuration.
	 */
	it("refuses a file it cannot parse instead of replacing it", () => {
		write(claudeCodePath(), "{ this is not json");
		expect(() => install("claude-code", STATUS, home, "win32")).toThrow(/not valid JSON/);
		expect(readFileSync(claudeCodePath(), "utf8")).toBe("{ this is not json");
	});

	it("writes VS Code under its own key", () => {
		install("vscode", STATUS, home, "win32");
		const written = read(join(home, "AppData", "Roaming", "Code", "User", "mcp.json"));
		expect(written.servers.juno).toEqual({ type: "http", url: STATUS.url });
		expect(written.mcpServers).toBeUndefined();
	});

	it("will not point a client at a server that is off, and says to switch it on", () => {
		expect(() => install("claude-code", { ...STATUS, running: false, enabled: false }, home, "win32")).toThrow(
			/switched off/,
		);
	});

	it("says the server could not start when it is meant to be on", () => {
		expect(() => install("claude-code", { ...STATUS, running: false }, home, "win32")).toThrow(/could not start/);
	});

	it("does not know Claude Desktop any more", () => {
		expect(() => install("claude-desktop", STATUS, home, "win32")).toThrow(/does not know how to configure/);
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
		const original = ["[profile.default]", 'approval_policy = "never"', "", "[mcp_servers.other]", 'command = "foo"', ""].join(
			"\n",
		);
		write(codexPath(), original);

		const result = install("codex", STATUS, home, "win32");
		expect(result.created).toBe(false);
		expect(result.backupPath).toBe(`${codexPath()}.juno-backup.toml`);

		const written = readFileSync(codexPath(), "utf8");
		expect(written).toContain(original.trimEnd());
		expect(written).toContain("[mcp_servers.juno]");
		expect(written).toContain(`url = "${STATUS.url}"`);
	});

	it("replaces an old command entry, with its env sub-section, and keeps its neighbours", () => {
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

		install("codex", STATUS, home, "win32");

		const written = readFileSync(codexPath(), "utf8");
		expect(written).toContain('[profile.default]\napproval_policy = "never"');
		expect(written).toContain('[mcp_servers.other]\ncommand = "foo"');
		expect(written).toContain('[mcp_servers.another]\ncommand = "bar"');
		expect(written).toContain(`url = "${STATUS.url}"`);
		expect(written).not.toContain("old-node");
		expect(written).not.toContain("OLD_VAR");
	});

	it("detects an up-to-date entry correctly, and a changed one as configured but stale", () => {
		install("codex", STATUS, home, "win32");

		const current = targets(STATUS, home, "win32").find((t) => t.id === "codex")!;
		expect(current.configured).toBe(true);
		expect(current.upToDate).toBe(true);

		const moved = targets({ ...STATUS, url: "http://127.0.0.1:6001/mcp" }, home, "win32").find((t) => t.id === "codex")!;
		expect(moved.configured).toBe(true);
		expect(moved.upToDate).toBe(false);
	});

	it("reports a command entry from the earlier design as stale", () => {
		write(codexPath(), ['[mcp_servers.juno]', 'command = "node"', 'args = ["x"]', ""].join("\n"));
		const target = targets(STATUS, home, "win32").find((t) => t.id === "codex")!;
		expect(target.configured).toBe(true);
		expect(target.upToDate).toBe(false);
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
		expect(written).toContain(`url = "${STATUS.url}"`);
	});
});

describe("telling a configured client from a changed one", () => {
	it("treats a reordered entry as the same entry", () => {
		// An editor or another tool can rewrite the file with its keys sorted
		// without changing a word of what it says. Reporting that as "pointing
		// somewhere else" sends a person looking for a problem that is not there.
		expect(sameEntry({ type: "http", url: "a" }, { url: "a", type: "http" })).toBe(true);
	});

	it("still sees a real difference", () => {
		expect(sameEntry({ url: "a" }, { url: "b" })).toBe(false);
		expect(sameEntry({ url: "a" }, { url: "a", headers: {} })).toBe(false);
	});

	it("does not treat a reordered list as the same", () => {
		// Order is meaningless between keys and load-bearing inside an array.
		expect(sameEntry({ args: ["a", "b"] }, { args: ["b", "a"] })).toBe(false);
	});
});
