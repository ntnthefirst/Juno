/**
 * Document templates laid out on the mail canvas, on paper of a fixed size.
 *
 * Pure and Electron-free, like document-layout.ts: the editor's model goes in,
 * the HTML the print pipeline takes comes out. The canvas compiler in
 * mail-layout.ts does the drawing; this file only turns a canvas of pages into
 * something a printer cuts at the right places:
 *
 * - `@page` is the paper, with no margin of its own. The margin is each page's
 *   padding, drawn on the canvas and edited like any other padding.
 * - Every page is printed at exactly the paper's size in millimetres, clips
 *   what runs past it, and breaks after itself, so a page on the canvas is a
 *   sheet in the PDF and never spills onto a sheet of its own.
 * - The room the canvas leaves between pages is taken away.
 *
 * A canvas template fills in its declared inputs and nothing else
 * (docs/templates.md): `{{document.<key>}}` for what a person or an agent
 * types, and `{{asset.<key>}}` for a picture the template carries.
 */
import type {
	DocumentCanvas,
	MailContainer,
	MailLayout,
	TemplateInput,
} from "../../shared/types";
import { normaliseCanvas, paperMm, toPaper } from "../../shared/paper";
import { compileLayout, normaliseLayout } from "./mail-layout";
import { escapeHtml, placeholdersIn } from "./template-render";

/** Reads a stored canvas back. Never throws: a canvas that cannot be read is no canvas. */
export function parseCanvas(json: string | null | undefined): DocumentCanvas | null {
	if (!json) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	return normaliseDocumentCanvas(raw);
}

/** The same checks, for a canvas that came over IPC or from an agent. */
export function normaliseDocumentCanvas(raw: unknown): DocumentCanvas | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	const layout = normaliseLayout(value.layout);
	if (!layout) return null;
	return normaliseCanvas({ version: 1, paper: toPaper(value.paper), layout });
}

export function serialiseCanvas(canvas: DocumentCanvas | null): string | null {
	return canvas ? JSON.stringify(canvas) : null;
}

/**
 * The canvas as it is printed: each page the paper's size in millimetres,
 * nothing between them, and a break after every one but the last.
 *
 * Written as custom CSS on the page, which the compiler puts after every
 * control's own declaration, so it wins over the pixel size the canvas draws
 * the page at. The pixel size is rounded and the paper is not, and a page a
 * fraction of a pixel too tall is a blank sheet after it.
 */
function forPrint(canvas: DocumentCanvas): MailLayout {
	const { width, height } = paperMm(canvas.paper);
	const pages = canvas.layout.children.filter((node): node is MailContainer => node.kind === "container");
	return {
		...canvas.layout,
		widthMode: "fixed",
		customCss: `width:${width}mm;max-width:none;margin:0`,
		children: pages.map((page, index) => {
			const last = index === pages.length - 1;
			const sheet = [
				`width:${width}mm`,
				`height:${height}mm`,
				"min-height:0",
				"max-width:none",
				"overflow:hidden",
				last ? "break-after:auto" : "break-after:page",
			].join(";");
			return {
				...page,
				box: {
					...page.box,
					margin: { top: 0, right: 0, bottom: 0, left: 0 },
					customCss: page.box.customCss ? `${page.box.customCss};${sheet}` : sheet,
				},
			};
		}),
	};
}

/**
 * What a canvas document is printed in.
 *
 * The canvas draws a page the way a mail client draws a message: Inter at 15
 * pixels, the browser's own heading sizes and paragraph margins. The document
 * stylesheet (document-style.ts) styles a contract written as HTML, with its
 * own sizes, so it is put back to the browser's inside the sheets. `revert`
 * goes back to the browser's stylesheet, and every style the compiler writes
 * is inline, so it still wins.
 */
