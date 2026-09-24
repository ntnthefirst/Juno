import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentClientTarget, AgentConfigFormat, McpServerStatus } from "../../shared/types";

/**
 * Writing Juno into the MCP configuration of the agent clients on this machine.
 *
 * The alternative is what this replaces: copy a block of JSON or TOML, find a
 * file whose path differs per client and per platform, work out whether it
 * exists, and merge by hand without breaking the servers already in it. That
 * is four chances to get it wrong before anything can be tested.
 *
 * Rules this follows, because it edits files that belong to other programs:
 *
 * - Nothing is written until the person asks for that one client by name.
 * - The existing file is copied to a `.juno-backup` file first.
 * - Only the one "juno" entry is added or replaced. Every other key, every
 *   other server and the file's own shape are read, kept and written back.
 * - A file this writer cannot parse, or cannot safely edit, is refused rather
 *   than replaced. It is somebody's configuration, and a parse error is far
 *   more likely to mean "this client uses a shape we do not know" than "this
 *   file is junk".
 */

type Platform = NodeJS.Platform;

type ClientSpec = {
	id: string;
	name: string;
	format: AgentConfigFormat;
	/**
	 * The object (json) or table (toml) servers live under. VS Code calls it
	 * "servers", everyone else copied Claude Desktop and calls it "mcpServers".
	 * Codex, the one TOML client, calls it "mcp_servers".
	 */
	key: string;
	/** What the person has to do after the file changes. */
	after: string;
	/**
	 * Where this client would keep its MCP servers, in order of preference, for
	 * this platform. The first candidate that exists is the one reported and
	 * written to; when none exists, the first candidate is the write target. An
	 * empty array means this client is not available on this platform.
	 */
	configCandidates: (home: string, platform: Platform) => string[];
	/**
	 * Paths whose presence means this client is on the machine at all: its data
	 * folder, its install directory. Distinct from the config file, which may
	 * not exist yet even when the client is installed.
	 */
	installMarkers: (home: string, platform: Platform) => string[];
};

const APPDATA = (home: string) => join(home, "AppData", "Roaming");
const LOCALAPPDATA = (home: string) => join(home, "AppData", "Local");

