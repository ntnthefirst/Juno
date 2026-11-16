import { describe, expect, it } from "vitest";
import { choiceOf, linkOfferFor } from "./attachment-place";

describe("what saving to a place can also file the conversation under", () => {
	it("offers the project when the conversation is not filed there yet", () => {
		expect(linkOfferFor({ clientId: "c", projectId: "p" }, { clientId: null, projectId: null })).toBe("project");
		expect(linkOfferFor({ clientId: "c", projectId: "p" }, { clientId: "c", projectId: "q" })).toBe("project");
		expect(linkOfferFor({ clientId: "c", projectId: "p" }, { clientId: "c", projectId: "p" })).toBeNull();
	});

	it("offers the client only to a conversation with no client, and nothing for Unfiled", () => {
		expect(linkOfferFor({ clientId: "c", projectId: "" }, { clientId: null, projectId: null })).toBe("client");
		expect(linkOfferFor({ clientId: "c", projectId: "" }, { clientId: "d", projectId: null })).toBeNull();
		expect(linkOfferFor({ clientId: "", projectId: "" }, { clientId: null, projectId: null })).toBeNull();
	});

	it("starts the pickers from the place, suggested or filed", () => {
		expect(choiceOf(null)).toEqual({ clientId: "", projectId: "" });
		expect(
			choiceOf({ clientId: "c", clientName: "Claes", projectId: "p", projectName: "Veranda", name: "Veranda", linked: false }),
		).toEqual({ clientId: "c", projectId: "p" });
	});
});
