import type { ExplorerItem } from "./explorer-items";

/** The Status column: a signature first, because it is the one thing a list of contracts is scanned for. */
export type ItemStatus = { text: string; tone: "seal" | "risk" | "muted" } | null;

export function statusOf(item: ExplorerItem, labels: ReadonlyMap<string, string>): ItemStatus {
	if (item.kind === "template") return item.template.reviewedAt === null ? { text: "Not reviewed", tone: "risk" } : null;
	if (item.kind !== "document") return null;
	const { record } = item;
	const kind = record.latestVersion?.kind;
	if (kind === "signed" || kind === "stamped") return { text: "Signed", tone: "seal" };
	if (record.statusId) {
		const label = labels.get(record.statusId);
		if (label) return { text: label, tone: "muted" };
	}
	return null;
}

export const STATUS_TONES: Record<NonNullable<ItemStatus>["tone"], string> = {
	seal: "text-[var(--seal)]",
	risk: "text-[var(--risk)]",
	muted: "text-[var(--ink-muted)]",
};
