/**
 * Microsoft sign-in for mail accounts, and the access tokens it keeps.
 *
 * Where each piece lives, and why:
 *
 * - A sign-in that finished in the browser waits here, in memory, under a
 *   random id, until the Ready step turns it into an account. The renderer
 *   holds the id, which is not a token and is worth nothing outside this
 *   process. It expires after fifteen minutes.
 * - The refresh token goes into the credential store with the account, under
 *   its credential key, like a password (decision 6). The database stores only
 *   that the account signs in with Microsoft.
 * - Access tokens live in memory only and are renewed a minute before they
 *   run out. A restart costs one refresh, which is cheap.
 *
 * No MCP tool reaches any of this (security.md section 9): an agent cannot
 * start a sign-in, finish one, or be handed a token. The settings window
 * starts it over IPC, and a person signs in in their own browser.
 */
import { randomBytes } from "node:crypto";
import { MICROSOFT_CLIENT_ID, microsoftSignInConfigured } from "../../shared/oauth";
import type { MailSignInResult } from "../../shared/types";
import {
	authorizeUrl,
	exchangeCode,
	listenForRedirect,
	pkcePair,
	randomState,
	refreshTokens,
	type LoopbackListener,
	type MicrosoftTokens,
	type TokenFetch,
} from "./microsoft-oauth";

type Config = {
	clientId: string;
	/** Opens a URL in the system browser. Electron's shell, injected at startup. */
	openExternal: ((url: string) => Promise<void>) | null;
	fetchToken: TokenFetch;
	/** How the redirect is awaited. A test hands back a code without a browser. */
	listen: (state: string) => Promise<LoopbackListener>;
	now: () => number;
};

const defaults = (): Config => ({
	clientId: MICROSOFT_CLIENT_ID,
	openExternal: null,
	fetchToken: (url, init) => fetch(url, init),
	listen: (state) => listenForRedirect(state),
	now: Date.now,
});

let config: Config = defaults();

export function configureMicrosoftSignIn(next: Partial<Config>): void {
	config = { ...config, ...next };
}

/** Back to the shipped configuration and empty caches. For tests. */
export function resetMicrosoftSignIn(): void {
	config = defaults();
	pending.clear();
	accessTokens.clear();
	active?.close();
	active = null;
}

export function signInConfigured(): boolean {
	return microsoftSignInConfigured(config.clientId);
}

const NOT_SET_UP =
	"Sign-in with Microsoft is coming soon. Until then, Outlook.com and Microsoft 365 accounts cannot be added.";

type PendingSignIn = { email: string; tokens: MicrosoftTokens; expiresAt: number };

const PENDING_FOR_MS = 15 * 60 * 1000;
const pending = new Map<string, PendingSignIn>();
let active: LoopbackListener | null = null;

function normalise(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Opens Microsoft's sign-in page in the browser and waits for the person to
 * finish there. Resolves once the code has been exchanged and the address
 * signed in to matches the one typed.
 */
async function runSignIn(email: string): Promise<MicrosoftTokens> {
	const address = normalise(email);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
		throw new Error("The address has to look like name@example.be.");
	}
	if (!signInConfigured()) throw new Error(NOT_SET_UP);
	if (!config.openExternal) throw new Error("Juno cannot open a browser from here.");

	// One sign-in at a time. Pressing the button again starts over.
	active?.close();
	const { verifier, challenge } = pkcePair();
	const state = randomState();
	const listener = await config.listen(state);
	active = listener;
	try {
		const url = authorizeUrl({
			clientId: config.clientId,
			redirectUri: listener.redirectUri,
			state,
			challenge,
			loginHint: address,
		});
		// security.md section 3: the shell is only ever handed https.
		if (new URL(url).protocol !== "https:") throw new Error("Juno only opens https pages in the browser.");
		await config.openExternal(url);

		const code = await listener.code;
		const tokens = await exchangeCode(
			{ clientId: config.clientId, code, verifier, redirectUri: listener.redirectUri },
			config.fetchToken,
			config.now,
		);
		if (tokens.email && tokens.email !== address) {
			throw new Error(
				`You signed in to Microsoft as ${tokens.email}, not ${address}. Sign in with ${address}, or go back and type ${tokens.email}.`,
			);
		}
		return tokens;
	} finally {
		listener.close();
		if (active === listener) active = null;
	}
}

/** Starts a sign-in for a new account. The tokens stay here; the caller gets an id. */
export async function signIn(email: string): Promise<MailSignInResult> {
	const tokens = await runSignIn(email);
	const signInId = randomBytes(18).toString("base64url");
	pending.set(signInId, { email: normalise(email), tokens, expiresAt: config.now() + PENDING_FOR_MS });
	return { signInId, email: normalise(email) };
}

/** Signs an existing account in again, and returns the new refresh token for the store. */
export async function signInAgain(accountId: string, email: string): Promise<string> {
	const tokens = await runSignIn(email);
	accessTokens.set(accountId, { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
	return tokens.refreshToken;
}

/** Stops a sign-in that is waiting on the browser. */
export function cancelSignIn(): void {
	active?.close();
	active = null;
}

function live(signInId: string): PendingSignIn {
	const entry = pending.get(signInId);
	if (!entry || entry.expiresAt < config.now()) {
		pending.delete(signInId);
		throw new Error("The Microsoft sign-in is no longer waiting. Press Sign in with Microsoft again.");
	}
	return entry;
}

/** The access token of a finished sign-in, for the connection test before saving. */
export function pendingAccess(signInId: string): { email: string; accessToken: string } {
	const entry = live(signInId);
	return { email: entry.email, accessToken: entry.tokens.accessToken };
}

/**
 * Hands a finished sign-in over to the account being created, and forgets it
 * here. The refresh token goes to the credential store; the access token is
 * kept in memory under the account's id.
 */
export function takeSignIn(signInId: string, accountId: string): { email: string; refreshToken: string } {
	const entry = live(signInId);
	pending.delete(signInId);
	accessTokens.set(accountId, { accessToken: entry.tokens.accessToken, expiresAt: entry.tokens.expiresAt });
	return { email: entry.email, refreshToken: entry.tokens.refreshToken };
}

const accessTokens = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * A usable access token for an account. Renews it with the refresh token when
 * it has less than a minute left, and hands the rotated refresh token to
 * `storeRefresh`, because Microsoft may stop honouring the old one.
 *
 * Throws `SignInExpiredError` when Microsoft refuses the refresh token. The
 * account service turns that into "Sign in again".
 */
export async function accessTokenFor(
	accountId: string,
	refreshToken: string,
	storeRefresh: (next: string) => void,
): Promise<string> {
	const cached = accessTokens.get(accountId);
	if (cached && cached.expiresAt - 60_000 > config.now()) return cached.accessToken;
	if (!signInConfigured()) throw new Error(NOT_SET_UP);
	const tokens = await refreshTokens({ clientId: config.clientId, refreshToken }, config.fetchToken, config.now);
	accessTokens.set(accountId, { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
	if (tokens.refreshToken !== refreshToken) storeRefresh(tokens.refreshToken);
	return tokens.accessToken;
}

/** Drops an account's access token, when it is removed or signs in again. */
export function forgetAccessToken(accountId: string): void {
	accessTokens.delete(accountId);
}
