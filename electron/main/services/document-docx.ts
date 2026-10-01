/**
 * A Word document turned into a document template laid out on paper.
 *
 * Mammoth reads the .docx into plain, semantic HTML (paragraphs, headings,
 * lists, tables, pictures), and that is read here into canvas blocks, one block
 * for each, so the result can be edited on the canvas like anything drawn on
 * it. Word's own look (its fonts, its exact spacing, its page layout) is not
 * carried across: the structure and the words are, and the pictures are kept
 * as pictures the template holds.
 *
 * A field in the text written as `{{ name }}` or `{{ document.name }}` becomes
 * an input the template asks for, so a contract already written with blanks
 * comes in ready to fill. Nothing else is filled in for it, which is the rule
 * for every canvas template (document-canvas.ts).
 *
 * Everything lands on the first page. The editor flows it onto as many pages
 * as it needs the first time it opens, because only a window that has drawn
 * the words knows how tall they are.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import mammoth from "mammoth";
import { parseDocument } from "htmlparser2";
import { assetToken, DEFAULT_PAPER, newPage, normaliseCanvas } from "../../shared/paper";
import type {
	DocumentCanvas,
	MailBlock,
	MailColumns,
	MailColumnsCell,
	MailNode,
	TemplateInput,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import * as assets from "./document-template-assets";
import * as templates from "./document-templates";
import { emptyBox, newBlock } from "./mail-layout";
import { escapeHtml } from "./template-render";

/** A Word file of a contract is well under this, pictures and all. */
export const MAX_DOCX_BYTES = 30 * 1024 * 1024;

type DomText = { type: "text"; data: string };
type DomElement = { type: "tag" | "script" | "style"; name: string; attribs: Record<string, string>; children: DomNode[] };
type DomNode = DomText | DomElement | { type: string; children?: DomNode[] };

function isElement(node: DomNode): node is DomElement {
	return node.type === "tag" && typeof (node as DomElement).name === "string";
}

function isText(node: DomNode): node is DomText {
	return node.type === "text";
}

const INLINE_TAGS = new Set(["strong", "b", "em", "i", "u", "s"]);

/**
 * The key a field written in the Word file becomes. Lowercase letters, digits
 * and underscores, starting with a letter, because that is all a key may be
 * (template-inputs.ts). Null for something that cannot become one.
 */
export function fieldKey(raw: string): string | null {
	const name = raw.trim().replace(/^document\./i, "");
	const key = name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!key) return null;
	return /^[a-z]/.test(key) ? key : `veld_${key}`;
}

const FIELD = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Collects the fields a piece of text names, and writes each as the input it becomes. */
class Fields {
	readonly found = new Map<string, string>();

	rewrite(text: string): string {
		return text.replace(FIELD, (whole, name: string) => {
			const key = fieldKey(name);
			if (!key) return whole;
			if (!this.found.has(key)) this.found.set(key, name.trim().replace(/^document\./i, ""));
			return `{{document.${key}}}`;
		});
	}

	inputs(): TemplateInput[] {
		return [...this.found].map(([key, label]) => ({ key, label: label || key, kind: "text", required: true }));
	}
}

function textOf(node: DomNode): string {
	if (isText(node)) return node.data;
	return (node.children ?? []).map(textOf).join("");
}

/** The words and inline marks of an element, as the markup a text block holds. */
function inlineHtml(node: DomNode, fields: Fields): string {
	if (isText(node)) return escapeHtml(fields.rewrite(node.data));
	if (!isElement(node)) return "";
	const inner = node.children.map((child) => inlineHtml(child, fields)).join("");
	if (node.name === "br") return "<br>";
	if (INLINE_TAGS.has(node.name)) return inner ? `<${node.name}>${inner}</${node.name}>` : "";
	if (node.name === "a") {
		const href = (node.attribs.href ?? "").trim();
		// A bookmark is an anchor with no address: its words stay, the anchor goes.
		return /^(https:|mailto:)/i.test(href) && inner ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
	}
	// A picture inside a paragraph is lifted out as a block of its own.
	if (node.name === "img") return "";
	return inner;
}

