import type {
	MailRule,
	MailRuleAction,
	MailRuleActionKind,
	MailRuleCondition,
	MailRuleMatch,
	MailRuleRun,
	MailRuleTextTest,
} from "@shared/types";

/** What a condition row asks about. Three of them take text, two take yes or no. */
export type WhatDraft = "sender" | "recipient" | "subject" | "client" | "attachments";

export const WHAT_OPTIONS: { value: WhatDraft; label: string }[] = [
	{ value: "sender", label: "Sender address" },
	{ value: "recipient", label: "Recipient address" },
	{ value: "subject", label: "Subject" },
	{ value: "client", label: "Sender is a client" },
	{ value: "attachments", label: "Has attachments" },
];

export const TEST_OPTIONS: { value: MailRuleTextTest; label: string }[] = [
	{ value: "contains", label: "contains" },
	{ value: "not_contains", label: "does not contain" },
	{ value: "is", label: "is" },
	{ value: "starts_with", label: "starts with" },
	{ value: "ends_with", label: "ends with" },
];

export type ConditionDraft = {
	key: string;
	what: WhatDraft;
	test: MailRuleTextTest;
	value: string;
	/** For the two yes or no questions. */
	yes: boolean;
};

export type WhereDraft = "stay" | "folder" | "trash" | "archive";

export type RuleDraft = {
	name: string;
	enabled: boolean;
	match: MailRuleMatch;
	conditions: ConditionDraft[];
	markRead: boolean;
	flag: boolean;
	link: boolean;
	where: WhereDraft;
	folderId: string;
	stopOnMatch: boolean;
};

let counter = 0;
export function nextKey(): string {
	counter += 1;
	return `condition-${counter}`;
}

export function blankCondition(): ConditionDraft {
	return { key: nextKey(), what: "sender", test: "contains", value: "", yes: true };
}

export function blankDraft(): RuleDraft {
	return {
		name: "",
		enabled: true,
		match: "all",
		conditions: [blankCondition()],
		markRead: false,
		flag: false,
		link: false,
		where: "stay",
		folderId: "",
		stopOnMatch: false,
	};
}

export function draftOf(rule: MailRule): RuleDraft {
	const moving = rule.actions.find((action) => action.kind === "move" || action.kind === "trash" || action.kind === "archive");
	const has = (kind: MailRuleActionKind) => rule.actions.some((action) => action.kind === kind);
	return {
		name: rule.name,
		enabled: rule.enabled,
		match: rule.match,
		conditions: rule.conditions.map((condition) => {
			if (condition.kind === "sender_is_client") {
				return { key: nextKey(), what: "client", test: "contains", value: "", yes: condition.value };
			}
			if (condition.kind === "has_attachments") {
				return { key: nextKey(), what: "attachments", test: "contains", value: "", yes: condition.value };
			}
			return { key: nextKey(), what: condition.field, test: condition.test, value: condition.value, yes: true };
		}),
		markRead: has("mark_read"),
		flag: has("flag"),
		link: has("link_client"),
		where: !moving ? "stay" : moving.kind === "move" ? "folder" : moving.kind,
		folderId: moving?.kind === "move" ? moving.folderId : "",
		stopOnMatch: rule.stopOnMatch,
	};
}

export function conditionsOf(draft: RuleDraft): MailRuleCondition[] {
	return draft.conditions.map((condition): MailRuleCondition => {
		if (condition.what === "client") return { kind: "sender_is_client", value: condition.yes };
		if (condition.what === "attachments") return { kind: "has_attachments", value: condition.yes };
		return { kind: "text", field: condition.what, test: condition.test, value: condition.value };
	});
}

export function actionsOf(draft: RuleDraft): MailRuleAction[] {
	const actions: MailRuleAction[] = [];
	if (draft.markRead) actions.push({ kind: "mark_read" });
	if (draft.flag) actions.push({ kind: "flag" });
	if (draft.link) actions.push({ kind: "link_client" });
	if (draft.where === "folder" && draft.folderId) actions.push({ kind: "move", folderId: draft.folderId });
	if (draft.where === "trash") actions.push({ kind: "trash" });
	if (draft.where === "archive") actions.push({ kind: "archive" });
	return actions;
}

/** A line for the history: what was done, in the past tense. */
export function runWords(run: MailRuleRun): string {
	switch (run.action) {
		case "mark_read":
			return "Marked read";
		case "flag":
			return "Flagged";
		case "link_client":
			return run.detail ? `Linked to ${run.detail}` : "Linked to the client";
		case "move":
			return run.detail ? `Moved to ${run.detail}` : "Moved to a folder";
		case "trash":
			return run.detail ? `Moved to ${run.detail}` : "Moved to Trash";
		case "archive":
			return run.detail ? `Moved to ${run.detail}` : "Archived";
	}
}

function attempt(run: MailRuleRun): string {
	const words = runWords(run)
		.replace(/^Marked read$/, "mark read")
		.replace(/^Flagged$/, "flag")
		.replace(/^Moved to/, "move to")
		.replace(/^Linked to/, "link to")
		.replace(/^Archived$/, "archive");
	return words;
}

/** A row that was tried and did not happen. */
export function failedWords(run: MailRuleRun): string {
	return `Could not ${attempt(run)}`;
}

/** A row with nothing to do. */
export function skippedWords(run: MailRuleRun): string {
	return `Skipped: ${attempt(run)}`;
}
