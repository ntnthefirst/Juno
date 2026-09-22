/**
 * The house style for an outgoing HTML message, and the plain-text twin every
 * message carries.
 *
 * Email clients ignore stylesheets and CSS variables, so the brand's light
 * palette is inlined here as values. That is the one place raw colours are
 * allowed for the same reason document-style.ts has them: the output leaves
 * the app and cannot reach the tokens.
 *
 * Nothing in the shell fetches anything: no logo image, no web font, no pixel.
 * Read receipts and tracking are permanently out of scope (PLAN.md, phase 4).
 */
import { convert } from "html-to-text";
import { escapeHtml } from "./template-render";

// The light values from brand/tokens.css, written out rather than referenced.
// This stylesheet is inlined into a message that leaves the machine, so it
// cannot use a CSS variable the recipient's client has never heard of. Keep
// these in step with the tokens by hand; there is no build step that can.
const INK = "#16161d";
const INK_MUTED = "#5d5e70";
const LINE = "#e3e2ec";
const ACCENT = "#4a3fa0";
const PAPER = "#f6f6fa";
const SURFACE = "#ffffff";

const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface MailShellOptions {
	/** The footer line: business name, address, VAT number. Escaped here. */
	footerLines: string[];
}

/** Wraps a rendered body in the house shell. The body is trusted HTML from a template. */
export function mailShell(bodyHtml: string, options: MailShellOptions): string {
	const footer = options.footerLines
		.filter((line) => line.trim())
		.map((line) => escapeHtml(line))
		.join("<br>");
	return [
		'<!doctype html><html lang="nl-BE"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1"></head>',
		`<body style="margin:0;padding:0;background:${PAPER};">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">`,
		`<tr><td align="center" style="padding:24px 12px;">`,
		`<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${SURFACE};border:1px solid ${LINE};border-top:3px solid ${ACCENT};">`,
		`<tr><td style="padding:28px 32px;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};">`,
		bodyHtml,
		"</td></tr>",
		footer
			? `<tr><td style="padding:16px 32px 20px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;line-height:1.5;color:${INK_MUTED};">${footer}</td></tr>`
			: "",
		"</table></td></tr></table></body></html>",
	].join("");
}

/**
 * A plain-text message as HTML paragraphs in the shell. Typed text is not
 * markup: every line is escaped, blank lines make paragraphs, and a quoted
 * line stays a quoted line.
 */
export function textToHtml(text: string): string {
	const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
	return paragraphs
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map((paragraph) => {
			const quoted = paragraph.split("\n").every((line) => /^\s*>/.test(line));
			const lines = paragraph
				.split("\n")
				.map((line) => escapeHtml(quoted ? line.replace(/^\s*>\s?/, "") : line))
				.join("<br>");
			return quoted
				? `<blockquote style="margin:8px 0 8px 0;padding-left:12px;border-left:2px solid ${LINE};color:${INK_MUTED};">${lines}</blockquote>`
				: `<p style="margin:0 0 12px 0;">${lines}</p>`;
		})
		.join("");
}

/** The text alternative of an HTML body, for clients that show text and for the search. */
export function htmlToText(html: string): string {
	return convert(html, {
		wordwrap: 78,
		selectors: [
			{ selector: "a", options: { hideLinkHrefIfSameAsText: true } },
			{ selector: "img", format: "skip" },
			{ selector: "table", format: "dataTable" },
		],
	}).trim();
}

/** The quoted original under a reply, in the form every mail client writes. */
export function quoteForReply(original: { fromLine: string; sentAt: string; text: string }): string {
	const header = `Op ${original.sentAt} schreef ${original.fromLine}:`;
	const quoted = original.text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	return `${header}\n${quoted}`;
}
