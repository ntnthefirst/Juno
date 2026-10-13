/**
 * Pictures a message names by an address, in a window that will not fetch one.
 *
 * The message links its pictures and the reader's mail client loads them. This
 * window loads images from Juno and nowhere else (`img-src` in
 * electron/main/windows/chrome.ts, security.md section 3), and it is not
 * loosened for a logo: fetching an address somebody typed is what decision 36
 * refuses for fonts as well. So the canvas and every preview frame draw a box
 * where a remote picture goes, at its width, with its alt text and a line that
 * says whose job loading it is, the way the canvas says a linked font shows its
 * fallback. What is sent is never touched.
 */

export const REMOTE_IMAGE_NOTE = "Loaded by the reader's mail client, not by Juno.";

/** A picture Juno's own window may draw: bytes it already holds, never an address it would fetch. */
export function isDrawable(src: string): boolean {
	return /^(data:|blob:|app:)/i.test(src.trim());
}

/** Text that is safe inside an element or inside a double-quoted attribute. */
export function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeText(value: string): string {
	return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function attributeOf(tag: string, name: string): string | null {
	const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
	return match ? (match[1] ?? match[2] ?? "") : null;
}

/**
 * What stands where a remote picture would, in a document of its own. Painted
 * in the browser's own page colours (`Canvas` and `CanvasText`) so it reads
 * on whatever the message has behind it, and needs no value of its own.
 * `style` is the picture's own, already safe to sit inside a double-quoted
 * attribute.
 */
export function remotePlaceholder(alt: string, style: string): string {
	const own = style.trim().replace(/;+$/, "");
	// max-width keeps a box inside the column it stands in, so a narrow frame
	// does not grow a horizontal scrollbar around it.
	const frame =
		"box-sizing:border-box;max-width:100%;padding:8px 10px;border:1px dashed GrayText;background-color:Canvas;color:CanvasText;font-size:12px;line-height:1.4;overflow:hidden";
	const width = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(own);
	if (width && Number(width[1]) < 160) {
		// Too narrow for words: the text would wrap into a tall sliver. A plain
		// box at the picture's size, with the explanation on hover.
		const side = Math.round(Number(width[1]));
		const sized = /(?:^|;)\s*height\s*:/i.test(own) ? "" : `height:${side}px;`;
		return (
			`<span data-juno-remote-image="1" title="${escapeAttribute(`${alt || "Picture"}. ${REMOTE_IMAGE_NOTE}`)}" ` +
			`style="display:block;${sized}${own ? `${own};` : ""}${frame};padding:0"></span>`
		);
	}
	return (
		`<span data-juno-remote-image="1" style="display:block;${own ? `${own};` : ""}${frame}">` +
		`${escapeAttribute(alt || "Picture")}<br><span style="opacity:0.7">${escapeAttribute(REMOTE_IMAGE_NOTE)}</span></span>`
	);
}

/**
 * A rendered message with each picture Juno cannot draw swapped for its box.
 * The picture's own style stays on the box, so its width, margins and
 * alignment are still the ones the message gives it.
 */
export function withoutRemoteImages(html: string): string {
	const pictures = html.replace(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
		const src = attributeOf(tag, "src");
		if (src === null || isDrawable(unescapeText(src))) return tag;
		return remotePlaceholder(unescapeText(attributeOf(tag, "alt") ?? ""), sizedStyle(tag));
	});
	// Video, audio and embedded players are loaded by the reader's client too,
	// and this window would refuse them. Each becomes the same box.
	return pictures.replace(
		/<(video|audio|iframe|embed|object)\b(?:"[^"]*"|'[^']*'|[^'">])*>(?:[\s\S]*?<\/\1>)?/gi,
		(tag, name: string) => {
			const label = unescapeText(attributeOf(tag, "title") ?? "") || name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
			return remotePlaceholder(label, sizedStyle(tag));
		},
	);
}

/** The element's own style, plus the width and height it gave as attributes when the style does not. */
function sizedStyle(tag: string): string {
	const own = attributeOf(tag, "style") ?? "";
	let extra = "";
	for (const side of ["width", "height"] as const) {
		const value = attributeOf(tag, side);
		const declared = own.split(";").some((part) => part.trim().toLowerCase().startsWith(`${side}:`));
		if (value && /^\d+(?:\.\d+)?%?$/.test(value) && !declared) {
			extra += side + ":" + (value.endsWith("%") ? value : value + "px") + ";";
		}
	}
	return extra + own;
}
