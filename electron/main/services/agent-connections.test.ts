import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as connections from "./agent-connections";
import { OAuthError } from "./agent-connections";

const REDIRECT = "http://127.0.0.1:53682/callback";

let dir: string;
let clock: number;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "juno-connections-"));
	clock = Date.parse("2026-10-02T09:00:00.000Z");
	connections.configureAgentConnections(dir, () => clock);
});

afterEach(() => {
	connections.configureAgentConnections(null);
	rmSync(dir, { recursive: true, force: true });
});

function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function register(name = "Claude Code", redirectUris = [REDIRECT]) {
	return connections.registerClient({ clientName: name, redirectUris });
}

/** A client starting the handshake, the way its browser page would. */
function begin(clientId: string, challenge: string, overrides: Record<string, unknown> = {}) {
	return connections.beginPairing({
		clientId,
		redirectUri: REDIRECT,
		codeChallenge: challenge,
		codeChallengeMethod: "S256",
		state: "abc",
		...overrides,
	});
}

function codeOf(redirect: string): string {
	return new URL(redirect).searchParams.get("code") ?? "";
}

/** The whole handshake, ending in a token. */
function connect(name = "Claude Code") {
	const client = register(name);
	const { verifier, challenge } = pkce();
	const started = begin(client.clientId, challenge);
	const answer = connections.answerPairing(started.pairingId, started.code);
	expect(answer.accepted).toBe(true);
	const status = connections.pairingStatus(started.pairingId);
	if (status.status !== "done") throw new Error("not done");
	return connections.exchangeCode({
		code: codeOf(status.redirect),
		clientId: client.clientId,
		redirectUri: REDIRECT,
		codeVerifier: verifier,
	});
}

