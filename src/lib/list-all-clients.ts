import type { ClientSummary } from "@shared/types";

/** The service's own ceiling for one page. */
const PAGE = 1000;

/**
 * Every client that matches, not only the first page the service returns by
 * default (200). A list or a search that stops there hides the rest without a
 * word, so a screen that has to show all of them reads page by page.
 */
export async function listAllClients(search?: string): Promise<ClientSummary[]> {
	const all: ClientSummary[] = [];
	for (;;) {
		const page = await window.juno.clients.list({ search, limit: PAGE, offset: all.length });
		all.push(...page);
		if (page.length < PAGE) return all;
	}
}
