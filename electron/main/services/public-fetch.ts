/**
 * Fetching an address someone typed, from the main process, without letting
 * that address reach this machine or its network.
 *
 * Two things in Juno do this: a picture a mail template links, after the
 * person confirmed its source (./mail-pictures.ts), and a calendar Juno
 * subscribes to (./calendar-subscriptions.ts). Both go through here, so the
 * rules are written once (security.md section 2):
 *
 * - https only, and no login in the address;
 * - the host has to resolve to a public address, checked again on every
 *   redirect, so a public page cannot bounce the request onto 127.0.0.1 or
 *   the router;
 * - a time limit, a cap on redirects and a cap on the body, counted while it
 *   arrives so a server that never says how long it is cannot fill memory.
 *
 * What it does not stop: a name that resolves to a public address when it is
 * checked and to a private one a moment later, when the request is made. That
 * needs the connection pinned to the checked address, which `fetch` does not
 * offer. The window is milliseconds and the request carries nothing secret of
 * Juno's.
 *
 * Every error names the address by `label`, which the caller chooses. A
 * calendar passes its host only, because a secret calendar address must not
 * end up in an error line the window shows or the database keeps.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Lookup = (host: string) => Promise<{ address: string }[]>;
export type Fetcher = typeof fetch;

export const defaultLookup: Lookup = (host) => lookup(host, { all: true });

const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local and other addresses nothing public is on. */
export function isPrivateAddress(address: string): boolean {
	if (isIP(address) === 6) {
		const lower = address.toLowerCase();
		if (lower === "::1" || lower === "::") return true;
		if (lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower)) return true;
		const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
		return mapped ? isPrivateAddress(mapped[1]!) : false;
	}
	const [a = 0, b = 0] = address.split(".").map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) ||
		a >= 224
	);
}

/** The error every refusal is, so a caller can tell this apart from its own. */
export class PublicFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PublicFetchError";
	}
}

function refused(label: string, why: string): PublicFetchError {
	return new PublicFetchError(`Juno did not load ${label}. ${why}`);
}

async function assertPublic(url: URL, label: string, resolve: Lookup): Promise<void> {
	if (url.protocol !== "https:") throw refused(label, "Only https addresses can be loaded.");
	if (url.username || url.password) throw refused(label, "An address with a login in it cannot be loaded.");
	const host = url.hostname.replace(/^\[|\]$/g, "");
	let addresses: string[];
	try {
		addresses = isIP(host) ? [host] : (await resolve(host)).map((entry) => entry.address);
	} catch {
		throw refused(label, "The server name could not be found. Check the address.");
	}
	if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
		throw refused(label, "It points at a private address on this network, not at the internet.");
	}
}

export interface PublicFetchOptions {
	/** How errors name the address. The address itself, or only its host when the address is a secret. */
	label: string;
	/** What is being fetched, for the size message: "picture", "calendar". */
	what: string;
	accept: string;
	sizeLimit: number;
	timeoutMs: number;
	/** Extra request headers, such as If-None-Match. Never a credential of Juno's. */
	headers?: Record<string, string>;
	fetcher?: Fetcher;
	resolve?: Lookup;
}

export type PublicFetchResult =
	| { notModified: true; headers: Headers }
	| { notModified: false; bytes: Uint8Array; headers: Headers };

function megabytes(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Reads a body, giving up as soon as it passes the cap rather than after it has all arrived. */
async function readCapped(response: Response, options: PublicFetchOptions): Promise<Uint8Array> {
	const tooLarge = () => refused(options.label, `The ${options.what} is larger than ${megabytes(options.sizeLimit)}.`);
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > options.sizeLimit) throw tooLarge();
	if (!response.body) return new Uint8Array(0);

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > options.sizeLimit) {
				await reader.cancel().catch(() => undefined);
				throw tooLarge();
			}
			chunks.push(value);
		}
	} catch (cause) {
		if (cause instanceof PublicFetchError) throw cause;
		throw refused(options.label, "The server stopped answering part way. Try again later.");
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * Fetches a public https address under the rules above. A 304 comes back as
 * `notModified`, for a caller that sent a validator; any other status that is
 * not a success is an error that says the status.
 */
export async function fetchPublic(address: string, options: PublicFetchOptions): Promise<PublicFetchResult> {
	const fetcher = options.fetcher ?? fetch;
	const resolve = options.resolve ?? defaultLookup;
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw refused(options.label, "That is not a web address.");
	}

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertPublic(url, options.label, resolve);
		let response: Response;
		try {
			response = await fetcher(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(options.timeoutMs),
				headers: { accept: options.accept, "user-agent": "Juno", ...options.headers },
			});
		} catch {
			throw refused(options.label, "The server did not answer. Check your connection and the address.");
		}
		if (response.status === 304) return { notModified: true, headers: response.headers };
		if (response.status >= 300 && response.status < 400) {
			const next = response.headers.get("location");
			if (!next) throw refused(options.label, "The server redirected without saying where.");
			url = new URL(next, url);
			continue;
		}
		if (response.status === 401 || response.status === 403) {
			throw refused(options.label, `The server refused it (${response.status}). The address may have been reset.`);
		}
		if (response.status === 404 || response.status === 410) {
			throw refused(options.label, `The server has nothing at that address (${response.status}).`);
		}
		if (!response.ok) throw refused(options.label, `The server answered ${response.status}.`);
		return { notModified: false, bytes: await readCapped(response, options), headers: response.headers };
	}
	throw refused(options.label, "It was redirected too many times.");
}