describe("redirect addresses", () => {
	it("allows this machine and an app scheme, and nothing on the web", () => {
		expect(connections.isAllowedRedirect("http://127.0.0.1:5000/callback")).toBe(true);
		expect(connections.isAllowedRedirect("http://localhost:5000/callback")).toBe(true);
		expect(connections.isAllowedRedirect("http://[::1]:5000/callback")).toBe(true);
		expect(connections.isAllowedRedirect("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
		expect(connections.isAllowedRedirect("vscode://ms-vscode.mcp/callback")).toBe(true);

		expect(connections.isAllowedRedirect("https://example.com/callback")).toBe(false);
		expect(connections.isAllowedRedirect("http://example.com/callback")).toBe(false);
		expect(connections.isAllowedRedirect("http://127.0.0.1.example.com/callback")).toBe(false);
		expect(connections.isAllowedRedirect("http://user:pass@127.0.0.1/callback")).toBe(false);
		expect(connections.isAllowedRedirect("http://127.0.0.1/callback#fragment")).toBe(false);
		expect(connections.isAllowedRedirect("javascript:alert(1)")).toBe(false);
		expect(connections.isAllowedRedirect("file:///etc/passwd")).toBe(false);
		expect(connections.isAllowedRedirect("not a url")).toBe(false);
	});
});

describe("registering a client", () => {
	it("signs the id, so it is known again without being stored", () => {
		const client = register("Cursor");
		expect(connections.readClientId(client.clientId)).toEqual({ name: "Cursor", redirectUris: [REDIRECT] });

		// A new process with the same secret on disk still recognises it.
		connections.configureAgentConnections(dir, () => clock);
		expect(connections.readClientId(client.clientId)?.name).toBe("Cursor");
	});

	it("refuses an id that was edited", () => {
		const client = register();
		const [prefix, payload, signature] = client.clientId.split(".");
		const forged = Buffer.from(JSON.stringify({ n: "Anything", r: ["http://127.0.0.1:1/x"] })).toString("base64url");
		expect(connections.readClientId(`${prefix}.${forged}.${signature}`)).toBeNull();
		expect(connections.readClientId(`${prefix}.${payload}.AAAA`)).toBeNull();
		expect(connections.readClientId("jc1.x")).toBeNull();
		expect(connections.readClientId(undefined)).toBeNull();
	});

	it("refuses a web redirect, an empty list and too many", () => {
		expect(() => register("x", ["https://evil.example/cb"])).toThrow(OAuthError);
		expect(() => register("x", [])).toThrow(OAuthError);
		expect(() => register("x", Array.from({ length: 6 }, (_, i) => `http://127.0.0.1:${i + 1}/cb`))).toThrow(OAuthError);
	});

	it("cleans a name so it cannot rearrange the line around it", () => {
		expect(connections.cleanName("  Claude‮  Code\n")).toBe("Claude Code");
		expect(connections.cleanName("")).toBe("Unnamed client");
		expect(connections.cleanName(42)).toBe("Unnamed client");
		expect(connections.cleanName("x".repeat(200))).toHaveLength(60);
	});
});

describe("the handshake", () => {
	it("lets a client in after the code is typed, and gives it a token that works", () => {
		const { accessToken, connection } = connect();
		expect(accessToken.startsWith("juno_")).toBe(true);
		expect(connection).toMatchObject({ name: "Claude Code", kind: "signed-in", lastUsedAt: null });
		expect(connections.verifyToken(accessToken)?.id).toBe(connection.id);
		expect(connections.list()).toHaveLength(1);
	});

	it("never puts the code in what the app shows", () => {
		const client = register();
		const started = begin(client.clientId, pkce().challenge);
		const waiting = connections.listPairings();
		expect(waiting).toHaveLength(1);
		expect(JSON.stringify(waiting)).not.toContain(started.code);
		expect(waiting[0]).toMatchObject({ clientName: "Claude Code", redirectHost: "127.0.0.1:53682", attemptsLeft: 3 });
	});

	it("accepts the code with spaces in it, the way the page shows it", () => {
		const client = register();
		const started = begin(client.clientId, pkce().challenge);
		const spaced = `${started.code.slice(0, 3)} ${started.code.slice(3)}`;
		expect(connections.answerPairing(started.pairingId, spaced).accepted).toBe(true);
	});

	it("ends the request after three wrong codes, even if the fourth is right", () => {
		const client = register();
		const started = begin(client.clientId, pkce().challenge);
		const wrong = started.code === "000000" ? "111111" : "000000";

		expect(connections.answerPairing(started.pairingId, wrong)).toEqual({ accepted: false, reason: "wrong-code", attemptsLeft: 2 });
		expect(connections.answerPairing(started.pairingId, wrong)).toEqual({ accepted: false, reason: "wrong-code", attemptsLeft: 1 });
		expect(connections.answerPairing(started.pairingId, wrong)).toEqual({ accepted: false, reason: "too-many-attempts", attemptsLeft: 0 });
		expect(connections.answerPairing(started.pairingId, started.code).accepted).toBe(false);

		const status = connections.pairingStatus(started.pairingId);
		expect(status).toMatchObject({ status: "done", denied: true });
		expect(connections.listPairings()).toHaveLength(0);
		expect(connections.list()).toHaveLength(0);
	});

	it("tells the client it was denied, with the error a client expects", () => {
		const client = register();
		const started = begin(client.clientId, pkce().challenge);
		connections.denyPairing(started.pairingId);
		const status = connections.pairingStatus(started.pairingId);
		if (status.status !== "done") throw new Error("not done");
		const url = new URL(status.redirect);
		expect(url.searchParams.get("error")).toBe("access_denied");
		expect(url.searchParams.get("state")).toBe("abc");
		expect(url.searchParams.get("code")).toBeNull();
	});

	it("lets a request lapse after three minutes", () => {
		const client = register();
		const started = begin(client.clientId, pkce().challenge);
		clock += connections.PAIRING_TTL_MS + 1000;
		expect(connections.listPairings()).toHaveLength(0);
		expect(connections.answerPairing(started.pairingId, started.code)).toMatchObject({ accepted: false, reason: "expired" });
	});

	it("refuses a sixth request while five wait", () => {
		const client = register();
		for (let i = 0; i < 5; i++) begin(client.clientId, pkce().challenge);
		expect(() => begin(client.clientId, pkce().challenge)).toThrow(/waiting/);
	});

	it("refuses a request that is not PKCE with S256, or whose redirect was not registered", () => {
		const client = register();
		const { challenge } = pkce();
		expect(() => begin(client.clientId, challenge, { codeChallengeMethod: "plain" })).toThrow(OAuthError);
		expect(() => begin(client.clientId, "short")).toThrow(OAuthError);
		expect(() => begin(client.clientId, challenge, { redirectUri: "http://127.0.0.1:9/other" })).toThrow(OAuthError);
		expect(() => begin("jc1.nope.nope", challenge)).toThrow(OAuthError);
	});

	it("announces a request, so the window can come forward", () => {
		const seen: string[] = [];
		const stop = connections.onPairingRequested((request) => seen.push(request.clientName));
		begin(register("Windsurf").clientId, pkce().challenge);
		stop();
		expect(seen).toEqual(["Windsurf"]);
	});
});

describe("swapping the code for a token", () => {
	function issued() {
		const client = register();
		const { verifier, challenge } = pkce();
		const started = begin(client.clientId, challenge);
		connections.answerPairing(started.pairingId, started.code);
		const status = connections.pairingStatus(started.pairingId);
		if (status.status !== "done") throw new Error("not done");
		return { client, verifier, code: codeOf(status.redirect) };
	}

	it("refuses a wrong verifier, and spends the code doing it", () => {
		const { client, code } = issued();
		expect(() =>
			connections.exchangeCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: randomBytes(32).toString("base64url") }),
		).toThrow(/verifier/);
		expect(() =>
			connections.exchangeCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: randomBytes(32).toString("base64url") }),
		).toThrow(/already been used/);
	});

	it("refuses a second use of the same code", () => {
		const { client, verifier, code } = issued();
		const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
		connections.exchangeCode(input);
		expect(() => connections.exchangeCode(input)).toThrow(OAuthError);
	});

	it("refuses a code given to another client or another redirect", () => {
		const { client, verifier, code } = issued();
		const other = register("Other");
		expect(() =>
			connections.exchangeCode({ code, clientId: other.clientId, redirectUri: REDIRECT, codeVerifier: verifier }),
		).toThrow(OAuthError);

		const again = issued();
		expect(() =>
			connections.exchangeCode({ code: again.code, clientId: again.client.clientId, redirectUri: "http://127.0.0.1:1/x", codeVerifier: again.verifier }),
		).toThrow(OAuthError);
		expect(client.clientId).not.toBe(other.clientId);
	});

	it("refuses a code that waited too long", () => {
		const { client, verifier, code } = issued();
		clock += 3 * 60 * 1000;
		expect(() =>
			connections.exchangeCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier }),
		).toThrow(OAuthError);
	});
});

