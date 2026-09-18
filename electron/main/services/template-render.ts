/**
 * Fills a template body with values from a record.
 *
 * Pure, so it is tested without Electron or a database. The syntax is
 * deliberately tiny: a contract needs substitution and "leave this paragraph out
 * if there is no VAT number", and nothing else. Anything more would be a
 * programming language inside a legal document.
 *
 *   {{ client.name }}                  the value, HTML-escaped
 *   {{& client.name }}                 the value, raw. Opt in, and rarely right
 *   {{#if client.vatNumber }} ... {{/if}}      include when present and non-empty
 *   {{#unless client.vatNumber }} ... {{/unless}}
 *
 * Two rules that matter more than the syntax:
 *
 * 1. **Everything is escaped by default.** A client called `<script>` or a note
 *    containing markup must not become markup. Decision 19.
 * 2. **A missing value is visible, not blank.** A contract with an empty space
 *    where the VAT number should be is worse than one that says the VAT number
 *    is missing, because the blank gets signed and the marker gets noticed.
 */

export type TemplateContext = Record<string, unknown>;

export interface RenderResult {
	html: string;
	/** Paths the template asked for that had no value. */
	missing: string[];
	/** Paths that were substituted, for the audit trail. */
	used: string[];
}

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

const UNESCAPES: Record<string, string> = Object.fromEntries(
	Object.entries(ESCAPES).map(([char, entity]) => [entity, char]),
);

/** The inverse of escapeHtml, for a rendered value that is going into plain text. */
export function unescapeHtml(value: string): string {
	return value.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => UNESCAPES[entity] ?? entity);
}

function lookup(context: TemplateContext, path: string): unknown {
	return path
		.trim()
		.split(".")
		.reduce<unknown>((current, key) => {
			if (current === null || current === undefined) return undefined;
			if (typeof current !== "object") return undefined;
			return (current as Record<string, unknown>)[key];
		}, context);
}

function isBlank(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		(typeof value === "string" && value.trim() === "") ||
		(Array.isArray(value) && value.length === 0)
	);
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

/** The marker left where a value is missing. Styled by the document stylesheet. */
export function missingMarker(path: string): string {
	return `<span class="bureau-missing" data-field="${escapeHtml(path)}">[ontbreekt: ${escapeHtml(
		path,
	)}]</span>`;
}

const BLOCK = /\{\{#(if|unless)\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VALUE = /\{\{(&?)\s*([\w.]+)\s*\}\}/g;

export function render(template: string, context: TemplateContext): RenderResult {
	const missing = new Set<string>();
	const used = new Set<string>();

	// Blocks first, and repeatedly, so a conditional inside a conditional
	// resolves. Bounded, because a malformed template must not spin forever.
	let body = template;
	for (let pass = 0; pass < 10; pass++) {
		const next = body.replace(BLOCK, (_match, kind: string, path: string, inner: string) => {
			const present = !isBlank(lookup(context, path));
			const keep = kind === "if" ? present : !present;
			return keep ? inner : "";
		});
		if (next === body) break;
		body = next;
	}

	const html = body.replace(VALUE, (_match, raw: string, path: string) => {
		const value = lookup(context, path);
		if (isBlank(value)) {
			missing.add(path);
			return missingMarker(path);
		}
		used.add(path);
		const text = stringify(value);
		return raw === "&" ? text : escapeHtml(text);
	});

	return { html, missing: [...missing].sort(), used: [...used].sort() };
}

/** Every placeholder a template refers to, for showing what a template needs. */
export function placeholdersIn(template: string): string[] {
	const found = new Set<string>();
	for (const match of template.matchAll(VALUE)) found.add(match[2]!);
	for (const match of template.matchAll(BLOCK)) found.add(match[2]!);
	return [...found].sort();
}
