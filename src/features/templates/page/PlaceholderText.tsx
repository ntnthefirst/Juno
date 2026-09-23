import type { ReactNode } from "react";

type PlaceholderTextProps = {
	text: string;
};

const PLACEHOLDER_RE = /\{\{\s*[^{}]+?\s*\}\}/g;

/**
 * Plain text with every `{{ path }}` token tinted, so the canvas reads as a
 * template rather than a filled document (docs/editors.md section 3: "the
 * canvas is a template, not a filled document"). Everything outside a token
 * is shown exactly as typed, including any inline markup characters, because
 * the canvas is not the place that interprets them.
 */
export function PlaceholderText({ text }: PlaceholderTextProps) {
	if (text.length === 0) return null;

	const tokens = text.match(PLACEHOLDER_RE) ?? [];
	const parts = text.split(PLACEHOLDER_RE);
	const nodes: ReactNode[] = [];

	parts.forEach((part, index) => {
		if (part) nodes.push(<span key={`t-${index}`}>{part}</span>);
		const token = tokens[index];
		if (token) {
			nodes.push(
				<span
					key={`p-${index}`}
					className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1 py-[1px] text-[var(--accent)]"
					style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em" }}
				>
					{token}
				</span>,
			);
		}
	});

	return <>{nodes}</>;
}
