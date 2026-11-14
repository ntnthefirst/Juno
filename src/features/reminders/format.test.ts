import { describe, expect, it } from "vitest";
import { describeSnoozedUntil } from "./format";

describe("describeSnoozedUntil", () => {
	it("says the day a snoozed reminder comes back, in the words the due date uses", () => {
		expect(describeSnoozedUntil("2026-11-15", "2026-11-14")).toBe("Until tomorrow");
		expect(describeSnoozedUntil("2026-11-18", "2026-11-14")).toBe("Until Wed");
		expect(describeSnoozedUntil("2026-12-03", "2026-11-14")).toBe("Until 3 Dec");
		expect(describeSnoozedUntil("2027-01-04", "2026-11-14")).toBe("Until 4 Jan 2027");
	});
});
