/**
 * Turns a rendered document into a PDF.
 *
 * This is the only part of document generation that needs Electron, so it is
 * kept apart from documents.ts, which stays testable in plain Node. Signing
 * lives in pdf-sign.ts for the same reason.
 */
import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { documentShell } from "./document-style";

let documentsDir = "";

export function configureDocuments(directory: string): void {
	documentsDir = directory;
}

/** Where a file with this name is written. Only ever a name the service built. */
export function outputPathFor(fileName: string): string {
	return join(outputDir(), fileName);
}

function outputDir(): string {
	if (!documentsDir) {
		throw new Error("configureDocuments() was not called before a document was rendered.");
	}
	if (!existsSync(documentsDir)) mkdirSync(documentsDir, { recursive: true });
	return documentsDir;
}

/**
 * The document faces, inlined as data URIs. An offscreen window cannot see the
 * renderer's bundled assets, and a contract that falls back to a system font
 * looks different on every machine.
 */
let fontCss: string | null = null;

function embeddedFontCss(): string {
	if (fontCss !== null) return fontCss;
	const dir = join(__dirname, "..", "..", "fonts");
	const face = (file: string, weight: number) => {
		const path = join(dir, file);
		if (!existsSync(path)) return "";
		const base64 = readFileSync(path).toString("base64");
		return `@font-face{font-family:"Inter";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${base64}) format("woff2");}`;
	};
	fontCss =
		face("inter-latin-400-normal.woff2", 400) + face("inter-latin-600-normal.woff2", 600);
	return fontCss;
}

export interface RenderOptions {
	title: string;
	bodyHtml: string;
	isSpecimen: boolean;
	language?: string;
	fileName: string;
}

/**
 * Renders HTML to a PDF file and returns its path.
 *
 * The waiting matters. printToPDF on a window that has not finished loading
 * produces a blank or half-rendered page and does not error, which is the single
 * most likely way for this to fail silently. See .claude/rules/verify.md.
 */
export async function renderPdf(options: RenderOptions): Promise<string> {
	const html = documentShell({
		title: options.title,
		bodyHtml: options.bodyHtml,
		isSpecimen: options.isSpecimen,
		language: options.language,
	}).replace("<style>", `<style>${embeddedFontCss()}`);

	const window = new BrowserWindow({
		show: false,
		width: 900,
		height: 1200,
		webPreferences: {
			offscreen: true,
			// Nothing in a document may run. The body is rendered from the operator's
			// own template, but it quotes client data, and a contract has no reason
			// to execute anything.
			javascript: false,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	try {
		await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
		// loadURL resolves on did-finish-load, but layout with a just-decoded font
		// settles a frame later. Without this the first page can print in the
		// fallback face.
		await new Promise((resolve) => setTimeout(resolve, 350));

		const pdf = await window.webContents.printToPDF({
			pageSize: "A4",
			printBackground: true,
			// The stylesheet owns the margins through @page, so Electron adds none.
			margins: { marginType: "none" },
		});

		const path = join(outputDir(), options.fileName);
		writeFileSync(path, pdf);
		return path;
	} finally {
		// An offscreen window that is never closed leaks a renderer process, and
		// generating a few documents in a row would leave several running.
		if (!window.isDestroyed()) window.destroy();
	}
}

export function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
