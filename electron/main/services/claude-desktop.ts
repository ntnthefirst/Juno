import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import type { ClaudeDesktopSetup } from "../../shared/types";
import * as connections from "./agent-connections";
import type { ServerInfo } from "./agent-install";

/**
 * Connecting Claude Desktop, which cannot be given an address.
 *
 * Its chats reach local servers only as a program it starts itself, and the
 * connectors it takes by URL are opened from Anthropic's servers, which cannot
 * see 127.0.0.1 on this machine. So Juno packs a Claude Desktop extension
 * (`.mcpb`): a manifest and the bridge in `electron/bridge/claude-desktop.ts`,
 * which Claude runs with its own Node and which forwards every message to the
 * agent server here.
 *
 * Nothing is written into Claude's files. Opening the bundle hands it to Claude,
 * which shows its own install dialog and asks for the access token there, and
 * keeps it in the system keychain. The token is made here, for this one client,
 * and shown once, like any token made by hand (decision 42).
 */

/** The file a person double-clicks, or Juno opens for them. */
export const BUNDLE_NAME = "Juno.mcpb";

export type ExtensionParts = {
	url: string;
	version: string;
	/** The compiled bridge, which becomes the extension's entry point. */
	bridgeSource: string;
	/** The app icon, shown in Claude's extension list. Left out when missing. */
	icon: Buffer | null;
};

/** What Claude reads to install and start the extension. */
export function manifestOf(parts: Pick<ExtensionParts, "url" | "version" | "icon">): Record<string, unknown> {
	return {
		manifest_version: "0.2",
		name: "juno",
		display_name: "Juno",
		// Claude wants a semantic version, and a development build reports one too.
		version: /^\d+\.\d+\.\d+/.test(parts.version) ? parts.version : "0.0.0",
		description: "Clients, documents, mail, calendar and reminders from Juno on this computer.",
		long_description:
			"Connects Claude to the Juno app running on this computer. Juno has to be open for the tools to answer. Anything that sends, signs, deletes or files waits for approval in Juno.",
		author: { name: "Juno" },
		...(parts.icon ? { icon: "icon.png" } : {}),
		server: {
			type: "node",
			entry_point: "server/index.js",
			mcp_config: {
				command: "node",
				args: ["${__dirname}/server/index.js"],
				env: {
					JUNO_URL: "${user_config.url}",
					JUNO_TOKEN: "${user_config.token}",
				},
			},
		},
		user_config: {
			token: {
				type: "string",
				title: "Access token",
				description: "The token Juno showed when you connected Claude Desktop under Settings > MCP.",
				sensitive: true,
				required: true,
			},
			url: {
				type: "string",
				title: "Juno address",
				description: "Where Juno's agent server listens. Change it only if you changed the port in Juno.",
				default: parts.url,
				required: true,
			},
		},
		tools_generated: true,
		compatibility: { platforms: ["win32", "darwin", "linux"], runtimes: { node: ">=18.0.0" } },
	};
}

/**
 * A zip with the files stored, not deflated. The bundle is a few kilobytes, so
 * compression buys nothing, and a stored zip is short enough to write here
 * instead of adding a dependency for it.
 */
export function zipStored(files: { name: string; data: Buffer }[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const file of files) {
		const name = Buffer.from(file.name, "utf8");
		const crc = crc32(file.data);
		const size = file.data.length;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // names are UTF-8
		local.writeUInt16LE(0, 8); // stored
		local.writeUInt32LE(0, 10); // time and date, left at zero
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(size, 18);
		local.writeUInt32LE(size, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, file.data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4); // made by
		central.writeUInt16LE(20, 6); // version needed
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(0, 12);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(size, 20);
		central.writeUInt32LE(size, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + size;
	}

	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

/** The bundle's bytes. No token is in it: Claude asks for that when it installs. */
export function buildExtension(parts: ExtensionParts): Buffer {
	// The compiled file points at a source map that is not in the bundle.
	const bridge = parts.bridgeSource.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
	const files: { name: string; data: Buffer }[] = [
		{ name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifestOf(parts), null, 2)}\n`, "utf8") },
		{ name: "server/index.js", data: Buffer.from(bridge, "utf8") },
	];
	if (parts.icon) files.push({ name: "icon.png", data: parts.icon });
	return zipStored(files);
}

/* ------------------------------------------------------------------ wiring */

type Deps = {
	status: () => Promise<ServerInfo>;
	version: string;
	/** The compiled bridge, next to the compiled main process. */
	bridgePath: string;
	iconPath: string | null;
	/** Where the bundle is written. Under userData. */
	outDir: string;
	/** Hands the bundle to whatever opens .mcpb files, which is Claude Desktop. */
	open: (path: string) => Promise<string>;
};

let deps: Deps | null = null;

export function configureClaudeDesktop(next: Deps): void {
	deps = next;
}

function required(): Deps {
	if (!deps) throw new Error("configureClaudeDesktop has not been called.");
	return deps;
}

/**
 * Makes a token for Claude Desktop, writes the extension and opens it.
 *
 * A person's action, over IPC only: it lets a client in, which no tool may do
 * (.claude/rules/security.md section 9). The token comes back once, for the
 * person to paste into the dialog Claude shows.
 */
export async function connect(): Promise<ClaudeDesktopSetup> {
	const current = required();
	const status = await current.status();
	if (!status.running) {
		throw new Error(
			status.enabled
				? "The Juno agent server could not start, so Claude Desktop has nothing to reach yet. Settings > MCP says why."
				: "The Juno agent server is switched off. Turn it on in Settings > MCP, then connect Claude Desktop.",
		);
	}
	if (!existsSync(current.bridgePath)) {
		throw new Error(`The Claude Desktop bridge is missing from this build at ${current.bridgePath}. Reinstall Juno.`);
	}

	const bundle = buildExtension({
		url: status.url,
		version: current.version,
		bridgeSource: readFileSync(current.bridgePath, "utf8"),
		icon: current.iconPath && existsSync(current.iconPath) ? readFileSync(current.iconPath) : null,
	});
	mkdirSync(current.outDir, { recursive: true });
	const path = join(current.outDir, BUNDLE_NAME);
	writeFileSync(path, bundle);

	const made = connections.createToken("Claude Desktop");
	const openError = await current.open(path);
	return { token: made.token, connection: made.connection, path, opened: openError.length === 0, url: status.url };
}
