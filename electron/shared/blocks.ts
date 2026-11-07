/**
 * The blocks a note and a page are written in.
 *
 * A note stores them as Markdown and a page as JSON, and both edit the same
 * list, so the editor is one component. Text inside a block is a small subset
 * of HTML (bold, italic, underline) so that one contentEditable line can hold
 * a mark; everything else is escaped, here, on both sides of the bridge.
 */

export type TextBlock = { id: string; type: "text" | "heading" | "bullet"; text: string };
export type CheckBlock = { id: string; type: "check"; text: string; done: boolean };
export type TableBlock = { id: string; type: "table"; header: string[]; rows: string[][] };
/**
 * A picture in a page. `path` is relative to the documents folder and always
 * `pages/<page id>/<file>`, a file the page's own folder holds (services/page-images.ts).
 * It is never a blob and never a path the renderer chose.
 */
export type ImageBlock = { id: string; type: "image"; path: string; alt: string };
export type Block = TextBlock | CheckBlock | TableBlock | ImageBlock;

/** The shape of an image's path: the page it belongs to, then a file the service named. */
export const IMAGE_PATH = /^pages\/([a-z0-9-]+)\/([a-z0-9-]+\.(?:png|jpg|gif|webp))$/;

/**
 * An address a link in a page may carry: https, or mailto. Anything else
 * (javascript:, data:, file:, a bare word) is refused, here and again at the
 * moment it is opened (security.md section 3). A bare domain is given https.
 */
