import type { Note } from "@shared/types";

/** The first line of a body with its list or heading marks taken off. */
function firstLine(body: string): string {
	for (const line of body.split("\n")) {
		const text = line.replace(/^\s*(#+\s+|[-*]\s+(\[[ xX]\]\s*)?)/, "").trim();
		if (text) return text;
	}
	return "";
}

/** The title a list shows for a note that was given none: its first line. */
export function noteTitleFallback(body: string): string {
	return firstLine(body).slice(0, 80) || "Untitled note";
}

export function noteTitle(note: Pick<Note, "title" | "body">): string {
	return note.title.trim() || noteTitleFallback(note.body);
}

/**
 * The line under the title: the start of the text. When the note has no title
 * the first line stands in for it, so the preview starts from the second.
 */
export function notePreview(note: Pick<Note, "title" | "body">): string {
	const lines = note.body
		.split("\n")
		.map((line) => line.replace(/^\s*(#+\s+|[-*]\s+(\[[ xX]\]\s*)?)/, "").trim())
		.filter(Boolean);
	const rest = note.title.trim() ? lines : lines.slice(1);
	return rest.join(", ");
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clock(at: Date): string {
	return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** What a row shows at its left: the time today, the weekday this week, the date after that. */
export function rowTime(iso: string, now: Date = new Date()): string {
	const at = new Date(iso);
	const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
	if (days <= 0) return clock(at);
	if (days < 7) return at.toLocaleDateString("en-GB", { weekday: "short" });
	const sameYear = at.getFullYear() === now.getFullYear();
	return at.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** "Edited today at 09:12", "Edited yesterday at 16:40", "Edited 3 Mar at 09:12". */
export function editedLabel(iso: string, now: Date = new Date()): string {
	const at = new Date(iso);
	const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
	if (days <= 0) return `Edited today at ${clock(at)}`;
	if (days === 1) return `Edited yesterday at ${clock(at)}`;
	const sameYear = at.getFullYear() === now.getFullYear();
	const date = at.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
	return `Edited ${date} at ${clock(at)}`;
}

/** The sections of the list. The design says Previous 7 days where the shared grouping says Last 7 days. */
export function groupLabel(label: string): string {
	return label === "Last 7 days" ? "Previous 7 days" : label;
}
