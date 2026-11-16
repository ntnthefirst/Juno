import { describe, expect, it } from "vitest";
import { openedNotice } from "./opened";

describe("openedNotice", () => {
	it("says a signed file opened read only", () => {
		expect(openedNotice("Contract Obet", { readOnly: true })).toBe("Contract Obet opened read only, because it is signed.");
	});

	it("says nothing when the file opened as a working copy", () => {
		expect(openedNotice("Contract Obet", { readOnly: false })).toBeNull();
	});
});
