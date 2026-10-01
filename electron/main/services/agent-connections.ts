/**
 * Who may talk to the agent server, and how they got in.
 *
 * The server listens on a port, and a port on a laptop is reachable by every
 * program on it and by any web page in the browser. So nothing is answered
 * without a token, and a token is only handed out after a person at the
 * keyboard has said yes. Two ways in, both ending in the same stored thing:
 *
 * - **The handshake** (what an MCP client does by itself): the client registers
 *   under a name, sends the person's browser to Juno, and the page there shows a
 *   six-digit code. Juno shows a prompt with no code in it, and the person types
 *   the code from the browser into it. A program that started the handshake
 *   unasked produces a prompt the person has no code for, which is the point:
 *   there is nothing to click through. Three wrong tries end the request. It is
 *   OAuth 2.1 with PKCE and dynamic client registration, because that is what
 *   MCP clients already speak, so connecting one is a URL and nothing else.
 * - **A token made by hand**, for a client that cannot do the handshake. It is
 *   shown once, when it is made.
 *
 * Only a hash of a token is kept, so reading the file gives nobody a way in.
 * The file is next to settings.json rather than in the database: these belong
 * to this installation and must not come back with a restored backup of the
 * records, which would reopen the door to whoever held a token then.
 *
 * Nothing here imports `electron`. The directory is configured, so a plain Node
 * test points it at a temp folder.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConnection, AgentTokenCreated, PairingAnswer, PairingRequest } from "../../shared/types";

const FILE_NAME = "agent-connections.json";

/** How long a person has to type the code. */
export const PAIRING_TTL_MS = 3 * 60 * 1000;
/** A wrong code three times and the request is over. One in a million per try. */
const PAIRING_ATTEMPTS = 3;
/** More waiting than this and a new request is refused, so a program cannot bury the real one. */
const MAX_WAITING = 5;
/** The code a client is given to swap for a token. Used once, and only for a moment. */
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
/** A decided request stays readable this long, so a slow page can still be redirected. */
const DECIDED_TTL_MS = 2 * 60 * 1000;
const MAX_REDIRECTS_PER_CLIENT = 5;
const MAX_NAME_LENGTH = 60;
/** A last-used time is rewritten at most this often, so a busy agent is not a stream of disk writes. */
const LAST_USED_GRANULARITY_MS = 60 * 1000;

export class OAuthError extends Error {
	readonly code: string;
	readonly status: number;
	constructor(code: string, message: string, status = 400) {
		super(message);
		this.name = "OAuthError";
		this.code = code;
		this.status = status;
	}
}

type StoredConnection = {
	id: string;
	name: string;
	kind: AgentConnection["kind"];
	tokenHash: string;
	createdAt: string;
	lastUsedAt: string | null;
};

type Store = {
	version: 1;
	/** Signs client ids, so registering needs no memory on this side. */
	secret: string;
	connections: StoredConnection[];
};

type Pairing = {
	id: string;
	clientId: string;
	clientName: string;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
	code: string;
	createdAt: number;
	expiresAt: number;
	attemptsLeft: number;
	status: "waiting" | "approved" | "denied" | "expired";
	redirect: string | null;
	decidedAt: number | null;
	timer: NodeJS.Timeout | null;
};

type IssuedCode = {
	clientId: string;
	clientName: string;
	redirectUri: string;
	codeChallenge: string;
	expiresAt: number;
};

let directory: string | null = null;
let now: () => number = () => Date.now();
let store: Store | null = null;

const pairings = new Map<string, Pairing>();
const issuedCodes = new Map<string, IssuedCode>();
const changeListeners = new Set<() => void>();
const requestListeners = new Set<(request: PairingRequest) => void>();

/**
 * Points the store at a directory. The main process passes the user data
 * folder; a test passes a temp one and, if it needs to move time, a clock.
 */
