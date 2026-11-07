import { useCallback, useState } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { useLoaded } from "../../lib/use-loaded";
import { notePreview, noteTitle, rowTime } from "./note-format";

type LinkedNotesProps = {
	projectId: string;
};

/**
 * The notes kept under a project, as File Row draws a file: a tile for the
 * kind, the title with what it is under it, and when it was last touched at the
 * right. Pages are documents, so they are already in the project's documents
 * above; this is the rest of what is written down about the work.
 */
export function LinkedNotes({ projectId }: LinkedNotesProps) {
	const load = useCallback(() => window.juno.notes.list({ projectId }), [projectId]);
	const notes = useLoaded(load);
	const [error, setError] = useState<string | null>(null);

	async function add() {
		try {
			const note = await window.juno.notes.create({ projectId });
			requestOpen({ kind: "note", id: note.id });
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	if (notes.status !== "ready") return null;

	return (
		<section aria-label="Notes">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-h3 text-[var(--ink)]">Notes</h2>
				<Button size="dense" onClick={() => void add()}>
					<Icon name="add" />
					Add a note
				</Button>
			</div>
			{error ? (
				<p role="alert" data-selectable className="mb-2 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					{error}
				</p>
			) : null}
			{notes.value.length === 0 ? (
				<p className="text-sm text-[var(--ink-muted)]">No notes under this project yet.</p>
			) : (
				<ul className="flex flex-col">
					{notes.value.map((note) => (
						<li key={note.id} className="border-b border-[var(--line)]">
							<button
								type="button"
								onClick={() => requestOpen({ kind: "note", id: note.id })}
								className="flex h-14 w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left hover:bg-[var(--hover)]"
							>
								<span
									aria-hidden
									className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]"
								>
									<Icon name="note" size={16} />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-base text-[var(--ink)]">{noteTitle(note)}</span>
									<span className="block truncate text-sm text-[var(--ink-muted)]">
										{["Note", note.clientName, notePreview(note)].filter(Boolean).join(" · ")}
									</span>
								</span>
								<span className="tabular flex-none text-dense text-[var(--ink-muted)]">{rowTime(note.updatedAt)}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
