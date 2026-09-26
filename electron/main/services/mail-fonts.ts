/**
 * Fetches a Google font so the mail template canvas can paint with it.
 *
 * A message links its fonts and the recipient's client loads them. The editor
 * cannot do the same: the window's content policy loads styles and fonts from
 * Juno itself and nowhere else (security.md section 3), and that is not
 * loosened for a typeface. So the main process asks Google for the family,
 * downloads the files once, and hands the canvas `@font-face` rules with the
 * files written inline, which the policy already allows (`font-src data:`).
 *
 * The request is built from a family name, never from an address. The bridge
 * must not carry a URL for the main process to fetch (security.md section 2),
 * and a name that passes `toFamily` cannot become one: the only hosts this
 * file ever talks to are the two Google serves fonts from, and a file address
 * in the stylesheet that points anywhere else is refused.
 *
 * Only for the canvas. The message itself carries a plain link, built from
 * the same name by `googleFontHref`, and nothing fetched here is ever sent.
 *
 * Not an MCP tool, on purpose. What it returns is the bytes of a typeface for
 * a canvas to draw with, which an agent has no use for; what an agent does
 * need, putting a font on a template, is the layout's `fonts` field, and that
 * goes through `mail.templates.update` like every other edit.
 */
import type { GoogleFontLoad, GoogleFontRequest } from "../../shared/types";
import { googleFontHref, toFamily } from "./mail-layout";

type FontFetch = typeof fetch;

const STYLESHEET_HOST = "fonts.googleapis.com";
const FILE_HOST = "fonts.gstatic.com";

// A stylesheet is a few kilobytes and a Latin font file a few dozen. These are
// the sizes past which the answer is not a font, whatever it says it is.
const STYLESHEET_LIMIT = 256 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024;
const MAX_FILES = 24;

/**
 * Google decides the file format by who is asking: woff2 to a browser it
 * recognises, a TrueType several times the size to anything else. The canvas
 * is a Chromium window, so asking as one gets what it will actually use.
 */
const BROWSER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * The scripts a Belgian business writes in. Google splits every weight into a
 * file per script, and a Dutch letter only ever needs the Latin ones.
 */
const KEPT_SUBSETS = new Set(["latin", "latin-ext"]);

const WEIGHT_STEPS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);

/** One load per stylesheet for as long as the app runs. A failure is not kept. */
const loaded = new Map<string, Promise<GoogleFontLoad>>();

function unreachable(): Error {
	return new Error("Could not reach Google Fonts. Check your connection. Until it loads, the canvas shows the fallback.");
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
	const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
	if (Number.isFinite(declared) && declared > limit) throw unreachable();
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > limit) throw unreachable();
	return bytes;
}

type Face = { subset: string | null; rule: string };

/** Splits Google's answer into its `@font-face` rules, each with the script its comment names. */
function faces(css: string): Face[] {
	const found: Face[] = [];
	const rule = /(?:\/\*\s*([a-z-]+)\s*\*\/\s*)?(@font-face\s*\{[^}]*\})/g;
	for (const match of css.matchAll(rule)) {
		found.push({ subset: match[1] ?? null, rule: match[2] ?? "" });
	}
	return found;
}

function mimeFor(address: string, rule: string): string {
	if (/format\(['"]?woff2/.test(rule) || address.endsWith(".woff2")) return "font/woff2";
	if (/format\(['"]?woff['"]?\)/.test(rule) || address.endsWith(".woff")) return "font/woff";
	return "font/ttf";
}

async function inline(request: { family: string; weights: number[]; italic: boolean }, fetchImpl: FontFetch): Promise<GoogleFontLoad> {
	const href = googleFontHref(request.family, request.weights, request.italic);

	let response: Response;
	try {
		response = await fetchImpl(href, {
			headers: { "User-Agent": BROWSER_AGENT, Accept: "text/css" },
			signal: AbortSignal.timeout(8000),
		});
	} catch {
		throw unreachable();
	}
	// css2 answers 400 for a family it does not have and for a weight the
	// family lacks, and it does not say which.
	if (response.status === 400) {
		throw new Error(
			`Google Fonts has no ${request.family} in every weight you picked. Check the spelling of the name, or take off the weights it does not have.`,
		);
	}
	if (!response.ok) throw unreachable();

	const css = new TextDecoder().decode(await readLimited(response, STYLESHEET_LIMIT));
	const all = faces(css);
	const labelled = all.some((face) => face.subset !== null);
	const kept = labelled ? all.filter((face) => face.subset !== null && KEPT_SUBSETS.has(face.subset)) : all;
	if (kept.length === 0) {
		throw new Error(`Google Fonts sent nothing for ${request.family} in the Latin alphabet. Pick another family.`);
	}

	const rules: string[] = [];
	for (const face of kept.slice(0, MAX_FILES)) {
		// A font face has no use for an angle bracket. One in here would be the
		// start of markup in the preview document the rule is written into.
		if (/[<>]/.test(face.rule)) continue;
		const address = /url\((https:\/\/[^)\s'"]+)\)/.exec(face.rule)?.[1];
		if (!address) continue;
		// Only the host Google serves font files from. An address anywhere else
		// is not something this was asked to fetch.
		if (new URL(address).hostname !== FILE_HOST) continue;

		let file: Response;
		try {
			file = await fetchImpl(address, { headers: { "User-Agent": BROWSER_AGENT }, signal: AbortSignal.timeout(8000) });
		} catch {
			throw unreachable();
		}
		if (!file.ok) throw unreachable();
		const bytes = await readLimited(file, FILE_LIMIT);
		const data = `data:${mimeFor(address, face.rule)};base64,${Buffer.from(bytes).toString("base64")}`;
		rules.push(face.rule.replace(/url\([^)]*\)/, `url(${data})`));
	}
	if (rules.length === 0) throw unreachable();

	return { family: request.family, href, css: rules.join("\n") };
}

/**
 * A Google font, ready for the canvas: the stylesheet the message will link,
 * and the same faces with their files inline.
 */
export async function loadGoogleFont(request: GoogleFontRequest, fetchImpl: FontFetch = fetch): Promise<GoogleFontLoad> {
	const family = toFamily(request.family);
	if (!family) {
		throw new Error("That is not a font family name. Write it the way Google Fonts does, like Playfair Display.");
	}
	const weights = [...new Set(request.weights.filter((weight) => WEIGHT_STEPS.has(weight)))].sort((a, b) => a - b);
	const clean = { family, weights: weights.length > 0 ? weights : [400], italic: request.italic === true };
	if (new URL(googleFontHref(clean.family, clean.weights, clean.italic)).hostname !== STYLESHEET_HOST) {
		throw unreachable();
	}

	const key = googleFontHref(clean.family, clean.weights, clean.italic);
	const pending = loaded.get(key);
	if (pending) return pending;

	const attempt = inline(clean, fetchImpl);
	loaded.set(key, attempt);
	// A failed load is forgotten, so reconnecting and trying again works.
	attempt.catch(() => loaded.delete(key));
	return attempt;
}

/** For tests: every load starts cold. */
export function forgetLoadedFonts(): void {
	loaded.clear();
}
