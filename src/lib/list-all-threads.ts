import type { MailThreadListQuery, MailThreadSummary } from "@shared/types";

/** The service's own ceiling for one page. */
const PAGE = 500;

/**
 * Every conversation that matches, for a list with no search in it. A thread
 * list that stops at the service's default page hides the rest without a word,
 * so the lists that mean "all of them" (a client's mail, a project's mail, the
 * unread count) read page by page.
 */
export async function listAllThreads(query: Omit<MailThreadListQuery, "limit" | "offset" | "search">): Promise<MailThreadSummary[]> {
	const all: MailThreadSummary[] = [];
	for (;;) {
		const page = await window.juno.mail.threads.list({ ...query, limit: PAGE, offset: all.length });
		all.push(...page);
		if (page.length < PAGE) return all;
	}
}
