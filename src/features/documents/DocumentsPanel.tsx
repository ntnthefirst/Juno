import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { DocumentPlace, DocumentRecord, ReferenceItem } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { MenuButton } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import type { ListCommand } from "../../lib/list-keys";
import { NO_SELECTION, pruneSelection, type ListSelection } from "../../lib/list-selection";
import { contextMenuFor } from "../../lib/native-menu";
import { describeOutcome, itemsFromFiles, itemsFromPicked, onDocumentsChanged, type ImportItem, type ImportOutcome } from "../../lib/pdf-drop";
import { useFileDrop } from "../../lib/use-file-drop";
import { AddExistingDialog } from "./AddExistingDialog";
import { AddFilesFlow } from "./AddFilesFlow";
import { documentItem, nextSort, sortItems, type ExplorerItem, type ExplorerSort } from "./explorer-items";
import { ExplorerView } from "./ExplorerView";

type DocumentsPanelProps = {
	scope: DocumentsScope;
	/** The client's or project's name, for "Drop to add to ...". */
	name: string;
	/** Starting a document from a template is a page, which the screen owns. */
	onGenerate: () => void;
	/** A click previews the document in the explorer (requestOpen with the document), which the screen asks for. */
	onOpen: (id: string, title: string) => void;
	/** The client's own counts and timeline are stale once a document is added. */
	onChanged: () => void;
};

/** Whose documents: a client's, or a project's. */
export type DocumentsScope = { clientId: string } | { projectId: string };

type Load =
	| { status: "loading" }
	| { status: "ready"; records: DocumentRecord[]; statuses: ReferenceItem[] }
	| { status: "error"; message: string };

/**
 * A client's or a project's documents, any kind of file, in the same rows the
 * explorer draws and with the same clicks (decision 75): one click opens the
 * document's preview in Documents, a double click opens the file in its own
 * app. Files dropped on the panel, or chosen with Add files, are kept for this
 * client or project, and one that looks like a document already here is shown
 * beside it first. A project that has a client brings its client along
 * (document-owner.ts), so a file dropped on a client's project shows on the
 * client's page too.
 */
