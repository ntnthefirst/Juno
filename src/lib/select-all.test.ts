import { describe, expect, it } from "vitest";
import { coversAll, withAll, withPick } from "./select-all";

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

	it("toggles one row on a plain pick", () => {
		expect(withPick(["a"], ["a", "b", "c"], "b", false, "a")).toEqual(["a", "b"]);
		expect(withPick(["a", "b"], ["a", "b", "c"], "a", false, "b")).toEqual(["b"]);
	});

	it("adds the run between the last pick and this one, in either direction", () => {
		expect(withPick(["b"], ["a", "b", "c", "d"], "d", true, "b")).toEqual(["b", "c", "d"]);
		expect(withPick(["z", "d"], ["a", "b", "c", "d"], "b", true, "d")).toEqual(["z", "d", "b", "c"]);
	});

	it("falls back to a plain pick when there is no earlier pick on the list", () => {
		expect(withPick([], ["a", "b"], "b", true, null)).toEqual(["b"]);
		expect(withPick(["x"], ["a", "b"], "b", true, "x")).toEqual(["x", "b"]);
	});
});
