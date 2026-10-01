import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as connections from "../services/agent-connections";
import { httpServerStatus, startHttpServer, stopHttpServer, type HttpServerDeps } from "./http-server";

const REDIRECT = "http://127.0.0.1:53682/callback";

let dir: string;
let base: string;
let locked = false;
let calls: { name: string; args: Record<string, unknown> }[];

const deps: HttpServerDeps = {
	version: "9.9.9",
	isLocked: () => locked,
	listTools: () => [
		{
			name: "demo.echo",
			title: "Echo",
			description: "Gives back what it was given.",
			inputSchema: { type: "object", properties: { text: { type: "string" } } },
			readOnly: true,
			requiresConfirmation: false,
		},
	],
	callTool: async (name, args) => {
		calls.push({ name, args });
		if (name === "demo.fail") throw new Error("It failed on purpose.");
		return { echoed: args.text ?? null };
	},
};

beforeAll(async () => {
	const status = await startHttpServer(0, deps);
	expect(status.running).toBe(true);
	base = `http://127.0.0.1:${status.port}`;
});

afterAll(async () => {
	await stopHttpServer();
});

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "juno-http-"));
	connections.configureAgentConnections(dir);
	locked = false;
	calls = [];
});

afterEach(() => {
	connections.configureAgentConnections(null);
	rmSync(dir, { recursive: true, force: true });
});

function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** A request with a Host or Origin of our choosing, which fetch will not send. */
function raw(path: string, headers: Record<string, string>, method = "GET"): Promise<{ status: number; body: string }> {
	const port = httpServerStatus().port;
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
			let body = "";
			res.on("data", (chunk: Buffer) => (body += chunk.toString()));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

type RpcResult = {
	serverInfo?: { name: string; version: string };
	tools?: { name: string; annotations?: Record<string, unknown> }[];
	structuredContent?: unknown;
	isError?: boolean;
	content?: { text: string }[];
};
type RpcBody = { error?: string; result?: RpcResult };

async function rpc(token: string | null, body: unknown, extra: Record<string, string> = {}) {
	const response = await fetch(`${base}/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...extra,
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	return { response, json: text ? (JSON.parse(text) as RpcBody) : null };
}

/** What an MCP client does by itself, with the person's typing done through the service. */
async function handshake(name = "Test client"): Promise<string> {
	const registered = await fetch(`${base}/register`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT] }),
	});
	expect(registered.status).toBe(201);
	const client = (await registered.json()) as { client_id: string };

	const { verifier, challenge } = pkce();
	const query = new URLSearchParams({
		response_type: "code",
		client_id: client.client_id,
		redirect_uri: REDIRECT,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: "xyz",
	});
	const page = await fetch(`${base}/authorize?${query}`);
	expect(page.status).toBe(200);
	const html = await page.text();
	const code = /class="code"[^>]*>(\d{3}) (\d{3})</.exec(html);
	const pairingId = /var id = "([0-9a-f]{32})"/.exec(html);
	expect(code).not.toBeNull();
	expect(pairingId).not.toBeNull();

	const waiting = (await (await fetch(`${base}/authorize/status?id=${pairingId![1]}`)).json()) as { status: string };
	expect(waiting.status).toBe("waiting");

	// The person types what the page showed into Juno.
	expect(connections.answerPairing(pairingId![1], `${code![1]}${code![2]}`).accepted).toBe(true);

	const done = (await (await fetch(`${base}/authorize/status?id=${pairingId![1]}`)).json()) as {
		status: string;
		redirect: string;
	};
	expect(done.status).toBe("done");
	const redirect = new URL(done.redirect);
	expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
	expect(redirect.searchParams.get("state")).toBe("xyz");

	const token = await fetch(`${base}/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: redirect.searchParams.get("code") ?? "",
			client_id: client.client_id,
			redirect_uri: REDIRECT,
			code_verifier: verifier,
		}),
	});
	expect(token.status).toBe(200);
	const issued = (await token.json()) as { access_token: string; token_type: string };
	expect(issued.token_type).toBe("Bearer");
	return issued.access_token;
}

