import type { ComposeBlockKind, ComposeBlockRule, ComposeBlockVariable } from "@shared/types";

/** The variables in the order the manage screen offers them. */
export const VARIABLE_ORDER: ComposeBlockVariable[] = ["client_name", "first_name", "project", "date", "my_name"];

export const VARIABLE_LABEL: Record<ComposeBlockVariable, string> = {
	client_name: "Client name",
	first_name: "First name",
	project: "Project",
	date: "Date",
	my_name: "My name",
};

/** Right-aligned in the composer menu: the rule in one or two words. */
export const RULE_SHORT: Record<ComposeBlockRule, string> = {
	manual: "Manual",
	client: "Clients",
	new_contact: "New contacts",
	reply: "Replies",
	project: "Projects",
};

/** One line under a block's name in the manage list. */
export const RULE_DESCRIPTION: Record<ComposeBlockRule, string> = {
	manual: "You add it yourself",
	client: "Added when you write to a client",
	new_contact: "Added when you write to someone who is not a client yet",
	reply: "Added when you reply",
	project: "Added when the mail is linked to a project",
};

/** The radio list headed "When to add it", in the order the design draws it. */
export const RULE_CHOICES: { rule: ComposeBlockRule; label: string }[] = [
	{ rule: "manual", label: "I add it myself, never automatically" },
	{ rule: "client", label: "I write to a client" },
	{ rule: "new_contact", label: "I write to someone who is not a client yet" },
	{ rule: "reply", label: "I reply to a mail" },
	{ rule: "project", label: "The mail is linked to a project" },
];

export const KIND_LABEL: Record<ComposeBlockKind, string> = { intro: "Intro", outro: "Outro" };

export type TextPart = { kind: "text"; text: string } | { kind: "variable"; name: ComposeBlockVariable };

const TOKEN = /\{\{([a-z_]+)\}\}/g;

/** A stored text cut into plain runs and variables, so each screen can draw a chip. */
export function splitTokens(body: string): TextPart[] {
	const parts: TextPart[] = [];
	let last = 0;
	for (const match of body.matchAll(TOKEN)) {
		const name = match[1] as ComposeBlockVariable;
		if (!VARIABLE_ORDER.includes(name)) continue;
		if (match.index > last) parts.push({ kind: "text", text: body.slice(last, match.index) });
		parts.push({ kind: "variable", name });
		last = match.index + match[0].length;
	}
	if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
	return parts;
}

/** What the person would compare to see whether a line in a message was edited. */
export function squash(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** The lines of a text as markup, for the block element in a message. */
export function linesToHtml(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
		.join("<br>");
}

/** `ids` with `moved` taken out and put where `before` is. Unknown ids leave the order as it was. */
export function moveBefore(ids: string[], moved: string, before: string): string[] {
	if (moved === before || !ids.includes(moved) || !ids.includes(before)) return ids;
	const rest = ids.filter((id) => id !== moved);
	rest.splice(rest.indexOf(before), 0, moved);
	return rest;
}

/** `ids` with `moved` one place up or down, or unchanged at the end of the list. */
export function moveBy(ids: string[], moved: string, step: -1 | 1): string[] {
	const from = ids.indexOf(moved);
	const to = from + step;
	if (from < 0 || to < 0 || to >= ids.length) return ids;
	const next = [...ids];
	next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
