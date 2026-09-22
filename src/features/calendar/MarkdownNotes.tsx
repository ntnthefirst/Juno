import type { AnchorHTMLAttributes, HTMLAttributes, OlHTMLAttributes, ReactNode } from "react";
import Markdown from "markdown-to-jsx";

type MarkdownNotesProps = {
	text: string;
};

/**
 * A link in a note behaves exactly like a link in a mail message: it opens in
 * the real browser, never inside Juno. `target="_blank"` is what routes it
 * through `hardenWindow`'s `setWindowOpenHandler` in main/windows/chrome.ts,
 * which only lets an `https:` or `mailto:` address through. Nothing here
 * grants a note any capability a message body does not already have.
 */
function NoteLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
	return (
		<a
			{...rest}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]"
		>
			{children}
		</a>
	);
}

function Paragraph({ children, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
	return (
		<p {...rest} className="mb-2 last:mb-0">
			{children}
		</p>
	);
}

function Strong({ children, ...rest }: HTMLAttributes<HTMLElement>) {
	return (
		<strong {...rest} className="font-[var(--weight-semibold)]">
			{children}
		</strong>
	);
}

function BulletList({ children, ...rest }: HTMLAttributes<HTMLUListElement>) {
	return (
		<ul {...rest} className="mb-2 ml-5 list-disc space-y-0.5 last:mb-0">
			{children}
		</ul>
	);
}

function NumberedList({ children, ...rest }: OlHTMLAttributes<HTMLOListElement>) {
	return (
		<ol {...rest} className="mb-2 ml-5 list-decimal space-y-0.5 last:mb-0">
			{children}
		</ol>
	);
}

function InlineCode({ children, ...rest }: HTMLAttributes<HTMLElement>) {
	return (
		<code
			{...rest}
			className="rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1 py-0.5 font-mono text-[length:var(--text-micro)]"
		>
			{children}
		</code>
	);
}

function Quote({ children, ...rest }: HTMLAttributes<HTMLQuoteElement>) {
	return (
		<blockquote {...rest} className="mb-2 border-l-2 border-[var(--line)] pl-3 text-[var(--ink-muted)] last:mb-0">
			{children}
		</blockquote>
	);
}

function Heading({ children, ...rest }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
	return (
		<p {...rest} className="mb-1 font-[var(--weight-semibold)] text-[var(--ink)]">
			{children}
		</p>
	);
}

/**
 * Notes, rendered as Markdown so a link is clickable instead of typed out in
 * full. Raw HTML in the source is left as plain text rather than parsed: a
 * note is short, typed text, not a document that needs `<div>` or `<iframe>`,
 * and leaving that door shut costs nothing here.
 */
export function MarkdownNotes({ text }: MarkdownNotesProps) {
	return (
		<Markdown
			options={{
				disableParsingRawHTML: true,
				overrides: {
					a: NoteLink,
					p: Paragraph,
					strong: Strong,
					ul: BulletList,
					ol: NumberedList,
					code: InlineCode,
					blockquote: Quote,
					h1: Heading,
					h2: Heading,
					h3: Heading,
					h4: Heading,
					h5: Heading,
					h6: Heading,
				},
			}}
		>
			{text}
		</Markdown>
	);
}