export function DocumentsPanel({ scope, name, onGenerate, onOpen, onChanged }: DocumentsPanelProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [items, setItems] = useState<ImportItem[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [addingExisting, setAddingExisting] = useState(false);
	const [heldSelection, setSelection] = useState<ListSelection>(NO_SELECTION);
	const [sort, setSort] = useState<ExplorerSort>({ by: "modified", descending: true });
	const [renaming, setRenaming] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<DocumentRecord[] | null>(null);

	const clientId = "clientId" in scope ? scope.clientId : undefined;
	const projectId = "projectId" in scope ? scope.projectId : undefined;
	const place: DocumentPlace = { clientId: clientId ?? null, projectId: projectId ?? null, folderId: null };

	const reload = useCallback(() => {
		Promise.all([
			window.juno.documents.list(clientId ? { clientId } : { projectId }),
			window.juno.reference.getSet("document_status"),
		])
			.then(([records, set]) => setLoad({ status: "ready", records, statuses: set ? set.items : [] }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [clientId, projectId]);

	useEffect(() => {
		reload();
		return onDocumentsChanged(reload);
	}, [reload]);

	const records = useMemo(() => (load.status === "ready" ? load.records : []), [load]);
	const statusLabels = useMemo(
		() => new Map((load.status === "ready" ? load.statuses : []).map((item) => [item.id, item.label])),
		[load],
	);
	const shown = useMemo(() => sortItems(records.map(documentItem), sort), [records, sort]);
	const keys = useMemo(() => shown.map((item) => item.key), [shown]);

	const selection = useMemo(() => pruneSelection(heldSelection, keys), [heldSelection, keys]);

	const selected = shown.flatMap((item) =>
		item.kind === "document" && selection.selected.includes(item.key) ? [item.record] : [],
	);

	async function bring(files: File[]) {
		setNotice(null);
		const read = await itemsFromFiles(files);
		if (read.length > 0) setItems(read);
	}

	async function choose() {
		setNotice(null);
		try {
			const picked = await window.juno.documents.pickFiles();
			if (picked.length > 0) setItems(itemsFromPicked(picked));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function finished(outcome: ImportOutcome) {
		setItems(null);
		const failures = outcome.failures.map((entry) => `${entry.name}: ${entry.message}`).join(" ");
		setNotice([describeOutcome(outcome), failures].filter(Boolean).join(" ") || null);
		if (outcome.documents + outcome.versions > 0) onChanged();
	}

	function preview(record: DocumentRecord) {
		onOpen(record.id, record.title);
	}

	async function openOutside(record: DocumentRecord) {
		if (record.sourceKind === "page" || !record.latestVersion) {
			preview(record);
			return;
		}
		try {
			const opened = await window.juno.documents.open(record.id);
			if (opened.readOnly) setNotice(`${record.title} opened read only, because it is signed.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function act(work: () => Promise<unknown>, done?: string) {
		try {
			await work();
			if (done) setNotice(done);
			reload();
			onChanged();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function command(next: ListCommand) {
		if (next.kind === "rename" && selected.length === 1) setRenaming(`doc:${selected[0]!.id}`);
		else if (next.kind === "delete" && selected.length > 0) setConfirm(selected);
		else if (next.kind === "duplicate") {
			const files = selected.filter((record) => record.latestVersion !== null);
			if (files.length > 0) {
				void act(async () => {
					for (const record of files) await window.juno.documents.duplicate(record.id);
				}, files.length === 1 ? `${files[0]!.title} duplicated.` : `${files.length} documents duplicated.`);
			}
		}
	}

	function itemMenu(item: ExplorerItem, event: MouseEvent) {
		if (item.kind !== "document") return;
		const { record } = item;
		contextMenuFor(
			{ kind: "file", id: record.id },
			{
				preview: () => preview(record),
				open: () => preview(record),
				// Copy to, Move to, Convert and Sign are the explorer's, where the record's folder is open.
				"copy-to": () => preview(record),
				"move-to": () => preview(record),
				"convert-pdf": () => preview(record),
				sign: () => preview(record),
				rename: () => setRenaming(item.key),
				delete: () => setConfirm(selected.some((other) => other.id === record.id) && selected.length > 1 ? selected : [record]),
				done: (message) => {
					reload();
					onChanged();
					if (message) setNotice(message);
				},
				failed: setNotice,
			},
		)(event);
	}

	const drop = useFileDrop((files) => void bring(files));

	return (
		<section
			{...drop.bind}
			className={`relative rounded-[var(--radius-lg)] ${
				drop.dragging ? "outline-2 outline-dashed outline-offset-4 outline-[var(--accent)]" : ""
			}`}
		>
			<div className="mb-3 flex items-center justify-between gap-4">
				<h3 className="text-h3">Documents</h3>
				<div className="flex items-center gap-1">
					<Button size="dense" onClick={() => void choose()}>
						Add files
					</Button>
					<MenuButton
						ariaLabel="Add a document"
						items={[
							{ id: "template", label: "From a template", icon: "documents", onSelect: onGenerate },
							{ id: "import", label: "Add files", icon: "import", onSelect: () => void choose() },
							{
								id: "existing",
								label: "Add an existing document",
								icon: "link",
								onSelect: () => {
									setNotice(null);
									setAddingExisting(true);
								},
							},
						]}
						label="New"
						icon="add"
					/>
				</div>
			</div>

			{load.status === "error" ? (
				<div className="border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the documents.</p>
					<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
						{load.message}
					</p>
				</div>
			) : load.status === "loading" ? (
				<div aria-hidden className="flex flex-col gap-2 py-2">
					{Array.from({ length: 3 }, (_, at) => (
						<span key={at} className="h-5 animate-pulse rounded-[var(--radius-sm)] bg-[var(--sunken)]" style={{ width: `${70 - at * 12}%` }} />
					))}
				</div>
			) : (
				<div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
					<ExplorerView
						items={shown}
						view="list"
						selection={selection}
						onSelection={setSelection}
						statusLabels={statusLabels}
						sort={sort}
						onSort={(by) => setSort((current) => nextSort(current, by))}
						renamingKey={renaming}
						onRename={(item, title) => {
							setRenaming(null);
							if (item.kind === "document") void act(() => window.juno.documents.rename(item.record.id, title));
						}}
						onRenameEnd={() => setRenaming(null)}
						cutKeys={new Set()}
						onActivate={(item, how) => {
							if (item.kind !== "document") return;
							if (how === "open") void openOutside(item.record);
							else preview(item.record);
						}}
						onCommand={command}
						onItemMenu={itemMenu}
						dragOf={() => null}
						canDropOn={() => false}
						onDropOn={() => undefined}
						label={`Documents of ${name}`}
						empty={
							<div className="px-6 py-10 text-center">
								<p className="font-[var(--weight-medium)]">No documents yet</p>
								<p className="mx-auto mt-1 max-w-[46ch] text-dense text-[var(--ink-muted)]">
									Drop any files here, or press Add files. A file that looks like a document already here is shown beside it
									first.
								</p>
							</div>
						}
					/>
				</div>
			)}

			{drop.dragging ? (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)]/80">
					<p className="font-[var(--weight-medium)] text-[var(--accent)]">Drop to add to {name}</p>
				</div>
			) : null}

			{notice ? (
				<p role="status" data-selectable className="mt-3 text-sm text-[var(--ink-muted)]">
					{notice}
				</p>
			) : null}
			{addingExisting ? (
				<AddExistingDialog
					scope={scope}
					name={name}
					onClose={() => setAddingExisting(false)}
					onAdded={(record, from) => {
						setAddingExisting(false);
						setNotice(from === "Not linked" ? `${record.title} added.` : `${record.title} moved here from ${from}.`);
						reload();
						onChanged();
					}}
				/>
			) : null}
			{confirm ? (
				<Dialog title="Delete" width="narrow" onClose={() => setConfirm(null)}>
					<p className="mt-3 text-base">
						{confirm.length === 1 ? `Delete ${confirm[0]!.title}?` : `Delete ${confirm.length} documents?`} They go from this list
						and from Documents.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirm(null)}>Cancel</Button>
						<Button
							variant="danger"
							onClick={() => {
								const gone = confirm;
								setConfirm(null);
								void act(async () => {
									for (const record of gone) await window.juno.documents.remove(record.id);
								}, gone.length === 1 ? `${gone[0]!.title} deleted.` : `${gone.length} documents deleted.`);
							}}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
			{items ? <AddFilesFlow items={items} place={place} placeName={name} onDone={finished} /> : null}
		</section>
	);
}
