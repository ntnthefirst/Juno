import { describe, expect, it } from "vitest";
import { coversAll, withAll } from "./select-all";

describe("select all", () => {
	it("covers nothing for an empty list", () => {
		expect(coversAll([], ["a"])).toBe(false);
	});

	it("needs every matching id, rendered or not", () => {
		expect(coversAll(["a", "b", "c"], ["a", "b"])).toBe(false);
		expect(coversAll(["a", "b", "c"], ["c", "b", "a", "z"])).toBe(true);
	});

	it("adds the matches without dropping earlier picks or repeating", () => {
		expect(withAll(["z", "a"], ["a", "b"])).toEqual(["z", "a", "b"]);
	});
});
