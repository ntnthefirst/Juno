import { describe, expect, it } from "vitest";
import { editedLabel, groupLabel, noteTitle, notePreview, rowTime } from "./note-format";

const NOW = new Date(2026, 9, 2, 15, 0);

function at(day: number, hour: number, minute: number): string {
	return new Date(2026, 9, day, hour, minute).toISOString();
}

describe("note format", () => {
	it("uses the first line as the title when there is none, and skips it in the preview", () => {
		const body = "- [x] Sharpen the chisels\n- [ ] Order screws";
		expect(noteTitle({ title: "", body })).toBe("Sharpen the chisels");
		expect(notePreview({ title: "", body })).toBe("Order screws");
		expect(notePreview({ title: "Workshop", body })).toBe("Sharpen the chisels, Order screws");
		expect(noteTitle({ title: "", body: "" })).toBe("Untitled note");
	});

	it("shows the time today, the weekday this week and the date after that", () => {
		expect(rowTime(at(2, 9, 12), NOW)).toBe("09:12");
		expect(rowTime(at(28, 9, 12).replace("2026-10", "2026-09"), NOW)).toMatch(/^[A-Z][a-z]{2}$/);
		expect(rowTime(new Date(2026, 7, 3, 9, 0).toISOString(), NOW)).toBe("3 Aug");
	});

	it("words when a note was edited", () => {
		expect(editedLabel(at(2, 9, 12), NOW)).toBe("Edited today at 09:12");
		expect(editedLabel(at(1, 16, 40), NOW)).toBe("Edited yesterday at 16:40");
		expect(editedLabel(new Date(2026, 2, 3, 9, 5).toISOString(), NOW)).toBe("Edited 3 Mar at 09:05");
	});

	it("names the week as the design does", () => {
		expect(groupLabel("Last 7 days")).toBe("Previous 7 days");
		expect(groupLabel("Today")).toBe("Today");
	});
});
