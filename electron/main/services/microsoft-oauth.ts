/**
 * Signing in to Microsoft for mail: the authorisation code flow with PKCE, as
 * a public client (decision 73).
 *
 * - **No client secret.** A desktop application cannot keep one, so it has
 *   none. Each sign-in is proven with a one-off code verifier instead.
 * - **The system browser**, never a window of Juno's. The person types their
 *   password into Microsoft's page in the browser they trust, and Juno never
 *   sees it.
 * - **The redirect comes back to this machine.** A one-off listener on
 *   127.0.0.1, on a port the operating system picks, takes the code, checks
 *   `state` and closes. A web address is never the redirect, for the reason
 *   in security.md section 9: the code would be handed to a server somewhere.
 *
 * Electron-free, so the tests run it against a fake token endpoint. Nothing
 * here calls Microsoft in a test.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MICROSOFT_AUTHORITY, MICROSOFT_MAIL_SCOPES } from "../../shared/oauth";

export type MicrosoftTokens = {
	accessToken: string;
	/** Microsoft hands a new one back on every refresh, and the old one may stop working. */
	refreshToken: string;
	/** UTC milliseconds. */
	expiresAt: number;
	/** The address the person signed in to, from the ID token. Null on a refresh. */
	email: string | null;
};

/** The token endpoint's shape, so a test can stand in for Microsoft. */
export type TokenFetch = (
	url: string,
	init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Thrown when Microsoft refuses a refresh token, so the account needs a person. */
export class SignInExpiredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignInExpiredError";
	}
}

