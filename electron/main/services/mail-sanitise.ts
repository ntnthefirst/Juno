/**
 * Makes a message body safe to show. Runs in the main process, on every read,
 * so a stricter sanitiser applies to mail that was fetched before it existed.
 *
 * Rules from .claude/rules/security.md section 4, and how each is met:
 * - Scripts, frames, objects, forms and every `on*` attribute are gone. The
 *   allow-list below is what survives; nothing else does.
 * - No remote images by default. Every http(s) `src` becomes a placeholder and
 *   is counted, so the reader can offer to load them for this one message.
 * - Links do not navigate. The `href` is moved to `data-href` and collected,
 *   with its real target, for the reader to show and open after a protocol
 *   check. A click inside the frame does nothing.
 * - Styles survive because email layout is styles, but any declaration that
 *   could fetch (`url(`, `@import`) or run (`expression(`, `behavior`) is cut.
 *
 * The output is a complete document with its own CSP meta tag, served on its
 * own origin with the same policy as a header, in a frame with an empty
 * sandbox. Four layers, each of which would be enough on its own.
 */
import sanitizeHtml from "sanitize-html";

export interface SanitiseOptions {
	/** Keep http(s) image sources. Only ever set by a person, per message. */
	allowRemoteImages?: boolean;
	/** Inline attachments by Content-ID, as data URLs, for `cid:` references. */
	inlineImages?: Map<string, string>;
}

export interface SanitisedBody {
	/** A full HTML document, ready for a sandboxed frame. */
	document: string;
	/** How many http(s) images were replaced by a placeholder. */
	remoteImages: number;
	links: { href: string; text: string }[];
}

const BLOCKED_IMAGE =
	"data:image/svg+xml," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#e8e6e1"/></svg>',
	);

const ALLOWED_TAGS = [
	"a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite",
	"code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2",
	"h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p",
	"pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody",
	"td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "wbr",
];

const SHARED_ATTRIBUTES = [
	"style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height",
	"bgcolor", "color", "border", "cellpadding", "cellspacing", "colspan", "rowspan",
	"nowrap",
];

/** Anything in a style that reaches out or runs. Stripped declaration by declaration. */
const DANGEROUS_STYLE = /url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|javascript:|position\s*:\s*fixed/i;

function filterStyleAttribute(value: string): string {
	return value
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => declaration && !DANGEROUS_STYLE.test(declaration))
		.join("; ");
}

/**
 * The contents of every <style> block, with the dangerous parts cut. Kept as
 * one stylesheet in the head, because email layout depends on it and the
 * sanitiser would otherwise drop the whole element.
 */
export function extractStyles(html: string): { css: string; html: string } {
	const blocks: string[] = [];
	const stripped = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_match, css: string) => {
		blocks.push(css);
		return "";
	});
	const css = blocks
		.join("\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/@import[^;]*;?/gi, "")
		.replace(/@charset[^;]*;?/gi, "")
		.replace(/url\s*\([^)]*\)/gi, "none")
		.replace(/expression\s*\([^)]*\)/gi, "none")
		.replace(/behavior\s*:[^;}]*/gi, "")
		.replace(/-moz-binding\s*:[^;}]*/gi, "")
		.replace(/<\/?[a-z][^>]*>/gi, "");
	return { css, html: stripped };
}

const BASE_CSS = `
html, body { margin: 0; padding: 0; }
body { font: 14px/1.5 Inter, -apple-system, "Segoe UI", sans-serif; color: #1c1b19; background: #ffffff; padding: 16px; word-wrap: break-word; overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; }
a[data-href] { color: #28456c; text-decoration: underline; cursor: default; }
blockquote { margin: 8px 0 8px 8px; padding-left: 12px; border-left: 2px solid #d9d6cf; color: #5c5a55; }
pre { white-space: pre-wrap; }
table { max-width: 100%; }
`;

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function frameCsp(allowRemoteImages: boolean): string {
	return [
		"default-src 'none'",
		"style-src 'unsafe-inline'",
		allowRemoteImages ? "img-src data: https:" : "img-src data:",
		"form-action 'none'",
		"base-uri 'none'",
	].join("; ");
}

