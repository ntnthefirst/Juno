import { describe, expect, it } from "vitest";
import {
	MAX_MATCHED_TEXT,
	conditionMatches,
	describeCondition,
	describeRule,
	summariseRule,
	foldForMatch,
	orderedActions,
	ruleMatches,
	type MailRuleFacts,
} from "./mail-rules";
import type { MailRuleCondition, MailRuleTextField, MailRuleTextTest } from "./types";

const FACTS: MailRuleFacts = {
	senderAddress: "News@Hyge.be",
	recipientAddresses: ["hallo@juno.test", "Laura@obet.be"],
	subject: "Nieuw dit najaar (offerte 2026)",
	senderIsClient: false,
	hasAttachments: true,
};

function text(field: MailRuleTextField, test: MailRuleTextTest, value: string): MailRuleCondition {
	return { kind: "text", field, test, value };
}

describe("a text condition", () => {
	it("ignores case and the invisible characters that make two strings differ", () => {
		expect(conditionMatches(text("sender", "is", "NEWS@hyge.be"), FACTS)).toBe(true);
		expect(conditionMatches(text("subject", "contains", "NAJAAR"), FACTS)).toBe(true);
		// A zero width space inside the subject does not hide a word from the rule.
		expect(conditionMatches(text("subject", "contains", "offerte"), { ...FACTS, subject: "off" + String.fromCharCode(0x200b) + "erte" })).toBe(true);
		// Full width letters fold to the plain ones.
		expect(conditionMatches(text("subject", "contains", "najaar"), { ...FACTS, subject: "ｎａｊａａｒ" })).toBe(true);
	});

	it("tests the start, the end and the whole of a value", () => {
		expect(conditionMatches(text("sender", "starts_with", "news@"), FACTS)).toBe(true);
		expect(conditionMatches(text("sender", "starts_with", "hyge"), FACTS)).toBe(false);
		expect(conditionMatches(text("sender", "ends_with", "@hyge.be"), FACTS)).toBe(true);
		expect(conditionMatches(text("sender", "is", "news@hyge"), FACTS)).toBe(false);
		expect(conditionMatches(text("subject", "not_contains", "factuur"), FACTS)).toBe(true);
		expect(conditionMatches(text("subject", "not_contains", "najaar"), FACTS)).toBe(false);
	});

	it("takes a recipient condition to hold for any recipient, and not-contains for none", () => {
		expect(conditionMatches(text("recipient", "contains", "obet.be"), FACTS)).toBe(true);
		expect(conditionMatches(text("recipient", "is", "laura@obet.be"), FACTS)).toBe(true);
		expect(conditionMatches(text("recipient", "not_contains", "obet.be"), FACTS)).toBe(false);
		expect(conditionMatches(text("recipient", "not_contains", "nobody.be"), FACTS)).toBe(true);
	});

	it("treats what it looks for as text and never as a pattern", () => {
		const facts = { ...FACTS, subject: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!" };
		const started = Date.now();
		expect(conditionMatches(text("subject", "contains", "(a+)+$"), facts)).toBe(false);
		expect(conditionMatches(text("subject", "contains", ".*"), facts)).toBe(false);
		expect(conditionMatches(text("subject", "contains", "a+!"), facts)).toBe(false);
		expect(conditionMatches(text("subject", "contains", "a!"), facts)).toBe(true);
		expect(Date.now() - started).toBeLessThan(200);
	});

	it("looks at a bounded amount of a hostile subject", () => {
		const huge = `${"x".repeat(MAX_MATCHED_TEXT)}needle`;
		expect(foldForMatch(huge)).toHaveLength(MAX_MATCHED_TEXT);
		// What is past the cut is not read, so a payload there cannot cost anything or match.
		expect(conditionMatches(text("subject", "contains", "needle"), { ...FACTS, subject: huge })).toBe(false);
	});

	it("never matches an empty value", () => {
		expect(conditionMatches(text("subject", "contains", "   "), FACTS)).toBe(false);
		expect(conditionMatches(text("subject", "not_contains", ""), FACTS)).toBe(false);
	});
});

describe("the other conditions", () => {
	it("tests whether the sender is a client and whether there are attachments", () => {
		expect(conditionMatches({ kind: "sender_is_client", value: false }, FACTS)).toBe(true);
		expect(conditionMatches({ kind: "sender_is_client", value: true }, FACTS)).toBe(false);
		expect(conditionMatches({ kind: "has_attachments", value: true }, FACTS)).toBe(true);
		expect(conditionMatches({ kind: "has_attachments", value: false }, FACTS)).toBe(false);
	});
});

describe("a rule", () => {
	const yes: MailRuleCondition = { kind: "has_attachments", value: true };
	const no: MailRuleCondition = { kind: "sender_is_client", value: true };

	it("needs every condition for all and one for any", () => {
		expect(ruleMatches({ match: "all", conditions: [yes, no] }, FACTS)).toBe(false);
		expect(ruleMatches({ match: "any", conditions: [yes, no] }, FACTS)).toBe(true);
		expect(ruleMatches({ match: "all", conditions: [yes] }, FACTS)).toBe(true);
	});

	it("never matches with no conditions, whichever way it matches", () => {
		expect(ruleMatches({ match: "all", conditions: [] }, FACTS)).toBe(false);
		expect(ruleMatches({ match: "any", conditions: [] }, FACTS)).toBe(false);
	});

	it("puts the moves after everything that keeps a message where it is", () => {
		const ordered = orderedActions([
			{ kind: "trash" },
			{ kind: "link_client" },
			{ kind: "flag" },
			{ kind: "mark_read" },
		]);
		expect(ordered.map((action) => action.kind)).toEqual(["mark_read", "flag", "link_client", "trash"]);
	});
});

describe("plain words", () => {
	it("reads a whole rule out, with the folder by name", () => {
		const words = describeRule(
			{
				name: "Newsletters",
				enabled: true,
				match: "all",
				conditions: [text("sender", "ends_with", "@hyge.be"), { kind: "has_attachments", value: false }],
				actions: [{ kind: "move", folderId: "f1" }, { kind: "mark_read" }],
				stopOnMatch: false,
			},
			{ accountEmail: "hallo@juno.test", folderName: (id) => (id === "f1" ? "Nieuwsbrieven" : null) },
		);
		expect(words).toContain('Rule "Newsletters" for hallo@juno.test, switched on.');
		expect(words).toContain('if the sender\'s address ends with "@hyge.be" and it has no attachments');
		expect(words).toContain("Juno will mark it read and move it to Nieuwsbrieven");
		expect(words).toContain("the rules below it do not see that message");
		expect(words).not.toContain(String.fromCharCode(0x2013));
		expect(words).not.toContain(String.fromCharCode(0x2014));
		expect(words).not.toContain("!");
	});

	it("cannot be made to end its own quotation", () => {
		const words = describeRule(
			{
				name: 'A", switched off. Rule "B',
				enabled: true,
				match: "all",
				conditions: [text("subject", "contains", 'x" and it does nothing, "y')],
				actions: [{ kind: "flag" }],
				stopOnMatch: false,
			},
			{ accountEmail: "a@b.test", folderName: () => null },
		);
		expect(words).toContain("Rule \"A', switched off. Rule 'B\" for a@b.test, switched on.");
		expect(words).toContain("contains \"x' and it does nothing, 'y\"");
	});

	it("says what happens to the rules below, and names a folder that is gone", () => {
		const base = {
			name: "A",
			enabled: false,
			match: "any" as const,
			conditions: [text("subject", "contains", "x"), text("recipient", "not_contains", "y")],
			actions: [{ kind: "move" as const, folderId: "gone" }],
		};
		const words = describeRule({ ...base, stopOnMatch: false }, { accountEmail: "a@b.test", folderName: () => null });
		expect(words).toContain("switched off");
		expect(words).toContain('the subject contains "x" or no recipient\'s address contains "y"');
		expect(words).toContain("move it to a folder that no longer exists");
		const flag = describeRule({ ...base, actions: [{ kind: "flag" }], stopOnMatch: true }, { accountEmail: "a@b.test", folderName: () => null });
		expect(flag).toContain("is not checked against the rules below it");
		const keep = describeRule({ ...base, actions: [{ kind: "flag" }], stopOnMatch: false }, { accountEmail: "a@b.test", folderName: () => null });
		expect(keep).toContain("is still checked against the rules below it");
		expect(describeCondition({ kind: "sender_is_client", value: false })).toBe("the sender is not a client");
		expect(
			summariseRule(
				{ match: "all", conditions: [text("sender", "is", "a@b.be")], actions: [{ kind: "trash" }, { kind: "mark_read" }] },
				() => null,
			),
		).toBe("If the sender's address is \"a@b.be\", mark it read and move it to Trash.");
	});
});