function imagesIn(node: DomNode): DomElement[] {
	if (!isElement(node)) return [];
	if (node.name === "img") return [node];
	return node.children.flatMap(imagesIn);
}

function textBlock(tag: "p" | "ul" | "ol", html: string): MailBlock {
	const block = newBlock("text");
	return { ...block, tag, html } as MailBlock;
}

function imageBlock(image: DomElement): MailBlock | null {
	const src = image.attribs.src ?? "";
	if (!src.startsWith("{{asset.")) return null;
	const block = newBlock("image");
	return { ...block, src, alt: image.attribs.alt ?? "" } as MailBlock;
}

function listItems(list: DomElement, fields: Fields): string {
	// Nested lists are flattened into the one list a text block can be, each
	// item keeping its own words.
	return list.children
		.filter(isElement)
		.flatMap((item) => {
			if (item.name !== "li") return [];
			const own = item.children.filter((child) => !(isElement(child) && (child.name === "ul" || child.name === "ol")));
			const nested = item.children.filter(
				(child): child is DomElement => isElement(child) && (child.name === "ul" || child.name === "ol"),
			);
			const words = own.map((child) => inlineHtml(child, fields)).join("").trim();
			return [words ? `<li>${words}</li>` : "", ...nested.map((inner) => listItems(inner, fields))];
		})
		.join("");
}

const CELL_STROKE = "#c8c9d4";

function tableNode(table: DomElement, fields: Fields): MailColumns | null {
	const rows: DomElement[] = [];
	const collect = (node: DomElement) => {
		for (const child of node.children) {
			if (!isElement(child)) continue;
			if (child.name === "tr") rows.push(child);
			else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") collect(child);
		}
	};
	collect(table);
	if (rows.length === 0) return null;

	return {
		id: globalThis.crypto.randomUUID(),
		kind: "columns",
		hidden: false,
		name: "Table",
		alignSelf: "auto",
		grow: 0,
		gap: 0,
		box: emptyBox(),
		actions: [],
		rows: rows.map((row) => ({
			id: globalThis.crypto.randomUUID(),
			cells: row.children
				.filter((cell): cell is DomElement => isElement(cell) && (cell.name === "td" || cell.name === "th"))
				.map((cell): MailColumnsCell => {
					const children = blocksOf(cell.children, fields);
					const header = cell.name === "th";
					return {
						id: globalThis.crypto.randomUUID(),
						width: null,
						verticalAlign: "top",
						box: {
							...emptyBox(),
							padding: { top: 6, right: 8, bottom: 6, left: 8 },
							borderWidth: 1,
							borderColor: CELL_STROKE,
						},
						actions: [],
						children: header
							? children.map((node) =>
									node.kind === "text" ? ({ ...node, text: { ...node.text, weight: "semibold" } } as MailNode) : node,
								)
							: children,
					};
				}),
		})),
	};
}

/** The blocks a run of elements becomes, in order. */
function blocksOf(nodes: DomNode[], fields: Fields): MailNode[] {
	const out: MailNode[] = [];
	for (const node of nodes) {
		if (isText(node)) {
			const words = node.data.trim();
			if (words) out.push(textBlock("p", escapeHtml(fields.rewrite(words))));
			continue;
		}
		if (!isElement(node)) continue;
		const name = node.name;
		if (/^h[1-6]$/.test(name)) {
			const block = newBlock("heading");
			const content = fields.rewrite(textOf(node)).trim();
			if (content) out.push({ ...block, tag: name as "h1", content } as MailBlock);
			continue;
		}
		if (name === "ul" || name === "ol") {
			const items = listItems(node, fields);
			if (items) out.push(textBlock(name, items));
			continue;
		}
		if (name === "table") {
			const table = tableNode(node, fields);
			if (table) out.push(table);
			continue;
		}
		if (name === "img") {
			const image = imageBlock(node);
			if (image) out.push(image);
			continue;
		}
		if (name === "p" || name === "div" || name === "blockquote") {
			const html = node.children.map((child) => inlineHtml(child, fields)).join("").trim();
			if (html && html !== "<br>") out.push(textBlock("p", html));
			for (const image of imagesIn(node)) {
				const block = imageBlock(image);
				if (block) out.push(block);
			}
			continue;
		}
		out.push(...blocksOf(node.children, fields));
	}
	return out;
}

