import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { DocumentTemplate } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { DOCUMENT_SWITCH } from "../../app/screens";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { MenuButton } from "../../components/Menu";
import { Dialog } from "../../components/Dialog";
import { InlineAdd } from "../../components/InlineAdd";
import { FilterToggle, ListSearchBar } from "../../components/ListSearchBar";
import { PdfViewer } from "../../components/PdfViewer";
import { SectionSwitch } from "../../components/SectionSwitch";
import { SelectAllButton } from "../../components/SelectAllButton";
import { SelectionBar } from "../../components/SelectionBar";
import { withAll } from "../../lib/select-all";
import { messageOf } from "../../lib/errors";
import {
	activeDocumentTemplateFilterCount,
	NO_DOCUMENT_TEMPLATE_FILTERS,
	type DocumentTemplateFilters,
} from "./document-template-filters";
import { ComponentCanvasEditor, DocumentCanvasEditor } from "./CanvasTemplateEditor";
import { ComponentsScreen } from "./ComponentsScreen";
import { paperLabel, pagesOf } from "@shared/paper";
import { TemplateEditor } from "./TemplateEditor";
import { UseCanvasTemplateScreen } from "./UseCanvasTemplateScreen";
import { UseDocumentTemplateScreen } from "./UseDocumentTemplateScreen";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: DocumentTemplate[] }
	| { status: "error"; message: string };

