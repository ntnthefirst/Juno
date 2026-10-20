import type { DocumentRecord } from "@shared/types";
import { AttachmentIcon } from "./AttachmentIcon";

type DocumentSearchListProps = {
	documents: DocumentRecord[] | null;
	search: string;
	/**
	 * The ones that belong to what is being worked on, the client of a mail or
	 * the project being added to, listed first under their own heading.
	 */
	nearby?: (record: DocumentRecord) => boolean;
	/** Heading over the nearby ones, such as the client's name. */
	nearbyLabel?: string;
	/** Checkboxes, for picking several. Left out, a row is a button that picks one. */
	checked?: string[];
	onPick: (record: DocumentRecord) => void;
	/** Shown when nothing is listed at all, before a search narrows it. */
	emptyText: string;
};

/** Where it is kept, the way a row says it: "Acme / Website", or "Not linked". */
function placeOf(record: DocumentRecord): string {
	return [record.clientName, record.projectName].filter(Boolean).join(" / ") || "Not linked";
}

/** Every word typed appears somewhere in the title or where it is kept. */
function matches(record: DocumentRecord, search: string): boolean {
	const haystack = `${record.title} ${record.clientName ?? ""} ${record.projectName ?? ""}`.toLowerCase();
	return search
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}

/**
 * Documents to choose from, narrowed by a search, with the ones nearest to the
 * task first. One list for attaching to a mail and for adding an existing
 * document to a client or project, so the two read the same.
 */
export function DocumentSearchList({
	documents,
	search,
	nearby,
	nearbyLabel,
	checked,
	onPick,
	emptyText,
}: DocumentSearchListProps) {
	if (documents === null) return <p className="px-2 py-2 text-[var(--ink-muted)]">Loading.</p>;
	if (documents.length === 0) {
		return <p className="px-2 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{emptyText}</p>;
	}

	const found = documents.filter((record) => matches(record, search));
	if (found.length === 0) {
		return (
			<p className="px-2 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				No document matches "{search.trim()}".
			</p>
		);
	}
	const near = nearby ? found.filter(nearby) : [];
	const rest = nearby ? found.filter((record) => !nearby(record)) : found;
	const groups = [
		{ key: "near", label: nearbyLabel ?? null, rows: near },
		{ key: "rest", label: near.length > 0 ? "Everything else" : null, rows: rest },
	].filter((group) => group.rows.length > 0);

	return (
		<div>
			{groups.map((group) => (
				<div key={group.key}>
					{group.label ? (
						<p className="px-2 pt-2 pb-1 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
							{group.label}
						</p>
					) : null}
					<ul>
						{group.rows.map((record) => {
							const name = `${record.title}.pdf`;
							const body = (
								<>
									<AttachmentIcon filename={name} mimeType="application/pdf" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[length:var(--text-dense)]">{record.title}</span>
										<span className="block truncate text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{placeOf(record)}
										</span>
									</span>
									{record.isSpecimen ? (
										<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--risk)]">specimen</span>
									) : null}
								</>
							);
							return (
								<li key={record.id}>
									{checked ? (
										<label
											className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-2 hover:bg-[var(--hover)]"
											style={{ height: "var(--row-height-roomy)" }}
										>
											<input
												type="checkbox"
												className="accent-[var(--accent)]"
												checked={checked.includes(record.id)}
												onChange={() => onPick(record)}
											/>
											{body}
										</label>
									) : (
										<button
											type="button"
											onClick={() => onPick(record)}
											className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
											style={{ height: "var(--row-height-roomy)" }}
										>
											{body}
										</button>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</div>
	);
}
