/**
 * The bridge Claude Desktop runs to reach Juno's agent server.
 *
 * Claude Desktop starts local servers as a program speaking MCP on stdio, and
 * a connector added by URL is reached by Anthropic's servers, which cannot see
 * this machine. So this file is packed into an extension (`Juno.mcpb`) and
 * Claude Desktop runs it with its own Node: it reads a message per line on
 * stdin, posts it to `http://127.0.0.1:<port>/mcp` with the access token, and
 * writes the reply to stdout. Decision 42 named this as the answer for a
 * client that cannot be given a URL.
 *
 * It holds no logic and no state beyond the protocol version, because the
 * server is stateless and answers in plain JSON. It runs from Claude's
 * extension folder, never from Juno's install, so an update can always replace
 * Juno's files while Claude is open (the problem decision 28 had to work
 * around when the bridge was Juno's own executable).
 *
 * Node built-ins only, and nothing imported from the rest of Juno: this file is
 * the whole program once it is inside the bundle.
 */
import { createInterface } from "node:readline";

export type BridgeOptions = {
	url: string;
	token: string;
};

type JsonRpcMessage = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	result?: { protocolVersion?: unknown };
};

type Fetch = typeof fetch;

/** Only this machine. The token must never be sent anywhere else. */
export function checkUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		throw new Error(`"${raw}" is not an address. Use the one Juno shows under Settings > MCP.`);
	}
	const loopback = ["127.0.0.1", "localhost", "[::1]"];
	if (parsed.protocol !== "http:" || !loopback.includes(parsed.hostname)) {
		throw new Error(
			`Juno's agent server is on this machine, so the address starts with http://127.0.0.1. "${raw}" does not.`,
		);
	}
	return parsed.toString();
}

function failure(id: JsonRpcMessage["id"], message: string): JsonRpcMessage & { error: { code: number; message: string } } {
	return { jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } };
}

/** Replies from a text/event-stream body. The server answers in JSON, but the spec allows either. */
function parseEventStream(text: string): unknown[] {
	const out: unknown[] = [];
	for (const block of text.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (data.length > 0) out.push(JSON.parse(data));
	}
	return out;
}

/**
 * Sends one message and gives back what goes to stdout: the replies, or a
 * JSON-RPC error a person can act on. A notification gets nothing back, even
 * when it fails, because nobody is waiting for it.
 */
export async function forward(
	message: JsonRpcMessage,
	options: BridgeOptions,
	state: { protocolVersion: string | null },
	fetchImpl: Fetch = fetch,
): Promise<unknown[]> {
	const expectsReply = message.id !== undefined && message.method !== undefined;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${options.token}`,
	};
	if (state.protocolVersion) headers["MCP-Protocol-Version"] = state.protocolVersion;

	let response: Response;
	try {
		response = await fetchImpl(options.url, { method: "POST", headers, body: JSON.stringify(message) });
	} catch {
		return expectsReply
			? [failure(message.id, "Juno is not running, or its agent server is switched off. Open Juno and try again.")]
			: [];
	}

	if (response.status === 401) {
		return expectsReply
			? [
					failure(
						message.id,
						"Juno did not accept the access token. Connect Claude Desktop again under Settings > MCP in Juno, or paste a new token into the Juno extension's settings in Claude.",
					),
				]
			: [];
	}
	if (response.status === 202 || response.status === 204) return [];

	const text = await response.text();
	let replies: unknown[];
	try {
		if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
			replies = parseEventStream(text);
		} else {
			const parsed: unknown = text.length > 0 ? JSON.parse(text) : [];
			replies = Array.isArray(parsed) ? parsed : [parsed];
		}
	} catch {
		replies = [];
	}

	const rpc = replies.filter((reply) => typeof reply === "object" && reply !== null && "jsonrpc" in reply);
	if (rpc.length === 0) {
		return expectsReply
			? [failure(message.id, `Juno's agent server answered with HTTP ${response.status}. Check Settings > MCP in Juno.`)]
			: [];
	}

	// Every later request carries the version the two sides agreed on.
	if (message.method === "initialize") {
		const version = (rpc[0] as JsonRpcMessage).result?.protocolVersion;
		if (typeof version === "string") state.protocolVersion = version;
	}
	return rpc;
}

/** Reads stdin until it closes. Nothing but protocol goes to stdout. */
export function run(options: BridgeOptions): void {
	const state = { protocolVersion: null as string | null };
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
	const write = (reply: unknown) => process.stdout.write(`${JSON.stringify(reply)}\n`);
	const inFlight = new Set<Promise<void>>();

	lines.on("line", (line) => {
		if (line.trim().length === 0) return;
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(line) as JsonRpcMessage;
		} catch {
			write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
			return;
		}
		const pending = forward(message, options, state).then((replies) => replies.forEach(write));
		inFlight.add(pending);
		void pending.finally(() => inFlight.delete(pending));
	});
	// A reply still on its way is written before the process ends.
	lines.on("close", () => {
		void Promise.allSettled([...inFlight]).then(() => process.exit(0));
	});
}

function main(): void {
	const token = (process.env.JUNO_TOKEN ?? "").trim();
	let url: string;
	try {
		url = checkUrl(process.env.JUNO_URL ?? "http://127.0.0.1:5866/mcp");
	} catch (cause: unknown) {
		process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
		process.exit(1);
	}
	if (token.length === 0) {
		process.stderr.write("No access token. Paste the one Juno showed into the extension's settings in Claude.\n");
		process.exit(1);
	}
	run({ url, token });
}

// Started by Claude Desktop, not when a test imports this file.
if (typeof module !== "undefined" && typeof require !== "undefined" && require.main === module) main();