type View =
	| { status: "list" }
	| { status: "preview"; id: string }
	/** `flow` for a template just made from a Word file, which lands on one page. */
	| { status: "edit"; id: string; flow?: boolean }
	| { status: "use"; id: string }
	/** The components for templates, and one of them in the editor. `from` is the template it was opened from. */
	| { status: "components" }
	| { status: "component"; id: string; from: string | null };

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
	const [importing, setImporting] = useState(false);

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

	/**
	 * A template from a Word file. Opened in the editor straight away, which
	 * flows what the import put on one page onto as many as it needs.
	 */
	async function importWord(): Promise<void> {
		setCreateError(null);
		setImporting(true);
		try {
			const created = await window.juno.templates.pickDocx();
			if (!created) return;
			const rows = await fetchRows();
			setLoad({ status: "ready", rows });
			setView({ status: "edit", id: created.id, flow: true });
		} catch (cause: unknown) {
			setCreateError(messageOf(cause));
		} finally {
			setImporting(false);
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

	const ofTemplate = view.status === "preview" || view.status === "edit" || view.status === "use" ? view : null;
	const selected = ofTemplate && load.status === "ready" ? load.rows.find((row) => row.id === ofTemplate.id) ?? null : null;

	// A row can disappear out from under an open view (removed elsewhere); the
	// list is the only place left to be. Derived at render time rather than
	// reset through an effect, since it is a plain function of state already
	// in hand and needs no synchronisation with anything external.
	const effectiveView: View = ofTemplate && load.status === "ready" && !selected ? { status: "list" } : view;

	const editedComponent = effectiveView.status === "component" ? effectiveView : null;
	usePublishBreadcrumb(
		effectiveView.status === "components"
			? [{ label: "Document templates", onSelect: () => setView({ status: "list" }) }, { label: "Components" }]
			: editedComponent
				? [
						{ label: "Document templates", onSelect: () => setView({ status: "list" }) },
						{ label: "Components", onSelect: () => setView({ status: "components" }) },
						{ label: "Edit" },
					]
				: !selected
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

	if (effectiveView.status === "components") {
		return (
			<div className="h-full min-h-0">
				<ComponentsScreen
					onOpen={(id) => setView({ status: "component", id, from: null })}
					onBack={() => setView({ status: "list" })}
				/>
			</div>
		);
	}

	if (editedComponent) {
		// Back goes where the person came from: the template that placed it, or the list of components.
		const back = () => {
			refresh();
			setView(editedComponent.from ? { status: "edit", id: editedComponent.from } : { status: "components" });
		};
		return (
			<div className="h-full min-h-0">
				<ComponentCanvasEditor key={editedComponent.id} templateId={editedComponent.id} onSaved={refresh} onBack={back} />
			</div>
		);
	}

	if (effectiveView.status === "edit" && selected && selected.canvas) {
		return (
			<div className="h-full min-h-0">
				<DocumentCanvasEditor
					key={selected.id}
					templateId={selected.id}
					flowOnOpen={effectiveView.flow === true}
					onSaved={refresh}
					onOpenComponent={(id) => setView({ status: "component", id, from: selected.id })}
					onBack={() => setView({ status: "preview", id: selected.id })}
				/>
			</div>
		);
	}

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

	if (effectiveView.status === "use" && selected && selected.canvas) {
		return (
			<div className="h-full min-h-0">
				<UseCanvasTemplateScreen
					key={selected.id}
					template={selected}
					onBack={() => setView({ status: "preview", id: selected.id })}
					onDone={() => {
						refresh();
						setView({ status: "list" });
					}}
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
			<div className="mb-6 w-full">
				<div className="flex items-center gap-3">
					<SectionSwitch sections={DOCUMENT_SWITCH} current="document-templates" label="Document views" />
					{load.status === "ready" ? (
						<span className="text-sm text-[var(--ink-muted)]">
							{shown.length} {shown.length === 1 ? "template" : "templates"}
						</span>
					) : null}
					<span className="ml-auto" />
					<TitleBarSlot side="overflow">
						<MenuButton
							size="dense"
							ariaLabel="More template actions"
							items={[{ id: "components", label: "Components", icon: "templates", onSelect: () => setView({ status: "components" }) }]}
						/>
					</TitleBarSlot>
					<Button size="dense" disabled={importing} onClick={() => void importWord()}>
						{importing ? "Importing" : "Import Word file"}
					</Button>
					<InlineAdd
						label="New document template"
						placeholder="Template name"
						busy={creating}
						onSubmit={(name) => void create(name)}
					/>
				</div>
				{createError ? (
					<p
						role="alert"
						data-selectable
						className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]"
					>
						{createError}
					</p>
				) : null}
				{removeError ? (
					<p
						role="alert"
						data-selectable
						className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]"
					>
						{removeError}
					</p>
				) : null}

				{load.status === "ready" && rows.length > 0 ? (
					<div className="mt-5">
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
							<SelectionBar
								count={selectedIds.length}
								allSelected={allSelected}
								onSelectAll={() => setSelectedIds((current) => withAll(current, shown.map((row) => row.id)))}
								onClear={() => setSelectedIds([])}
								actions={[
									{
										id: "remove",
										icon: "remove",
										label: "Delete",
										danger: true,
										onSelect: () => setConfirmRemove(selectedIds),
									},
								]}
							/>
						) : (
							<SelectAllButton
								checked={false}
								indeterminate={false}
								disabled={shown.length === 0}
								onSelectAll={() => setSelectedIds(shown.map((row) => row.id))}
								onClearSelection={() => setSelectedIds([])}
							/>
						)}
					</div>
				) : null}
			</div>

			<div className="w-full flex-1 overflow-y-auto">
				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not load your document templates.
						</p>
						<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
							{load.message}
						</p>
					</div>
				) : rows.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No document templates yet.</p>
				) : shown.length === 0 ? (
					<p className="text-[var(--ink-muted)]">Nothing matches.</p>
				) : (
					<ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 pt-6">
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
					<p className="text-dense">
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

/** The sheet a card shows. A stand-in drawn from the paper's shape, not a render, so a list of them costs nothing. */
function PaperThumb({ landscape }: { landscape: boolean }) {
	return (
		<span
			aria-hidden
			className={`flex flex-col gap-[6px] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3 ${
				landscape ? "h-[110px] w-[150px]" : "h-[148px] w-[110px]"
			}`}
		>
			<span className="h-1.5 w-1/2 rounded-full bg-[var(--accent-soft)]" />
			<span className="h-1.5 w-full rounded-full bg-[var(--accent-soft)]" />
			<span className="h-1.5 w-5/6 rounded-full bg-[var(--accent-soft)]" />
			<span className="h-1.5 w-full rounded-full bg-[var(--accent-soft)]" />
			<span className="h-1.5 w-2/3 rounded-full bg-[var(--accent-soft)]" />
		</span>
	);
}

function DocumentTemplateRow({ template, checked, hasSelection, onToggle, onSelect }: DocumentTemplateRowProps) {
	const reviewed = template.reviewedAt !== null;
	const pages = template.canvas ? pagesOf(template.canvas.layout).length : 1;
	const inputs = template.canvas ? template.inputs.length : template.placeholders.length;
	const meta = [
		template.canvas ? paperLabel(template.canvas.paper).split(" ")[0] : "HTML",
		`${pages} ${pages === 1 ? "page" : "pages"}`,
		`${inputs} ${inputs === 1 ? "input" : "inputs"}`,
	].join(" · ");

	return (
		<li className="group relative">
			<button
				type="button"
				onClick={() => (hasSelection ? onToggle(template.id) : onSelect(template.id))}
				className={`block w-full overflow-hidden rounded-[var(--radius-lg)] border text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
					checked ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]"
				}`}
			>
				<span className="flex h-[180px] items-center justify-center bg-[var(--sunken)]">
					<PaperThumb landscape={template.canvas?.paper.orientation === "landscape"} />
				</span>
				<span className="block px-4 py-3">
					<span className="flex items-center gap-2">
						<span className="truncate text-base">{template.name}</span>
						{reviewed ? null : (
							<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--risk)]">
								Not reviewed
							</span>
						)}
					</span>
					<span className="tabular block text-sm text-[var(--ink-muted)]">{meta}</span>
				</span>
			</button>
			<span className="absolute top-3 left-3">
				<Checkbox
					checked={checked}
					onChange={() => onToggle(template.id)}
					aria-label={`Select ${template.name}`}
					className={`bg-[var(--surface)] ${hasSelection ? "" : "opacity-0 group-hover:opacity-100 has-[:focus-visible]:opacity-100"}`}
				/>
			</span>
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
 * editor. It renders in a fully sandboxed frame, because the body quotes
 * client data.
 */
function TemplatePreview({ template, onBack, onEdit, onUse }: TemplatePreviewProps) {
	// The component starts loading, and only this file's TemplatePreview
	// instance ever carries one template's id (DocumentTemplatesScreen renders
	// a fresh tree when the view changes), so a genuinely new preview always
	// begins from this initial state rather than needing a reset inside the
	// effect below.
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
	// A canvas template is previewed as the PDF it prints as.
	const [printed, setPrinted] = useState<{ stamp: number; pdf: Uint8Array; missing: string[] } | null>(null);
	const [printError, setPrintError] = useState<string | null>(null);
	const readPrinted = useCallback(async () => printed?.pdf ?? new Uint8Array(), [printed]);

	useEffect(() => {
		if (!template.canvas) return;
		let cancelled = false;
		window.juno.templates
			.renderPdf({
				templateId: template.id,
				values: Object.fromEntries(
					template.inputs.filter((input) => input.defaultValue).map((input) => [input.key, input.defaultValue ?? ""]),
				),
			})
			.then((result) => {
				if (!cancelled) setPrinted({ stamp: Date.now(), pdf: result.pdf, missing: result.missing });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setPrintError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [template.id, template.canvas, template.inputs, template.updatedAt]);

	useEffect(() => {
		if (template.canvas) return;
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
	}, [template.id, template.bodyHtml, template.reviewedAt, template.canvas]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-none items-center justify-between gap-2 border-b border-[var(--line)] px-6 py-3">
				<div className="flex min-w-0 items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="-ml-2 inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<ArrowLeftIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
						Back
					</button>
					<span aria-hidden className="text-[var(--ink-faint)]">
						/
					</span>
					<h1 className="min-w-0 truncate text-h3">
						{template.name}
					</h1>
					{template.reviewedAt === null ? (
						<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--risk)]">
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
				<div className="w-full">
					{template.description ? (
						<p className="text-sm text-[var(--ink-muted)]">{template.description}</p>
					) : null}

					<section className="mt-6">
						<h2 className="border-b border-[var(--line)] pb-2 text-h3 font-[var(--weight-medium)]">
							Asks for
						</h2>
						{template.inputs.length === 0 ? (
							<p className="mt-3 text-dense text-[var(--ink-muted)]">
								{template.canvas ? "Nothing. It prints as it is." : "Nothing beyond a client and a project."}
							</p>
						) : (
							<ul className="mt-3 flex flex-col gap-1">
								{template.inputs.map((input) => (
									<li key={input.key} className="text-dense text-[var(--ink)]">
										{input.label || input.key}
										{input.required ? <span className="text-[var(--ink-muted)]"> (required)</span> : null}
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="mt-8">
						<h2 className="border-b border-[var(--line)] pb-2 text-h3 font-[var(--weight-medium)]">
							Preview
						</h2>

						{template.reviewedAt === null ? (
							<p className="mt-3 max-w-[62ch] border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
								Nobody has checked this text. A document generated from it is marked as a specimen and
								cannot be signed.
							</p>
						) : null}

						{template.canvas ? (
							<div className="mt-4 flex h-[66vh] min-h-[420px] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)]">
								<PdfViewer
									fileKey={printed ? String(printed.stamp) : null}
									read={readPrinted}
									caption={
										<span className="truncate text-micro text-[var(--ink-muted)]">
											{paperLabel(template.canvas.paper)}
											{printed && printed.missing.length > 0 ? `. No value for: ${printed.missing.join(", ")}` : ""}
										</span>
									}
									empty={
										<p className="p-6 text-center text-[var(--ink-muted)]">
											{printError ?? "Making the PDF."}
										</p>
									}
								/>
							</div>
						) : preview.status === "loading" ? (
							<p className="mt-4 text-dense text-[var(--ink-muted)]">Rendering.</p>
						) : preview.status === "error" ? (
							<p
								data-selectable
								className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]"
							>
								{preview.message}
							</p>
						) : (
							<>
								{preview.missing.length > 0 ? (
									<p className="mt-3 text-sm text-[var(--ink-muted)]">
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