export function safeLinkHref(raw: string): string | null {
	const text = raw.trim();
	if (text === "" || text.length > 2000 || /[\s<>"]/.test(text)) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : /^[^/@]+\.[^/@]+/.test(text) ? "https://" + text : null;
	if (!withScheme) return null;
	try {
		const url = new URL(withScheme);
		if (url.protocol === "https:" && url.hostname !== "") return url.href;
		if (url.protocol === "mailto:" && url.pathname !== "") return url.href;
	} catch {
		// Not an address.
	}
	return null;
}

export const MAX_BLOCKS = 2000;
const MAX_TEXT = 20_000;
const MAX_CELLS = 40;

let counter = 0;

/** An id that is unique inside one document, which is all a block needs. */
export function newBlockId(): string {
	counter += 1;
	return `b${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

const TAG = /<(\/?)(b|strong|i|em|u)\s*>|<a\s[^>]*>|<\/a\s*>|<[^>]*>|[^<]+|</gi;

const MARK = { strong: "b", em: "i", b: "b", i: "i", u: "u" } as const;

function escapeAttribute(text: string): string {
	return escapeHtml(text).replace(/"/g, "&quot;");
}

/** The address a tag carries, checked. Null when it has none or it is not one a page may link to. */
function hrefOf(tag: string): string | null {
	const match = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
	const value = match?.[1] ?? match?.[2];
	return value === undefined ? null : safeLinkHref(decodeEntities(value));
}

/** Keeps b, i, u and a link, drops every other tag, and escapes the text between them. */
export function sanitiseInline(html: string): string {
	const open = { b: false, i: false, u: false };
	let link = false;
	let out = "";
	for (const match of html.slice(0, MAX_TEXT).matchAll(TAG)) {
		const [token, slash, name] = match;
		if (/^<a\s/i.test(token)) {
			const href = link ? null : hrefOf(token);
			if (href) {
				link = true;
				out += '<a href="' + escapeAttribute(href) + '">';
			}
		} else if (/^<\/a\s*>/i.test(token)) {
			if (link) {
				link = false;
				out += "</a>";
			}
		} else if (name) {
			const tag = MARK[name.toLowerCase() as keyof typeof MARK];
			if (slash) {
				if (open[tag]) {
					open[tag] = false;
					out += `</${tag}>`;
				}
			} else if (!open[tag]) {
				open[tag] = true;
				out += `<${tag}>`;
			}
		} else if (token === "<") {
			out += "&lt;";
		} else if (token.startsWith("<")) {
			// Any other tag is dropped, its text stays.
		} else {
			out += escapeHtml(decodeEntities(token).replace(/\r?\n/g, " "));
		}
	}
	if (link) out += "</a>";
	for (const tag of ["u", "i", "b"] as const) if (open[tag]) out += `</${tag}>`;
	return out;
}

/** The words of a block with the marks taken off. */
export function plainText(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

function textBlock(type: TextBlock["type"], text: string): TextBlock {
	return { id: newBlockId(), type, text: escapeHtml(text) };
}

/** Markdown to blocks. Only the lines a note can hold are read: text, headings, bullets and checklists. */
export function parseMarkdown(markdown: string): Block[] {
	const blocks: Block[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		if (line.trim() === "") continue;
		const check = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/.exec(line);
		if (check) {
			blocks.push({ id: newBlockId(), type: "check", text: escapeHtml(check[2] ?? ""), done: check[1] !== " " });
			continue;
		}
		const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
		if (bullet) {
			blocks.push(textBlock("bullet", bullet[1] ?? ""));
			continue;
		}
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (heading) {
			blocks.push(textBlock("heading", heading[1] ?? ""));
			continue;
		}
		blocks.push(textBlock("text", line));
	}
	return blocks;
}

/** Blocks to Markdown. A mark is lost, which a note never carries. */
export function toMarkdown(blocks: Block[]): string {
	const lines: string[] = [];
	for (const block of blocks) {
		if (block.type === "table") {
			for (const row of [block.header, ...block.rows]) lines.push(row.join(" | "));
			continue;
		}
		if (block.type === "image") {
			if (block.alt.trim() !== "") lines.push(block.alt.trim());
			continue;
		}
		const text = plainText(block.text).replace(/\r?\n/g, " ");
		if (block.type === "check") lines.push(`- [${block.done ? "x" : " "}] ${text}`);
		else if (block.type === "bullet") lines.push(`- ${text}`);
		else if (block.type === "heading") lines.push(`# ${text}`);
		else lines.push(text);
	}
	// A blank text block at the end is the cursor's place, not content.
	return lines.join("\n").replace(/\s+$/, "");
}

/** The words of every block, for search and for a one-line preview. */
export function blocksText(blocks: Block[]): string {
	return blocks
		.map((block) =>
			block.type === "table" ? [block.header, ...block.rows].flat().join(" ") : block.type === "image" ? block.alt : plainText(block.text),
		)
		.filter((line) => line.trim() !== "")
		.join(" ");
}

/** The body a page keeps next to its blocks, so anything that reads a body still works. */
export function blocksToHtml(blocks: Block[]): string {
	let html = "";
	let list: "ul" | "checks" | null = null;
	const close = () => {
		if (list) html += "</ul>";
		list = null;
	};
	for (const block of blocks) {
		if (block.type === "bullet") {
			if (list !== "ul") {
				close();
				html += "<ul>";
				list = "ul";
			}
			html += `<li>${block.text}</li>`;
		} else if (block.type === "check") {
			if (list !== "checks") {
				close();
				html += '<ul style="list-style:none;padding-left:0">';
				list = "checks";
			}
			html += `<li>${block.done ? "&#9745;" : "&#9744;"} ${block.text}</li>`;
		} else {
			close();
			if (block.type === "heading") html += `<h2>${block.text}</h2>`;
			else if (block.type === "text") html += block.text.trim() === "" ? "" : `<p>${block.text}</p>`;
			else if (block.type === "image") html += block.alt.trim() === "" ? "" : "<p>" + escapeHtml(block.alt) + "</p>";
			else if (block.type === "table") {
				const head = block.header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
				const rows = block.rows
					.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
					.join("");
				html += `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
			}
		}
	}
	close();
	return html;
}

function cells(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, MAX_CELLS).map((cell) => (typeof cell === "string" ? cell.slice(0, 500) : ""));
}

/** Checks what arrived from the editor or an agent, and rebuilds only what is well formed. */
export function cleanBlocks(value: unknown): Block[] {
	if (!Array.isArray(value)) throw new Error("A page is a list of blocks.");
	if (value.length > MAX_BLOCKS) throw new Error(`A page can hold at most ${MAX_BLOCKS} blocks.`);
	const seen = new Set<string>();
	const out: Block[] = [];
	for (const raw of value) {
		if (typeof raw !== "object" || raw === null) continue;
		const item = raw as Record<string, unknown>;
		const type = item.type;
		if (type !== "table" && type !== "image" && type !== "check" && type !== "text" && type !== "heading" && type !== "bullet") continue;
		const wanted = typeof item.id === "string" ? item.id.slice(0, 60) : "";
		const id = wanted !== "" && !seen.has(wanted) ? wanted : newBlockId();
		seen.add(id);
		if (type === "image") {
			const path = typeof item.path === "string" ? item.path : "";
			// A path that is not one the image service makes is dropped, not repaired.
			if (!IMAGE_PATH.test(path)) continue;
			out.push({ id, type, path, alt: String(item.alt ?? "").slice(0, 300) });
		} else if (type === "table") {
			const header = cells(item.header);
			const rows = Array.isArray(item.rows) ? item.rows.slice(0, 500).map(cells) : [];
			out.push({ id, type, header, rows });
		} else if (type === "check") {
			out.push({ id, type, text: sanitiseInline(String(item.text ?? "")), done: item.done === true });
		} else {
			out.push({ id, type, text: sanitiseInline(String(item.text ?? "")) });
		}
	}
	return out;
}
