import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { installIn as install, targetsIn as targets } from "./agent-install";
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

/** The Claude Desktop config on Windows, which is where these tests aim. */
function claudePath(): string {
	return join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
}

function write(path: string, text: string) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text, "utf8");
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "juno-install-"));
});

describe("agent install", () => {
	it("creates the file when the client has never been opened", () => {
		const result = install("claude-desktop", STATUS, home, "win32");
		expect(result.created).toBe(true);
		expect(result.backupPath).toBeNull();
		const written = JSON.parse(readFileSync(claudePath(), "utf8"));
		expect(written.mcpServers.juno).toEqual({ command: "node", args: STATUS.args });
	});

	/**
	 * The one that matters. This edits a file another program owns, and a person
	 * has other servers in it that Juno has no business touching.
	 */
	it("keeps every other server and every other key in the file", () => {
		write(
			claudePath(),
			JSON.stringify({
				globalShortcut: "Alt+Space",
				mcpServers: { filesystem: { command: "npx", args: ["-y", "mcp-fs"] } },
			}),
		);

		install("claude-desktop", STATUS, home, "win32");

		const written = JSON.parse(readFileSync(claudePath(), "utf8"));
		expect(written.globalShortcut).toBe("Alt+Space");
		expect(written.mcpServers.filesystem).toEqual({ command: "npx", args: ["-y", "mcp-fs"] });
		expect(written.mcpServers.juno.command).toBe("node");
	});

	it("backs the file up before rewriting it", () => {
		write(claudePath(), JSON.stringify({ mcpServers: { old: { command: "x", args: [] } } }));
		const result = install("claude-desktop", STATUS, home, "win32");
		expect(result.backupPath).toBe(`${claudePath()}.juno-backup.json`);
		const backup = JSON.parse(readFileSync(result.backupPath!, "utf8"));
		expect(backup.mcpServers.old).toBeDefined();
	});

	it("replaces its own entry rather than adding a second one", () => {
		install("claude-desktop", STATUS, home, "win32");
		install("claude-desktop", { ...STATUS, args: ["/new/path.mjs"] }, home, "win32");
		const written = JSON.parse(readFileSync(claudePath(), "utf8"));
		expect(Object.keys(written.mcpServers)).toEqual(["juno"]);
		expect(written.mcpServers.juno.args).toEqual(["/new/path.mjs"]);
	});

	/**
	 * A parse error almost always means the file is in a format Juno has not
	 * seen, not that it is junk. Overwriting it would destroy a configuration.
	 */
	it("refuses a file it cannot parse instead of replacing it", () => {
		write(claudePath(), "{ this is not json");
		expect(() => install("claude-desktop", STATUS, home, "win32")).toThrow(/not valid JSON/);
		expect(readFileSync(claudePath(), "utf8")).toBe("{ this is not json");
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
		const written = JSON.parse(readFileSync(claudePath(), "utf8"));
		expect(written.mcpServers.juno.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
	});

	it("leaves the env out entirely when there is none", () => {
		install("claude-desktop", STATUS, home, "win32");
		const written = JSON.parse(readFileSync(claudePath(), "utf8"));
		expect("env" in written.mcpServers.juno).toBe(false);
	});

	it("will not point a client at a server that is not listening", () => {
		expect(() => install("claude-desktop", { ...STATUS, running: false }, home, "win32")).toThrow(
			/not listening/,
		);
	});

	it("reports which clients are present, configured and current", () => {
		expect(targets(STATUS, home, "win32").find((t) => t.id === "claude-desktop")).toMatchObject({
			found: false,
			configured: false,
		});

		install("claude-desktop", STATUS, home, "win32");
		expect(targets(STATUS, home, "win32").find((t) => t.id === "claude-desktop")).toMatchObject({
			found: true,
			configured: true,
			upToDate: true,
		});

		// A path that moved, which is what an update or a reinstall produces.
		expect(
			targets({ ...STATUS, args: ["/elsewhere"] }, home, "win32").find(
				(t) => t.id === "claude-desktop",
			),
		).toMatchObject({ configured: true, upToDate: false });
	});
});