function sheetCss(canvas: DocumentCanvas): string {
	const { width, height } = paperMm(canvas.paper);
	return [
		`@page{size:${width}mm ${height}mm;margin:0}`,
		".juno-sheets{font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#16161d}",
		".juno-sheets :where(p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,hr,dl,dd,pre){margin:revert;padding:revert;font-size:revert;line-height:revert}",
		".juno-sheets :where(h1,h2,h3,h4,h5,h6){font-weight:revert;letter-spacing:revert}",
		".juno-sheets :where(img){display:block;max-width:100%}",
		// Each sheet keeps its fill when printed, rather than the printer's
		// choice to save ink.
		".juno-sheets *{-webkit-print-color-adjust:exact;print-color-adjust:exact}",
	].join("");
}

/**
 * The body a canvas template is stored and rendered as. `fontCss` is the
 * `@font-face` rules for the Google fonts it uses, with the files inline, when
 * they could be fetched: a PDF is printed offline and has to carry its type.
 */
export function compileCanvas(canvas: DocumentCanvas, inputs: TemplateInput[] = [], fontCss = ""): string {
	const normal = normaliseCanvas(canvas);
	const fonts = fontCss ? `<style>${fontCss}</style>` : "";
	return `<style>${sheetCss(normal)}</style>${fonts}<div class="juno-sheets">${compileLayout(forPrint(normal), inputs)}</div>`;
}

/**
 * Every placeholder in a compiled canvas that is not one of its own inputs or
 * pictures. A canvas template is filled in by hand and nothing in it comes
 * from a record, so `{{client.name}}` in one is a mistake to catch when it is
 * saved, rather than a gap found in a PDF.
 */
export function foreignPlaceholders(bodyHtml: string, inputs: TemplateInput[]): string[] {
	const keys = new Set(inputs.map((input) => input.key));
	return placeholdersIn(bodyHtml).filter((path) => {
		const [root, key, ...rest] = path.split(".");
		if (rest.length > 0 || !key) return true;
		if (root === "asset") return false;
		return !(root === "document" && keys.has(key));
	});
}

/** Throws when a canvas template refers to anything it does not fill in itself. */
export function assertOwnPlaceholders(bodyHtml: string, inputs: TemplateInput[]): void {
	const foreign = foreignPlaceholders(bodyHtml, inputs);
	if (foreign.length === 0) return;
	const list = foreign.map((path) => `{{${path}}}`).join(", ");
	throw new Error(
		`This template uses ${list}, which it does not ask for. A document template fills in only its own ` +
			"inputs, so add an input for each value and write it as {{document.<key>}}.",
	);
}

const IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** A picture value a person or an agent supplied: the bytes inline, never an address. */
export function isImageData(value: string): boolean {
	return IMAGE_DATA.test(value.trim());
}

/**
 * Stands in for a picture input left empty. A missing value has to be visible
 * (template-render.ts), but the marker is markup and would break the `src` it
 * landed in, so a picture gets a picture of the marker instead.
 */
export function missingImage(path: string): string {
	const label = escapeHtml(`[ontbreekt: ${path}]`);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">` +
		`<rect x="1" y="1" width="318" height="78" fill="#ffe8e8" stroke="#b03030" stroke-width="2"/>` +
		`<text x="160" y="46" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="600" fill="#8f2020">${label}</text>` +
		`</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * What a canvas template is rendered against: the values typed for its inputs
 * and its own pictures. Nothing else, on purpose.
 *
 * A picture input takes the picture's bytes inline. Anything else typed into
 * one, an address included, is treated as empty: Juno does not fetch a file
 * because somebody named it (security.md section 2).
 */
export function canvasContext(
	inputs: TemplateInput[],
	values: Record<string, string>,
	assets: Record<string, string>,
): { context: Record<string, unknown>; missing: string[] } {
	const document: Record<string, string> = {};
	const missing: string[] = [];
	for (const input of inputs) {
		const value = (values[input.key] ?? "").trim();
		if (input.kind === "image") {
			if (isImageData(value)) {
				document[input.key] = value.replace(/\s+/g, "");
			} else {
				document[input.key] = missingImage(`document.${input.key}`);
				missing.push(input.key);
			}
			continue;
		}
		if (value) document[input.key] = value;
		else missing.push(input.key);
	}
	return { context: { document, asset: assets }, missing };
}