describe("who may reach the server", () => {
	it("answers a plain request at the root", async () => {
		const response = await fetch(`${base}/`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("/mcp");
	});

	it("refuses a Host that is not a loopback name on this port", async () => {
		const wrongName = await raw("/", { Host: `evil.example:${httpServerStatus().port}` });
		expect(wrongName.status).toBe(421);
		const wrongPort = await raw("/", { Host: "127.0.0.1:1" });
		expect(wrongPort.status).toBe(421);
		const noPort = await raw("/", { Host: "127.0.0.1" });
		expect(noPort.status).toBe(421);
	});

	it("accepts localhost as a name for this machine", async () => {
		const response = await raw("/", { Host: `localhost:${httpServerStatus().port}` });
		expect(response.status).toBe(200);
	});

	it("refuses a request that comes from a web page", async () => {
		const response = await raw("/mcp", { Host: `127.0.0.1:${httpServerStatus().port}`, Origin: "https://evil.example" }, "POST");
		expect(response.status).toBe(403);
	});

	it("sends a client without a token to the handshake", async () => {
		const { response, json } = await rpc(null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
		expect(response.status).toBe(401);
		expect(json?.error).toBe("unauthorized");
		expect(response.headers.get("www-authenticate")).toContain(`${base}/.well-known/oauth-protected-resource/mcp`);
	});

	it("refuses a token it did not issue", async () => {
		const { response } = await rpc("juno_" + "z".repeat(43), { jsonrpc: "2.0", id: 1, method: "tools/list" });
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});
});

describe("discovery", () => {
	it("describes the resource and the authorisation server for the address it was reached at", async () => {
		const resource = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
		expect(resource.resource).toBe(`${base}/mcp`);
		expect(resource.authorization_servers).toEqual([base]);

		const server = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
		expect(server).toMatchObject({
			issuer: base,
			authorization_endpoint: `${base}/authorize`,
			token_endpoint: `${base}/token`,
			registration_endpoint: `${base}/register`,
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
		});
	});
});

describe("registering and authorising", () => {
	it("refuses a client that wants to be sent to a web address", async () => {
		const response = await fetch(`${base}/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ client_name: "Evil", redirect_uris: ["https://evil.example/cb"] }),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toBe("invalid_redirect_uri");
	});

	it("shows the code in the page and escapes what the client called itself", async () => {
		const registered = (await (
			await fetch(`${base}/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ client_name: "<script>alert(1)</script>", redirect_uris: [REDIRECT] }),
			})
		).json()) as { client_id: string };
		const page = await fetch(
			`${base}/authorize?${new URLSearchParams({
				response_type: "code",
				client_id: registered.client_id,
				redirect_uri: REDIRECT,
				code_challenge: pkce().challenge,
				code_challenge_method: "S256",
			})}`,
		);
		const html = await page.text();
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		expect(page.headers.get("x-frame-options")).toBe("DENY");
		expect(connections.listPairings()).toHaveLength(1);
	});

	it("says so, with no code, when Juno is locked", async () => {
		locked = true;
		const registered = (await (
			await fetch(`${base}/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ client_name: "A", redirect_uris: [REDIRECT] }),
			})
		).json()) as { client_id: string };
		const page = await fetch(
			`${base}/authorize?${new URLSearchParams({
				response_type: "code",
				client_id: registered.client_id,
				redirect_uri: REDIRECT,
				code_challenge: pkce().challenge,
				code_challenge_method: "S256",
			})}`,
		);
		expect(page.status).toBe(503);
		expect(await page.text()).toContain("locked");
		expect(connections.listPairings()).toHaveLength(0);
	});

	it("explains a request it cannot start, instead of redirecting anywhere", async () => {
		const page = await fetch(`${base}/authorize?response_type=code&client_id=nope`);
		expect(page.status).toBe(400);
		expect(page.headers.get("location")).toBeNull();
	});

	it("refuses a token request with the wrong verifier", async () => {
		const registered = (await (
			await fetch(`${base}/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ client_name: "A", redirect_uris: [REDIRECT] }),
			})
		).json()) as { client_id: string };
		const response = await fetch(`${base}/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: "nothing",
				client_id: registered.client_id,
				redirect_uri: REDIRECT,
				code_verifier: randomBytes(32).toString("base64url"),
			}),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");
	});
});

describe("using the tools after the handshake", () => {
	it("lists them and calls one", async () => {
		const token = await handshake();

		const init = await rpc(token, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
		});
		expect(init.response.status).toBe(200);
		expect(init.json?.result?.serverInfo).toEqual({ name: "juno", version: "9.9.9" });

		const listed = await rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" });
		expect(listed.json?.result?.tools).toHaveLength(1);
		expect(listed.json?.result?.tools?.[0]).toMatchObject({
			name: "demo.echo",
			annotations: { readOnlyHint: true, destructiveHint: false },
		});

		const called = await rpc(
			token,
			{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo.echo", arguments: { text: "hi" } } },
			{ "mcp-protocol-version": "2025-06-18" },
		);
		expect(called.json?.result?.structuredContent).toEqual({ echoed: "hi" });
		expect(calls).toEqual([{ name: "demo.echo", args: { text: "hi" } }]);
	});

	it("reports a failing tool as an error result the agent can read", async () => {
		const token = await handshake();
		const called = await rpc(
			token,
			{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo.fail", arguments: {} } },
			{ "mcp-protocol-version": "2025-06-18" },
		);
		expect(called.json?.result?.isError).toBe(true);
		expect(called.json?.result?.content?.[0]?.text).toBe("It failed on purpose.");
	});

	it("works with a token made by hand", async () => {
		const made = connections.createToken("Script");
		const listed = await rpc(made.token, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" });
		expect(listed.json?.result?.tools).toHaveLength(1);
	});

	it("stops answering a token the moment it is revoked", async () => {
		const made = connections.createToken("Script");
		connections.revoke(made.connection.id);
		const { response } = await rpc(made.token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
		expect(response.status).toBe(401);
	});

	it("offers no stream and no session", async () => {
		const made = connections.createToken("Script");
		const response = await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${made.token}`, Accept: "text/event-stream" } });
		expect(response.status).toBe(405);
		const bad = await fetch(`${base}/mcp`, {
			method: "POST",
			headers: { Authorization: `Bearer ${made.token}`, "Content-Type": "text/plain" },
			body: "x",
		});
		expect(bad.status).toBe(415);
		const garbled = await fetch(`${base}/mcp`, {
			method: "POST",
			headers: { Authorization: `Bearer ${made.token}`, "Content-Type": "application/json" },
			body: "{nope",
		});
		expect(garbled.status).toBe(400);
	});
});

