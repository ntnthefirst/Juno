/**
 * The MCP server an agent spawns, and the only thing that talks to Bureau
 * from outside it.
 *
 * It holds no logic and no database handle. It speaks MCP over stdio, forwards
 * every call to the running app over a local pipe, and passes the answer back.
 * The app is where the tools, the lock and the confirmation gate live, so an
 * agent gets exactly the surface the window has and not a second one.
 *
 * Run it with Node, or with the packaged app's own binary:
 *
 *   node scripts/mcp-bridge.mjs
 *   ELECTRON_RUN_AS_NODE=1 "C:\\Program Files\\Bureau\\Bureau.exe" resources/app.asar/scripts/mcp-bridge.mjs
 *
 * Settings > Agent prints the exact block for this machine.
 *
 * Nothing is written to stdout but protocol traffic. A stray console.log here
 * corrupts the stream and the client disconnects with an unhelpful error, so
 * everything diagnostic goes to stderr.
 */
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT_MS = 4000;
const CALL_TIMEOUT_MS = 120_000;

/** Where Electron puts userData, for the case where nothing told us. */
function defaultUserDataDir() {
	const product = "Bureau";
	if (process.platform === "win32") {
		return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), product);
	}
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support", product);
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), product);
}

function userDataDir() {
	const flagIndex = process.argv.indexOf("--user-data-dir");
	if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
	return process.env.BUREAU_USER_DATA ?? defaultUserDataDir();
}

const dir = userDataDir();

function readConnection() {
	const raw = readFileSync(join(dir, "mcp.json"), "utf8");
	const parsed = JSON.parse(raw);
	if (!parsed?.address || !parsed?.token) throw new Error("mcp.json is missing the address or the token.");
	return parsed;
}

function cachedTools() {
	try {
		return JSON.parse(readFileSync(join(dir, "mcp-tools.json"), "utf8"));
	} catch {
		return [];
	}
}

const NOT_RUNNING =
	"Bureau is not running, so nothing can be read or changed. Start Bureau on this machine and try again.";

/**
 * One request, one connection.
 *
 * A long-lived socket would have to survive the app restarting, the machine
 * sleeping and the pipe going away, and an agent makes a handful of calls a
 * minute at most. Connecting per call costs a millisecond and removes every
 * one of those states.
 */
function ask(method, params) {
	return new Promise((resolve, reject) => {
		let connection;
		try {
			connection = readConnection();
		} catch {
			reject(new Error(NOT_RUNNING));
			return;
		}

		const socket = connect(connection.address);
		let buffer = "";
		let settled = false;

		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error);
			else resolve(value);
		};

		const timer = setTimeout(
			() => finish(new Error("Bureau did not answer in time.")),
			method === "hello" ? CONNECT_TIMEOUT_MS : CALL_TIMEOUT_MS,
		);

		socket.setEncoding("utf8");
		socket.on("error", () => finish(new Error(NOT_RUNNING)));
		socket.on("close", () => finish(new Error(NOT_RUNNING)));

		socket.on("connect", () => {
			socket.write(`${JSON.stringify({ id: 1, method: "hello", params: { token: connection.token } })}\n`);
			socket.write(`${JSON.stringify({ id: 2, method, params })}\n`);
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let index = buffer.indexOf("\n");
			while (index !== -1) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
				if (!line.trim()) continue;
				let message;
				try {
					message = JSON.parse(line);
				} catch {
					finish(new Error("Bureau sent something unreadable."));
					return;
				}
				if (message.id === 1) {
					if (message.error) finish(new Error(message.error.message));
					continue;
				}
				if (message.id === 2) {
					if (message.error) finish(new Error(message.error.message));
					else finish(null, message.result);
					return;
				}
			}
		});
	});
}

const server = new Server(
	{ name: "bureau", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	let tools;
	try {
		tools = await ask("list_tools", {});
	} catch (cause) {
		// Bureau is closed right now. Offer the tools it had last time rather
		// than an empty surface the client will cache for its whole session.
		process.stderr.write(`bureau: ${cause.message} Using the tool list from the last run.\n`);
		tools = cachedTools();
	}
	return {
		tools: tools.map((tool) => ({
			name: tool.name,
			title: tool.title,
			description: tool.description,
			inputSchema: tool.inputSchema,
			annotations: {
				title: tool.title,
				readOnlyHint: tool.readOnly === true,
				destructiveHint: tool.readOnly !== true,
			},
		})),
	};
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	try {
		const result = await ask("call_tool", {
			name: request.params.name,
			arguments: request.params.arguments ?? {},
		});
		return {
			content: [{ type: "text", text: JSON.stringify(result ?? null, null, "\t") }],
			structuredContent: wrap(result),
		};
	} catch (cause) {
		return {
			isError: true,
			content: [{ type: "text", text: cause.message }],
		};
	}
});

/** MCP wants structured content to be an object, and a list is not one. */
function wrap(result) {
	if (result === null || result === undefined) return { result: null };
	if (Array.isArray(result)) return { items: result };
	if (typeof result === "object") return result;
	return { result };
}

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`bureau: ready, reading ${dir}\n`);
