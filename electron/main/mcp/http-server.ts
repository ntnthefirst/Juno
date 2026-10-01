/**
 * Where an agent reaches Juno: an MCP server on this machine's loopback address.
 *
 * The database is open in this process and only this process, so the server
 * lives here and an agent client connects to it by URL, the way it would to any
 * remote MCP server. Nothing is installed in the client and nothing is spawned
 * from Juno's folder, which is also why an update can replace the program while
 * an agent stays connected.
 *
 * A port is reachable by every program on the machine and by any web page in
 * the browser, so this file is mostly about who is allowed to use it:
 *
 * - It binds to 127.0.0.1 and nothing else.
 * - A request whose Host is not a loopback name on this port is refused, which
 *   is what stops a web page from reaching it through a DNS name it controls.
 * - A request that carries an Origin is refused unless the origin is this
 *   server. Programs do not send one; a web page always does.
 * - `/mcp` answers only to a token. A client without one is told how to get
 *   one, and the answer is the handshake in services/agent-connections.ts.
 *
 * The protocol itself is the SDK's. Each request is handled by a fresh server
 * and transport, with no session kept, which is the SDK's own pattern for a
 * server whose tools hold no per-client state.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as connections from "../services/agent-connections";
import { OAuthError } from "../services/agent-connections";
import { renderMessagePage, renderPairingPage } from "./http-pages";
import type { ToolListing } from "./host";

export interface HttpServerDeps {
	listTools: () => ToolListing[];
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
	isLocked: () => boolean;
	/** Reported to the client as the server's own version. */
	version: string;
}

export interface HttpServerStatus {
	running: boolean;
	/** The port actually bound. Zero until it is. */
	port: number;
	error: string | null;
}

const MAX_BODY_BYTES = 1_000_000;
const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"];

let server: HttpServer | null = null;
let boundPort = 0;
let startError: string | null = null;
let deps: HttpServerDeps | null = null;

export function httpServerStatus(): HttpServerStatus {
	return { running: server !== null, port: boundPort, error: startError };
}

/**
 * Starts listening. Never throws: Juno without an agent surface is still Juno,
 * and the reason it is not listening is something to show on the settings
 * screen rather than a window that refuses to open.
 */
export async function startHttpServer(port: number, nextDeps: HttpServerDeps): Promise<HttpServerStatus> {
	if (server) return httpServerStatus();
	startError = null;
	deps = nextDeps;

	const next = createServer((request, response) => {
		void handle(request, response).catch(() => {
			if (!response.headersSent) sendJson(response, 500, { error: "server_error" });
			else response.end();
		});
	});
	next.maxConnections = 100;

	try {
		await new Promise<void>((resolve, reject) => {
			next.once("error", reject);
			next.listen(port, "127.0.0.1", () => {
				next.off("error", reject);
				resolve();
			});
		});
	} catch (cause: unknown) {
		startError = explain(cause, port);
		return httpServerStatus();
	}

	// A socket that errors after the start must not take the process down.
	next.on("error", () => undefined);
	server = next;
	boundPort = (next.address() as AddressInfo).port;
	return httpServerStatus();
}

export async function stopHttpServer(): Promise<void> {
	const current = server;
	server = null;
	boundPort = 0;
	if (!current) return;
	current.closeAllConnections();
	await new Promise<void>((resolve) => current.close(() => resolve()));
}

