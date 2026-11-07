/**
 * Variables in a message being written.
 *
 * In the composer a variable is a chip, never curly braces. A draft keeps the
 * chip as a marked span in its HTML and as a {{name}} token in its text, so it
 * can be reopened as a chip and can still be resolved after the recipient
 * changes. The values go in when the message is sent or its preview is drawn,
 * in the service, and nothing of the chip survives that.
 */
import type { ComposeBlockVariable } from "./types";
import { escapeHtml } from "./blocks";

export const VARIABLE_NAMES: readonly ComposeBlockVariable[] = [
	"client_name",
	"first_name",
	"project",
	"date",
	"my_name",
];

export const VARIABLE_LABELS: Record<ComposeBlockVariable, string> = {
	client_name: "Client name",
	first_name: "First name",
	project: "Project",
	date: "Date",
	my_name: "My name",
};

/** The attribute that marks a chip in a draft's HTML. */
export const VARIABLE_ATTRIBUTE = "data-juno-variable";

const NAMES = VARIABLE_NAMES.join("|");
const CHIP = new RegExp(`<span\\b[^>]*\\b${VARIABLE_ATTRIBUTE}="(${NAMES})"[^>]*>[^<]*</span>`, "gi");
const TOKEN = new RegExp(`\\{\\{(${NAMES})\\}\\}`, "g");

/** One chip as markup, the way a draft stores it. */
export function chipHtml(name: ComposeBlockVariable): string {
	return `<span ${VARIABLE_ATTRIBUTE}="${name}" contenteditable="false">${VARIABLE_LABELS[name]}</span>`;
}

/** A body with each chip written as its {{name}} token, for the plain text twin. */
export function chipsToTokens(html: string): string {
	return html.replace(CHIP, (_chip, name: string) => `{{${name}}}`);
}

/** The variables a message names, in order of first use, whether as a chip or as a token. */
export function variablesUsed(text: string, html: string | null): ComposeBlockVariable[] {
	const found: ComposeBlockVariable[] = [];
	const take = (name: string) => {
		const variable = name as ComposeBlockVariable;
		if (!found.includes(variable)) found.push(variable);
	};
	for (const match of (html ?? "").matchAll(CHIP)) take(match[1] ?? "");
	for (const match of (html ?? "").matchAll(TOKEN)) take(match[1] ?? "");
	for (const match of text.matchAll(TOKEN)) take(match[1] ?? "");
	return found;
}

export interface FilledBody {
	text: string;
	html: string | null;
	/** Variables the message names that have no value. */
	missing: ComposeBlockVariable[];
}

/**
 * The message with every variable replaced by its value: chips and tokens in
 * the HTML, tokens in the text. The text of an HTML message is escaped on its
 * way in, so a value can never add markup.
 */
export function fillVariables(
	body: { text: string; html: string | null },
	values: Record<ComposeBlockVariable, string>,
): FilledBody {
	const missing = variablesUsed(body.text, body.html).filter((name) => !values[name]?.trim());
	const value = (name: string) => values[name as ComposeBlockVariable] ?? "";
	return {
		text: body.text.replace(TOKEN, (_token, name: string) => value(name)),
		html:
			body.html === null
				? null
				: body.html
						.replace(CHIP, (_chip, name: string) => escapeHtml(value(name)))
						.replace(TOKEN, (_token, name: string) => escapeHtml(value(name))),
		missing,
	};
}

/** What the person is told when a variable has nothing to put in. */
export function missingMessage(missing: ComposeBlockVariable[]): string {
	const names = missing.map((name) => VARIABLE_LABELS[name]);
	const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
	return `${list} ${names.length === 1 ? "has" : "have"} no value for this message, so it was not sent. Fill in the recipient, client or project it comes from, or remove the chip.`;
}

/** A draft's text for reading on screen: each token as the label of its chip, never as braces. */
export function tokensToLabels(text: string): string {
	return text.replace(TOKEN, (_token, name: string) => VARIABLE_LABELS[name as ComposeBlockVariable]);
}
