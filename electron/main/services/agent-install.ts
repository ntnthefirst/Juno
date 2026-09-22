import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentClientTarget, McpServerStatus } from "../../shared/types";

/**
 * Writing Juno into the MCP configuration of the agent clients on this machine.
 *
 * The alternative is what this replaces: copy a block of JSON, find a file
 * whose path differs per client and per platform, work out whether it exists,
 * and merge by hand without breaking the servers already in it. That is four
 * chances to get it wrong before anything can be tested.
 *
 * Rules this follows, because it edits files that belong to other programs:
 *
 * - Nothing is written until the person asks for that one client by name.
 * - The existing file is copied to <name>.juno-backup.json first.
 * - Only the one "juno" entry is added or replaced. Every other key, every
 *   other server and the file's own shape are read, kept and written back.
 * - A file that is not valid JSON is refused rather than replaced. It is
 *   somebody's configuration, and a parse error is far more likely to mean
 *   "this client uses a format we do not know" than "this file is junk".
 */

type Platform = NodeJS.Platform;

type ClientSpec = {
	id: string;
	name: string;
	/** Where this client keeps its MCP servers, per platform. */
	file: (home: string, platform: Platform) => string | null;
	/**
	 * The object servers live under. VS Code calls it "servers", everyone else
	 * copied Claude Desktop and calls it "mcpServers".
	 */
	key: string;
	/** What the person has to do after the file changes. */
	after: string;
};

const APPDATA = (home: string) => join(home, "AppData", "Roaming");

const CLIENTS: ClientSpec[] = [
	{
		id: "claude-desktop",
		name: "Claude Desktop",
		key: "mcpServers",
		after: "Quit Claude Desktop and start it again. It reads this file once, at launch.",
		file: (home, platform) =>
			platform === "win32"
				? join(APPDATA(home), "Claude", "claude_desktop_config.json")
				: platform === "darwin"
					? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
					: join(home, ".config", "Claude", "claude_desktop_config.json"),
	},
	{
		id: "claude-code",
		name: "Claude Code",
		key: "mcpServers",
		after: "Open a new Claude Code session. Run /mcp in it to check Juno is listed.",
		// The user-scope config, so Juno is available in every project rather
		// than in whichever directory it happened to be added from.
		file: (home) => join(home, ".claude.json"),
	},
	{
		id: "cursor",
		name: "Cursor",
		key: "mcpServers",
		after: "Restart Cursor, then enable Juno under Settings > MCP.",
		file: (home) => join(home, ".cursor", "mcp.json"),
	},
	{
		id: "windsurf",
		name: "Windsurf",
		key: "mcpServers",
		after: "Restart Windsurf, then press refresh in the Cascade MCP panel.",
		file: (home) => join(home, ".codeium", "windsurf", "mcp_config.json"),
	},
	{
		id: "vscode",
		name: "VS Code",
		key: "servers",
		after: "Reload the window, then pick Juno from the tools menu in Copilot Chat.",
		file: (home, platform) =>
			platform === "win32"
				? join(APPDATA(home), "Code", "User", "mcp.json")
				: platform === "darwin"
					? join(home, "Library", "Application Support", "Code", "User", "mcp.json")
					: join(home, ".config", "Code", "User", "mcp.json"),
	},
];

/** The entry Juno writes. Matches what the connection panel prints. */
function entryOf(status: McpServerStatus): Record<string, unknown> {
	return {
		command: status.command,
		args: [...status.args],
		// Only when there is one. An empty env object in a config file reads as
		// something that was meant to be filled in.
		...(Object.keys(status.env).length > 0 ? { env: { ...status.env } } : {}),
	};
}