function explain(cause: unknown, port: number): string {
	const code = isErrnoError(cause) ? cause.code : undefined;
	if (code === "EADDRINUSE") {
		return `Port ${port} is already used by another program. Pick a different port in Settings > MCP.`;
	}
	if (code === "EACCES") {
		return `The system does not let Juno listen on port ${port}. Pick a different port in Settings > MCP.`;
	}
	return `Could not start the agent server on port ${port}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

function isErrnoError(value: unknown): value is NodeJS.ErrnoException {
	return value instanceof Error && "code" in value;
}

/* ----------------------------------------------------------------- helpers */

const COMMON_HEADERS = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
};

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	response.writeHead(status, { ...COMMON_HEADERS, "Content-Type": "application/json; charset=utf-8", ...headers });
	response.end(JSON.stringify(body));
}

function sendOAuthError(response: ServerResponse, error: OAuthError): void {
	sendJson(response, error.status, { error: error.code, error_description: error.message });
}

/** A page for a person. It may not be framed, and may run only the one script it carries. */
function sendPage(response: ServerResponse, status: number, html: string, nonce: string | null): void {
	const script = nonce ? `'nonce-${nonce}'` : "'none'";
	response.writeHead(status, {
		...COMMON_HEADERS,
		"Content-Type": "text/html; charset=utf-8",
		"X-Frame-Options": "DENY",
		"Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src ${script}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
	});
	response.end(html);
}

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const piece = chunk as Buffer;
		size += piece.length;
		if (size > MAX_BODY_BYTES) throw new OAuthError("invalid_request", "That request is too large.", 413);
		chunks.push(piece);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Form or JSON, because token requests are the first and registrations the second. */
function parseParams(contentType: string, body: string): Record<string, unknown> {
	if (contentType.includes("application/json")) {
		try {
			const parsed: unknown = JSON.parse(body);
			return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			throw new OAuthError("invalid_request", "That was not valid JSON.");
		}
	}
	return Object.fromEntries(new URLSearchParams(body));
}

function baseOf(request: IncomingMessage): string {
	return `http://${request.headers.host ?? `127.0.0.1:${boundPort}`}`;
}