const CLIENTS: ClientSpec[] = [
	{
		id: "claude-desktop",
		name: "Claude Desktop",
		format: "json",
		key: "mcpServers",
		after: "Quit Claude Desktop and start it again. It reads this file once, at launch.",
		configCandidates: (home, platform) =>
			platform === "win32"
				? [join(APPDATA(home), "Claude", "claude_desktop_config.json")]
				: platform === "darwin"
					? [join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")]
					: [join(home, ".config", "Claude", "claude_desktop_config.json")],
		installMarkers: (home, platform) =>
			platform === "win32"
				? [join(APPDATA(home), "Claude"), join(LOCALAPPDATA(home), "AnthropicClaude")]
				: platform === "darwin"
					? ["/Applications/Claude.app", join(home, "Library", "Application Support", "Claude")]
					: [join(home, ".config", "Claude")],
	},
	{
		id: "claude-code",
		name: "Claude Code",
		format: "json",
		key: "mcpServers",
		after: "Open a new Claude Code session. Run /mcp in it to check Juno is listed.",
		// The user-scope config, so Juno is available in every project rather
		// than in whichever directory it happened to be added from.
		configCandidates: (home) => [join(home, ".claude.json")],
		installMarkers: (home) => [join(home, ".claude"), join(home, ".claude.json")],
	},
	{
		id: "cursor",
		name: "Cursor",
		format: "json",
		key: "mcpServers",
		after: "Restart Cursor, then enable Juno under Settings > MCP.",
		configCandidates: (home) => [join(home, ".cursor", "mcp.json")],
		installMarkers: (home, platform) => [
			join(home, ".cursor"),
			...(platform === "win32" ? [join(LOCALAPPDATA(home), "Programs", "cursor")] : []),
			...(platform === "darwin" ? ["/Applications/Cursor.app"] : []),
		],
	},
	{
		id: "windsurf",
		name: "Windsurf",
		format: "json",
		key: "mcpServers",
		after: "Restart Windsurf, then press refresh in the Cascade MCP panel.",
		configCandidates: (home) => [join(home, ".codeium", "windsurf", "mcp_config.json")],
		installMarkers: (home, platform) => [
			join(home, ".codeium", "windsurf"),
			...(platform === "win32" ? [join(LOCALAPPDATA(home), "Programs", "Windsurf")] : []),
			...(platform === "darwin" ? ["/Applications/Windsurf.app"] : []),
		],
	},
	{
		id: "vscode",
		name: "VS Code",
		format: "json",
		key: "servers",
		after: "Reload the window, then pick Juno from the tools menu in Copilot Chat.",
		// Stable first, then Insiders. The first candidate that exists wins, so
		// a machine with both is configured for the one it actually has a file
		// for, and a machine with only Insiders is not told VS Code is missing.
		configCandidates: (home, platform) =>
			platform === "win32"
				? [
						join(APPDATA(home), "Code", "User", "mcp.json"),
						join(APPDATA(home), "Code - Insiders", "User", "mcp.json"),
					]
				: platform === "darwin"
					? [
							join(home, "Library", "Application Support", "Code", "User", "mcp.json"),
							join(home, "Library", "Application Support", "Code - Insiders", "User", "mcp.json"),
						]
					: [
							join(home, ".config", "Code", "User", "mcp.json"),
							join(home, ".config", "Code - Insiders", "User", "mcp.json"),
						],
		installMarkers: (home, platform) =>
			platform === "win32"
				? [
						join(APPDATA(home), "Code"),
						join(APPDATA(home), "Code - Insiders"),
						join(LOCALAPPDATA(home), "Programs", "Microsoft VS Code"),
						join(LOCALAPPDATA(home), "Programs", "Microsoft VS Code Insiders"),
					]
				: platform === "darwin"
					? [
							join(home, "Library", "Application Support", "Code"),
							join(home, "Library", "Application Support", "Code - Insiders"),
							"/Applications/Visual Studio Code.app",
							"/Applications/Visual Studio Code - Insiders.app",
						]
					: [join(home, ".config", "Code"), join(home, ".config", "Code - Insiders")],
	},
	{
		id: "codex",
		name: "Codex",
		format: "toml",
		key: "mcp_servers",
		after: "Start a new Codex session. Run /mcp in it to check Juno is listed.",
		configCandidates: (home) => [join(home, ".codex", "config.toml")],
		installMarkers: (home) => [join(home, ".codex")],
	},
	{
		id: "antigravity",
		name: "Antigravity",
		format: "json",
		key: "mcpServers",
		after: "Restart Antigravity, then press refresh in its MCP servers panel.",
		// The real file, then the machine-specific symlinks that point at it.
		configCandidates: (home) => [
			join(home, ".gemini", "config", "mcp_config.json"),
			join(home, ".gemini", "antigravity", "mcp_config.json"),
			join(home, ".gemini", "antigravity-ide", "mcp_config.json"),
		],
		installMarkers: (home, platform) => [
			join(home, ".antigravity"),
			join(home, ".gemini", "antigravity"),
			...(platform === "win32"
				? [join(APPDATA(home), "Antigravity"), join(LOCALAPPDATA(home), "Programs", "Antigravity")]
				: []),
			...(platform === "darwin" ? ["/Applications/Antigravity.app"] : []),
		],
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

function parseJson(path: string): Record<string, unknown> {
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

/* -------------------------------------------------------------------- toml */

/**
 * Enough of TOML to find one table and read or replace it, not a general
 * parser. It only has to understand what this file itself writes, plus the
 * handful of shapes a person might reasonably have typed by hand: a basic
 * string, an array of basic strings, comments and blank lines.
 */

type TomlSection = { header: string; start: number; end: number };

/** Every `[table.header]` line in the file, with the byte range it owns. */
function tomlSections(text: string): TomlSection[] {
	const headerRe = /^[ \t]*\[([^[\]\r\n]+)\][ \t]*\r?$/gm;
	const found: { header: string; index: number }[] = [];
	let match: RegExpExecArray | null;
	while ((match = headerRe.exec(text)) !== null) {
		found.push({ header: match[1].trim(), index: match.index });
	}
	return found.map((entry, i) => ({
		header: entry.header,
		start: entry.index,
		end: i + 1 < found.length ? found[i + 1].index : text.length,
	}));
}

function sectionBody(text: string, section: TomlSection): string {
	const headerLineEnd = text.indexOf("\n", section.start);
	const bodyStart = headerLineEnd === -1 ? text.length : headerLineEnd + 1;
	return text.slice(bodyStart, section.end);
}

/** Escapes a value for a TOML basic string. Windows paths need this most. */
function tomlString(value: string): string {
	const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
	return `"${escaped}"`;
}

/** Reverses `tomlString` for the handful of escapes it, or a person, produces. */
function unescapeTomlString(raw: string): string {
	const inner = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
	let out = "";
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "\\" && i + 1 < inner.length) {
			const escapes: Record<string, string> = { "\\": "\\", '"': '"', n: "\n", t: "\t", r: "\r" };
			const next = inner[i + 1];
			if (next in escapes) {
				out += escapes[next];
				i++;
				continue;
			}
		}
		out += ch;
	}
	return out;
}

/** Splits `["a", "b"]` into its quoted items, respecting quotes around commas. */
function parseTomlStringArray(raw: string): string[] {
	const inner = raw.trim().replace(/^\[/, "").replace(/\]\s*$/, "");
	if (inner.trim().length === 0) return [];
	const items: string[] = [];
	let current = "";
	let inString = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === '"' && inner[i - 1] !== "\\") {
			inString = !inString;
			current += ch;
		} else if (ch === "," && !inString) {
			items.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}
	if (current.trim().length > 0) items.push(current.trim());
	return items.map(unescapeTomlString);
}

function parseTomlBody(body: string): Map<string, string> {
	const values = new Map<string, string>();
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
	}
	return values;
}