describe("tokens", () => {
	it("stores a hash and never the token", () => {
		const { accessToken } = connect();
		const onDisk = readFileSync(join(dir, "agent-connections.json"), "utf8");
		expect(onDisk).not.toContain(accessToken);
		expect(onDisk).toContain(createHash("sha256").update(accessToken).digest("hex"));
	});

	it("keeps who was let in across a restart", () => {
		const { accessToken } = connect();
		connections.configureAgentConnections(dir, () => clock);
		expect(connections.verifyToken(accessToken)?.name).toBe("Claude Code");
	});

	it("refuses anything that is not a token it made", () => {
		connect();
		expect(connections.verifyToken("juno_" + "a".repeat(43))).toBeNull();
		expect(connections.verifyToken("")).toBeNull();
		expect(connections.verifyToken(undefined)).toBeNull();
		expect(connections.verifyToken("x".repeat(500))).toBeNull();
	});

	it("makes a token by hand, readable once, that works like the other kind", () => {
		const made = connections.createToken("  My script ");
		expect(made.connection).toMatchObject({ name: "My script", kind: "token" });
		expect(connections.verifyToken(made.token)?.id).toBe(made.connection.id);
		expect(JSON.stringify(connections.list())).not.toContain(made.token);
	});

	it("takes a client out, and its token stops working", () => {
		const { accessToken, connection } = connect();
		connections.revoke(connection.id);
		expect(connections.verifyToken(accessToken)).toBeNull();
		expect(connections.list()).toHaveLength(0);
		expect(() => connections.revoke(connection.id)).toThrow(/already gone/);
	});

	it("notes when a token was last used, at most once a minute", () => {
		const { accessToken, connection } = connect();
		connections.verifyToken(accessToken);
		const first = connections.list().find((row) => row.id === connection.id)?.lastUsedAt;
		expect(first).toBe(new Date(clock).toISOString());

		clock += 10_000;
		connections.verifyToken(accessToken);
		expect(connections.list()[0].lastUsedAt).toBe(first);

		clock += 60_000;
		connections.verifyToken(accessToken);
		expect(connections.list()[0].lastUsedAt).toBe(new Date(clock).toISOString());
	});

	it("tells listeners when the list changes", () => {
		let count = 0;
		const stop = connections.onChange(() => count++);
		const made = connections.createToken("a");
		connections.revoke(made.connection.id);
		stop();
		expect(count).toBe(2);
	});
});
