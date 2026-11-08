/**
 * The Microsoft sign-in pieces, with the token endpoint played by a fake.
 * Nothing here talks to Microsoft. The loopback listener is real, because the
 * checks it makes on a redirect are the point of it.
 */
import { createHash } from "node:crypto";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import {
	authorizeUrl,
	emailFromIdToken,
	exchangeCode,
	listenForRedirect,
	pkcePair,
	refreshTokens,
	SignInExpiredError,
	type TokenFetch,
} from "./microsoft-oauth";

function idToken(claims: Record<string, unknown>): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

/** A token endpoint that records what it was sent and answers with `reply`. */
function fakeTokenEndpoint(reply: (params: URLSearchParams) => { status: number; body: unknown }) {
	const calls: URLSearchParams[] = [];
	const fetchToken: TokenFetch = async (url, init) => {
		expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
		const params = new URLSearchParams(init.body);
		calls.push(params);
		const answer = reply(params);
		return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
	};
	return { fetchToken, calls };
}

function get(port: number, path: string, host = `localhost:${port}`): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (res) => {
			let body = "";
			res.on("data", (chunk: Buffer) => (body += chunk.toString()));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

describe("PKCE", () => {
	it("shows Microsoft the SHA-256 of a verifier that never leaves this machine", () => {
		const { verifier, challenge } = pkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
		expect(pkcePair().verifier).not.toBe(verifier);
	});
});

describe("the authorise address", () => {
	it("asks for mail, a refresh token and the address, with no secret in it", () => {
		const url = new URL(
			authorizeUrl({
				clientId: "client-1",
				redirectUri: "http://localhost:50123",
				state: "state-1",
				challenge: "challenge-1",
				loginHint: "jan@hotmail.com",
			}),
		);
		expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: "client-1",
			response_type: "code",
			redirect_uri: "http://localhost:50123",
			state: "state-1",
			code_challenge: "challenge-1",
			code_challenge_method: "S256",
			login_hint: "jan@hotmail.com",
		});
		expect(url.searchParams.get("scope")?.split(" ")).toEqual([
			"offline_access",
			"https://outlook.office.com/IMAP.AccessAsUser.All",
			"https://outlook.office.com/SMTP.Send",
			"openid",
			"email",
		]);
		expect(url.searchParams.has("client_secret")).toBe(false);
	});
});

describe("the token endpoint", () => {
	it("trades the code and the verifier for tokens, and reads the address", async () => {
		const endpoint = fakeTokenEndpoint(() => ({
			status: 200,
			body: {
				access_token: "access-1",
				refresh_token: "refresh-1",
				expires_in: 3600,
				id_token: idToken({ email: "Jan@Hotmail.com" }),
			},
		}));
		const tokens = await exchangeCode(
			{ clientId: "client-1", code: "code-1", verifier: "verifier-1", redirectUri: "http://localhost:1" },
			endpoint.fetchToken,
			() => 1_000,
		);
		expect(tokens).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 3_601_000, email: "jan@hotmail.com" });
		expect(Object.fromEntries(endpoint.calls[0]!)).toMatchObject({
			client_id: "client-1",
			grant_type: "authorization_code",
			code: "code-1",
			code_verifier: "verifier-1",
			redirect_uri: "http://localhost:1",
		});
		expect(endpoint.calls[0]!.has("client_secret")).toBe(false);
	});

	it("renews with the refresh token and keeps the new one Microsoft hands back", async () => {
		const endpoint = fakeTokenEndpoint(() => ({
			status: 200,
			body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 },
		}));
		const tokens = await refreshTokens({ clientId: "client-1", refreshToken: "refresh-1" }, endpoint.fetchToken);
		expect(tokens.refreshToken).toBe("refresh-2");
		expect(Object.fromEntries(endpoint.calls[0]!)).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
	});

	it("says a refused refresh token needs a person, not a retry", async () => {
		const endpoint = fakeTokenEndpoint(() => ({ status: 400, body: { error: "invalid_grant" } }));
		await expect(refreshTokens({ clientId: "c", refreshToken: "r" }, endpoint.fetchToken)).rejects.toBeInstanceOf(
			SignInExpiredError,
		);
	});

	it("refuses an answer with no refresh token, because the account could not stay signed in", async () => {
		const endpoint = fakeTokenEndpoint(() => ({ status: 200, body: { access_token: "a", expires_in: 3600 } }));
		await expect(
			exchangeCode({ clientId: "c", code: "x", verifier: "v", redirectUri: "http://localhost:1" }, endpoint.fetchToken),
		).rejects.toThrow(/stay signed in/);
	});

	it("falls back to the preferred user name, and ignores a token it cannot read", () => {
		expect(emailFromIdToken(idToken({ preferred_username: "info@vandamme.be" }))).toBe("info@vandamme.be");
		expect(emailFromIdToken(idToken({ preferred_username: "not an address" }))).toBeNull();
		expect(emailFromIdToken("garbage")).toBeNull();
		expect(emailFromIdToken(undefined)).toBeNull();
	});
});

describe("the redirect listener", () => {
	it("takes the code from a redirect with the right state, then closes", async () => {
		const listener = await listenForRedirect("state-ok");
		const port = Number(new URL(listener.redirectUri).port);
		expect(listener.redirectUri).toBe(`http://localhost:${port}`);

		const reply = await get(port, "/?code=code-1&state=state-ok");
		expect(reply.status).toBe(200);
		expect(reply.body).toContain("go back to Juno");
		await expect(listener.code).resolves.toBe("code-1");
		await expect(get(port, "/?code=code-2&state=state-ok")).rejects.toThrow();
	});

	it("ignores a redirect with another state, so a page elsewhere cannot finish the sign-in", async () => {
		const listener = await listenForRedirect("state-ok");
		const port = Number(new URL(listener.redirectUri).port);
		expect((await get(port, "/?code=evil&state=guess")).status).toBe(400);
		expect((await get(port, "/?code=evil&state=state-ok", "attacker.example:80")).status).toBe(400);
		expect((await get(port, "/elsewhere?code=evil&state=state-ok")).status).toBe(404);

		const reply = await get(port, "/?code=good&state=state-ok");
		expect(reply.status).toBe(200);
		await expect(listener.code).resolves.toBe("good");
	});

	it("passes a cancel in the browser on as a sentence", async () => {
		const listener = await listenForRedirect("s");
		const port = Number(new URL(listener.redirectUri).port);
		await get(port, "/?error=access_denied&state=s");
		await expect(listener.code).rejects.toThrow(/cancelled in the browser/);
	});

	it("gives up after its time, and when it is closed", async () => {
		const slow = await listenForRedirect("s", 20);
		await expect(slow.code).rejects.toThrow(/five minutes/);
		const closed = await listenForRedirect("s");
		closed.close();
		await expect(closed.code).rejects.toThrow(/cancelled/);
	});
});