function base64url(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A verifier and the challenge Microsoft is shown, RFC 7636 with S256. */
export function pkcePair(): { verifier: string; challenge: string } {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

export function randomState(): string {
	return base64url(randomBytes(24));
}

export function authorizeUrl(input: {
	clientId: string;
	redirectUri: string;
	state: string;
	challenge: string;
	loginHint?: string;
}): string {
	const url = new URL(`${MICROSOFT_AUTHORITY}/authorize`);
	url.searchParams.set("client_id", input.clientId);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("response_mode", "query");
	url.searchParams.set("scope", MICROSOFT_MAIL_SCOPES.join(" "));
	url.searchParams.set("state", input.state);
	url.searchParams.set("code_challenge", input.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	// Opens the account chooser on the address already typed. It is a hint,
	// which is why the address that comes back is checked against it.
	if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
	url.searchParams.set("prompt", "select_account");
	return url.href;
}

/**
 * The address in an ID token. The token came straight from Microsoft's token
 * endpoint over TLS in answer to this request, so its payload is read rather
 * than its signature checked: nothing between the two could have changed it.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
	if (!idToken) return null;
	const payload = idToken.split(".")[1];
	if (!payload) return null;
	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
			email?: unknown;
			preferred_username?: unknown;
		};
		const value = typeof claims.email === "string" ? claims.email : claims.preferred_username;
		return typeof value === "string" && value.includes("@") ? value.trim().toLowerCase() : null;
	} catch {
		return null;
	}
}

type TokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	id_token?: string;
	error?: string;
	error_description?: string;
};

async function postToken(params: Record<string, string>, fetchToken: TokenFetch, now: () => number): Promise<MicrosoftTokens> {
	const response = await fetchToken(`${MICROSOFT_AUTHORITY}/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params).toString(),
	});
	const body = (await response.json()) as TokenResponse;
	if (!response.ok || !body.access_token) {
		// invalid_grant is Microsoft saying the refresh token is no good any more:
		// revoked, expired, or the password changed. Only a person can fix that.
		if (body.error === "invalid_grant" || body.error === "interaction_required") {
			throw new SignInExpiredError("Microsoft asks you to sign in again.");
		}
		throw new Error(
			`Microsoft did not accept the sign-in (${body.error ?? `status ${response.status}`}). Try again, and sign in with the same address.`,
		);
	}
	if (!body.refresh_token) {
		throw new Error("Microsoft did not allow Juno to stay signed in. Sign in again and accept every permission asked.");
	}
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expiresAt: now() + Math.max(60, body.expires_in ?? 3600) * 1000,
		email: emailFromIdToken(body.id_token),
	};
}

export function exchangeCode(
	input: { clientId: string; code: string; verifier: string; redirectUri: string },
	fetchToken: TokenFetch,
	now: () => number = Date.now,
): Promise<MicrosoftTokens> {
	return postToken(
		{
			client_id: input.clientId,
			grant_type: "authorization_code",
			code: input.code,
			redirect_uri: input.redirectUri,
			code_verifier: input.verifier,
			scope: MICROSOFT_MAIL_SCOPES.join(" "),
		},
		fetchToken,
		now,
	);
}

export function refreshTokens(
	input: { clientId: string; refreshToken: string },
	fetchToken: TokenFetch,
	now: () => number = Date.now,
): Promise<MicrosoftTokens> {
	return postToken(
		{
			client_id: input.clientId,
			grant_type: "refresh_token",
			refresh_token: input.refreshToken,
			scope: MICROSOFT_MAIL_SCOPES.join(" "),
		},
		fetchToken,
		now,
	);
}

/** What the browser tab shows once the redirect has arrived. English, like the rest of the interface. */
function page(title: string, line: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Juno</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:15vh auto;max-width:28rem;padding:0 1rem}</style></head><body><h1>${title}</h1><p>${line}</p></body></html>`;
}

export type LoopbackListener = {
	/** `http://localhost:<port>`, which is what the app registration allows. */
	redirectUri: string;
	/** Resolves with the code once a redirect with the right state arrives. */
	code: Promise<string>;
	close(): void;
};

/**
 * A one-off listener for the redirect.
 *
 * It binds 127.0.0.1 only, on port 0 so the operating system picks a free
 * one, and the redirect names it as `localhost`, which is what Microsoft
 * matches against the registered `http://localhost` whatever the port. It
 * answers one redirect with the right `state`, then closes. Anything else, a
 * wrong state, a wrong Host or a second request, gets a plain 400 and changes
 * nothing. It also gives up after `timeoutMs`, so a sign-in nobody finishes
 * does not keep a port open.
 */
export async function listenForRedirect(state: string, timeoutMs = 5 * 60 * 1000): Promise<LoopbackListener> {
	let server: Server | null = null;
	let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | null = null;
	const code = new Promise<string>((resolve, reject) => {
		settle = { resolve, reject };
	});
	// A rejection nobody is waiting for yet must not be reported as unhandled.
	code.catch(() => undefined);

	let port = 0;
	let timer: NodeJS.Timeout | null = null;
	const close = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		server?.close();
		server?.closeAllConnections?.();
		server = null;
	};
	const finish = (outcome: { code: string } | { error: Error }) => {
		const pending = settle;
		settle = null;
		close();
		if (!pending) return;
		if ("code" in outcome) pending.resolve(outcome.code);
		else pending.reject(outcome.error);
	};

	const handle = (request: IncomingMessage, response: ServerResponse) => {
		const reply = (status: number, html: string) => {
			response.writeHead(status, {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
			});
			response.end(html);
		};
		const host = (request.headers.host ?? "").toLowerCase();
		if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
			reply(400, page("Not here", "This address only answers a sign-in from Juno."));
			return;
		}
		const url = new URL(request.url ?? "/", `http://localhost:${port}`);
		if (request.method !== "GET" || url.pathname !== "/" || !settle) {
			reply(404, page("Not here", "This address only answers a sign-in from Juno."));
			return;
		}
		if (url.searchParams.get("state") !== state) {
			// Not ours. Someone else's page cannot finish this sign-in.
			reply(400, page("Not here", "This sign-in did not start in Juno."));
			return;
		}
		const error = url.searchParams.get("error");
		if (error) {
			reply(200, page("Sign-in stopped", "Go back to Juno to try again."));
			finish({
				error: new Error(
					error === "access_denied"
						? "The sign-in was cancelled in the browser. Press Sign in with Microsoft to try again."
						: "Microsoft stopped the sign-in. Press Sign in with Microsoft to try again.",
				),
			});
			return;
		}
		const received = url.searchParams.get("code");
		if (!received) {
			reply(400, page("Not here", "This sign-in did not start in Juno."));
			return;
		}
		reply(200, page("Signed in", "You can close this tab and go back to Juno."));
		finish({ code: received });
	};

	await new Promise<void>((resolve, reject) => {
		const created = createServer(handle);
		created.once("error", reject);
		created.listen(0, "127.0.0.1", () => {
			port = (created.address() as AddressInfo).port;
			server = created;
			resolve();
		});
	});

	timer = setTimeout(() => {
		finish({ error: new Error("The sign-in took longer than five minutes. Press Sign in with Microsoft to try again.") });
	}, timeoutMs);
	timer.unref?.();

	return {
		redirectUri: `http://localhost:${port}`,
		code,
		close: () => finish({ error: new Error("The sign-in was cancelled.") }),
	};
}
