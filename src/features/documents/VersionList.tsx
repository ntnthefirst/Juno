import { useCallback, useEffect, useState } from "react";
import type { DocumentVersion, DocumentVersionKind, DocumentVersionSource } from "@shared/types";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { onDocumentsChanged } from "../../lib/pdf-drop";

type VersionListProps = {
	documentId: string;
	/** Under a row in a list, rather than a section of its own on the detail page. */
	nested?: boolean;
};

const KIND_LABELS: Record<DocumentVersionKind, string> = {
	generated: "Generated",
	imported: "Imported",
	stamped: "Stamped",
	signed: "Signed digitally",
};

const SOURCE_LABELS: Record<DocumentVersionSource, string> = {
	generate: "Made in Juno",
	picker: "Chosen from a folder",
	drop: "Dropped in",
	mail: "From a mail",
	sign: "Signed in Juno",
	agent: "Added by the agent",
};

/** Brass is for signed and sealed only (brand/BRAND.md), so it marks those two. */
function kindClass(kind: DocumentVersionKind): string {
	return kind === "stamped" || kind === "signed"
		? "bg-[var(--seal-soft)] text-[var(--seal)]"
		: "bg-[var(--sunken)] text-[var(--ink-muted)]";
}

/** An instant, in the reader's own time zone: dd/mm/yyyy hh:mm. */
function formatInstant(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function detailOf(version: DocumentVersion): string {
	const parts = [SOURCE_LABELS[version.source]];
	if (version.signerName) parts.push(`by ${version.signerName}`);
	if (version.digital) parts.push(`certificate of ${version.digital.subject}`);
	if (version.fileName && version.kind === "imported") parts.push(version.fileName);
	return parts.join(", ");
}

/**
 * Every file a document has been, newest first. The newest is the one the
 * document opens as, and says so; the others open on their own from here.
 */
export function VersionList({ documentId, nested = false }: VersionListProps) {
	const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		window.juno.documents
			.versions(documentId)
			.then(setVersions)
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, [documentId]);

	useEffect(() => {
		load();
		return onDocumentsChanged(load);
	}, [load]);

	async function run(work: () => Promise<void>) {
		setError(null);
		try {
			await work();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	if (versions === null) {
		return error ? (
			<p className="py-2 text-[length:var(--text-sm)] text-[var(--risk)]">{error}</p>
		) : (
			<p className="py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Loading.</p>
		);
	}

	if (versions.length === 0) {
		return (
			<p className="py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				No versions yet. The first one is made when the PDF is created.
			</p>
		);
	}

	return (
		<div>
			<ol className={nested ? "border-l-2 border-[var(--line)] pl-3" : ""}>
				{versions.map((version) => (
					<li
						key={version.id}
						className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-1.5 text-[length:var(--text-dense)] last:border-b-0"
						style={{ minHeight: "var(--row-height)" }}
					>
						<div className="flex min-w-0 items-center gap-3">
							<span className="tabular w-7 shrink-0 text-[var(--ink-muted)]">v{version.number}</span>
							<span
								className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${kindClass(version.kind)}`}
							>
								{KIND_LABELS[version.kind]}
							</span>
							{version.isLatest ? (
								<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--accent)]">
									Latest
								</span>
							) : null}
							<span data-selectable className="min-w-0 truncate text-[var(--ink-muted)]">
								{detailOf(version)}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<span className="tabular mr-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{formatInstant(version.fileDate)}
							</span>
							<Button size="dense" onClick={() => void run(() => window.juno.documents.openVersion(version.id))}>
								Open
							</Button>
							{version.hasCertificate ? (
								<Button size="dense" onClick={() => void run(() => window.juno.documents.openCertificate(version.id))}>
									Certificate
								</Button>
							) : null}
							<Button size="dense" onClick={() => void run(() => window.juno.documents.revealVersion(version.id))}>
								Show in folder
							</Button>
						</div>
					</li>
				))}
			</ol>
			{error ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">{error}</p> : null}
		</div>
	);
}
