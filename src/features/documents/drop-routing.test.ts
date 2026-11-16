import { describe, expect, it } from "vitest";
import { decodeDrag, encodeDrag } from "./drop-routing";

describe("a drag of documents", () => {
	it("reads back what it carried, and nothing that is not one of ours", () => {
		const payload = { kind: "documents" as const, ids: ["a", "b"] };
		expect(decodeDrag(encodeDrag(payload))).toEqual(payload);
		expect(decodeDrag(JSON.stringify({ kind: "documents", ids: [1] }))).toBeNull();
		expect(decodeDrag(JSON.stringify({ kind: "folder", key: "folder:f1", folderId: "f1" }))).toBeNull();
		expect(decodeDrag("not json")).toBeNull();
	});
});
