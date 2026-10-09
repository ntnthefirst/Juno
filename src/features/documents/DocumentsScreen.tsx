import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentRecord, GenerateDocumentResult, ReferenceItem } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { useScreenAction } from "../../lib/screen-actions";
import { DOCUMENT_SWITCH } from "../../app/screens";
import { AddButton } from "../../components/AddButton";
import { Avatar } from "../../components/Avatar";
import { IconAction } from "../../components/IconAction";
import { FilterToggle, ListSearchBar } from "../../components/ListSearchBar";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { SectionSwitch } from "../../components/SectionSwitch";
import { Select } from "../../components/Select";
import { SelectAllButton } from "../../components/SelectAllButton";
import { Toast } from "../../components/Toast";
import { groupByDay } from "../../lib/day-groups";
import { useContextMenu } from "../../lib/use-context-menu";
import { clearPending, peekPending } from "../../lib/open-entity";
import { messageOf } from "../../lib/errors";
import { activeDocumentFilterCount, NO_DOCUMENT_FILTERS, type DocumentFilters } from "./document-filters";
import { DocumentDetail, SpecimenMark } from "./DocumentDetail";
import { GenerateDialog } from "./GenerateDialog";
import { describeOutcome, itemsFromPicked, onDocumentsChanged, type ImportItem } from "../../lib/pdf-drop";
import { ImportFlow } from "./ImportFlow";
import { VersionCount } from "./VersionCount";
import { VersionList } from "./VersionList";
import { SignPage } from "./SignPage";

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function countInWords(count: number): string {
	return count < WORDS.length ? WORDS[count] : String(count);
}

function missingNotice(missing: string[]): string {
	if (missing.length === 0) return "Document generated.";
	if (missing.length === 1) return "One value was missing and is marked in the document.";
	return `${countInWords(missing.length)} values were missing and are marked in the document.`;
}

function matches(record: DocumentRecord, needle: string): boolean {
	return `${record.title} ${record.clientName}`.toLowerCase().includes(needle);
}

type Rows = { records: DocumentRecord[]; statuses: ReferenceItem[] };

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: Rows }
	| { status: "error"; message: string };

