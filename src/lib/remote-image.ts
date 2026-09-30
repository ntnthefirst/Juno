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
	const frame =
		"box-sizing:border-box;padding:8px 10px;border:1px dashed GrayText;background-color:Canvas;color:CanvasText;font-size:12px;line-height:1.4;overflow:hidden";
	const own = style.trim().replace(/;+$/, "");
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
	return html.replace(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
		const src = attributeOf(tag, "src");
		if (src === null || isDrawable(unescapeText(src))) return tag;
		return remotePlaceholder(unescapeText(attributeOf(tag, "alt") ?? ""), attributeOf(tag, "style") ?? "");
	});
}
