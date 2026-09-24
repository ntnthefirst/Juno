import { useCallback, useEffect, useState } from "react";
import type { DocumentRecord, GenerateDocumentResult, ReferenceItem } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { AddButton } from "../../components/AddButton";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { Toast } from "../../components/Toast";
import { useContextMenu } from "../../lib/use-context-menu";
import { messageOf } from "../../lib/errors";
import { DocumentDetail, SpecimenMark } from "./DocumentDetail";
import { GenerateDialog } from "./GenerateDialog";
import { ImportDialog } from "./ImportDialog";

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

type Rows = { records: DocumentRecord[]; statuses: ReferenceItem[] };

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: Rows }
	| { status: "error"; message: string };

export function DocumentsScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Seeded from the clicked row so the trail never flashes empty, then kept
	// current by DocumentDetail once the real record has loaded.
	const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
	const [detailVersion, setDetailVersion] = useState(0);
	const [generating, setGenerating] = useState(false);
	const [importing, setImporting] = useState(false);
	const [deleted, setDeleted] = useState<DocumentRecord | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

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

	const dismissUndo = useCallback(() => setDeleted(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	const clearSelection = useCallback(() => {
		setSelectedId(null);
		setSelectedTitle(null);
	}, []);

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

	function imported(record: DocumentRecord) {
		setImporting(false);
		setSelectedId(record.id);
		setSelectedTitle(record.title);
		setDetailVersion((version) => version + 1);
		refreshList();
	}

	function removed(record: DocumentRecord) {
		clearSelection();
		setDeleted(record);
		refreshList();
	}

	async function removeFromList(record: DocumentRecord) {
		try {
			const record_ = await window.juno.documents.remove(record.id);
			removed(record_);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		const title = deleted.title;
		setDeleted(null);
		try {
			await window.juno.documents.restore(id);
			setSelectedId(id);
			setSelectedTitle(title);
			setDetailVersion((version) => version + 1);
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

	// The form takes the screen rather than covering the list it came from.
	if (generating) {
		return <GenerateDialog onClose={() => setGenerating(false)} onGenerated={generated} />;
	}

	return (
		<div className="flex h-full flex-col p-8">
			{selectedId !== null ? (
				<div className="mx-auto min-h-0 w-full max-w-[var(--content-width)] flex-1 overflow-y-auto">
					<DocumentDetail
						key={`${selectedId}:${detailVersion}`}
						documentId={selectedId}
						onDeleted={removed}
						onChanged={refreshList}
						onTitleChange={setSelectedTitle}
					/>
				</div>
			) : (
				<>
					<div className="mb-6 flex items-center justify-between gap-4 mx-auto w-full max-w-[var(--content-width)]">
						<div className="flex items-baseline gap-3">
							<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
								Documents
							</h1>
							{load.status === "ready" ? (
								<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{load.rows.records.length}{" "}
									{load.rows.records.length === 1 ? "document" : "documents"}
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
										onSelect: () => setImporting(true),
									},
								]}
							/>
							<AddButton label="New document" onClick={() => setGenerating(true)} />
						</div>
					</div>

					<div className="mx-auto min-h-0 w-full max-w-[var(--content-width)] flex-1 overflow-y-auto">
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
						) : (
							<DocumentTable
								rows={load.rows}
								selectedId={selectedId}
								onSelect={selectDocument}
								onRemove={(record) => void removeFromList(record)}
							/>
						)}
					</div>
				</>
			)}

			{importing ? (
				<ImportDialog onClose={() => setImporting(false)} onImported={imported} />
			) : null}

			{deleted ? (
				<Toast
					message={`${deleted.title} deleted.`}
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
	onSelect: (id: string, title: string) => void;
	onRemove: (record: DocumentRecord) => void;
};

const HEADS = ["Title", "Client", "Status", "Issued"];

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7.
 */
function DocumentTable({ rows, selectedId, onSelect, onRemove }: DocumentTableProps) {
	const labels = new Map(rows.statuses.map((item) => [item.id, item.label]));
	const menu = useContextMenu();
	// Which row the menu belongs to. The menu is one element for the whole
	// table rather than one per row: sixty rows would otherwise each carry a
	// portal that is closed.
	const [target, setTarget] = useState<DocumentRecord | null>(null);

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
					{HEADS.map((head) => (
						<th
							key={head}
							className={[
								"border-b border-[var(--line)] px-3 pb-2 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]",
								head === "Issued" ? "text-right" : "text-left",
							].join(" ")}
						>
							{head}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.records.map((row) => {
					const selected = row.id === selectedId;
					return (
						<tr
							key={row.id}
							onClick={() => onSelect(row.id, row.title)}
							onContextMenu={(event) => {
								setTarget(row);
								menu.open(event);
							}}
							className={`transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
							}`}
						>
							<td
								className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]"
								style={{ height: "var(--row-height)" }}
							>
								<button
									type="button"
									aria-current={selected ? "true" : undefined}
									onClick={() => onSelect(row.id, row.title)}
									className="flex w-full items-center gap-2 text-left"
								>
									<span className="truncate">{row.title}</span>
									{row.isSpecimen ? <SpecimenMark /> : null}
								</button>
							</td>
							<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								<span className="block truncate">{row.clientName}</span>
							</td>
							<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								<span className="block truncate">
									{(row.statusId && labels.get(row.statusId)) || ""}
								</span>
							</td>
							<td className="tabular whitespace-nowrap border-b border-[var(--line)] px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{formatDate(row.issuedOn)}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
		{menu.at && target ? (
			<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={target.title} />
		) : null}
		</>
	);
}