function parse(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	const text = readFileSync(path, "utf8").trim();
	if (text.length === 0) return {};
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(
			`${path} is not valid JSON, so Juno will not rewrite it. Open it, fix or remove it, and try again.`,
		);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} does not hold a JSON object, so Juno will not rewrite it.`);
	}
	return value as Record<string, unknown>;
}

function serversIn(config: Record<string, unknown>, key: string): Record<string, unknown> {
	const existing = config[key];
	if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return {};
	return existing as Record<string, unknown>;
}

/**
 * What is on this machine, and where Juno stands with each one.
 *
 * "installed" is whether the file is there, which is the only honest signal
 * without looking for executables on a path that differs per platform and per
 * installer. A client that has never been opened has no config file yet, so it
 * shows as not found, and the file is still offered: writing it is what makes
 * the client pick Juno up on first launch.
 */
export function targetsIn(
	status: McpServerStatus,
	home: string,
	platform: Platform,
): AgentClientTarget[] {
	const wanted = entryOf(status);

	return CLIENTS.map((client) => {
		const path = client.file(home, platform);
		if (path === null) {
			return {
				id: client.id,
				name: client.name,
				path: null,
				found: false,
				configured: false,
				upToDate: false,
				after: client.after,
			};
		}

		let configured = false;
		let upToDate = false;
		try {
			const current = serversIn(parse(path), client.key)["juno"];
			configured = current !== undefined;
			upToDate = configured && JSON.stringify(current) === JSON.stringify(wanted);
		} catch {
			// A file that cannot be read tells us nothing about whether Juno is in
			// it. Install will report the same problem with a message worth reading.
			configured = false;
		}

		return {
			id: client.id,
			name: client.name,
			path,
			found: existsSync(path),
			configured,
			upToDate,
			after: client.after,
		};
	});
}

export type InstallResult = {
	name: string;
	path: string;
	/** Where the previous file was copied, when there was one. */
	backupPath: string | null;
	created: boolean;
	after: string;
};

/**
 * Writes the Juno entry into one client's configuration.
 *
 * Side-effectful, and on a file another program owns, so it is never called
 * without the person naming that client. See the rules at the top.
 */
export function installIn(
	clientId: string,
	status: McpServerStatus,
	home: string,
	platform: Platform,
): InstallResult {
	const client = CLIENTS.find((candidate) => candidate.id === clientId);
	if (!client) throw new Error(`Juno does not know how to configure ${clientId}.`);

	const path = client.file(home, platform);
	if (path === null) throw new Error(`${client.name} is not available on this platform.`);

	if (!status.running) {
		throw new Error(
			"The Juno agent server is not listening, so there is nothing to point a client at yet.",
		);
	}

	const existed = existsSync(path);
	const config = parse(path);

	let backupPath: string | null = null;
	if (existed) {
		backupPath = `${path}.juno-backup.json`;
		copyFileSync(path, backupPath);
	} else {
		mkdirSync(dirname(path), { recursive: true });
	}

	// Everything else in the file is read and written back untouched. Only the
	// one entry named "juno" is ours to replace.
	const servers = { ...serversIn(config, client.key), juno: entryOf(status) };
	const next = { ...config, [client.key]: servers };

	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");

	return { name: client.name, path, backupPath, created: !existed, after: client.after };
}

/* ------------------------------------------------------------------ wiring */

type Deps = {
	/** Read fresh on every call: the bridge path moves with an update. */
	status: () => McpServerStatus;
	home: string;
	platform: Platform;
};

let deps: Deps | null = null;

/**
 * Injected from main.ts, like every other service that needs a path. Keeping
 * `electron` out of here is what lets the two functions above be tested against
 * a temporary directory rather than a real home folder.
 */
export function configureAgentInstall(next: Deps): void {
	deps = next;
}

function required(): Deps {
	if (!deps) throw new Error("configureAgentInstall has not been called.");
	return deps;
}

/** Every agent client Juno knows about, and where it stands with each. */
export function targets(): AgentClientTarget[] {
	const { status, home, platform } = required();
	return targetsIn(status(), home, platform);
}

/** Writes Juno into one named client. See the rules at the top of this file. */
export function install(clientId: string): InstallResult {
	const { status, home, platform } = required();
	return installIn(clientId, status(), home, platform);
}
