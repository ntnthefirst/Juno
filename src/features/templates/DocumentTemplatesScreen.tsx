import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { DocumentTemplate } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconAction } from "../../components/IconAction";
import { InlineAdd } from "../../components/InlineAdd";
import { FilterToggle, ListSearchBar } from "../../components/ListSearchBar";
import { SelectAllButton } from "../../components/SelectAllButton";
import { messageOf } from "../../lib/errors";
import {
	activeDocumentTemplateFilterCount,
	NO_DOCUMENT_TEMPLATE_FILTERS,
	type DocumentTemplateFilters,
} from "./document-template-filters";
import { TemplateEditor } from "./TemplateEditor";
import { UseDocumentTemplateScreen } from "./UseDocumentTemplateScreen";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: DocumentTemplate[] }
	| { status: "error"; message: string };

type View =
	| { status: "list" }
	| { status: "preview"; id: string }
	| { status: "edit"; id: string }
	| { status: "use"; id: string };

function matches(template: DocumentTemplate, needle: string): boolean {
	return `${template.name} ${template.description ?? ""}`.toLowerCase().includes(needle);
}

export function DocumentTemplatesScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [view, setView] = useState<View>({ status: "list" });
	const [search, setSearch] = useState("");
	const [filters, setFilters] = useState<DocumentTemplateFilters>(NO_DOCUMENT_TEMPLATE_FILTERS);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	const fetchRows = useCallback(() => window.juno.templates.list(), []);

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

	const refresh = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [fetchRows]);

	/**
	 * A new template, from the one thing worth asking for before it exists.
	 *
	 * The body is left out: the service defaults it to one empty page, the same
	 * one the editor already treats as blank, which is where the rest gets
	 * filled in. The list is reloaded before the view switches, so the row the
	 * editor opens on is already there to find.
	 */
	async function create(name: string): Promise<void> {
		setCreateError(null);
		setCreating(true);
		try {
			const created = await window.juno.templates.create({ name });
			const rows = await fetchRows();
			setLoad({ status: "ready", rows });
			setView({ status: "edit", id: created.id });
		} catch (cause: unknown) {
			setCreateError(messageOf(cause));
		} finally {
			setCreating(false);
		}
	}

	async function removeSelected(ids: string[]): Promise<void> {
		setRemoveError(null);
		try {
			for (const id of ids) await window.juno.templates.remove(id);
			setSelectedIds([]);
			refresh();
		} catch (cause: unknown) {
			setRemoveError(messageOf(cause));
		}
	}

	// Memoised so the two derived lists below only rebuild when a load lands,
	// not on every keystroke in search.
	const rows = useMemo(() => (load.status === "ready" ? load.rows : []), [load]);
	const needle = search.trim().toLowerCase();
	const filterCount = activeDocumentTemplateFilterCount(filters);
	const shown = useMemo(() => {
		let list = rows;
		if (filters.unreviewedOnly) list = list.filter((row) => row.reviewedAt === null);
		if (needle) list = list.filter((row) => matches(row, needle));
		return list;
	}, [rows, needle, filters]);
	const allSelected = shown.length > 0 && shown.every((row) => selectedIds.includes(row.id));
	const someSelected = selectedIds.length > 0 && !allSelected;

	const selected = view.status !== "list" && load.status === "ready"
		? load.rows.find((row) => row.id === view.id) ?? null
		: null;

	// A row can disappear out from under an open view (removed elsewhere); the
	// list is the only place left to be. Derived at render time rather than
	// reset through an effect, since it is a plain function of state already
	// in hand and needs no synchronisation with anything external.
	const effectiveView: View = view.status !== "list" && load.status === "ready" && !selected ? { status: "list" } : view;

	usePublishBreadcrumb(
		!selected
			? []
			: effectiveView.status === "preview"
				? [{ label: "Document templates", onSelect: () => setView({ status: "list" }) }, { label: selected.name }]
				: effectiveView.status === "edit"
					? [
							{ label: "Document templates", onSelect: () => setView({ status: "list" }) },
							{ label: selected.name, onSelect: () => setView({ status: "preview", id: selected.id }) },
							{ label: "Edit" },
						]
					: [
							{ label: "Document templates", onSelect: () => setView({ status: "list" }) },
							{ label: selected.name, onSelect: () => setView({ status: "preview", id: selected.id }) },
							{ label: "Use" },
						],
	);

	// Only when nothing is layered on top: the editor can raise its own "save
	// this edit" dialog, and that dialog's own Escape has to win first. The
	// editor and the use flow manage their own Escape, since they can be dirty
	// or mid-sequence; only the read-only preview closes on this one.
	useEffect(() => {
		if (effectiveView.status !== "preview") return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			setView({ status: "list" });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [effectiveView.status]);

	if (effectiveView.status === "edit" && selected) {
		return (
			<div className="h-full min-h-0">
				<TemplateEditor
					key={selected.id}
					templateId={selected.id}
					onSaved={refresh}
					onBack={() => setView({ status: "preview", id: selected.id })}
				/>
			</div>
		);
	}

	if (effectiveView.status === "use" && selected) {
		return (
			<div className="h-full min-h-0">
				<UseDocumentTemplateScreen
					key={selected.id}
					templateId={selected.id}
					onBack={() => setView({ status: "preview", id: selected.id })}
					onDone={() => {
						refresh();
						setView({ status: "list" });
					}}
				/>
			</div>
		);
	}

	if (effectiveView.status === "preview" && selected) {
		return (
			<div className="h-full min-h-0">
				<TemplatePreview
					template={selected}
					onBack={() => setView({ status: "list" })}
					onEdit={() => setView({ status: "edit", id: selected.id })}
					onUse={() => setView({ status: "use", id: selected.id })}
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col p-8">
			<div className="mx-auto mb-6 w-full max-w-[var(--content-width)]">
				<div className="flex items-center gap-3">
					<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
						Document templates
					</h1>
					{load.status === "ready" ? (
						<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{shown.length} {shown.length === 1 ? "template" : "templates"}
						</span>
					) : null}
					<span className="ml-auto" />
					<InlineAdd
						label="New document template"
						placeholder="Template name"
						busy={creating}
						onSubmit={(name) => void create(name)}
					/>
				</div>
				<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					The contract texts that get rendered into the PDFs you send clients. The texts that ship
					are invented, so read one, correct it, and mark it as reviewed before anything generated
					from it goes out.
				</p>
				{createError ? (
					<p
						role="alert"
						data-selectable
						className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
					>
						{createError}
					</p>
				) : null}
				{removeError ? (
					<p
						role="alert"
						data-selectable
						className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
					>
						{removeError}
					</p>
				) : null}

				{load.status === "ready" && rows.length > 0 ? (
					<div className="mt-5 flex items-center gap-2">
						<SelectAllButton
							checked={allSelected}
							indeterminate={someSelected}
							disabled={shown.length === 0}
							onSelectAll={() => setSelectedIds(shown.map((row) => row.id))}
							onClearSelection={() => setSelectedIds([])}
						/>
						{selectedIds.length > 0 ? (
							<span className="tabular shrink-0 text-[length:var(--text-sm)] font-[var(--weight-medium)]">
								{selectedIds.length} selected
							</span>
						) : null}

						<ListSearchBar
							search={search}
							onSearch={setSearch}
							placeholder="Search document templates"
							filtersAriaLabel="Document template filters"
							filterCount={filterCount}
							onClearFilters={() => setFilters(NO_DOCUMENT_TEMPLATE_FILTERS)}
							filters={
								<div className="flex flex-wrap gap-1">
									<FilterToggle
										label="Unreviewed"
										icon="warning"
										on={filters.unreviewedOnly}
										onClick={() => setFilters({ ...filters, unreviewedOnly: !filters.unreviewedOnly })}
									/>
								</div>
							}
						/>

						{selectedIds.length > 0 ? (
							<div className="ml-auto flex items-center gap-1">
								<IconAction
									icon="remove"
									label="Delete"
									danger
									onClick={() => setConfirmRemove(selectedIds)}
								/>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="mx-auto w-full max-w-[var(--content-width)] flex-1 overflow-y-auto">
				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not load your document templates.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{load.message}
						</p>
					</div>
				) : rows.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No document templates yet.</p>
				) : shown.length === 0 ? (
					<p className="text-[var(--ink-muted)]">Nothing matches.</p>
				) : (
					<ul>
						{shown.map((row) => (
							<DocumentTemplateRow
								key={row.id}
								template={row}
								checked={selectedIds.includes(row.id)}
								hasSelection={selectedIds.length > 0}
								onToggle={(id) =>
									setSelectedIds((current) =>
										current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
									)
								}
								onSelect={(id) => setView({ status: "preview", id })}
							/>
						))}
					</ul>
				)}
			</div>

			{confirmRemove ? (
				<Dialog title="Delete document templates" onClose={() => setConfirmRemove(null)} width="narrow">
					<p className="text-[length:var(--text-dense)]">
						{confirmRemove.length === 1
							? "1 document template will be deleted. This cannot be undone."
							: `${confirmRemove.length} document templates will be deleted. This cannot be undone.`}
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmRemove(null)}>Cancel</Button>
						<Button
							variant="danger"
							onClick={() => {
								const ids = confirmRemove;
								setConfirmRemove(null);
								void removeSelected(ids);
							}}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}

type DocumentTemplateRowProps = {
	template: DocumentTemplate;
	checked: boolean;
	/** Once anything is ticked, a plain click on any row ticks it too. */
	hasSelection: boolean;
	onToggle: (id: string) => void;
	onSelect: (id: string) => void;
};

function DocumentTemplateRow({ template, checked, hasSelection, onToggle, onSelect }: DocumentTemplateRowProps) {
	const count = template.placeholders.length;
	const reviewed = template.reviewedAt !== null;

	return (
		<li className="border-b border-[var(--line)]">
			<div
				className={`group flex items-center gap-2 rounded-[var(--radius-md)] px-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
					checked ? "bg-[var(--sunken)]" : "hover:bg-[var(--hover)]"
				}`}
				style={{ minHeight: "var(--row-height)" }}
			>
				<input
					type="checkbox"
					checked={checked}
					onChange={() => onToggle(template.id)}
					aria-label={`Select ${template.name}`}
					className={`h-4 w-4 flex-none accent-[var(--accent)] ${
						hasSelection ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
					}`}
				/>
				<button
					type="button"
					onClick={() => (hasSelection ? onToggle(template.id) : onSelect(template.id))}
					className="min-w-0 flex-1 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					<span className="flex items-center gap-2">
						<span className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
							{template.name}
						</span>
						{reviewed ? null : (
							<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--risk)]">
								Not reviewed
							</span>
						)}
					</span>
					{template.description ? (
						<span className="mt-0.5 block truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
							{template.description}
						</span>
					) : null}
					<span className="tabular mt-0.5 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Version {template.version}
						{"  ·  "}
						{count} {count === 1 ? "placeholder" : "placeholders"}
					</span>
				</button>
			</div>
		</li>
	);
}

type TemplatePreviewProps = {
	template: DocumentTemplate;
	onBack: () => void;
	onEdit: () => void;
	onUse: () => void;
};

type PreviewState =
	| { status: "loading" }
	| { status: "ready"; html: string; missing: string[] }
	| { status: "error"; message: string };

/**
 * Reading a template is the common case, editing it is the rare one
 * (docs/editors.md section 4), so clicking a row opens this rather than the
 * editor. It renders the same way DocumentPreview.tsx renders a real
 * document: a fully sandboxed frame, because the body quotes client data.
 */
function TemplatePreview({ template, onBack, onEdit, onUse }: TemplatePreviewProps) {
	// The component starts loading, and only this file's TemplatePreview
	// instance ever carries one template's id (DocumentTemplatesScreen renders
	// a fresh tree when the view changes), so a genuinely new preview always
	// begins from this initial state rather than needing a reset inside the
	// effect below.
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		window.juno.templates
			.preview({ bodyHtml: template.bodyHtml, clientId: null, isSpecimen: template.reviewedAt === null })
			.then((result) => {
				if (!cancelled) setPreview({ status: "ready", html: result.html, missing: result.missing });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setPreview({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [template.id, template.bodyHtml, template.reviewedAt]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-none items-center justify-between gap-2 border-b border-[var(--line)] px-6 py-3">
				<div className="flex min-w-0 items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="-ml-2 inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<ArrowLeftIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
						Back
					</button>
					<span aria-hidden className="text-[var(--ink-faint)]">
						/
					</span>
					<h1 className="min-w-0 truncate text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
						{template.name}
					</h1>
					{template.reviewedAt === null ? (
						<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--risk)]">
							Not reviewed
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					<Button onClick={onEdit}>Edit</Button>
					<Button variant="primary" onClick={onUse}>
						Use
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto w-full max-w-[var(--content-width)]">
					{template.description ? (
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">{template.description}</p>
					) : null}

					<section className="mt-6">
						<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
							Asks for
						</h2>
						{template.inputs.length === 0 ? (
							<p className="mt-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								Nothing beyond a client and a project.
							</p>
						) : (
							<ul className="mt-3 flex flex-col gap-1">
								{template.inputs.map((input) => (
									<li key={input.key} className="text-[length:var(--text-dense)] text-[var(--ink)]">
										{input.label || input.key}
										{input.required ? <span className="text-[var(--ink-muted)]"> (required)</span> : null}
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="mt-8">
						<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
							Preview
						</h2>

						{template.reviewedAt === null ? (
							<p className="mt-3 max-w-[62ch] border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
								Nobody has checked this text. A document generated from it is marked as a specimen and
								cannot be signed.
							</p>
						) : null}

						{preview.status === "loading" ? (
							<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">Rendering.</p>
						) : preview.status === "error" ? (
							<p
								data-selectable
								className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
							>
								{preview.message}
							</p>
						) : (
							<>
								{preview.missing.length > 0 ? (
									<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										Missing here: {preview.missing.join(", ")}
									</p>
								) : null}
								<iframe
									title={`${template.name}, preview`}
									sandbox=""
									referrerPolicy="no-referrer"
									srcDoc={preview.html}
									className="mt-4 h-[62vh] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
								/>
							</>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
