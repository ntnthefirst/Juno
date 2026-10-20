import { useEffect, useState } from "react";
import type { DocumentRecord } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { DocumentSearchList } from "../../components/DocumentSearchList";
import { messageOf } from "../../lib/errors";
import { announceDocumentsChanged } from "../../lib/pdf-drop";
import { belongsTo } from "./belongs-to";
import type { DocumentsScope } from "./DocumentsPanel";

type AddExistingDialogProps = {
	scope: DocumentsScope;
	/** The client's or project's name, for the question. */
	name: string;
	onClose: () => void;
	/** Called with the moved document, for the panel's notice. */
	onAdded: (record: DocumentRecord, from: string) => void;
};

/**
 * Puts a document that already exists under this client or project, so a
 * contract imported from the Documents screen or kept from a mail does not
 * have to be opened to be filed. Pick one, then say yes; it is a move, so the
 * question says where it is kept now.
 *
 * Moving it under a client keeps its project only when that project is the
 * client's own. A project brings its client along (decision 48), so moving it
 * under a project files it under that project's client too.
 */
export function AddExistingDialog({ scope, name, onClose, onAdded }: AddExistingDialogProps) {
	const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
	const [search, setSearch] = useState("");
	const [chosen, setChosen] = useState<DocumentRecord | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const clientId = "clientId" in scope ? scope.clientId : null;
	const projectId = "projectId" in scope ? scope.projectId : null;

	useEffect(() => {
		let cancelled = false;
		window.juno.documents
			.list()
			.then((rows) => {
				if (cancelled) return;
				// What is already here is not offered again.
				setDocuments(
					rows.filter((row) => (clientId ? row.clientId !== clientId : row.projectId !== projectId)),
				);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [clientId, projectId]);

	async function add() {
		if (!chosen) return;
		setBusy(true);
		setError(null);
		try {
			const moved = await window.juno.documents.link(
				chosen.id,
				// A project of another client, or of the owner's own, cannot stay
				// attached under this client, so the client alone is asked for.
				clientId ? { clientId, projectId: null } : { clientId: null, projectId },
			);
			announceDocumentsChanged();
			onAdded(moved, belongsTo(chosen));
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	if (chosen) {
		const kept = belongsTo(chosen);
		return (
			<Dialog title="Add an existing document" width="narrow" onClose={onClose}>
				<p className="mt-4">
					Move <span className="font-[var(--weight-medium)]">{chosen.title}</span> to {name}?{" "}
					{chosen.clientId || chosen.projectId
						? `It is kept under ${kept} now, and will not be listed there any more.`
						: "It is not kept under anything now."}
				</p>
				{error ? (
					<p role="alert" data-selectable className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						{error}
					</p>
				) : null}
				<div className="mt-6 flex justify-end gap-2">
					<Button disabled={busy} onClick={() => setChosen(null)}>
						Back
					</Button>
					<Button variant="primary" disabled={busy} onClick={() => void add()}>
						Move here
					</Button>
				</div>
			</Dialog>
		);
	}

	return (
		<Dialog title="Add an existing document" onClose={onClose}>
			<input
				type="search"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				placeholder="Search documents"
				aria-label="Search documents"
				autoFocus
				className="mt-4 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
			/>
			{error ? (
				<p role="alert" data-selectable className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
			<div className="mt-3 max-h-[360px] overflow-y-auto">
				<DocumentSearchList
					documents={documents}
					search={search}
					// Documents kept under nothing are the likeliest to belong here.
					nearby={(record) => record.clientId === null && record.projectId === null}
					nearbyLabel="Not linked yet"
					onPick={setChosen}
					emptyText="Every document is already here."
				/>
			</div>
		</Dialog>
	);
}
