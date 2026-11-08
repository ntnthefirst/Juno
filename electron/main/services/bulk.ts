/**
 * What every action on a list of rows shares: how its ids are checked and how
 * it is put in front of a person before an agent's call runs.
 *
 * The rules, the same for clients, projects and notes:
 *
 * - An id nobody has, or one that belongs to another owner, refuses the whole
 *   call and nothing is written. A list that names a record the caller cannot
 *   see is a wrong list, and doing the rest of it would be guessing. The
 *   message is the same for both, so it does not tell a caller that a row of
 *   someone else's exists.
 * - A row already in the state the call asks for is left as it is and is not
 *   in the result: deleting a deleted client, restoring one that is there.
 *   A selection goes stale while it waits for a click or an approval, and
 *   refusing it for that would throw the rest of the work away.
 * - Everything a call writes is written in one transaction.
 */

/** The most rows one call may name. A selection larger than this is a mistake, not a task. */
export const MAX_BULK_IDS = 500;

export type BulkNoun = { one: string; many: string };

/** The ids, checked, in the order given and each once. */
export function cleanIds(ids: unknown, noun: BulkNoun): string[] {
	if (!Array.isArray(ids)) throw new Error(`Pass the ${noun.many} as a list of ids.`);
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (typeof id !== "string" || id.trim() === "") throw new Error(`Every ${noun.one} id is a text id.`);
		if (seen.has(id)) continue;
		seen.add(id);
		unique.push(id);
	}
	if (unique.length === 0) throw new Error(`Pick at least one ${noun.one}.`);
	if (unique.length > MAX_BULK_IDS) {
		throw new Error(`At most ${MAX_BULK_IDS} ${noun.many} at a time. Split the list.`);
	}
	return unique;
}

/** Throws for the first id the rows do not cover. */
export function requireAll(ids: string[], found: ReadonlySet<string>, noun: BulkNoun): void {
	const missing = ids.find((id) => !found.has(id));
	if (missing !== undefined) {
		throw new Error(`No ${noun.one} with id "${missing}". Nothing was changed. Read the list again and try again.`);
	}
}

export type BulkReview = { summary: string; preview: string };

function counted(n: number, noun: BulkNoun): string {
	return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/**
 * The one sentence and the whole list a person reads before approving a bulk
 * call: every row by name, and the ones it will leave alone, named as such.
 * A call that would change nothing is refused here, so an agent learns that at
 * once instead of leaving a request waiting that does nothing.
 */
export function reviewOf(
	request: { verb: string; noun: BulkNoun; afterwards: string; skippedAs: string },
	rows: { name: string; skipped: boolean }[],
): BulkReview {
	const { verb, noun, afterwards, skippedAs } = request;
	const acting = rows.filter((row) => !row.skipped);
	const skipped = rows.filter((row) => row.skipped);
	if (acting.length === 0) {
		throw new Error(`${skippedAs}: every one of these ${noun.many}. There is nothing to do.`);
	}
	const head = acting.length === 1 ? `this ${noun.one}` : `these ${counted(acting.length, noun)}`;
	const parts = [`${verb} ${head}. ${afterwards}`, acting.map((row) => `- ${row.name || "Untitled"}`).join("\n")];
	if (skipped.length > 0) {
		parts.push(`${skippedAs}, so left alone: ${skipped.map((row) => row.name || "Untitled").join(", ")}.`);
	}
	return { summary: `${verb} ${counted(acting.length, noun)}`, preview: parts.join("\n\n") };
}