export function DocumentsScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [selectedId, setSelectedId] = useState<string | null>(() => peekPending("document")?.id ?? null);
	// Seeded from the clicked row so the trail never flashes empty, then kept
	// current by DocumentDetail once the real record has loaded.
	const [selectedTitle, setSelectedTitle] = useState<string | null>(() => peekPending("document")?.name ?? null);
	useEffect(() => clearPending, []);
	const [detailVersion, setDetailVersion] = useState(0);
	const [generating, setGenerating] = useState(false);
	useScreenAction("documents", () => setGenerating(true));
	const [importItems, setImportItems] = useState<ImportItem[] | null>(null);
	const [signingRecord, setSigningRecord] = useState<DocumentRecord | null>(null);
	const [deleted, setDeleted] = useState<DocumentRecord[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [filters, setFilters] = useState<DocumentFilters>(NO_DOCUMENT_FILTERS);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);

	const fetchRows = useCallback(async (): Promise<Rows> => {
		const [records, statusSet] = await Promise.all([
			window.juno.documents.list(),
			window.juno.reference.getSet("document_status"),
		]);
		return { records, statuses: statusSet ? statusSet.items : [] };
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetchRows()
			.then((rows) => {
				if (!cancelled) setLoad({ status: "ready", rows });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchRows]);

	const refreshList = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [fetchRows]);

	// A drop elsewhere in the window can import into this list.
	useEffect(() => onDocumentsChanged(refreshList), [refreshList]);

	const dismissUndo = useCallback(() => setDeleted(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	const clearSelection = useCallback(() => {
		setSelectedId(null);
		setSelectedTitle(null);
	}, []);

	const clearRowSelection = useCallback(() => setSelectedIds([]), []);

	function selectDocument(id: string, title: string) {
		setSelectedId(id);
		setSelectedTitle(title);
	}

	function generated(result: GenerateDocumentResult) {
		setGenerating(false);
		setSelectedId(result.document.id);
		setSelectedTitle(result.document.title);
		setDetailVersion((version) => version + 1);
		// A failed PDF is the more important of the two, because the record now
		// says it is a document and the file behind it is not there yet.
		setNotice(
			result.pdfError === null
				? missingNotice(result.missing)
				: "The document was saved, but its PDF was not written. Create it from the record.",
		);
		refreshList();
	}

	async function pickAndImport() {
		try {
			const picked = await window.juno.documents.pickPdfs();
			if (picked.length > 0) setImportItems(itemsFromPicked(picked));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function removed(records: DocumentRecord[]) {
		clearSelection();
		clearRowSelection();
		setDeleted(records);
		refreshList();
	}

	async function removeFromList(record: DocumentRecord) {
		try {
			const record_ = await window.juno.documents.remove(record.id);
			removed([record_]);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function removeSelected(ids: string[]) {
		try {
			const records: DocumentRecord[] = [];
			for (const id of ids) records.push(await window.juno.documents.remove(id));
			removed(records);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function restore() {
		if (!deleted) return;
		const records = deleted;
		setDeleted(null);
		try {
			for (const record of records) await window.juno.documents.restore(record.id);
			// Only a single restore reopens the record: which of several to land
			// on is not obvious, so a bulk undo just returns everyone to the list.
			if (records.length === 1) {
				setSelectedId(records[0]!.id);
				setSelectedTitle(records[0]!.title);
				setDetailVersion((version) => version + 1);
			}
			refreshList();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	// Escape backs out of the open record, same as a FormPage, but only when
	// nothing floats above it: a dialog on top handles Escape itself, and
	// without this guard both would fire and close the record out from under it.
	useEffect(() => {
		if (selectedId === null || generating) return;
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			clearSelection();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedId, generating, clearSelection]);

	usePublishBreadcrumb(
		generating
			? [{ label: "Documents", onSelect: () => setGenerating(false) }, { label: "New document" }]
			: selectedId !== null
				? [{ label: "Documents", onSelect: clearSelection }, { label: selectedTitle ?? "Document" }]
				: [],
	);

	// Memoised so the derived lists below only rebuild when a load actually
	// lands, not on every keystroke in search.
	const records = useMemo(() => (load.status === "ready" ? load.rows.records : []), [load]);
	const statuses = useMemo(() => (load.status === "ready" ? load.rows.statuses : []), [load]);
	const statusLabels = new Map(statuses.map((item) => [item.id, item.label]));
	// Only the statuses and clients a document actually carries, not the whole
	// reference set or client list: a filter offering a status nothing uses
	// would narrow the list to nothing every time it was tried.
	const usedStatusIds = new Map<string, string>();
	for (const record of records) {
		if (record.statusId) usedStatusIds.set(record.statusId, statusLabels.get(record.statusId) ?? record.statusId);
	}
	const statusOptions = [...usedStatusIds.entries()]
		.map(([value, label]) => ({ value, label }))
		.sort((a, b) => a.label.localeCompare(b.label));
	const usedClients = new Map(records.map((record) => [record.clientId, record.clientName]));
	const clientOptions = [...usedClients.entries()]
		.map(([value, label]) => ({ value, label }))
		.sort((a, b) => a.label.localeCompare(b.label));

	const needle = search.trim().toLowerCase();
	const filterCount = activeDocumentFilterCount(filters);
	const shown = useMemo(() => {
		let list = records;
		if (filters.statusId) list = list.filter((r) => r.statusId === filters.statusId);
		if (filters.clientId) list = list.filter((r) => r.clientId === filters.clientId);
		if (filters.specimenOnly) list = list.filter((r) => r.isSpecimen);
		if (needle) list = list.filter((r) => matches(r, needle));
		return list;
	}, [records, needle, filters]);
	const allSelected = shown.length > 0 && shown.every((r) => selectedIds.includes(r.id));
	const someSelected = selectedIds.length > 0 && !allSelected;

	// The form takes the screen rather than covering the list it came from.
	if (generating) {
		return <GenerateDialog onClose={() => setGenerating(false)} onGenerated={generated} />;
	}

	if (signingRecord) {
		return (
			<SignPage
				record={signingRecord}
				onClose={() => setSigningRecord(null)}
				onSigned={() => {
					setSigningRecord(null);
					setDetailVersion((version) => version + 1);
					refreshList();
				}}
			/>
		);
	}

	return (
		// An open document is a viewer with a column beside it, so it takes the whole
		// pane. The list keeps the padding and the centred column.
		<div className={selectedId !== null ? "flex h-full flex-col" : "flex h-full flex-col p-8"}>
			{selectedId !== null ? (
				<div className="min-h-0 w-full flex-1">
					<DocumentDetail
						key={`${selectedId}:${detailVersion}`}
						documentId={selectedId}
						onDeleted={(record) => removed([record])}
						onChanged={refreshList}
						onSign={setSigningRecord}
						onTitleChange={setSelectedTitle}
					/>
				</div>
			) : (
				<>
					<div className="mb-6 flex items-center justify-between gap-4 w-full">
						<div className="flex items-center gap-3">
							<SectionSwitch sections={DOCUMENT_SWITCH} current="documents" label="Document views" />
							{load.status === "ready" ? (
								<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{shown.length} {shown.length === 1 ? "document" : "documents"}
								</span>
							) : null}
						</div>

						<div className="flex items-center gap-2">
							<MenuButton
								size="base"
								ariaLabel="More document actions"
								items={[
									{
										id: "import",
										label: "Import a PDF",
										icon: "import",
										onSelect: () => void pickAndImport(),
									},
								]}
							/>
							<AddButton label="New document" onClick={() => setGenerating(true)} />
						</div>
					</div>

					{load.status === "ready" && load.rows.records.length > 0 ? (
						<div className="mb-4 flex items-center gap-2 w-full">
							<SelectAllButton
								checked={allSelected}
								indeterminate={someSelected}
								disabled={shown.length === 0}
								onSelectAll={() => setSelectedIds(shown.map((r) => r.id))}
								onClearSelection={clearRowSelection}
							/>
							{selectedIds.length > 0 ? (
								<span className="tabular shrink-0 text-[length:var(--text-sm)] font-[var(--weight-medium)]">
									{selectedIds.length} selected
								</span>
							) : null}

							<ListSearchBar
								search={search}
								onSearch={setSearch}
								placeholder="Search documents"
								filtersAriaLabel="Document filters"
								filterCount={filterCount}
								onClearFilters={() => setFilters(NO_DOCUMENT_FILTERS)}
								filters={
									<>
										<div className="flex flex-wrap gap-1">
											<FilterToggle
												label="Specimen only"
												icon="warning"
												on={filters.specimenOnly}
												onClick={() => setFilters({ ...filters, specimenOnly: !filters.specimenOnly })}
											/>
										</div>
										<div className="mt-3 grid grid-cols-2 gap-2">
											<Select
												label="Status"
												value={filters.statusId}
												onChange={(value) => setFilters({ ...filters, statusId: value })}
												options={statusOptions}
												placeholder="Any status"
											/>
											<Select
												label="Client"
												value={filters.clientId}
												onChange={(value) => setFilters({ ...filters, clientId: value })}
												options={clientOptions}
												placeholder="Any client"
											/>
										</div>
									</>
								}
							/>

							{selectedIds.length > 0 ? (
								<div className="ml-auto flex items-center gap-1">
									<IconAction
										icon="remove"
										label="Delete"
										danger
										onClick={() => void removeSelected(selectedIds)}
									/>
								</div>
							) : null}
						</div>
					) : null}

					<div className="min-h-0 w-full flex-1 overflow-y-auto">
						{load.status === "loading" ? (
							<p className="text-[var(--ink-muted)]">Loading.</p>
						) : load.status === "error" ? (
							<div className="border-l-2 border-[var(--risk)] pl-4">
								<p className="font-[var(--weight-medium)] text-[var(--risk)]">
									Could not load your documents.
								</p>
								<p
									data-selectable
									className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
								>
									{load.message}
								</p>
							</div>
						) : load.rows.records.length === 0 ? (
							<p className="text-[var(--ink-muted)]">
								No documents yet. Generate one from a template or import a PDF.
							</p>
						) : shown.length === 0 ? (
							<p className="text-[var(--ink-muted)]">Nothing matches.</p>
						) : (
							<DocumentTable
								rows={{ records: shown, statuses }}
								selectedId={selectedId}
								selectedIds={selectedIds}
								onToggle={(id) =>
									setSelectedIds((current) =>
										current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
									)
								}
								onSelect={selectDocument}
								onRemove={(record) => void removeFromList(record)}
							/>
						)}
					</div>
				</>
			)}

			{importItems ? (
				<ImportFlow
					items={importItems}
					onDone={(outcome) => {
						setImportItems(null);
						const failures = outcome.failures.map((entry) => entry.message).join(" ");
						setNotice([describeOutcome(outcome), failures].filter(Boolean).join(" ") || null);
						refreshList();
					}}
				/>
			) : null}

			{deleted ? (
				<Toast
					message={
						deleted.length === 1 ? `${deleted[0]!.title} deleted.` : `${deleted.length} documents deleted.`
					}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={dismissUndo}
				/>
			) : null}

			{deleted === null && notice ? (
				<Toast message={notice} onDismiss={dismissNotice} />
			) : null}
		</div>
	);
}

type DocumentTableProps = {
	rows: Rows;
	selectedId: string | null;
	selectedIds: string[];
	onToggle: (id: string) => void;
	onSelect: (id: string, title: string) => void;
	onRemove: (record: DocumentRecord) => void;
};

const HEADS = ["Title", "Client", "Status", "Issued"];

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7.
 */
function DocumentTable({ rows, selectedId, selectedIds, onToggle, onSelect, onRemove }: DocumentTableProps) {
	const labels = new Map(rows.statuses.map((item) => [item.id, item.label]));
	const menu = useContextMenu();
	// Which row the menu belongs to. The menu is one element for the whole
	// table rather than one per row: sixty rows would otherwise each carry a
	// portal that is closed.
	const [target, setTarget] = useState<DocumentRecord | null>(null);
	const [expanded, setExpanded] = useState<string[]>([]);
	const hasSelection = selectedIds.length > 0;
	const toggleVersions = (id: string) =>
		setExpanded((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));

	// Newest first and split by day, so the table reads as what changed lately
	// and not as an archive in the order it happened to be filed.
	const groups = useMemo(
		() =>
			groupByDay(
				[...rows.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
				(record) => record.updatedAt,
			),
		[rows.records],
	);

	const items: MenuItem[] = target
		? [
				{
					id: "open",
					label: "Open",
					icon: "documents",
					onSelect: () => onSelect(target.id, target.title),
				},
				{
					id: "delete",
					label: "Delete",
					icon: "remove",
					danger: true,
					separatorBefore: true,
					onSelect: () => onRemove(target),
				},
			]
		: [];

	return (
		<>
		<table className="w-full border-collapse">
			<thead>
				<tr>
					<th className="w-10 border-b border-[var(--line)] px-3 pb-2">
						<span className="sr-only">Select</span>
					</th>
					{HEADS.map((head) => (
						<th
							key={head}
							className={[
								"border-b border-[var(--line)] px-3 pb-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]",
								head === "Issued" ? "text-right" : "text-left",
							].join(" ")}
						>
							{head}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{groups.map((group) => (
				<Fragment key={group.key}>
				<tr aria-hidden>
					<td
						colSpan={HEADS.length + 1}
						className="px-3 pt-5 pb-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]"
					>
						{group.label}
					</td>
				</tr>
				{group.items.map((row) => {
					const selected = row.id === selectedId;
					const checked = selectedIds.includes(row.id);
					// A plain click opens the record; once anything is ticked, the
					// same click ticks instead, the way the mail template rows do.
					const open = () => (hasSelection ? onToggle(row.id) : onSelect(row.id, row.title));
					const unfolded = expanded.includes(row.id);
					return (
						<Fragment key={row.id}>
						<tr
							onClick={open}
							onContextMenu={(event) => {
								setTarget(row);
								menu.open(event);
							}}
							className={`group transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								selected || checked ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
							}`}
						>
							<td
								className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)]"
								style={{ height: "var(--row-height-roomy)" }}
								onClick={(event) => event.stopPropagation()}
							>
								<input
									type="checkbox"
									checked={checked}
									onChange={() => onToggle(row.id)}
									aria-label={`Select ${row.title}`}
									className={`h-4 w-4 accent-[var(--accent)] ${
										hasSelection ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
									}`}
								/>
							</td>
							<td
								className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)]"
								style={{ height: "var(--row-height-roomy)" }}
							>
								<div className="flex items-center gap-3">
									<Avatar name={row.clientName} size={28} shape="square" />
									<button
										type="button"
										aria-current={selected ? "true" : undefined}
										onClick={(event) => {
											// The row handles the same click; without this a tick
											// would be made and undone by the one press.
											event.stopPropagation();
											open();
										}}
										className="flex min-w-0 items-center gap-2 text-left"
									>
										<span className="truncate">{row.title}</span>
										{row.isSpecimen ? <SpecimenMark /> : null}
									</button>
									{row.versionCount > 0 ? (
										<VersionCount
											count={row.versionCount}
											open={unfolded}
											onToggle={() => toggleVersions(row.id)}
										/>
									) : null}
								</div>
							</td>
							<td className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								<span className="block truncate">{row.clientName}</span>
							</td>
							<td className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								<span className="block truncate">
									{(row.statusId && labels.get(row.statusId)) || ""}
								</span>
							</td>
							<td className="tabular whitespace-nowrap border-b border-[var(--line)]/60 px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{formatDate(row.issuedOn)}
							</td>
						</tr>
						{unfolded ? (
							<tr>
								<td />
								<td colSpan={HEADS.length} className="border-b border-[var(--line)] px-3 pb-2">
									<VersionList documentId={row.id} nested />
								</td>
							</tr>
						) : null}
						</Fragment>
					);
				})}
				</Fragment>
				))}
			</tbody>
		</table>
		{menu.at && target ? (
			<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={target.title} />
		) : null}
		</>
	);
}
