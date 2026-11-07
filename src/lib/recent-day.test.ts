import { describe, expect, it } from "vitest";
import { recentDay } from "./recent-day";

const NOW = new Date(2026, 9, 14, 15, 0);

describe("recentDay", () => {
	it("says Today and Yesterday", () => {
		expect(recentDay(new Date(2026, 9, 14, 8, 0).toISOString(), NOW)).toBe("Today");
		expect(recentDay(new Date(2026, 9, 13, 23, 0).toISOString(), NOW)).toBe("Yesterday");
	});

	it("uses the weekday inside a week and the date after it", () => {
		expect(recentDay(new Date(2026, 9, 12, 9, 0).toISOString(), NOW)).toBe("Mon");
		expect(recentDay(new Date(2026, 9, 1, 9, 0).toISOString(), NOW)).toBe("1 Oct");
	});
});
