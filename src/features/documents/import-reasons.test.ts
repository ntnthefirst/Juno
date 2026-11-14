import { describe, expect, it } from "vitest";
import type { ImportMatch } from "@shared/types";
import { firstMatch, needsAsking, reasonFor } from "./import-reasons";

function match(partial: Partial<ImportMatch>): ImportMatch {
	return {
		documentId: "d",
		title: "Offerte Jansen",
		clientId: null,
		clientName: null,
		projectId: null,
		folderId: null,
		score: 0,
		identical: false,
		reason: "name",
		latestVersion: null,
		...partial,
	};
}

describe("reasonFor", () => {
	it("says in plain words why a file looks like a document", () => {
		expect(reasonFor(match({ reason: "name" }))).toBe("Same name as Offerte Jansen");
		expect(reasonFor(match({ reason: "text", score: 1 }))).toBe("Same text as Offerte Jansen");
		expect(reasonFor(match({ reason: "text", score: 0.874 }))).toBe("Same text as Offerte Jansen, 87% of it");
		expect(reasonFor(match({ reason: "bytes", score: 1 }))).toBe("The same file as Offerte Jansen");
		expect(reasonFor(match({ reason: "bytes", identical: true }))).toBe("This exact file is already a version of Offerte Jansen");
	});
});

describe("choosing what to ask", () => {
	it("adds a file with no match straight away", () => {
		expect(needsAsking({ matches: [] })).toBe(false);
		expect(needsAsking({ matches: [match({})] })).toBe(true);
	});

	it("compares with a match it could still be a version of first", () => {
		const same = match({ documentId: "same", identical: true });
		const like = match({ documentId: "like", reason: "text", score: 0.9 });
		expect(firstMatch({ matches: [same, like] })?.documentId).toBe("like");
		expect(firstMatch({ matches: [same] })?.documentId).toBe("same");
		expect(firstMatch({ matches: [] })).toBeNull();
	});
});