describe("starting", () => {
	it("says why it could not when the port is taken, and keeps going without it", async () => {
		await stopHttpServer();
		const blocker = createNetServer();
		await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
		const taken = (blocker.address() as AddressInfo).port;

		const status = await startHttpServer(taken, deps);
		expect(status.running).toBe(false);
		expect(status.error).toContain(`Port ${taken} is already used`);

		await new Promise<void>((resolve) => blocker.close(() => resolve()));
		const again = await startHttpServer(0, deps);
		expect(again.running).toBe(true);
		expect(again.error).toBeNull();
		// A new listener, a new port: the tests after this one have to follow it.
		base = `http://127.0.0.1:${again.port}`;
	});
});

describe("a real MCP client", () => {
	/**
	 * The SDK's own client does the whole handshake the way Claude Code, Cursor
	 * and VS Code do: it finds the authorisation server from the 401, registers
	 * itself, sends the browser away and swaps the code for a token. If this
	 * passes, a client built on the same code can be connected with a URL.
	 */
	it("connects with only the URL, and uses the tools after the code is typed", async () => {
		const memory: {
			info?: OAuthClientInformationMixed;
			tokens?: OAuthTokens;
			verifier?: string;
			authorizationUrl?: URL;
		} = {};

		const provider: OAuthClientProvider = {
			get redirectUrl() {
				return REDIRECT;
			},
			get clientMetadata() {
				return {
					client_name: "SDK test client",
					redirect_uris: [REDIRECT],
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
				};
			},
			clientInformation: () => memory.info,
			saveClientInformation: (info) => {
				memory.info = info;
			},
			tokens: () => memory.tokens,
			saveTokens: (tokens) => {
				memory.tokens = tokens;
			},
			redirectToAuthorization: (url) => {
				memory.authorizationUrl = url;
			},
			saveCodeVerifier: (verifier) => {
				memory.verifier = verifier;
			},
			codeVerifier: () => memory.verifier ?? "",
		};

		const url = new URL(`${base}/mcp`);
		const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
		await expect(new Client({ name: "sdk-test", version: "1" }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
		expect(memory.authorizationUrl).toBeDefined();
		expect(memory.info).toBeDefined();

		// What the person does: reads the code off the page, types it into Juno.
		const page = await (await fetch(memory.authorizationUrl!)).text();
		const code = /class="code"[^>]*>(\d{3}) (\d{3})</.exec(page);
		const pairingId = /var id = "([0-9a-f]{32})"/.exec(page);
		expect(page).toContain("SDK test client");
		expect(connections.listPairings().map((request) => request.clientName)).toEqual(["SDK test client"]);
		expect(connections.answerPairing(pairingId![1], `${code![1]}${code![2]}`).accepted).toBe(true);

		const done = (await (await fetch(`${base}/authorize/status?id=${pairingId![1]}`)).json()) as { redirect: string };
		const redirect = new URL(done.redirect);
		expect(redirect.searchParams.get("state")).toBe(memory.authorizationUrl!.searchParams.get("state"));
		await first.finishAuth(redirect.searchParams.get("code") ?? "");
		expect(memory.tokens?.access_token).toBeDefined();

		const client = new Client({ name: "sdk-test", version: "1" });
		await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
		expect(client.getServerVersion()).toEqual({ name: "juno", version: "9.9.9" });

		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toEqual(["demo.echo"]);
		const result = await client.callTool({ name: "demo.echo", arguments: { text: "hello" } });
		expect(result.structuredContent).toEqual({ echoed: "hello" });
		await client.close();

		expect(connections.list().map((row) => row.name)).toEqual(["SDK test client"]);
	});
});
