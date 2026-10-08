import { describe, expect, it } from "vitest";
import { rank } from "./palette-search";

const ITEMS = [
	{ label: "Overview" },
	{ label: "Clients", keywords: "customers companies" },
	{ label: "New client" },
	{ label: "New reminder" },
	{ label: "Mail", keywords: "inbox email" },
	{ label: "Styled mail" },
	{ label: "Settings", keywords: "preferences" },
];

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("rank", () => {
	it("returns the list untouched when nothing is typed", () => {
		expect(rank(ITEMS, "")).toBe(ITEMS);
		expect(rank(ITEMS, "   ")).toBe(ITEMS);
	});

	it("puts a label that starts with the word before one that only contains it", () => {
		expect(labels(rank(ITEMS, "mail"))).toEqual(["Mail", "Styled mail"]);
	});

	it("finds a word that starts a later word in the label", () => {
		expect(labels(rank(ITEMS, "client"))).toEqual(["Clients", "New client"]);
	});

	it("needs every word, in any order", () => {
		expect(labels(rank(ITEMS, "new cl"))).toEqual(["New client"]);
		expect(labels(rank(ITEMS, "cl new"))).toEqual(["New client"]);
	});

	it("finds by keyword, below a label match", () => {
		expect(labels(rank(ITEMS, "preferences"))).toEqual(["Settings"]);
		expect(labels(rank(ITEMS, "inbox"))).toEqual(["Mail"]);
	});

	it("drops what nothing in it matches", () => {
		expect(rank(ITEMS, "zzz")).toEqual([]);
	});

	it("keeps the written order between equal matches", () => {
		expect(labels(rank(ITEMS, "new"))).toEqual(["New client", "New reminder"]);
	});

	it("ignores case", () => {
		expect(labels(rank(ITEMS, "OVERVIEW"))).toEqual(["Overview"]);
	});
});
