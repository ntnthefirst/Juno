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
 * The address rules (https only, no login in it, a public host on every hop,
 * a size cap and a time limit) are ./public-fetch.ts, shared with calendar
 * subscriptions. What is particular to a picture is here: only the four
 * raster formats a mail client draws. SVG is refused because it can carry
 * script.
 *
 * Not an MCP tool, for the same reason as the fonts: an agent has no use for
 * the bytes, and "make Juno fetch this address" is not something it should be
 * able to ask.
 */
import type { PictureLoad } from "../../shared/types";
import { fetchPublic, PublicFetchError, type Fetcher, type Lookup } from "./public-fetch";

export { isPrivateAddress } from "./public-fetch";

const SIZE_LIMIT = 6 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

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

export async function loadPicture(address: string, fetcher?: Fetcher, resolve?: Lookup): Promise<PictureLoad> {
	const result = await fetchPublic(address, {
		label: address,
		what: "picture",
		accept: "image/png,image/jpeg,image/gif,image/webp",
		sizeLimit: SIZE_LIMIT,
		timeoutMs: TIMEOUT_MS,
		...(fetcher ? { fetcher } : {}),
		...(resolve ? { resolve } : {}),
	});
	// Nothing sent a validator, so a 304 is a server answering a question nobody asked.
	if (result.notModified) throw new PublicFetchError(`Juno did not load ${address}. The server answered 304.`);
	const type = sniffPicture(result.bytes);
	if (!type) throw new PublicFetchError(`Juno did not load ${address}. It is not a PNG, JPEG, GIF or WebP picture.`);
	return { address, dataUrl: `data:${type};base64,${Buffer.from(result.bytes).toString("base64")}` };
}
