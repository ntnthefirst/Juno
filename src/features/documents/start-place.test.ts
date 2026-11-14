import { describe, expect, it } from "vitest";
import { folderFor, ownerOf, type StartPlace } from "./start-place";

const inFolder: StartPlace = { name: "Offertes", place: { clientId: "c1", projectId: "p1", folderId: "f1" } };

describe("where a document from a template starts out", () => {
	it("sets the pickers to the node it was started from", () => {
		expect(ownerOf(inFolder)).toEqual({ clientId: "c1", projectId: "p1" });
		expect(ownerOf(null)).toEqual({ clientId: "", projectId: "" });
	});

	it("keeps it in the folder while the pickers still name the folder's place", () => {
		expect(folderFor(inFolder, { clientId: "c1", projectId: "p1" })).toBe("f1");
	});

	it("leaves the folder out once another client or project is picked", () => {
		expect(folderFor(inFolder, { clientId: "c1", projectId: "" })).toBeNull();
		expect(folderFor(inFolder, { clientId: "c2", projectId: "" })).toBeNull();
	});

	it("names no folder for a node that is not one", () => {
		expect(folderFor({ name: "Acme", place: { clientId: "c1", projectId: null, folderId: null } }, { clientId: "c1", projectId: "" })).toBeNull();
		expect(folderFor(undefined, { clientId: "", projectId: "" })).toBeNull();
	});
});
