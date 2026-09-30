import type { DocumentVersion, DocumentVersionKind, DocumentVersionSource } from "@shared/types";

export const KIND_LABELS: Record<DocumentVersionKind, string> = {
	generated: "Generated",
	imported: "Imported",
	stamped: "Stamped",
	signed: "Signed digitally",
};

export const SOURCE_LABELS: Record<DocumentVersionSource, string> = {
	generate: "Made in Juno",
	picker: "Chosen from a folder",
	drop: "Dropped in",
	mail: "From a mail",
	sign: "Signed in Juno",
	agent: "Added by the agent",
};

/** Brass is for signed and sealed only (brand/BRAND.md), so it marks those two. */
export function kindClass(kind: DocumentVersionKind): string {
	return kind === "stamped" || kind === "signed"
		? "bg-[var(--seal-soft)] text-[var(--seal)]"
		: "bg-[var(--sunken)] text-[var(--ink-muted)]";
}

/** An instant, in the reader's own time zone: dd/mm/yyyy hh:mm. */
export function formatInstant(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function detailOf(version: DocumentVersion): string {
	const parts = [SOURCE_LABELS[version.source]];
	if (version.signerName) parts.push(`by ${version.signerName}`);
	if (version.digital) parts.push(`certificate of ${version.digital.subject}`);
	if (version.fileName && version.kind === "imported") parts.push(version.fileName);
	return parts.join(", ");
}
