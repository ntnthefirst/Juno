/**
 * Downloads a picture a template links, once the person has said its source
 * can be trusted, so the editor and the previews can draw it.
 *
 * The window loads images from Juno and nowhere else (security.md section 3),
 * and that stays. What changes is who fetches: the main process does, for an
 * address the person confirmed in a dialog, and hands back the bytes inline
 * (`img-src data:` is already allowed). What is sent is untouched: the message
 * still carries the plain link, and nothing fetched here is stored or sent.
 *
 * This is the one place the bridge carries an address for the main process to
 * fetch, so it is narrow on purpose: https only, no credentials in the
 * address, a host that resolves to a public address on every hop, a size
 * cap, a time limit, and only the four raster formats a mail client draws.
 * SVG is refused because it can carry script.
 *
 * Not an MCP tool, for the same reason as the fonts: an agent has no use for
 * the bytes, and "make Juno fetch this address" is not something it should be
 * able to ask.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PictureLoad } from "../../shared/types";

const SIZE_LIMIT = 6 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

type Lookup = (host: string) => Promise<{ address: string }[]>;
type PictureFetch = typeof fetch;

const defaultLookup: Lookup = (host) => lookup(host, { all: true });

/** True for loopback, private, link-local and other addresses a public picture is never on. */
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

function refused(address: string, why: string): Error {
	return new Error(`Juno did not load ${address}. ${why}`);
}

/** The format the bytes really are, whatever the server called them. */
export function sniffPicture(bytes: Uint8Array): string | null {
	const at = (...values: number[]) => values.every((value, index) => bytes[index] === value);
	if (at(0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (at(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
		return "image/webp";
	}
	return null;
}

async function assertPublic(url: URL, address: string, resolve: Lookup): Promise<void> {
	if (url.protocol !== "https:") throw refused(address, "Only https addresses can be loaded.");
	if (url.username || url.password) throw refused(address, "An address with a login in it cannot be loaded.");
	const host = url.hostname.replace(/^\[|\]$/g, "");
	let addresses: string[];
	try {
		addresses = isIP(host) ? [host] : (await resolve(host)).map((entry) => entry.address);
	} catch {
		throw refused(address, "The server name could not be found. Check the address.");
	}
	if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
		throw refused(address, "It points at a private address on this network, not at the internet.");
	}
}

export async function loadPicture(
	address: string,
	fetcher: PictureFetch = fetch,
	resolve: Lookup = defaultLookup,
): Promise<PictureLoad> {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw refused(address, "That is not a web address.");
	}

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertPublic(url, address, resolve);
		let response: Response;
		try {
			response = await fetcher(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: { accept: "image/png,image/jpeg,image/gif,image/webp", "user-agent": "Juno" },
			});
		} catch {
			throw refused(address, "The server did not answer. Check your connection and the address.");
		}
		if (response.status >= 300 && response.status < 400) {
			const next = response.headers.get("location");
			if (!next) throw refused(address, "The server redirected without saying where.");
			url = new URL(next, url);
			continue;
		}
		if (!response.ok) throw refused(address, `The server answered ${response.status}.`);

		const declared = Number(response.headers.get("content-length") ?? 0);
		if (declared > SIZE_LIMIT) throw refused(address, "The picture is larger than 6 MB.");
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > SIZE_LIMIT) throw refused(address, "The picture is larger than 6 MB.");
		const type = sniffPicture(bytes);
		if (!type) throw refused(address, "It is not a PNG, JPEG, GIF or WebP picture.");
		return { address, dataUrl: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` };
	}
	throw refused(address, "It was redirected too many times.");
}
