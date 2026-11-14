import { describe, expect, it } from "vitest";
import { coverOrigin, focusToReturn, markScroll, restoreScroll } from "./return-to";

describe("coverOrigin", () => {
	const document = { kind: "document", id: "d1", name: "Offerte" } as const;

	it("opens a document over the screen it was asked for from", () => {
		expect(coverOrigin(document, "clients")).toBe("clients");
		expect(coverOrigin(document, "projects")).toBe("projects");
		expect(coverOrigin(document, "mail")).toBe("mail");
		expect(coverOrigin(document, "agent")).toBe("agent");
		expect(coverOrigin(document, "overview")).toBe("overview");
	});

	it("keeps the way it was in Documents itself", () => {
		expect(coverOrigin(document, "documents")).toBeNull();
	});

	it("lands every other request as a place of its own", () => {
		expect(coverOrigin({ kind: "document-folder", key: "unfiled" }, "clients")).toBeNull();
		expect(coverOrigin({ kind: "project", id: "p1", name: "Site" }, "clients")).toBeNull();
		expect(coverOrigin({ kind: "thread", id: "t1", messageId: null }, "documents")).toBeNull();
		expect(coverOrigin({ kind: "screen", screen: "documents" }, "clients")).toBeNull();
	});
});

describe("markScroll and restoreScroll", () => {
	it("keeps only what is scrolled, and puts it back", () => {
		const list = { scrollTop: 240, scrollLeft: 0 };
		const table = { scrollTop: 0, scrollLeft: 32 };
		const still = { scrollTop: 0, scrollLeft: 0 };
		const marks = markScroll([list, table, still]);
		expect(marks.map((mark) => mark.element)).toEqual([list, table]);

		list.scrollTop = 0;
		table.scrollLeft = 0;
		restoreScroll(marks);
		expect(list.scrollTop).toBe(240);
		expect(table.scrollLeft).toBe(32);
		expect(still.scrollTop).toBe(0);
	});
});

describe("focusToReturn", () => {
	const row = { name: "row" };
	const earlier = { name: "earlier" };
	const palette = { name: "palette input" };
	const onScreen = new Set([row, earlier]);
	const inside = (element: { name: string }) => onScreen.has(element);

	it("returns to the row the preview was opened from", () => {
		expect(focusToReturn(row, earlier, inside)).toBe(row);
	});

	it("falls back to the last focus on the screen when the request came from outside it", () => {
		expect(focusToReturn(palette, earlier, inside)).toBe(earlier);
		expect(focusToReturn(null, earlier, inside)).toBe(earlier);
	});

	it("gives up when neither is on the screen any more", () => {
		expect(focusToReturn(palette, null, inside)).toBeNull();
		expect(focusToReturn(palette, { name: "gone" }, inside)).toBeNull();
	});
});