export function configureAgentConnections(dir: string | null, clock?: () => number): void {
	directory = dir;
	now = clock ?? (() => Date.now());
	store = null;
	for (const pairing of pairings.values()) if (pairing.timer) clearTimeout(pairing.timer);
	pairings.clear();
	issuedCodes.clear();
}

export function onChange(listener: () => void): () => void {
	changeListeners.add(listener);
	return () => changeListeners.delete(listener);
}

/** Fires when a client starts a handshake, which is when the window should come forward. */
export function onPairingRequested(listener: (request: PairingRequest) => void): () => void {
	requestListeners.add(listener);
	return () => requestListeners.delete(listener);
}

function emitChange(): void {
	for (const listener of changeListeners) listener();
}

/* ------------------------------------------------------------------- store */

function file(): string {
	if (!directory) throw new Error("configureAgentConnections() was not called before the connection store was used.");
	return join(directory, FILE_NAME);
}

function persist(next: Store): void {
	const path = file();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	// 0o600 where the platform honours it. The hashes are not secrets, but the
	// signing secret is, and the file is not for anyone else on the machine.
	writeFileSync(tmp, `${JSON.stringify(next, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(tmp, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function read(): Store {
	if (store) return store;
	let raw: unknown = null;
	try {
		raw = JSON.parse(readFileSync(file(), "utf8"));
	} catch {
		raw = null;
	}

	const record = isRecord(raw) ? raw : {};
	const secret = typeof record.secret === "string" && record.secret.length >= 32 ? record.secret : null;
	const connections: StoredConnection[] = [];
	if (secret && Array.isArray(record.connections)) {
		for (const row of record.connections) {
			if (!isRecord(row)) continue;
			if (typeof row.id !== "string" || typeof row.tokenHash !== "string") continue;
			connections.push({
				id: row.id,
				name: cleanName(row.name),
				kind: row.kind === "token" ? "token" : "signed-in",
				tokenHash: row.tokenHash,
				createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
				lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
			});
		}
	}

	store = { version: 1, secret: secret ?? randomBytes(32).toString("hex"), connections };
	// A secret that was just made has to survive a restart, or every client id
	// handed out before it would stop verifying.
	if (!secret) persist(store);
	return store;
}

function write(next: Store): void {
	persist(next);
	store = next;
}

/* ------------------------------------------------------------------ naming */

/**
 * A name a person can read and trust no further than they trust the program
 * that sent it. Control and direction-override characters are dropped so a
 * name cannot rearrange the line around it.
 */
export function cleanName(raw: unknown): string {
	const text = typeof raw === "string" ? raw : "";
	let visible = "";
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		const unsafe =
			code < 0x20 ||
			(code >= 0x7f && code <= 0x9f) ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069) ||
			code === 0xfeff;
		visible += unsafe ? " " : character;
	}
	return visible.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim() || "Unnamed client";
}

/* --------------------------------------------------------- client identity */

const DANGEROUS_SCHEMES = new Set([
	"javascript:",
	"data:",
	"file:",
	"vbscript:",
	"blob:",
	"about:",
	"ftp:",
	"ws:",
	"wss:",
	"http:",
	"https:",
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Where a client may be sent back to. A loopback address (a program listening on
 * this machine, which is how a desktop client receives it) or a scheme the
 * client registered with the operating system. A web address is refused: the
 * code would go to a server somewhere, and that is what the whole handshake
 * exists to prevent.
 */
export function isAllowedRedirect(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password || url.hash) return false;
	if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
	if (DANGEROUS_SCHEMES.has(url.protocol)) return false;
	return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** What a person is shown of the place the browser goes next. */
export function redirectHostOf(value: string): string {
	try {
		const url = new URL(value);
		return url.host || url.protocol;
	} catch {
		return "unknown";
	}
}

function sign(payload: string): string {
	return createHmac("sha256", read().secret).update(payload).digest().subarray(0, 16).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

type ClientIdentity = { name: string; redirectUris: string[] };

/**
 * Registering a client costs nothing here: its name and where it may be sent
 * are written into the id and signed. A program that registers a thousand
 * times fills nothing, and a client that registered before a restart is still
 * known after it.
 */
export function registerClient(input: { clientName?: unknown; redirectUris?: unknown }): {
	clientId: string;
	clientName: string;
	redirectUris: string[];
} {
	const uris = Array.isArray(input.redirectUris) ? input.redirectUris : [];
	if (uris.length === 0 || uris.length > MAX_REDIRECTS_PER_CLIENT || uris.some((uri) => typeof uri !== "string")) {
		throw new OAuthError("invalid_redirect_uri", "Give between one and five redirect addresses.");
	}
	for (const uri of uris as string[]) {
		if (!isAllowedRedirect(uri)) {
			throw new OAuthError(
				"invalid_redirect_uri",
				"Juno only sends a client back to this machine, or to an app address the client registered.",
			);
		}
	}
	const clientName = cleanName(input.clientName);
	const redirectUris = [...new Set(uris as string[])];
	const payload = Buffer.from(JSON.stringify({ n: clientName, r: redirectUris })).toString("base64url");
	return { clientId: `jc1.${payload}.${sign(payload)}`, clientName, redirectUris };
}

export function readClientId(clientId: unknown): ClientIdentity | null {
	if (typeof clientId !== "string" || clientId.length > 4000) return null;
	const parts = clientId.split(".");
	if (parts.length !== 3 || parts[0] !== "jc1") return null;
	if (!safeEqual(sign(parts[1]), parts[2])) return null;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		if (!isRecord(parsed) || !Array.isArray(parsed.r) || parsed.r.some((uri) => typeof uri !== "string")) return null;
		return { name: cleanName(parsed.n), redirectUris: parsed.r as string[] };
	} catch {
		return null;
	}
}

/* ----------------------------------------------------------------- pairing */

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

function describe(pairing: Pairing): PairingRequest {
	return {
		id: pairing.id,
		clientName: pairing.clientName,
		redirectHost: redirectHostOf(pairing.redirectUri),
		createdAt: new Date(pairing.createdAt).toISOString(),
		expiresAt: new Date(pairing.expiresAt).toISOString(),
		attemptsLeft: pairing.attemptsLeft,
	};
}

function redirectWith(pairing: Pairing, params: Record<string, string>): string {
	const url = new URL(pairing.redirectUri);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	if (pairing.state !== null) url.searchParams.set("state", pairing.state);
	return url.toString();
}

function sweep(): void {
	const at = now();
	for (const [id, pairing] of pairings) {
		if (pairing.status === "waiting" && at > pairing.expiresAt) expire(pairing);
		if (pairing.decidedAt !== null && at - pairing.decidedAt > DECIDED_TTL_MS) pairings.delete(id);
	}
	for (const [code, issued] of issuedCodes) if (at > issued.expiresAt) issuedCodes.delete(code);
}

function expire(pairing: Pairing): void {
	if (pairing.status !== "waiting") return;
	pairing.status = "expired";
	pairing.decidedAt = now();
	pairing.redirect = redirectWith(pairing, { error: "access_denied", error_description: "The request timed out." });
	if (pairing.timer) clearTimeout(pairing.timer);
	pairing.timer = null;
	emitChange();
}

/**
 * A client has sent the person's browser here. Returns what the page shows.
 *
 * The code is made here and is only ever returned to the caller that is about
 * to draw it in the browser. The prompt in the app is given a request with no
 * code in it.
 */
export function beginPairing(input: {
	clientId: unknown;
	redirectUri: unknown;
	codeChallenge: unknown;
	codeChallengeMethod: unknown;
	state: unknown;
}): { pairingId: string; code: string; clientName: string; expiresAt: string } {
	sweep();

	const identity = readClientId(input.clientId);
	if (!identity) throw new OAuthError("invalid_client", "This client is not known to Juno. Connect it again.", 401);
	if (typeof input.redirectUri !== "string" || !identity.redirectUris.includes(input.redirectUri)) {
		throw new OAuthError("invalid_request", "That redirect address is not the one the client registered.");
	}
	if (input.codeChallengeMethod !== "S256" || typeof input.codeChallenge !== "string" || !CHALLENGE_PATTERN.test(input.codeChallenge)) {
		throw new OAuthError("invalid_request", "The client has to send a PKCE challenge, made with S256.");
	}
	const state = typeof input.state === "string" && input.state.length <= 2000 ? input.state : null;

	const waiting = [...pairings.values()].filter((pairing) => pairing.status === "waiting").length;
	if (waiting >= MAX_WAITING) {
		throw new OAuthError(
			"temporarily_unavailable",
			"Several connection requests are already waiting in Juno. Answer or deny them first.",
			503,
		);
	}

	const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
	const pairing: Pairing = {
		id: randomBytes(16).toString("hex"),
		clientId: input.clientId as string,
		clientName: identity.name,
		redirectUri: input.redirectUri,
		state,
		codeChallenge: input.codeChallenge,
		code,
		createdAt: now(),
		expiresAt: now() + PAIRING_TTL_MS,
		attemptsLeft: PAIRING_ATTEMPTS,
		status: "waiting",
		redirect: null,
		decidedAt: null,
		timer: null,
	};
	// Unref'd, so a request nobody answers cannot keep the process alive.
	pairing.timer = setTimeout(() => expire(pairing), PAIRING_TTL_MS + 50);
	pairing.timer.unref();
	pairings.set(pairing.id, pairing);

	emitChange();
	for (const listener of requestListeners) listener(describe(pairing));
	return { pairingId: pairing.id, code, clientName: pairing.clientName, expiresAt: new Date(pairing.expiresAt).toISOString() };
}

/** What the browser page asks while it waits. */
export function pairingStatus(
	pairingId: unknown,
): { status: "waiting" } | { status: "done"; redirect: string; denied: boolean } | { status: "unknown" } {
	sweep();
	const pairing = typeof pairingId === "string" ? pairings.get(pairingId) : undefined;
	if (!pairing) return { status: "unknown" };
	if (pairing.status === "waiting" || pairing.redirect === null) return { status: "waiting" };
	return { status: "done", redirect: pairing.redirect, denied: pairing.status !== "approved" };
}

/** The requests the prompt in the app shows, oldest first. No code in them. */
export function listPairings(): PairingRequest[] {
	sweep();
	return [...pairings.values()]
		.filter((pairing) => pairing.status === "waiting")
		.sort((a, b) => a.createdAt - b.createdAt)
		.map(describe);
}

function digitsOf(value: unknown): string {
	return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

/** A person typed what the browser showed. */
export function answerPairing(pairingId: string, typed: string): PairingAnswer {
	sweep();
	const pairing = pairings.get(pairingId);
	if (!pairing || pairing.status === "approved" || pairing.status === "denied") {
		return { accepted: false, reason: "unknown", attemptsLeft: 0 };
	}
	if (pairing.status === "expired") return { accepted: false, reason: "expired", attemptsLeft: 0 };

	const entered = digitsOf(typed);
	if (entered.length === 6 && safeEqual(entered, pairing.code)) {
		const authCode = randomBytes(32).toString("base64url");
		issuedCodes.set(authCode, {
			clientId: pairing.clientId,
			clientName: pairing.clientName,
			redirectUri: pairing.redirectUri,
			codeChallenge: pairing.codeChallenge,
			expiresAt: now() + AUTH_CODE_TTL_MS,
		});
		pairing.status = "approved";
		pairing.decidedAt = now();
		pairing.redirect = redirectWith(pairing, { code: authCode });
		if (pairing.timer) clearTimeout(pairing.timer);
		pairing.timer = null;
		emitChange();
		return { accepted: true, clientName: pairing.clientName };
	}

	pairing.attemptsLeft -= 1;
	if (pairing.attemptsLeft <= 0) {
		decide(pairing, "denied", "The code was entered wrongly too many times.");
		return { accepted: false, reason: "too-many-attempts", attemptsLeft: 0 };
	}
	emitChange();
	return { accepted: false, reason: "wrong-code", attemptsLeft: pairing.attemptsLeft };
}

function decide(pairing: Pairing, status: "denied", description: string): void {
	pairing.status = status;
	pairing.decidedAt = now();
	pairing.redirect = redirectWith(pairing, { error: "access_denied", error_description: description });
	if (pairing.timer) clearTimeout(pairing.timer);
	pairing.timer = null;
	emitChange();
}

export function denyPairing(pairingId: string): void {
	const pairing = pairings.get(pairingId);
	if (!pairing || pairing.status !== "waiting") return;
	decide(pairing, "denied", "It was denied in Juno.");
}

/* ------------------------------------------------------------------ tokens */

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
	return `juno_${randomBytes(32).toString("base64url")}`;
}

function publicOf(row: StoredConnection): AgentConnection {
	return { id: row.id, name: row.name, kind: row.kind, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt };
}

function addConnection(name: string, kind: AgentConnection["kind"]): { row: StoredConnection; token: string } {
	const current = read();
	const token = newToken();
	const row: StoredConnection = {
		id: randomBytes(8).toString("hex"),
		name: cleanName(name),
		kind,
		tokenHash: hashToken(token),
		createdAt: new Date(now()).toISOString(),
		lastUsedAt: null,
	};
	write({ ...current, connections: [...current.connections, row] });
	emitChange();
	return { row, token };
}

/**
 * The client comes back with the code from the redirect and the secret it made
 * before it started. The code is single use, and spent even when this fails, so
 * a guess cannot be retried against it.
 */
export function exchangeCode(input: {
	code: unknown;
	clientId: unknown;
	redirectUri: unknown;
	codeVerifier: unknown;
}): { accessToken: string; connection: AgentConnection } {
	sweep();
	const key = typeof input.code === "string" ? input.code : "";
	const issued = issuedCodes.get(key);
	issuedCodes.delete(key);
	if (!issued) throw new OAuthError("invalid_grant", "That code was not issued, or it has already been used.");
	if (input.clientId !== issued.clientId || input.redirectUri !== issued.redirectUri) {
		throw new OAuthError("invalid_grant", "That code was issued to a different client.");
	}
	if (typeof input.codeVerifier !== "string" || !VERIFIER_PATTERN.test(input.codeVerifier)) {
		throw new OAuthError("invalid_request", "The PKCE verifier is missing or malformed.");
	}
	const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
	if (!safeEqual(challenge, issued.codeChallenge)) {
		throw new OAuthError("invalid_grant", "The PKCE verifier does not match the challenge.");
	}
	const { row, token } = addConnection(issued.clientName, "signed-in");
	return { accessToken: token, connection: publicOf(row) };
}

/** A token for a client that cannot do the handshake. The only time it is readable. */
export function createToken(name: string): AgentTokenCreated {
	const { row, token } = addConnection(name, "token");
	return { connection: publicOf(row), token };
}

/** Who a token belongs to, or null. The token is never stored, only its hash. */
export function verifyToken(token: unknown): AgentConnection | null {
	if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
	const current = read();
	const hash = hashToken(token);
	const row = current.connections.find((candidate) => candidate.tokenHash === hash);
	if (!row) return null;

	const last = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0;
	if (now() - last >= LAST_USED_GRANULARITY_MS) {
		row.lastUsedAt = new Date(now()).toISOString();
		try {
			write({ ...current });
		} catch {
			// A time that could not be written is not a reason to refuse a valid token.
		}
	}
	return publicOf(row);
}

export function list(): AgentConnection[] {
	return read()
		.connections.map(publicOf)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revoke(id: string): void {
	const current = read();
	if (!current.connections.some((row) => row.id === id)) {
		throw new Error("That connection is already gone.");
	}
	write({ ...current, connections: current.connections.filter((row) => row.id !== id) });
	emitChange();
}
