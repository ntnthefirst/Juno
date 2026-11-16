import type { DocumentTimelineEntry, DocumentTimelineKind } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { requestOpen } from "../../lib/open-entity";
import { formatInstant } from "./version-format";

type DocumentTimelineProps = {
	entries: DocumentTimelineEntry[];
	/** Jumps the viewer to the version an entry made. */
	onView: (versionId: string) => void;
};

const ICONS: Record<DocumentTimelineKind, IconName> = {
	created: "add",
	generated: "documents",
	imported: "import",
	stamped: "edit",
	signed: "lock",
	edited: "edit",
	converted: "documents",
	emailed: "sent",
};

/** Brass marks signed and sealed and nothing else (brand/BRAND.md). */
function toneClass(kind: DocumentTimelineKind): string {
	return kind === "stamped" || kind === "signed"
		? "bg-[var(--seal-soft)] text-[var(--seal)]"
		: "bg-[var(--sunken)] text-[var(--ink-muted)]";
}

/**
 * Everything that happened to the document, newest first. An entry that made a
 * version opens it in the viewer, and an email opens its conversation in Mail.
 */
export function DocumentTimeline({ entries, onView }: DocumentTimelineProps) {
	if (entries.length === 0) {
		return <p className="py-2 text-sm text-[var(--ink-muted)]">Nothing has happened yet.</p>;
	}

	return (
		<ol>
			{entries.map((entry, index) => {
				const body = (
					<>
						<span className="block text-dense">{entry.title}</span>
						{entry.detail ? (
							<span className="block truncate text-sm text-[var(--ink-muted)]">
								{entry.detail}
							</span>
						) : null}
						<span className="tabular block text-sm text-[var(--ink-muted)]">
							{formatInstant(entry.at)}
						</span>
					</>
				);
				const { versionId, threadId } = entry;
				const open = versionId
					? { run: () => onView(versionId), label: undefined }
					: threadId
						? { run: () => requestOpen({ kind: "thread", id: threadId, messageId: null }), label: "Open the conversation in Mail" }
						: null;
				return (
					<li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
						{index < entries.length - 1 ? (
							<span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--line)]" />
						) : null}
						<span
							className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-full)] ${toneClass(entry.kind)}`}
						>
							<Icon name={ICONS[entry.kind]} size={12} />
						</span>
						{open ? (
							<button
								type="button"
								onClick={open.run}
								title={open.label}
								className="min-w-0 flex-1 rounded-[var(--radius-sm)] text-left hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
							>
								{body}
							</button>
						) : (
							<div className="min-w-0 flex-1">{body}</div>
						)}
					</li>
				);
			})}
		</ol>
	);
}
