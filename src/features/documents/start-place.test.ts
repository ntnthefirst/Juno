import { describe, expect, it } from "vitest";
import { ownerOf, type StartPlace } from "./start-place";

const fromProject: StartPlace = { name: "Website", place: { clientId: "c1", projectId: "p1" } };

describe("where a document from a template starts out", () => {
	it("sets the pickers to the record it was started from, and to nothing without one", () => {
		expect(ownerOf(fromProject)).toEqual({ clientId: "c1", projectId: "p1" });
		expect(ownerOf({ name: "Acme", place: { clientId: "c1", projectId: null } })).toEqual({ clientId: "c1", projectId: "" });
		expect(ownerOf(null)).toEqual({ clientId: "", projectId: "" });
	});
});
