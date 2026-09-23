import { describe, expect, it } from "vitest";
import type { TemplateInput } from "../../shared/types";
import { parseInputs, serialiseInputs, validateInputs, validateValues } from "./template-inputs";

describe("parseInputs", () => {
	it("returns an empty array for null, empty and unparseable JSON", () => {
		expect(parseInputs(null)).toEqual([]);
		expect(parseInputs("")).toEqual([]);
		expect(parseInputs("not json")).toEqual([]);
	});

	it("returns an empty array when the JSON is not an array", () => {
		expect(parseInputs('{"key":"scope"}')).toEqual([]);
	});

	it("drops an entry that is not a record and one with no usable key", () => {
		expect(parseInputs('["nope", 5, null, {}, {"key":"  "}]')).toEqual([]);
	});

	it("falls back to kind text when the kind is not one of the known ones", () => {
		const [input] = parseInputs('[{"key":"scope","label":"Scope","kind":"paragraph"}]');
		expect(input?.kind).toBe("text");
	});

	it("falls back to required false when it is missing or not a boolean", () => {
		const [input] = parseInputs('[{"key":"scope","label":"Scope","required":"yes"}]');
		expect(input?.required).toBe(false);
	});

	it("keeps options only for kind choice, and only as an array of strings", () => {
		const [choice] = parseInputs(
			'[{"key":"size","label":"Size","kind":"choice","options":["s","m",3,"l"]}]',
		);
		expect(choice?.options).toEqual(["s", "m", "l"]);

		const [text] = parseInputs('[{"key":"scope","label":"Scope","kind":"text","options":["s"]}]');
		expect(text?.options).toBeUndefined();
	});

	it("parses a full, well-formed entry", () => {
		const [input] = parseInputs(
			'[{"key":"amount","label":"Amount","kind":"money","required":true,"help":"In cents.","defaultValue":"0"}]',
		);
		expect(input).toEqual({
			key: "amount",
			label: "Amount",
			kind: "money",
			required: true,
			help: "In cents.",
			defaultValue: "0",
		});
	});
});

describe("serialiseInputs", () => {
	it("returns null for an empty array, so the column stays null", () => {
		expect(serialiseInputs([])).toBeNull();
	});

	it("round-trips a non-empty array through parseInputs", () => {
		const inputs: TemplateInput[] = [{ key: "scope", label: "Scope", kind: "text", required: true }];
		const json = serialiseInputs(inputs);
		expect(json).not.toBeNull();
		expect(parseInputs(json)).toEqual(inputs);
	});
});

function input(overrides: Partial<TemplateInput> = {}): TemplateInput {
	return { key: "scope", label: "Scope", kind: "text", required: false, ...overrides };
}

describe("validateInputs", () => {
	it("allows a well-formed list", () => {
		expect(() =>
			validateInputs([input({ key: "scope" }), input({ key: "amount_2" })]),
		).not.toThrow();
	});

	it("refuses an empty key", () => {
		expect(() => validateInputs([input({ key: "" })])).toThrow(/needs a key/);
		expect(() => validateInputs([input({ key: "   " })])).toThrow(/needs a key/);
	});

	it("refuses a key that is not a plain identifier", () => {
		expect(() => validateInputs([input({ key: "Scope" })])).toThrow(/"Scope"/);
		expect(() => validateInputs([input({ key: "due.date" })])).toThrow(/"due.date"/);
		expect(() => validateInputs([input({ key: "due date" })])).toThrow(/"due date"/);
		expect(() => validateInputs([input({ key: "2fast" })])).toThrow(/"2fast"/);
		expect(() => validateInputs([input({ key: "scope" })])).not.toThrow();
		expect(() => validateInputs([input({ key: "scope_2" })])).not.toThrow();
	});

	it("says the key becomes a placeholder, and names it", () => {
		expect(() => validateInputs([input({ key: "Bad Key" })])).toThrow(/\{\{document\.Bad Key\}\}/);
	});

	it("refuses two inputs sharing a key", () => {
		expect(() =>
			validateInputs([input({ key: "scope" }), input({ key: "scope", label: "Other" })]),
		).toThrow(/share the key "scope"/);
	});

	it("refuses an empty label", () => {
		expect(() => validateInputs([input({ label: "" })])).toThrow(/needs a label/);
		expect(() => validateInputs([input({ label: "   " })])).toThrow(/needs a label/);
	});

	it("refuses a choice with no options", () => {
		expect(() => validateInputs([input({ kind: "choice", options: [] })])).toThrow(/at least one option/);
		expect(() => validateInputs([input({ kind: "choice" })])).toThrow(/at least one option/);
	});

	it("allows a choice with at least one option", () => {
		expect(() => validateInputs([input({ kind: "choice", options: ["a"] })])).not.toThrow();
	});
});

describe("validateValues", () => {
	it("trims every value", () => {
		const { values } = validateValues([input({ key: "scope" })], { scope: "  redesign  " });
		expect(values.scope).toBe("redesign");
	});

	it("reports a required input with no value as missing", () => {
		const { missing } = validateValues([input({ key: "scope", required: true })], {});
		expect(missing).toEqual(["scope"]);
	});

	it("reports a required input that is only whitespace as missing", () => {
		const { missing } = validateValues([input({ key: "scope", required: true })], { scope: "   " });
		expect(missing).toEqual(["scope"]);
	});

	it("does not report an optional input with no value as missing", () => {
		const { missing } = validateValues([input({ key: "scope", required: false })], {});
		expect(missing).toEqual([]);
	});

	it("never throws, even when every required input is missing", () => {
		expect(() =>
			validateValues([input({ key: "a", required: true }), input({ key: "b", required: true })], {}),
		).not.toThrow();
	});
});
