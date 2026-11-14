import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { openedNotice } from "@shared/opened";
import type { DocumentRecord } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { MenuButton } from "../../components/Menu";
import { RowsSkeleton } from "../../components/RowsSkeleton";
import { Segmented } from "../../components/Segmented";
import { Toast } from "../../components/Toast";
import { ToolbarButton } from "../../components/ToolbarButton";
import { blankMenuFor } from "../../lib/blank-menu";
import { dragDocumentsOut } from "../../lib/document-drag";
import { messageOf } from "../../lib/errors";
import type { ListCommand } from "../../lib/list-keys";
import { NO_SELECTION, pruneSelection, selectOnly, type ListSelection } from "../../lib/list-selection";
import { contextMenuFor } from "../../lib/native-menu";
import { requestOpen } from "../../lib/open-entity";
import {
	announceDocumentsChanged,
	BUSY_ADDING,
	describeOutcome,
	itemsFromFiles,
	itemsFromPicked,
	type ImportItem,
	type ImportOutcome,
} from "../../lib/pdf-drop";
import { useFileDrop } from "../../lib/use-file-drop";
import { useRecentTouch } from "../../lib/use-recent-touch";
import { AddExistingDialog } from "./AddExistingDialog";
import { AddFilesFlow } from "./AddFilesFlow";
import { DocumentDetail } from "./DocumentDetail";
import { convertToPdf, needsConversion } from "./document-flows";
import type { DocumentTakeoverRequest } from "./DocumentTakeover";
import { readClipboard, writeClipboard } from "./explorer-clipboard";
import { documentItem, documentKey, nameOf, nextSort, sortItems, type ExplorerItem, type ExplorerSort } from "./explorer-items";
import { readPrefs, writePrefs } from "./explorer-prefs";
import { ExplorerView } from "./ExplorerView";
import { placeKeyOf, type PlaceOption } from "./place-options";
import { RecordPickerDialog } from "./RecordPickerDialog";
import { useRecordDocuments, type DocumentsScope } from "./use-record-documents";

export type { DocumentsScope } from "./use-record-documents";

type DocumentsPanelProps = {
	scope: DocumentsScope;
	/** The client's or project's name, for "Drop to add to ..." and the way back from a preview. */
	name: string;
	/** A document asked for from elsewhere, previewed once the list is in. */
	openDocumentId?: string | null;
	/** Told once that document is shown, so coming back to the tab later does not show it again. */
	onOpenedDocument?: () => void;
	/** The record's own counts and timeline are stale once a document is added or goes. */
	onChanged: () => void;
	/** Signing, sending and writing a page are pages, which the screen shows in place of the record. */
	onTakeOver: (request: DocumentTakeoverRequest) => void;
	/** Drawn under the documents, inside the same drop: a project's own files. */
	children?: ReactNode;
};

type Picker = {
	mode: "copy" | "move";
	records: DocumentRecord[];
	current: string | null;
};