/* ----------------------------------------------------------------- routing */

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
	if (!deps) {
		sendJson(response, 503, { error: "unavailable" });
		return;
	}

	// DNS rebinding: a page on evil.example can make that name point at 127.0.0.1,
	// and the browser then sends this server a request for evil.example.
	const host = (request.headers.host ?? "").toLowerCase();
	if (!LOOPBACK_NAMES.some((name) => host === `${name}:${boundPort}`)) {
		sendJson(response, 421, { error: "wrong_host", error_description: "Use the address Juno shows in its settings." });
		return;
	}
	const origin = request.headers.origin;
	if (origin !== undefined && origin !== `http://${host}`) {
		sendJson(response, 403, { error: "forbidden_origin", error_description: "A web page may not use this server." });
		return;
	}

	const url = new URL(request.url ?? "/", `http://${host}`);
	const path = url.pathname;
	const method = request.method ?? "GET";

	if (path === "/mcp") return handleMcp(request, response, method);

	if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
		const base = baseOf(request);
		sendJson(response, 200, {
			resource: `${base}/mcp`,
			authorization_servers: [base],
			bearer_methods_supported: ["header"],
		});
		return;
	}
	if (
		path === "/.well-known/oauth-authorization-server" ||
		path === "/.well-known/openid-configuration"
	) {
		const base = baseOf(request);
		sendJson(response, 200, {
			issuer: base,
			authorization_endpoint: `${base}/authorize`,
			token_endpoint: `${base}/token`,
			registration_endpoint: `${base}/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
		});
		return;
	}

	try {
		if (path === "/register" && method === "POST") return await handleRegister(request, response);
		if (path === "/authorize" && method === "GET") return handleAuthorize(url, response);
		if (path === "/authorize/status" && method === "GET") return handleStatus(url, response);
		if (path === "/token" && method === "POST") return await handleToken(request, response);
	} catch (cause: unknown) {
		if (cause instanceof OAuthError) {
			sendOAuthError(response, cause);
			return;
		}
		throw cause;
	}

	if (path === "/" && method === "GET") {
		response.writeHead(200, { ...COMMON_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
		response.end("Juno agent server. Point an MCP client at /mcp.\n");
		return;
	}
	sendJson(response, 404, { error: "not_found" });
}

/* ------------------------------------------------------------------- /mcp */

function bearerOf(request: IncomingMessage): string | null {
	const header = request.headers.authorization;
	if (typeof header !== "string") return null;
	const match = /^Bearer\s+(\S+)$/i.exec(header);
	return match ? match[1] : null;
}

async function handleMcp(request: IncomingMessage, response: ServerResponse, method: string): Promise<void> {
	if (!deps) return;

	const token = bearerOf(request);
	if (!connections.verifyToken(token)) {
		const metadata = `${baseOf(request)}/.well-known/oauth-protected-resource/mcp`;
		sendJson(
			response,
			401,
			{ error: "unauthorized", error_description: "Connect this client to Juno first." },
			{ "WWW-Authenticate": `Bearer realm="Juno", resource_metadata="${metadata}"` },
		);
		return;
	}

	// The stateless transport has no stream to offer a GET, and no session to end.
	if (method !== "POST") {
		sendJson(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
		return;
	}
	if (!(request.headers["content-type"] ?? "").includes("application/json")) {
		sendJson(response, 415, { error: "unsupported_media_type", error_description: "Send application/json." });
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(await readBody(request));
	} catch (cause: unknown) {
		const tooLarge = cause instanceof OAuthError && cause.status === 413;
		sendJson(response, tooLarge ? 413 : 400, {
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: tooLarge ? "That request is too large." : "That was not valid JSON." },
		});
		return;
	}

	const mcp = buildMcpServer(deps);
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
	response.on("close", () => {
		void transport.close();
		void mcp.close();
	});
	await mcp.connect(transport);
	await transport.handleRequest(request, response, parsed);
}

/** MCP wants structured content to be an object, and a list is not one. */
function wrap(result: unknown): Record<string, unknown> {
	if (result === null || result === undefined) return { result: null };
	if (Array.isArray(result)) return { items: result };
	if (typeof result === "object") return result as Record<string, unknown>;
	return { result };
}

function buildMcpServer(current: HttpServerDeps): Server {
	const mcp = new Server({ name: "juno", version: current.version }, { capabilities: { tools: {} } });

	mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: current.listTools().map((tool) => ({
			name: tool.name,
			title: tool.title,
			description: tool.description,
			inputSchema: tool.inputSchema as { type: "object"; properties?: Record<string, unknown> },
			annotations: {
				title: tool.title,
				readOnlyHint: tool.readOnly,
				destructiveHint: !tool.readOnly,
			},
		})),
	}));

	mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
		try {
			const result = await current.callTool(call.params.name, call.params.arguments ?? {});
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result ?? null, null, "\t") }],
				structuredContent: wrap(result),
			};
		} catch (cause: unknown) {
			return {
				isError: true,
				content: [{ type: "text" as const, text: cause instanceof Error ? cause.message : String(cause) }],
			};
		}
	});

	return mcp;
}

/* ------------------------------------------------------------------ OAuth */

async function handleRegister(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const params = parseParams(request.headers["content-type"] ?? "", await readBody(request));
	const registered = connections.registerClient({
		clientName: params.client_name,
		redirectUris: params.redirect_uris,
	});
	sendJson(response, 201, {
		client_id: registered.clientId,
		client_name: registered.clientName,
		redirect_uris: registered.redirectUris,
		grant_types: ["authorization_code"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
		client_id_issued_at: Math.floor(Date.now() / 1000),
	});
}

function handleAuthorize(url: URL, response: ServerResponse): void {
	const nonce = randomBytes(16).toString("base64");

	if (deps?.isLocked()) {
		sendPage(response, 503, renderMessagePage("Juno is locked", "Unlock Juno on this computer, then connect again."), null);
		return;
	}
	if (url.searchParams.get("response_type") !== "code") {
		sendPage(response, 400, renderMessagePage("Cannot connect", "This request is not one Juno understands."), null);
		return;
	}

	try {
		const started = connections.beginPairing({
			clientId: url.searchParams.get("client_id"),
			redirectUri: url.searchParams.get("redirect_uri"),
			codeChallenge: url.searchParams.get("code_challenge"),
			codeChallengeMethod: url.searchParams.get("code_challenge_method"),
			state: url.searchParams.get("state"),
		});
		sendPage(
			response,
			200,
			renderPairingPage({ clientName: started.clientName, code: started.code, pairingId: started.pairingId, nonce }),
			nonce,
		);
	} catch (cause: unknown) {
		if (!(cause instanceof OAuthError)) throw cause;
		sendPage(response, cause.status === 503 ? 503 : 400, renderMessagePage("Cannot connect", cause.message), null);
	}
}

function handleStatus(url: URL, response: ServerResponse): void {
	sendJson(response, 200, connections.pairingStatus(url.searchParams.get("id")));
}

async function handleToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const params = parseParams(request.headers["content-type"] ?? "", await readBody(request));
	if (params.grant_type !== "authorization_code") {
		throw new OAuthError("unsupported_grant_type", "Only the authorization code grant is supported.");
	}
	const exchanged = connections.exchangeCode({
		code: params.code,
		clientId: params.client_id,
		redirectUri: params.redirect_uri,
		codeVerifier: params.code_verifier,
	});
	sendJson(response, 200, { access_token: exchanged.accessToken, token_type: "Bearer" }, { Pragma: "no-cache" });
}