type TomlJunoSection = { command: string; args: string[]; env: Record<string, string> };

/** Reads the `[<key>.juno]` table and its `.env` sub-table, if any. */
function readTomlJunoSection(text: string, key: string): TomlJunoSection | null {
	const sections = tomlSections(text);
	const junoIndex = sections.findIndex((section) => section.header === `${key}.juno`);
	if (junoIndex === -1) return null;

	const body = parseTomlBody(sectionBody(text, sections[junoIndex]));
	const command = body.has("command") ? unescapeTomlString(body.get("command")!) : "";
	const args = body.has("args") ? parseTomlStringArray(body.get("args")!) : [];

	const env: Record<string, string> = {};
	const next = sections[junoIndex + 1];
	if (next && next.header === `${key}.juno.env`) {
		for (const [envKey, raw] of parseTomlBody(sectionBody(text, next))) {
			env[envKey] = unescapeTomlString(raw);
		}
	}

	return { command, args, env };
}

function tomlJunoMatches(section: TomlJunoSection, status: McpServerStatus): boolean {
	if (section.command !== status.command) return false;
	if (section.args.length !== status.args.length) return false;
	if (section.args.some((value, i) => value !== status.args[i])) return false;
	const envKeys = Object.keys(status.env);
	if (Object.keys(section.env).length !== envKeys.length) return false;
	return envKeys.every((envKey) => section.env[envKey] === status.env[envKey]);
}

/** The `[<key>.juno]` block this install would write, with no trailing newline. */
function tomlJunoBlock(key: string, status: McpServerStatus): string {
	const lines = [
		`[${key}.juno]`,
		`command = ${tomlString(status.command)}`,
		`args = [${status.args.map(tomlString).join(", ")}]`,
	];
	if (Object.keys(status.env).length > 0) {
		lines.push("", `[${key}.juno.env]`);
		for (const [envKey, value] of Object.entries(status.env)) {
			lines.push(`${envKey} = ${tomlString(value)}`);
		}
	}
	return lines.join("\n");
}

/**
 * A line declaring the servers table as an inline table (`mcp_servers = { ...
 * }`) or through a dotted key (`mcp_servers.juno = ...`) is not something this
 * writer can edit without risking the rest of the file: the table might not
 * even have its own `[key.juno]` header for a splice to find.
 */
function declaresServersInline(text: string, key: string): boolean {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const guard = new RegExp(`^[ \\t]*${escaped}(\\.[^\\s=]+)*[ \\t]*=`, "m");
	return guard.test(text);
}

/**
 * Replaces an existing `[<key>.juno]` section (and its `.env` sub-section, if
 * it immediately follows) in place, or appends a new one after a blank line.
 * Every other line, including comments and other servers, is carried over
 * exactly as it was.
 */
function spliceTomlJunoSection(text: string, key: string, status: McpServerStatus): string {
	const block = tomlJunoBlock(key, status);
	const sections = tomlSections(text);
	const junoIndex = sections.findIndex((section) => section.header === `${key}.juno`);

	if (junoIndex === -1) {
		if (text.trim().length === 0) return `${block}\n`;
		return `${text.replace(/\s+$/, "")}\n\n${block}\n`;
	}

	const spanStart = sections[junoIndex].start;
	let spanEnd = sections[junoIndex].end;
	const next = sections[junoIndex + 1];
	if (next && next.header === `${key}.juno.env`) {
		spanEnd = next.end;
	}
	return `${text.slice(0, spanStart)}${block}\n${text.slice(spanEnd)}`;
}

/* --------------------------------------------------------------- detection */