/**
 * Reads Mammoth's HTML into a canvas on one page, and the inputs its fields
 * ask for. Pure apart from the ids, so a test can feed it HTML directly.
 */
export function canvasFromHtml(html: string): { canvas: DocumentCanvas; inputs: TemplateInput[] } {
	const fields = new Fields();
	const dom = parseDocument(html) as unknown as { children: DomNode[] };
	const children = blocksOf(dom.children, fields);
	const page = { ...newPage(DEFAULT_PAPER, "Page 1"), children };
	const canvas = normaliseCanvas({
		version: 1,
		paper: DEFAULT_PAPER,
		layout: {
			version: 2,
			width: 0,
			widthMode: "fixed",
			minHeight: 0,
			fill: null,
			fonts: [],
			customCss: null,
			children: [page],
			breakpoints: [],
		},
	});
	return { canvas, inputs: fields.inputs() };
}

function nameFrom(fileName: string): string {
	return fileName.replace(/[\\/]/g, "").replace(/\.docx$/i, "").trim() || "Imported document";
}

/**
 * A new template from a Word file's bytes. The template is written first,
 * because its pictures belong to it; if reading the file fails after that, the
 * half-made template is deleted again, so a bad file leaves nothing behind.
 */
export async function importDocx(
	input: { fileName: string; data: Uint8Array },
	db: Db = getDb(),
): Promise<templates.DocumentTemplate> {
	const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data as ArrayLike<number>);
	if (bytes.byteLength === 0) throw new Error("That Word file is empty. Choose another one.");
	if (bytes.byteLength > MAX_DOCX_BYTES) throw new Error("That Word file is larger than 30 MB. Make it smaller first.");
	// A .docx is a zip, and a zip starts with PK.
	if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
		throw new Error(`"${nameFrom(input.fileName)}" is not a Word document. Only .docx files can be imported, not .doc.`);
	}

	const template = await templates.create({ name: nameFrom(input.fileName) }, db);
	try {
		const result = await mammoth.convertToHtml(
			{ buffer: Buffer.from(bytes) },
			{
				// A Word file can link a picture from the network or the disk.
				// Juno fetches neither (security.md section 2).
				externalFileAccess: false,
				convertImage: mammoth.images.imgElement(async (image) => {
					try {
						const data = new Uint8Array(await image.readAsBuffer());
						const asset = await assets.add({ templateId: template.id, fileName: "picture", data }, db);
						return { src: assetToken(asset.id) };
					} catch {
						// A picture in a format a contract cannot carry (EMF, SVG) is left out.
						return { src: "" };
					}
				}),
			},
		);
		const { canvas, inputs } = canvasFromHtml(result.value);
		return await templates.update(template.id, { canvas, inputs }, db);
	} catch (cause) {
		await templates.remove(template.id, db);
		throw cause instanceof Error && /^That |^This template uses/.test(cause.message)
			? cause
			: new Error(`"${nameFrom(input.fileName)}" could not be read as a Word document. Open it in Word, save it again as .docx and try once more.`);
	}
}

/**
 * The same, from a file on this machine, for an agent working beside Juno. The
 * path is only read, never written to, and only a .docx is accepted.
 */
export async function importDocxFile(sourcePath: string, db: Db = getDb()): Promise<templates.DocumentTemplate> {
	if (!isAbsolute(sourcePath) || !/\.docx$/i.test(sourcePath)) {
		throw new Error("Give the absolute path to a .docx file.");
	}
	let size: number;
	try {
		size = statSync(sourcePath).size;
	} catch {
		throw new Error(`There is no file at ${sourcePath}. Check the path.`);
	}
	if (size > MAX_DOCX_BYTES) throw new Error(`"${basename(sourcePath)}" is larger than 30 MB. Make it smaller first.`);
	return importDocx({ fileName: basename(sourcePath), data: new Uint8Array(readFileSync(sourcePath)) }, db);
}