function decodeEntities(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

/** Every anchor that kept a target, with its visible text, deduplicated by target. */
function collectLinks(body: string): { href: string; text: string }[] {
	const seen = new Map<string, { href: string; text: string }>();
	for (const match of body.matchAll(/<a\b[^>]*\bdata-href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
		const href = decodeEntities(match[1] ?? "");
		const text = decodeEntities((match[2] ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
		const existing = seen.get(href);
		if (existing) {
			if (!existing.text && text) existing.text = text;
		} else {
			seen.set(href, { href, text });
		}
	}
	return [...seen.values()];
}

/** Sanitises an HTML body into a self-contained document. */
export function sanitiseHtml(raw: string, options: SanitiseOptions = {}): SanitisedBody {
	const { css, html } = extractStyles(raw);
	let remoteImages = 0;

	const body = sanitizeHtml(html, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: {
			"*": SHARED_ATTRIBUTES,
			a: ["data-href", "name"],
			img: ["src", "alt"],
			font: ["face", "size"],
			td: ["abbr"],
			th: ["abbr", "scope"],
		},
		allowedSchemes: ["http", "https", "mailto", "tel"],
		allowedSchemesByTag: { img: ["data", "cid", "http", "https"] },
		allowProtocolRelative: false,
		// The CSS in style="" is inspected by hand below; postcss would also
		// reject unusual but harmless email markup.
		parseStyleAttributes: false,
		disallowedTagsMode: "discard",
		nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head"],
		transformTags: {
			"*": (tagName, attribs) => {
				const next = { ...attribs };
				if (next.style !== undefined) {
					const filtered = filterStyleAttribute(next.style);
					if (filtered) next.style = filtered;
					else delete next.style;
				}
				return { tagName, attribs: next };
			},
			a: (tagName, attribs) => {
				const href = (attribs.href ?? "").trim();
				const next: Record<string, string> = {};
				for (const [key, value] of Object.entries(attribs)) {
					if (key !== "href") next[key] = value;
				}
				if (/^(https?:|mailto:|tel:)/i.test(href)) {
					next["data-href"] = href;
					next.title = href;
				}
				return { tagName, attribs: next };
			},
			img: (tagName, attribs) => {
				const src = (attribs.src ?? "").trim();
				const next: Record<string, string> = { ...attribs };
				if (/^https?:/i.test(src)) {
					if (!options.allowRemoteImages) {
						remoteImages += 1;
						next.src = BLOCKED_IMAGE;
						next.alt = attribs.alt || "Image not loaded";
					}
				} else if (/^cid:/i.test(src)) {
					const inline = options.inlineImages?.get(src.slice(4).replace(/^<|>$/g, ""));
					if (inline) next.src = inline;
					else delete next.src;
				} else if (/^data:image\//i.test(src)) {
					next.src = src;
				} else {
					delete next.src;
				}
				return { tagName, attribs: next };
			},
		},
		// An image with no source left is a hole; drop it rather than show a
		// broken-image icon for every tracking pixel.
		exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
	});

	const links = collectLinks(body);

	const document =
		"<!doctype html><html><head><meta charset=\"utf-8\">" +
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(frameCsp(Boolean(options.allowRemoteImages)))}">` +
		`<style>${BASE_CSS}</style><style>${css}</style></head><body>${body}</body></html>`;

	return { document, remoteImages, links };
}

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A plain-text body as a document, with the same frame rules and nothing else.
 *
 * Unlike an HTML message, which was designed for white and stays white, plain
 * text has no colours of its own, so it follows the theme. The frame sees the
 * same prefers-color-scheme as the window because nativeTheme is set with the
 * setting (decision 14).
 */
const TEXT_DARK_CSS =
	"@media (prefers-color-scheme: dark) { body { background: #1c1b19; color: #e8e6e1; } .q { color: #9a978f; } a[data-href] { color: #8fb0dc; } }";

export function textDocument(text: string): string {
	const body = text
		.split(/\r?\n/)
		.map((line) => (/^\s*>/.test(line) ? `<span class="q">${escapeText(line)}</span>` : escapeText(line)))
		.join("\n");
	return (
		"<!doctype html><html><head><meta charset=\"utf-8\">" +
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(frameCsp(false))}">` +
		`<style>${BASE_CSS} body { white-space: pre-wrap; } .q { color: #5c5a55; } ${TEXT_DARK_CSS}</style></head>` +
		`<body>${body}</body></html>`
	);
}
