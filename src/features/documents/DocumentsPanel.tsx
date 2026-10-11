import { useCallback, useEffect, useState } from "react";
import type { DocumentRecord } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { MenuButton } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import {
	describeOutcome,
	itemsFromFiles,
	itemsFromPicked,
	onDocumentsChanged,
	type ImportItem,
	type ImportOutcome,
} from "../../lib/pdf-drop";
import { useFileDrop } from "../../lib/use-file-drop";
import { ImportFlow } from "./ImportFlow";
import { VersionCount } from "./VersionCount";
import { VersionList } from "./VersionList";

type DocumentsPanelProps = {
	scope: DocumentsScope;
	/** The client's or project's name, for "Drop to add to ...". */
	name: string;
	/** Starting a document from a template is a page, which the screen owns. */
	onGenerate: () => void;
	/** Opening one is the same viewer the Documents screen shows, which the screen owns too. */
	onOpen: (id: string, title: string) => void;
	/** The client's own counts and timeline are stale once a document is added. */
	onChanged: () => void;
};

/** Whose documents: a client's, or a project's. */
export type DocumentsScope = { clientId: string } | { projectId: string };

type Load =
	| { status: "loading" }
	| { status: "ready"; records: DocumentRecord[] }
	| { status: "error"; message: string };

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

/**
 * A client's or a project's documents, with the two ways to add one. The plus
 * offers a template or an import, and files dropped on the panel are imported
 * for this client or project without being asked which one. A project that has
 * a client brings its client along (document-owner.ts), so a file dropped on
 * a client's project shows on the client's page too.
 */
export function DocumentsPanel({
	scope,
	name,
	onGenerate,
	onOpen,
	onChanged,
}: DocumentsPanelProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [items, setItems] = useState<ImportItem[] | null>(null);
	const [expanded, setExpanded] = useState<string[]>([]);
	const [problems, setProblems] = useState<string[]>([]);
	const [notice, setNotice] = useState<string | null>(null);

	const clientId = "clientId" in scope ? scope.clientId : undefined;
	const projectId = "projectId" in scope ? scope.projectId : undefined;

	const reload = useCallback(() => {
		window.juno.documents
			.list(clientId ? { clientId } : { projectId })
			.then((records) => setLoad({ status: "ready", records }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [clientId, projectId]);

	useEffect(() => {
		reload();
		return onDocumentsChanged(reload);
	}, [reload]);

	async function bring(files: File[]) {
		setProblems([]);
		setNotice(null);
		const { items: read, rejected } = await itemsFromFiles(files);
		setProblems(rejected);
		if (read.length > 0) setItems(read);
	}

	async function choose() {
		setProblems([]);
		setNotice(null);
		try {
			const picked = await window.juno.documents.pickPdfs();
			if (picked.length > 0) setItems(itemsFromPicked(picked));
		} catch (cause: unknown) {
			setProblems([messageOf(cause)]);
		}
	}

	function finished(outcome: ImportOutcome) {
		setItems(null);
		setNotice(describeOutcome(outcome));
		setProblems((current) => [...current, ...outcome.failures.map((entry) => entry.message)]);
		if (outcome.documents + outcome.versions > 0) onChanged();
	}

	function toggle(id: string) {
		setExpanded((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
	}

	const drop = useFileDrop((files) => void bring(files));
	const records = load.status === "ready" ? load.records : [];

	return (
		<section
			{...drop.bind}
			className={`relative rounded-[var(--radius-lg)] ${
				drop.dragging ? "outline-2 outline-dashed outline-offset-4 outline-[var(--accent)]" : ""
			}`}
		>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Documents</h3>
				<MenuButton
					ariaLabel="Add a document"
					items={[
						{ id: "template", label: "From a template", icon: "documents", onSelect: onGenerate },
						{ id: "import", label: "Import a PDF", icon: "import", onSelect: () => void choose() },
					]}
					icon="add"
				/>
			</div>

			{load.status === "loading" ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : load.status === "error" ? (
				<div className="border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the documents.</p>
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{load.message}
					</p>
				</div>
			) : records.length === 0 ? (
				<div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--line-strong)] px-6 py-10 text-center">
					<p className="font-[var(--weight-medium)]">No documents yet</p>
					<p className="mx-auto mt-1 max-w-[46ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						Drop PDF files here, or use the plus to start one from a template or import one. A file that is an existing document again is offered as a new version.
					</p>
				</div>
			) : (
				<ul>
					{records.map((record) => (
						<li key={record.id} className="border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]">
							<div className="flex items-center justify-between gap-4">
							<div className="flex min-w-0 items-center gap-3">
								<span
									aria-hidden
									className="flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--sunken)] text-[var(--ink-muted)]"
								>
									<Icon name="documents" size={14} />
								</span>
								<div className="min-w-0">
									<span data-selectable className="block truncate font-[var(--weight-medium)]">
										{record.title}
									</span>
									<span className="flex items-center gap-2 text-[var(--ink-muted)]">
										{record.sourceKind === "imported" ? "Imported PDF" : "From a template"}
										{record.versionCount > 0 ? (
											<VersionCount
												count={record.versionCount}
												open={expanded.includes(record.id)}
												onToggle={() => toggle(record.id)}
											/>
										) : null}
									</span>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-3">
								<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-faint)]">
									{formatDate(record.issuedOn)}
								</span>
								<Button
									size="dense"
									disabled={record.pdfPath === null}
									onClick={() => onOpen(record.id, record.title)}
								>
									Open
								</Button>
							</div>
							</div>
							{expanded.includes(record.id) ? (
								<div className="mt-2 pl-9">
									<VersionList documentId={record.id} nested />
								</div>
							) : null}
						</li>
					))}
				</ul>
			)}

			{drop.dragging ? (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)]/80">
					<p className="font-[var(--weight-medium)] text-[var(--accent)]">
						Drop to add to {name}
					</p>
				</div>
			) : null}

			{notice ? (
				<p role="status" className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{notice}
				</p>
			) : null}
			{problems.length > 0 ? (
				<div className="mt-3 border-l-2 border-[var(--risk)] pl-4">
					<ul className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{problems.map((message, index) => (
							<li key={`${index}:${message}`} data-selectable>
								{message}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{items ? (
				<ImportFlow
					items={items}
					{...(clientId ? { clientId } : {})}
					{...(projectId ? { projectId } : {})}
					onDone={finished}
				/>
			) : null}
		</section>
	);
}
