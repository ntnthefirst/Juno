import { describe, expect, it } from "vitest";
import { linesToHtml, moveBefore, moveBy, splitTokens, squash } from "./block-text";

describe("splitTokens", () => {
	it("cuts a text into runs and variables", () => {
		expect(splitTokens("Dag {{first_name}},")).toEqual([
			{ kind: "text", text: "Dag " },
			{ kind: "variable", name: "first_name" },
			{ kind: "text", text: "," },
		]);
	});

	it("keeps line breaks inside a run", () => {
		expect(splitTokens("Groeten,\n{{my_name}}")).toEqual([
			{ kind: "text", text: "Groeten,\n" },
			{ kind: "variable", name: "my_name" },
		]);
	});

	it("leaves a token it does not know as text", () => {
		expect(splitTokens("Dag {{nobody}}")).toEqual([{ kind: "text", text: "Dag {{nobody}}" }]);
	});

	it("reads a text with no variable as one run, and an empty one as nothing", () => {
		expect(splitTokens("Dag,")).toEqual([{ kind: "text", text: "Dag," }]);
		expect(splitTokens("")).toEqual([]);
	});
});

describe("squash and linesToHtml", () => {
	it("ignores spacing and line ends when comparing", () => {
		expect(squash("Groeten,\n  Nathan ")).toBe(squash("Groeten, Nathan"));
	});

	it("escapes markup and turns lines into breaks", () => {
		expect(linesToHtml("A <b>\nB & C")).toBe("A &lt;b&gt;<br>B &amp; C");
	});
});

describe("moving", () => {
	it("puts an id where another one was", () => {
		expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
		expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
	});

	it("leaves the order alone for an id it does not know", () => {
		expect(moveBefore(["a", "b"], "x", "a")).toEqual(["a", "b"]);
		expect(moveBefore(["a", "b"], "a", "a")).toEqual(["a", "b"]);
	});

	it("moves one place and stops at the ends", () => {
		expect(moveBy(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
		expect(moveBy(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
	});
});