/**
 * What is on this machine, and where Juno stands with each client.
 *
 * `installed` and `hasConfigFile` used to be the same boolean, and the UI
 * printed "no configuration file yet" for a client that had simply never had
 * Juno added to it, which reads as "this is not on your machine". They are
 * two different facts now: `installed` comes from a client's own data folder
 * or install directory, `hasConfigFile` from whether the file Juno would
 * write is actually there. A client that has never had an MCP server added
 * has no file yet, and writing it is what makes the client pick Juno up on
 * its next launch.
 */
export function targetsIn(status: McpServerStatus, home: string, platform: Platform): AgentClientTarget[] {
	const wanted = entryOf(status);

	return CLIENTS.map((client) => {
		const candidates = client.configCandidates(home, platform);
		const path = candidates.find(existsSync) ?? candidates[0] ?? null;
		const installed = client.installMarkers(home, platform).some(existsSync);

		if (path === null) {
			return {
				id: client.id,
				name: client.name,
				path: null,
				installed,
				hasConfigFile: false,
				configured: false,
				upToDate: false,
				format: client.format,
				configKey: client.key,
				after: client.after,
			};
		}

		const hasConfigFile = existsSync(path);
		let configured = false;
		let upToDate = false;
		try {
			if (client.format === "toml") {
				const section = hasConfigFile ? readTomlJunoSection(readFileSync(path, "utf8"), client.key) : null;
				configured = section !== null;
				upToDate = section !== null && tomlJunoMatches(section, status);
			} else {
				const current = serversIn(parseJson(path), client.key)["juno"];
				configured = current !== undefined;
				upToDate = configured && sameEntry(current, wanted);
			}
		} catch {
			// A file that cannot be read or parsed tells us nothing about whether
			// Juno is in it. Install will report the same problem with a message
			// worth reading.
			configured = false;
		}

		return {
			id: client.id,
			name: client.name,
			path,
			installed,
			hasConfigFile,
			configured,
			upToDate,
			format: client.format,
			configKey: client.key,
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

function installJson(client: ClientSpec, path: string, status: McpServerStatus): InstallResult {
	const existed = existsSync(path);
	const config = parseJson(path);

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

function installToml(client: ClientSpec, path: string, status: McpServerStatus): InstallResult {
	const existed = existsSync(path);
	let text = "";
	if (existed) {
		try {
			text = readFileSync(path, "utf8");
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Could not read ${path}, so Juno will not rewrite it. ${detail}`);
		}
	}

	if (declaresServersInline(text, client.key)) {
		throw new Error(
			`${path} declares ${client.key} on a single line, which Juno cannot safely edit without ` +
				`risking the rest of the file. Open the file and add the entry by hand: copy the ` +
				`[${client.key}.juno] block from the agent connection panel in Juno's settings.`,
		);
	}

	let backupPath: string | null = null;
	if (existed) {
		backupPath = `${path}.juno-backup.toml`;
		copyFileSync(path, backupPath);
	} else {
		mkdirSync(dirname(path), { recursive: true });
	}

	writeFileSync(path, spliceTomlJunoSection(text, client.key, status), "utf8");

	return { name: client.name, path, backupPath, created: !existed, after: client.after };
}

/**
 * Writes the Juno entry into one client's configuration.
 *
 * Side-effectful, and on a file another program owns, so it is never called
 * without the person naming that client. See the rules at the top.
 */
export function installIn(clientId: string, status: McpServerStatus, home: string, platform: Platform): InstallResult {
	const client = CLIENTS.find((candidate) => candidate.id === clientId);
	if (!client) throw new Error(`Juno does not know how to configure ${clientId}.`);

	const candidates = client.configCandidates(home, platform);
	const path = candidates.find(existsSync) ?? candidates[0];
	if (path === undefined) throw new Error(`${client.name} is not available on this platform.`);

	if (!status.running) {
		throw new Error(
			"The Juno agent server is not listening, so there is nothing to point a client at yet.",
		);
	}

	return client.format === "toml" ? installToml(client, path, status) : installJson(client, path, status);
}

/**
 * Whether two configuration entries say the same thing.
 *
 * Deep and order-insensitive, because key order is not a difference. An editor
 * that reformats the file, or another tool that rewrites it, can sort the keys
 * without changing a word of what it means, and a string comparison would then
 * report Juno as configured to point somewhere else. That wording sends a
 * person looking for a problem that is not there.
 */
export function sameEntry(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null || typeof a !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((value, index) => sameEntry(value, b[index]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && sameEntry(left[key], right[key]));
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
