/**
 * Where an agent reaches Bureau.
 *
 * The database is open in this process and only this process: two processes on
 * one SQLite file is corruption waiting, which is why the app takes a single
 * instance lock. So an MCP client cannot be handed the services directly. It
 * spawns the bridge in scripts/mcp-bridge.mjs, which speaks MCP over stdio and
 * forwards every call here, over a named pipe on Windows or a socket file
 * elsewhere.
 *
 * The wire is newline-delimited JSON, one object per line, because the whole
 * transport is a local pipe between two processes that ship together. Nothing
 * listens on a network port: decision 5 says local-first, and an open port on
 * a laptop in a café is a different product.
 *
 * **What the token buys, and what it does not.** `mcp.json` holds the address
 * and a random token, and a connection that does not present it is dropped.
 * That stops something that guessed the pipe name. It does not stop a program
 * already running as this user, which can read the file: on a single-user
 * desktop that program could read `bureau.sqlite` anyway. The lock is the
 * control that matters here, and it is checked on every call.
 */
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { callTool, listTools, ToolError } from "./host";

export interface SocketConfig {
	/** Where mcp.json and the tool cache are written. */
	userDataDir: string;
	/** Tells a dev run's pipe from the installed app's. */
	instanceKey: string;
}

interface Request {
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
}

const MAX_LINE_BYTES = 1_000_000;

let server: Server | null = null;
let address = "";
let token = "";
let startError: string | null = null;
const live = new Set<Socket>();

export function addressFor(config: SocketConfig): string {
	if (process.platform === "win32") {
		const key = createHash("sha256").update(config.instanceKey).digest("hex").slice(0, 12);
		return `\\\\.\\pipe\\bureau-mcp-${key}`;
	}
	return join(config.userDataDir, "mcp.sock");
}

export function connectionFile(config: SocketConfig): string {
	return join(config.userDataDir, "mcp.json");
}

export function toolCacheFile(config: SocketConfig): string {
	return join(config.userDataDir, "mcp-tools.json");
}

export function status(): { running: boolean; address: string; connections: number; error: string | null } {
	return { running: server !== null, address, connections: live.size, error: startError };
}

/**
 * Starts listening, and writes the file the bridge reads.
 *
 * A failure here is reported and does not stop the app: Bureau without an
 * agent surface is still Bureau, and a window that refuses to open because a
 * pipe was busy would be the worse failure.
 */
export function startSocketServer(config: SocketConfig): void {
	if (server) return;
	startError = null;
	address = addressFor(config);
	token = randomBytes(32).toString("hex");

	// A stale socket file from a crash would refuse the bind. A named pipe on
	// Windows disappears with its process, so there is nothing to clean there.
	if (process.platform !== "win32" && existsSync(address)) {
		try {
			rmSync(address);
		} catch {
			// The bind below reports it in a way worth reading.
		}
	}

	const next = createServer((socket) => attach(socket));
	next.on("error", (error: Error) => {
		startError = error.message;
		server = null;
	});

	try {
		next.listen(address, () => {
			server = next;
			writeConnectionFile(config);
			writeToolCache(config);
		});
		server = next;
	} catch (cause: unknown) {
		startError = cause instanceof Error ? cause.message : String(cause);
		server = null;
	}
}

export function stopSocketServer(config?: SocketConfig): void {
	for (const socket of live) socket.destroy();
	live.clear();
	server?.close();
	server = null;
	if (config) {
		for (const file of [connectionFile(config)]) {
			try {
				if (existsSync(file)) rmSync(file);
			} catch {
				// A left-behind file says "not running" to the bridge anyway, since
				// connecting to the address will fail.
			}
		}
	}
}

function writeConnectionFile(config: SocketConfig): void {
	const file = connectionFile(config);
	writeFileSync(file, `${JSON.stringify({ version: 1, address, token }, null, "\t")}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	try {
		// Re-applied because an existing file keeps its old mode.
		chmodSync(file, 0o600);
	} catch {
		// Windows does not honour the bits; the directory is already per-user.
	}
}

/**
 * The tool list, on disk.
 *
 * An MCP client asks for the tools once, at startup, and caches them. If
 * Bureau happens to be closed at that moment the agent would see no tools for
 * the rest of its session, so the bridge falls back to this file and reports a
 * clear error only when something is actually called.
 */
function writeToolCache(config: SocketConfig): void {
	try {
		writeFileSync(toolCacheFile(config), `${JSON.stringify(listTools())}\n`, "utf8");
	} catch {
		// The bridge copes with the file being missing.
	}
}

function attach(socket: Socket): void {
	live.add(socket);
	socket.setEncoding("utf8");

	let buffer = "";
	let greeted = false;

	socket.on("data", (chunk: string) => {
		buffer += chunk;
		if (buffer.length > MAX_LINE_BYTES) {
			send(socket, { id: null, error: { code: "TOO_LARGE", message: "That request is too large." } });
			socket.destroy();
			return;
		}
		let index = buffer.indexOf("\n");
		while (index !== -1) {
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			if (line.trim()) void handle(socket, line, () => greeted, () => (greeted = true));
			index = buffer.indexOf("\n");
		}
	});

	socket.on("error", () => socket.destroy());
	socket.on("close", () => live.delete(socket));
}

function send(socket: Socket, payload: unknown): void {
	if (socket.destroyed) return;
	socket.write(`${JSON.stringify(payload)}\n`);
}

async function handle(
	socket: Socket,
	line: string,
	isGreeted: () => boolean,
	markGreeted: () => void,
): Promise<void> {
	let request: Request;
	try {
		request = JSON.parse(line) as Request;
	} catch {
		send(socket, { id: null, error: { code: "BAD_REQUEST", message: "That was not JSON." } });
		return;
	}

	const id = request.id ?? null;
	const params = request.params ?? {};

	if (request.method === "hello") {
		if (typeof params.token !== "string" || !constantTimeEqual(params.token, token)) {
			send(socket, { id, error: { code: "UNAUTHORISED", message: "Wrong token. Restart the agent so it reads the current one." } });
			socket.destroy();
			return;
		}
		markGreeted();
		send(socket, { id, result: { ok: true, tools: listTools().length } });
		return;
	}

	if (!isGreeted()) {
		send(socket, { id, error: { code: "UNAUTHORISED", message: "Say hello with the token first." } });
		socket.destroy();
		return;
	}

	try {
		if (request.method === "list_tools") {
			send(socket, { id, result: listTools() });
			return;
		}
		if (request.method === "call_tool") {
			const name = typeof params.name === "string" ? params.name : "";
			const args =
				params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
					? (params.arguments as Record<string, unknown>)
					: {};
			const result = await callTool(name, args, { source: "mcp" });
			send(socket, { id, result });
			return;
		}
		send(socket, { id, error: { code: "BAD_REQUEST", message: `Unknown method "${request.method}".` } });
	} catch (cause: unknown) {
		const code = cause instanceof ToolError ? cause.code : "TOOL_FAILED";
		const message = cause instanceof Error ? cause.message : String(cause);
		send(socket, { id, error: { code, message } });
	}
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let different = 0;
	for (let index = 0; index < a.length; index++) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
	return different === 0;
}
