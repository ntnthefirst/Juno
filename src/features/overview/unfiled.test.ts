import { describe, expect, it } from "vitest";
import type { DocumentRecord } from "@shared/types";
import { unfiledOf } from "./unfiled";

const record = (id: string, createdAt: string, clientId: string | null, projectId: string | null) =>
	({ id, title: id, createdAt, clientId, projectId }) as DocumentRecord;

describe("unfiledOf", () => {
	it("keeps only the documents with no client and no project, newest first", () => {
		const records = [
			record("a", "2026-11-01T09:00:00.000Z", null, null),
			record("b", "2026-11-03T09:00:00.000Z", "c1", null),
			record("c", "2026-11-04T09:00:00.000Z", null, "p1"),
			record("d", "2026-11-02T09:00:00.000Z", null, null),
		];
		expect(unfiledOf(records).map((entry) => entry.id)).toEqual(["d", "a"]);
	});

	it("orders two of one moment by id, so a reload does not swap them", () => {
		const at = "2026-11-01T09:00:00.000Z";
		expect(unfiledOf([record("x1", at, null, null), record("x2", at, null, null)]).map((entry) => entry.id)).toEqual(["x2", "x1"]);
	});
});