const VIEW_OPTIONS = [
	{ id: "list" as const, icon: "list" as const, name: "List" },
	{ id: "grid" as const, icon: "grid" as const, name: "Tiles" },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A client's or a project's Documents tab: the file handling the explorer had,
 * for that record and without a tree (decisions 75 and 81). A list or tiles,
 * sorted by any column. One click previews over the content area and closing
 * comes back here, a double click opens the file in its own app. Files
 * dropped on the tab, or chosen with Add files, are kept for this record, and
 * one that looks like a document already here is shown beside it first.
 *
 * A client's tab lists the documents of its projects too, with the project in
 * a column of its own. The documents kept under neither are listed the same
 * way, on the page the Overview card opens, where the only thing to do with
 * one is to give it a client or a project.
 */
export function DocumentsPanel({ scope, name, openDocumentId = null, onOpenedDocument, onChanged, onTakeOver, children }: DocumentsPanelProps) {
	const [prefs] = useState(readPrefs);
	const { load, reload, changedOutside } = useRecordDocuments(scope);
	const [view, setView] = useState(prefs.view);
	const [sort, setSort] = useState<ExplorerSort>(prefs.sort);
	const [details, setDetails] = useState(prefs.details);
	const [items, setItems] = useState<ImportItem[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [addingExisting, setAddingExisting] = useState(false);
	const [heldSelection, setSelection] = useState<ListSelection>(() =>
		openDocumentId ? selectOnly(documentKey(openDocumentId)) : NO_SELECTION,
	);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<DocumentRecord[] | null>(null);
	const [deleted, setDeleted] = useState<DocumentRecord[] | null>(null);
	const [picker, setPicker] = useState<Picker | null>(null);
	const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
	const [clip, setClip] = useState(readClipboard);
	// The document asked for from elsewhere is shown once, when the list it is in has been read.
	const asked = useRef(openDocumentId);

	const unfiled = "unfiled" in scope;
	const clientId = "clientId" in scope ? scope.clientId : null;
	const projectId = "projectId" in scope ? scope.projectId : null;
	const here = clientId ? { clientId, projectId: null } : projectId ? { clientId: null, projectId } : null;
	const hereKey = clientId ? `client:${clientId}` : projectId ? `project:${projectId}` : null;

	useEffect(() => writePrefs({ view }), [view]);
	useEffect(() => writePrefs({ sort }), [sort]);
	useEffect(() => writePrefs({ details }), [details]);
	useRecentTouch("document", preview?.id ?? null);

	const records = useMemo(() => (load.status === "ready" ? load.records : []), [load]);
	const statusLabels = useMemo(() => new Map((load.status === "ready" ? load.statuses : []).map((item) => [item.id, item.label])), [load]);
	const shown = useMemo(() => sortItems(records.map(documentItem), sort), [records, sort]);
	const keys = useMemo(() => shown.map((item) => item.key), [shown]);
	const byKey = useMemo(() => new Map(shown.map((item) => [item.key, item])), [shown]);
	const selection = useMemo(() => pruneSelection(heldSelection, keys), [heldSelection, keys]);
	const selected = shown.flatMap((item) => (item.kind === "document" && selection.selected.includes(item.key) ? [item.record] : []));
	const cutKeys = useMemo(() => new Set(clip && clip.mode === "cut" ? clip.ids.map(documentKey) : []), [clip]);

	const changed = () => {
		announceDocumentsChanged();
		reload();
		onChanged();
	};

	/* ---------------------------------------------------------- opening */

	function show(record: DocumentRecord) {
		setSelection(selectOnly(documentKey(record.id)));
		if (record.sourceKind === "page") onTakeOver({ kind: "page", record });
		else setPreview({ id: record.id, title: record.title });
	}

	// What Previous and Next go through: the files of the list, in its order. A page opens as a page.
	const previewable = shown.flatMap((item) => (item.kind === "document" && item.record.sourceKind !== "page" ? [item.record] : []));
	const previewIndex = preview ? previewable.findIndex((record) => record.id === preview.id) : -1;
	const position =
		previewIndex >= 0
			? {
					index: previewIndex,
					total: previewable.length,
					onPrevious: () => {
						const before = previewable[previewIndex - 1];
						if (before) show(before);
					},
					onNext: () => {
						const after = previewable[previewIndex + 1];
						if (after) show(after);
					},
				}
			: null;

	useEffect(() => {
		const wanted = asked.current;
		if (!wanted || load.status !== "ready") return;
		asked.current = null;
		onOpenedDocument?.();
		const record = load.records.find((entry) => entry.id === wanted);
		if (record?.sourceKind === "page") onTakeOver({ kind: "page", record });
		// Shown even when it is not listed here, such as one moved away since the link was made.
		else setPreview({ id: wanted, title: record?.title ?? "Document" });
	}, [load, onTakeOver, onOpenedDocument]);

	/** Closes the preview with the focus on the row of the file it ended on, so the arrow keys carry on from there. */
	function closePreview() {
		const key = preview ? documentKey(preview.id) : null;
		setPreview(null);
		if (!key) return;
		window.requestAnimationFrame(() => {
			const row = document.querySelector<HTMLElement>(`[data-explorer-item="${CSS.escape(key)}"]`);
			row?.focus({ preventScroll: true });
			row?.scrollIntoView({ block: "nearest" });
		});
	}

	async function openOutside(record: DocumentRecord) {
		if (record.sourceKind === "page" || !record.latestVersion) {
			show(record);
			return;
		}
		try {
			const opened = await window.juno.documents.open(record.id);
			const said = openedNotice(record.title, opened);
			if (said) setNotice(said);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	/* ----------------------------------------------------------- adding */

	/** A second batch while the first is still being asked about would take over its place in the flow. */
	function start(next: ImportItem[]) {
		if (next.length === 0) return;
		if (items) setNotice(BUSY_ADDING);
		else setItems(next);
	}

	async function bring(files: File[]) {
		if (!here) {
			setNotice("Open a client or a project to add files to it.");
			return;
		}
		setNotice(null);
		start(await itemsFromFiles(files));
	}

	async function choose() {
		setNotice(null);
		try {
			start(itemsFromPicked(await window.juno.documents.pickFiles()));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function finished(outcome: ImportOutcome) {
		setItems(null);
		const failures = outcome.failures.map((entry) => `${entry.name}: ${entry.message}`).join(" ");
		setNotice([describeOutcome(outcome), failures].filter(Boolean).join(" ") || null);
		if (outcome.documents + outcome.versions > 0) {
			reload();
			onChanged();
		}
	}

	/** A page is a document with no file, made empty here and opened to write in. */
	async function newPage() {
		if (!here) return;
		try {
			const page = await window.juno.pages.create(here);
			changed();
			onTakeOver({ kind: "page", record: page.document });
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	/** The Templates screen, from here: a document made there is kept with this record. */
	const openTemplates = () => {
		if (here) requestOpen({ kind: "templates", place: { ...here, name } });
	};

	/* ---------------------------------------------------------- actions */

	async function act(work: () => Promise<unknown>, done?: string) {
		try {
			await work();
			if (done) setNotice(done);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
		changed();
	}

	function copyOrMove(mode: Picker["mode"], chosen: DocumentRecord[], target: PlaceOption) {
		const what = chosen.length === 1 ? chosen[0]!.title : plural(chosen.length, "document", "documents");
		const into = { clientId: target.clientId, projectId: target.projectId };
		void act(
			async () => {
				for (const record of chosen) {
					if (mode === "copy") await window.juno.documents.copyTo(record.id, into);
					else await window.juno.documents.move(record.id, into);
				}
			},
			`${what} ${mode === "copy" ? "copied" : "moved"} to ${target.name}.`,
		);
	}

	async function convert(record: DocumentRecord, then?: (converted: DocumentRecord) => void) {
		try {
			const done = await convertToPdf(record);
			setNotice(done.notice);
			changed();
			then?.(done.record);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function sign(record: DocumentRecord) {
		if (needsConversion(record)) void convert(record, (converted) => onTakeOver({ kind: "sign", record: converted }));
		else onTakeOver({ kind: "sign", record });
	}

	function duplicate(chosen: DocumentRecord[]) {
		const files = chosen.filter((record) => record.latestVersion !== null);
		if (files.length === 0) return;
		void act(
			async () => {
				for (const record of files) await window.juno.documents.duplicate(record.id);
			},
			files.length === 1 ? `${files[0]!.title} duplicated.` : `${files.length} documents duplicated.`,
		);
	}

	function copyOrCut(mode: "copy" | "cut") {
		const ids = selected.map((record) => record.id);
		if (ids.length === 0) return;
		writeClipboard({ mode, ids });
		setClip(readClipboard());
		setNotice(
			mode === "copy"
				? `${plural(ids.length, "document", "documents")} copied. Open a client or a project and paste.`
				: `${plural(ids.length, "document", "documents")} cut. Open a client or a project and paste to move.`,
		);
	}

	async function paste() {
		const held = readClipboard();
		if (!held || !here) return;
		// Cut and pasted where it already is: nothing moves, and the cut is let go, as in Explorer.
		const ids = held.mode === "cut" ? held.ids.filter((id) => !byKey.has(documentKey(id))) : held.ids;
		try {
			for (const id of ids) {
				if (held.mode === "copy") await window.juno.documents.copyTo(id, here);
				else await window.juno.documents.move(id, here);
			}
			if (held.mode === "cut") writeClipboard(null);
			setClip(readClipboard());
			if (ids.length > 0)
				setNotice(`${plural(ids.length, "document", "documents")} ${held.mode === "copy" ? "copied" : "moved"} to ${name}.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
		if (ids.length > 0) changed();
	}

	async function remove(gone: DocumentRecord[]) {
		const removed: DocumentRecord[] = [];
		try {
			for (const record of gone) removed.push(await window.juno.documents.remove(record.id));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
		if (preview && gone.some((record) => record.id === preview.id)) setPreview(null);
		setSelection(NO_SELECTION);
		changed();
		if (removed.length > 0) setDeleted(removed);
	}

	async function restore() {
		const back = deleted;
		setDeleted(null);
		if (!back) return;
		await act(async () => {
			for (const record of back) await window.juno.documents.restore(record.id);
		});
	}

	function command(next: ListCommand) {
		switch (next.kind) {
			case "rename":
				if (selected.length === 1) setRenaming(documentKey(selected[0]!.id));
				return;
			case "delete":
				if (selected.length > 0) setConfirm(selected);
				return;
			case "duplicate":
				duplicate(selected);
				return;
			case "copy":
				copyOrCut("copy");
				return;
			case "cut":
				copyOrCut("cut");
				return;
			case "paste":
				void paste();
				return;
			default:
				return;
		}
	}

	const pickFor = (mode: Picker["mode"], chosen: DocumentRecord[]) =>
		setPicker({
			mode,
			records: chosen,
			current: mode === "move" && chosen.length === 1 ? placeKeyOf(chosen[0]!) : null,
		});

	function itemMenu(item: ExplorerItem, event: MouseEvent) {
		if (item.kind !== "document") return;
		const { record } = item;
		// An action on one of several selected rows is an action on all of them.
		const together = selected.some((other) => other.id === record.id) && selected.length > 1 ? selected : [record];
		contextMenuFor(
			{ kind: "file", id: record.id },
			{
				preview: () => show(record),
				// The registry offers Open as `open` only for a page; a file's Open is the
				// main process's `open-in-default-app`. Either way it does what Enter does.
				open: () => void openOutside(record),
				"copy-to": () => pickFor("copy", together),
				"move-to": () => pickFor("move", together),
				"convert-pdf": () => void convert(record),
				sign: () => sign(record),
				"send-file": () => onTakeOver({ kind: "send", record }),
				rename: () => setRenaming(item.key),
				delete: () => setConfirm(together),
				done: (message) => {
					changed();
					if (message) setNotice(message);
				},
				failed: setNotice,
				notice: setNotice,
			},
		)(event);
	}

	const blankMenu = here
		? blankMenuFor("documents", {
				"add-files": () => void choose(),
				"new-page": () => void newPage(),
				"new-document": openTemplates,
			})
		: undefined;

	const drop = useFileDrop((files) => void bring(files));

	/* ------------------------------------------------------------- draw */

	const count =
		load.status !== "ready"
			? ""
			: selection.selected.length > 1
				? `${selection.selected.length} of ${shown.length} selected`
				: plural(shown.length, "document", "documents");

	const previewItem = preview ? byKey.get(documentKey(preview.id)) : undefined;

	return (
		<>
			<section
				{...(here ? drop.bind : {})}
				aria-label={`Documents of ${name}`}
				className={`relative rounded-[var(--radius-lg)] ${drop.dragging ? "outline-2 outline-dashed outline-offset-4 outline-[var(--accent)]" : ""}`}
			>
				<div className="mb-3 flex min-h-[40px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<div className="flex min-w-0 items-baseline gap-2.5">
						<h3 className="text-h3">Documents</h3>
						<span aria-live="polite" className="tabular text-sm text-[var(--ink-muted)]">
							{count}
						</span>
					</div>
					<div className="flex flex-none items-center gap-1">
						<Segmented size="icons-compact" label="Layout" value={view} onChange={setView} options={VIEW_OPTIONS} />
						{here ? (
							<>
								<span aria-hidden className="mx-1 h-5 w-px bg-[var(--line)]" />
								<ToolbarButton icon="templates" label="Templates" onClick={openTemplates} />
								<MenuButton
									size="dense"
									ariaLabel="New document"
									label="New"
									icon="add"
									items={[
										{
											id: "page",
											label: "Page",
											icon: "note",
											onSelect: () => void newPage(),
										},
										{
											id: "template",
											label: "Document from template",
											icon: "templates",
											onSelect: openTemplates,
										},
										{
											id: "existing",
											label: "An existing document",
											icon: "link",
											separatorBefore: true,
											onSelect: () => {
												setNotice(null);
												setAddingExisting(true);
											},
										},
									]}
								/>
								<ToolbarButton icon="import" label="Add files" onClick={() => void choose()} />
							</>
						) : null}
					</div>
				</div>

				{load.status === "error" ? (
					<div role="alert" className="animate-fade border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the documents.</p>
						<p data-selectable className="mt-1 max-w-[62ch] text-sm text-[var(--ink-muted)]">
							{load.message}
						</p>
						<div className="mt-3">
							<Button size="dense" onClick={reload}>
								Try again
							</Button>
						</div>
					</div>
				) : (
					// Clipped for the corners without becoming a scroller, so the column headers stay sticky as the page scrolls.
					<div className="overflow-clip rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
						{load.status === "loading" ? (
							<RowsSkeleton rows={4} label="Loading the documents" />
						) : (
							<ExplorerView
								items={shown}
								view={view}
								selection={selection}
								onSelection={setSelection}
								statusLabels={statusLabels}
								sort={sort}
								onSort={(by) => setSort((current) => nextSort(current, by))}
								whereColumn={clientId ? "project" : unfiled ? "where" : null}
								renamingKey={renaming}
								onRename={(item, title) => {
									setRenaming(null);
									if (item.kind === "document") void act(() => window.juno.documents.rename(item.record.id, title));
								}}
								onRenameEnd={() => setRenaming(null)}
								cutKeys={cutKeys}
								onActivate={(item, how) => {
									if (item.kind !== "document") return;
									if (how === "open") void openOutside(item.record);
									else show(item.record);
								}}
								onCommand={command}
								onItemMenu={itemMenu}
								onBlankMenu={blankMenu}
								dragOf={(item) =>
									item.kind === "document"
										? {
												kind: "documents",
												ids: selected.some((record) => record.id === item.record.id)
													? selected.map((record) => record.id)
													: [item.record.id],
											}
										: null
								}
								onDragOut={(item, event) => {
									if (item.kind !== "document" || !item.record.latestVersion) return false;
									const ids = selected.some((record) => record.id === item.record.id) ? selected : [item.record];
									if (ids.some((record) => !record.latestVersion)) return false;
									dragDocumentsOut(
										event,
										ids.map((record) => record.id),
									);
									return true;
								}}
								canDropOn={() => false}
								onDropOn={() => undefined}
								label={`Documents of ${name}`}
								empty={
									<div className="px-6 py-10 text-center">
										<p className="font-[var(--weight-medium)]">{unfiled ? "Every file has a client or a project" : "No documents yet"}</p>
										<p className="mx-auto mt-1 max-w-[46ch] text-dense text-[var(--ink-muted)]">
											{unfiled
												? "A file kept under neither would be listed here, to give it one."
												: "Drop any files here, or press Add files. A file that looks like a document already here is shown beside it first."}
										</p>
									</div>
								}
							/>
						)}
					</div>
				)}

				{drop.dragging ? (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)]/80">
						<p className="font-[var(--weight-medium)] text-[var(--accent)]">Drop to add to {name}</p>
					</div>
				) : null}

				{preview ? (
					<DocumentDetail
						documentId={preview.id}
						knownTitle={previewItem ? nameOf(previewItem) : preview.title}
						position={position}
						closeLabel={`Back to ${name}`}
						onClose={closePreview}
						revision={changedOutside.ids.includes(preview.id) ? changedOutside.at : 0}
						details={details}
						onToggleDetails={() => setDetails((value) => !value)}
						onDeleted={(record) => {
							setPreview(null);
							setSelection(NO_SELECTION);
							changed();
							setDeleted([record]);
						}}
						onChanged={() => {
							reload();
							onChanged();
						}}
						onSign={sign}
						onSend={(record) => onTakeOver({ kind: "send", record })}
						onCopyTo={(record) => pickFor("copy", [record])}
						onMoveTo={(record) => pickFor("move", [record])}
						onNotice={setNotice}
						onTitleChange={(title) => setPreview((current) => (current && current.title !== title ? { ...current, title } : current))}
					/>
				) : null}

				{addingExisting && here ? (
					<AddExistingDialog
						scope={clientId ? { clientId } : { projectId: projectId! }}
						name={name}
						onClose={() => setAddingExisting(false)}
						onAdded={(record, from) => {
							setAddingExisting(false);
							setNotice(from === "Not linked" ? `${record.title} added.` : `${record.title} moved here from ${from}.`);
							changed();
						}}
					/>
				) : null}
				{confirm ? (
					<Dialog title="Delete" width="narrow" onClose={() => setConfirm(null)}>
						<p className="mt-3 text-base">
							{confirm.length === 1 ? `Delete ${confirm[0]!.title}?` : `Delete ${confirm.length} documents?`} You can undo this straight
							after.
						</p>
						<div className="mt-6 flex justify-end gap-2">
							<Button onClick={() => setConfirm(null)}>Cancel</Button>
							<Button
								variant="danger"
								onClick={() => {
									const gone = confirm;
									setConfirm(null);
									void remove(gone);
								}}
							>
								Delete
							</Button>
						</div>
					</Dialog>
				) : null}
				{items && here ? <AddFilesFlow items={items} place={here} placeName={name} onDone={finished} /> : null}
				{picker ? (
					<RecordPickerDialog
						title={`${picker.mode === "copy" ? "Copy" : "Move"} ${picker.records.length === 1 ? picker.records[0]!.title : plural(picker.records.length, "document", "documents")}`}
						confirmLabel={picker.mode === "copy" ? "Copy here" : "Move here"}
						current={picker.current ?? (picker.mode === "move" ? hereKey : null)}
						onClose={() => setPicker(null)}
						onPick={(target) => {
							const chosen = picker;
							setPicker(null);
							copyOrMove(chosen.mode, chosen.records, target);
						}}
					/>
				) : null}
				{deleted ? (
					<Toast
						message={deleted.length === 1 ? `${deleted[0]!.title} deleted.` : `${deleted.length} documents deleted.`}
						actionLabel="Undo"
						onAction={() => void restore()}
						onDismiss={() => setDeleted(null)}
					/>
				) : notice ? (
					<Toast message={notice} onDismiss={() => setNotice(null)} />
				) : null}
			</section>
			{children}
		</>
	);
}
