import { describe, expect, it } from "vitest";
import { assertSignable } from "./documents";

describe("assertSignable", () => {
	it("refuses a document generated from an unreviewed template", () => {
		expect(() => assertSignable({ isSpecimen: true })).toThrow(/has not been reviewed/);
	});

	it("says what to do about it, not just that it refused", () => {
		expect(() => assertSignable({ isSpecimen: true })).toThrow(/mark it as reviewed/);
	});

	it("allows a document from a reviewed template", () => {
		expect(() => assertSignable({ isSpecimen: false })).not.toThrow();
	});
});
