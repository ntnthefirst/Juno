import { describe, expect, it } from "vitest";
import { cleanPrefill, isNewRecordKind, prefillFromQuery, prefillToQuery } from "./new-record";

describe("new-record prefill", () => {
	it("round trips the fields it keeps", () => {
		const prefill = {
			clientId: "0192f5a0-7c1e-7000-8000-000000000001",
			date: "2026-10-13",
			startLocal: "2026-10-13T10:00:00",
			endLocal: "2026-10-13T10:30:00",
			allDay: true,
		};
		expect(prefillFromQuery(prefillToQuery(prefill))).toEqual(prefill);
	});

	it("drops values of the wrong shape", () => {
		expect(cleanPrefill({ clientId: "x y", date: "tomorrow", startLocal: "2026-13", extra: "1" })).toEqual({});
		expect(cleanPrefill(null)).toEqual({});
	});

	it("knows the four kinds", () => {
		expect(isNewRecordKind("client")).toBe(true);
		expect(isNewRecordKind("document")).toBe(false);
	});
});
