import type { Note, NoteQuery } from "@shared/types";

/** The service's own ceiling for one page. */
const PAGE = 1000;

/**
 * Every note that matches, not only the first page the service returns by
 * default (200). Pinned notes come first and then the newest edit, so a screen
 * that stopped at one page would drop the oldest notes without a word.
 */
export async function listAllNotes(query: Omit<NoteQuery, "limit" | "offset"> = {}): Promise<Note[]> {
	const all: Note[] = [];
	for (;;) {
		const page = await window.juno.notes.list({ ...query, limit: PAGE, offset: all.length });
		all.push(...page);
		if (page.length < PAGE) return all;
	}
}
