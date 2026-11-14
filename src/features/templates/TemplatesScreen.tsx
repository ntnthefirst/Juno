import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { DocumentRecord, DocumentTemplate, DocumentTemplateEntry } from "@shared/types";
import { usePublishBreadcrumb, type Crumb } from "../../app/breadcrumb-context";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { TitleSearch } from "../../app/TitleSearch";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { InlineAdd } from "../../components/InlineAdd";
import { RowsSkeleton } from "../../components/RowsSkeleton";
import { Segmented } from "../../components/Segmented";
import { Toast } from "../../components/Toast";
import { ToolbarButton } from "../../components/ToolbarButton";
import { messageOf } from "../../lib/errors";
import type { ListCommand } from "../../lib/list-keys";
import { NO_SELECTION, pruneSelection, selectOnly, type ListSelection } from "../../lib/list-selection";
import { contextMenuFor } from "../../lib/native-menu";
import { clearPending, peekPending, type TemplatesPlace } from "../../lib/open-entity";
import { showDocumentWhereKept, showPlace } from "../../lib/show-in-record";
import { nextSort, sortItems, templateItem, templateKey, type ExplorerItem, type ExplorerSort } from "../documents/explorer-items";
import { readPrefs, writePrefs } from "../documents/explorer-prefs";
import { ExplorerView } from "../documents/ExplorerView";
import type { StartPlace } from "../documents/start-place";
import { ComponentCanvasEditor, DocumentCanvasEditor } from "./CanvasTemplateEditor";
import { ComponentsScreen } from "./ComponentsScreen";
import { TemplateEditor } from "./TemplateEditor";
import { TemplatePreview } from "./TemplatePreview";
import { UseCanvasTemplateScreen } from "./UseCanvasTemplateScreen";
import { UseDocumentTemplateScreen } from "./UseDocumentTemplateScreen";

/** What takes the screen instead of the list: an editor, the use flow or Components (decision 30). */
type Mode =
	| { kind: "list" }
	| { kind: "edit"; id: string; canvas: boolean; flow?: boolean }
	| { kind: "use"; template: DocumentTemplate }
	| { kind: "components" }
	| { kind: "component"; id: string; from: string | null };

type Load =
	| { status: "loading" }
	| { status: "ready"; templates: DocumentTemplateEntry[] }
	| { status: "error"; message: string };

const VIEW_OPTIONS = [
	{ id: "list" as const, icon: "list" as const, name: "List" },
	{ id: "grid" as const, icon: "grid" as const, name: "Tiles" },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const NO_STATUSES: ReadonlyMap<string, string> = new Map();
const NO_CUTS: ReadonlySet<string> = new Set();

function entryOf(template: DocumentTemplate): DocumentTemplateEntry {
	return {
		id: template.id,
		name: template.name,
		updatedAt: template.updatedAt,
		reviewedAt: template.reviewedAt,
		hasCanvas: template.canvas !== null,
	};
}

/**
 * The document templates, a screen without a rail entry that keeps Projects
 * lit. It is reached from the Templates button and New on a client's or a
 * project's Documents tab, and from the palette.
 *
 * One click previews a template, two open its editor, and Use makes a
 * document from it. Opened from a client or a project, the document is kept
 * there, and Done shows it on that record's Documents tab.
 */
export function TemplatesScreen() {
	const [prefs] = useState(readPrefs);
	// What the request that opened this screen named, read once.
	const [place] = useState<TemplatesPlace | null>(() => peekPending("templates")?.place ?? null);
	const [preview, setPreview] = useState<string | null>(() => peekPending("document-template")?.id ?? null);
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [view, setView] = useState(prefs.view);
	const [sort, setSort] = useState<ExplorerSort>(prefs.sort);
	const [details, setDetails] = useState(prefs.details);
	const [search, setSearch] = useState("");
	const [heldSelection, setSelection] = useState<ListSelection>(() => {
		const asked = peekPending("document-template");
		return asked ? selectOnly(templateKey(asked.id)) : NO_SELECTION;
	});
	const [renaming, setRenaming] = useState<string | null>(null);
	const [mode, setMode] = useState<Mode>({ kind: "list" });
	const [confirm, setConfirm] = useState<{ id: string; name: string }[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [made, setMade] = useState<DocumentRecord | null>(null);

	useEffect(() => {
		clearPending();
		return clearPending;
	}, []);

	useEffect(() => writePrefs({ view }), [view]);
	useEffect(() => writePrefs({ sort }), [sort]);
	useEffect(() => writePrefs({ details }), [details]);

	const reload = useCallback(() => {
		window.juno.templates
			.list()
			.then((rows) => setLoad({ status: "ready", templates: rows.map(entryOf) }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, []);

	useEffect(() => reload(), [reload]);

	const start: StartPlace | null = place
		? { place: { clientId: place.clientId, projectId: place.projectId, folderId: null }, name: place.name }
		: null;

	const needle = search.trim().toLocaleLowerCase();
	const items = useMemo((): ExplorerItem[] => {
		const all = load.status === "ready" ? load.templates : [];
		const shown = needle ? all.filter((template) => template.name.toLocaleLowerCase().includes(needle)) : all;
		return sortItems(shown.map(templateItem), sort);
	}, [load, needle, sort]);
	const keys = useMemo(() => items.map((item) => item.key), [items]);
	const selection = useMemo(() => pruneSelection(heldSelection, keys), [heldSelection, keys]);
	const selectedTemplates = items.flatMap((item) =>
		item.kind === "template" && selection.selected.includes(item.key) ? [item.template] : [],
	);

	const previewIndex = preview ? items.findIndex((item) => item.kind === "template" && item.template.id === preview) : -1;
	const show = (item: ExplorerItem) => {
		if (item.kind !== "template") return;
		setSelection(selectOnly(item.key));
		setPreview(item.template.id);
	};
	const position =
		previewIndex >= 0
			? {
					index: previewIndex,
					total: items.length,
					onPrevious: () => {
						const before = items[previewIndex - 1];
						if (before) show(before);
					},
					onNext: () => {
						const after = items[previewIndex + 1];
						if (after) show(after);
					},
				}
			: null;

	const fail = (cause: unknown) => setNotice(messageOf(cause));

	async function startUse(id: string) {
		try {
			const template = await window.juno.templates.get(id);
			if (template) setMode({ kind: "use", template });
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	async function rename(item: ExplorerItem, name: string) {
		setRenaming(null);
		if (item.kind !== "template") return;
		try {
			await window.juno.templates.update(item.template.id, { name });
			reload();
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	async function remove(chosen: { id: string; name: string }[]) {
		setConfirm(null);
		try {
			for (const template of chosen) await window.juno.templates.remove(template.id);
			if (preview && chosen.some((template) => template.id === preview)) setPreview(null);
			setSelection(NO_SELECTION);
			setNotice(`${plural(chosen.length, "template", "templates")} deleted.`);
		} catch (cause: unknown) {
			fail(cause);
		}
		reload();
	}

	function command(next: ListCommand) {
		if (next.kind === "rename" && selectedTemplates.length === 1) setRenaming(templateKey(selectedTemplates[0]!.id));
		else if (next.kind === "delete" && selectedTemplates.length > 0) {
			setConfirm(selectedTemplates.map((template) => ({ id: template.id, name: template.name })));
		}
	}

	function itemMenu(item: ExplorerItem, event: MouseEvent) {
		if (item.kind !== "template") return;
		const { template } = item;
		const together = selection.selected.includes(item.key) && selectedTemplates.length > 1 ? selectedTemplates : [template];
		contextMenuFor(
			{ kind: "document-template", id: template.id },
			{
				preview: () => show(item),
				edit: () => setMode({ kind: "edit", id: template.id, canvas: template.hasCanvas }),
				"use-template": () => void startUse(template.id),
				delete: () => setConfirm(together.map((entry) => ({ id: entry.id, name: entry.name }))),
				failed: setNotice,
			},
		)(event);
	}

	const toList = () => setMode({ kind: "list" });

	/* ------------------------------------------------------- breadcrumb */

	const crumbs: Crumb[] = [];
	if (place) crumbs.push({ label: place.name, onSelect: () => showPlace(place) });
	if (mode.kind !== "list" || preview || place) {
		const atList = mode.kind === "list" && !preview;
		crumbs.push(atList ? { label: "Templates" } : { label: "Templates", onSelect: () => { toList(); setPreview(null); } });
		if (mode.kind === "components") crumbs.push({ label: "Components" });
		else if (mode.kind === "component") crumbs.push({ label: "Components", onSelect: () => setMode({ kind: "components" }) }, { label: "Edit" });
		else if (mode.kind === "use") crumbs.push({ label: `Use ${mode.template.name}` });
		else if (mode.kind === "edit") crumbs.push({ label: "Edit" });
	}
	usePublishBreadcrumb(crumbs);

	/* ------------------------------------------------------------ modes */

	if (mode.kind === "components") {
		return (
			<div className="h-full min-h-0">
				<ComponentsScreen onOpen={(id) => setMode({ kind: "component", id, from: null })} />
			</div>
		);
	}

	if (mode.kind === "component") {
		const from = mode.from;
		return (
			<div className="h-full min-h-0">
				<ComponentCanvasEditor
					key={mode.id}
					templateId={mode.id}
					onSaved={reload}
					onBack={() => setMode(from ? { kind: "edit", id: from, canvas: true } : { kind: "components" })}
				/>
			</div>
		);
	}

	if (mode.kind === "edit") {
		const id = mode.id;
		const back = () => {
			toList();
			reload();
		};
		return (
			<div className="h-full min-h-0">
				{mode.canvas ? (
					<DocumentCanvasEditor
						key={id}
						templateId={id}
						flowOnOpen={mode.flow === true}
						onSaved={reload}
						onOpenComponent={(componentId) => setMode({ kind: "component", id: componentId, from: id })}
						onBack={back}
					/>
				) : (
					<TemplateEditor key={id} templateId={id} onSaved={reload} onBack={back} />
				)}
			</div>
		);
	}

	if (mode.kind === "use") {
		// Done shows the document where it is kept, on its client's or project's Documents tab.
		const done = () => {
			toList();
			const record = made;
			setMade(null);
			if (record) showDocumentWhereKept(record);
		};
		return (
			<div className="h-full min-h-0">
				{mode.template.canvas ? (
					<UseCanvasTemplateScreen
						key={mode.template.id}
						template={mode.template}
						start={start}
						onBack={toList}
						onCreated={setMade}
						onDone={done}
					/>
				) : (
					<UseDocumentTemplateScreen
						key={mode.template.id}
						templateId={mode.template.id}
						start={start}
						onBack={toList}
						onCreated={setMade}
						onDone={done}
					/>
				)}
			</div>
		);
	}

	/* ------------------------------------------------------------- list */

	const loading = load.status === "loading";
	const count = loading
		? ""
		: selection.selected.length > 1
			? `${selection.selected.length} of ${items.length} selected`
			: plural(items.length, "template", "templates");

	const empty = loading ? (
		<div className="px-2 pt-8">
			<RowsSkeleton rows={6} divided={false} label="Loading the templates" />
		</div>
	) : load.status === "error" ? (
		<div role="alert" className="animate-fade m-8 border-l-2 border-[var(--risk)] pl-4">
			<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load your templates.</p>
			<p data-selectable className="mt-1 max-w-[62ch] text-sm text-[var(--ink-muted)]">
				{load.message}
			</p>
			<div className="mt-3">
				<Button size="dense" onClick={reload}>
					Try again
				</Button>
			</div>
		</div>
	) : needle ? (
		<EmptyState
			icon="search"
			title="Nothing matches that"
			description="Try other words, or clear the search to see every template."
			secondaryAction={{ label: "Clear search", onClick: () => setSearch("") }}
		/>
	) : (
		<EmptyState
			icon="templates"
			title="No templates yet"
			description="Make one with New template, or import a Word file to start from."
		/>
	);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<TitleSearch value={search} onChange={setSearch} placeholder="Search templates" />
			<TitleBarSlot side="right">
				<Segmented size="icons-compact" label="Layout" value={view} onChange={setView} options={VIEW_OPTIONS} />
			</TitleBarSlot>

			<div className="flex h-[52px] flex-none items-center gap-3 border-b border-[var(--line)] px-4">
				<div className="flex min-w-0 flex-1 items-center gap-2.5">
					<h2 className="min-w-0 truncate text-base font-[var(--weight-medium)]">
						{place ? `Templates for ${place.name}` : "Templates"}
					</h2>
					<span aria-live="polite" className="tabular flex-none text-sm text-[var(--ink-muted)]">
						{count}
					</span>
				</div>
				<div className="flex flex-none items-center gap-1.5">
					<InlineAdd
						label="New document template"
						placeholder="Template name"
						onSubmit={(name) =>
							void (async () => {
								try {
									const created = await window.juno.templates.create({ name });
									reload();
									setMode({ kind: "edit", id: created.id, canvas: created.canvas !== null });
								} catch (cause: unknown) {
									fail(cause);
								}
							})()
						}
					/>
					<ToolbarButton
						icon="import"
						label="Import Word file"
						onClick={() =>
							void (async () => {
								try {
									const created = await window.juno.templates.pickDocx();
									if (!created) return;
									reload();
									setMode({ kind: "edit", id: created.id, canvas: created.canvas !== null, flow: true });
								} catch (cause: unknown) {
									fail(cause);
								}
							})()
						}
					/>
					<ToolbarButton icon="templates" label="Components" onClick={() => setMode({ kind: "components" })} />
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<ExplorerView
					items={loading ? [] : items}
					view={view}
					selection={selection}
					onSelection={setSelection}
					statusLabels={NO_STATUSES}
					sort={sort}
					onSort={(by) => setSort((current) => nextSort(current, by))}
					renamingKey={renaming}
					onRename={(item, name) => void rename(item, name)}
					onRenameEnd={() => setRenaming(null)}
					cutKeys={NO_CUTS}
					onActivate={(item, how) => {
						if (item.kind !== "template") return;
						if (how === "open") setMode({ kind: "edit", id: item.template.id, canvas: item.template.hasCanvas });
						else show(item);
					}}
					onCommand={command}
					onItemMenu={itemMenu}
					dragOf={() => null}
					canDropOn={() => false}
					onDropOn={() => undefined}
					label="Templates"
					empty={empty}
				/>
			</div>

			{preview ? (
				<TemplatePreview
					templateId={preview}
					position={position}
					details={details}
					onToggleDetails={() => setDetails((value) => !value)}
					onClose={() => setPreview(null)}
					onEdit={(template) => setMode({ kind: "edit", id: template.id, canvas: template.canvas !== null })}
					onUse={(template) => setMode({ kind: "use", template })}
					onDelete={(template) => setConfirm([{ id: template.id, name: template.name }])}
				/>
			) : null}

			{confirm ? (
				<Dialog title="Delete" width="narrow" onClose={() => setConfirm(null)}>
					<p className="mt-3 text-base">
						{confirm.length === 1 ? `The template ${confirm[0]!.name} is` : `${plural(confirm.length, "template", "templates")} are`} deleted for
						good. This cannot be undone.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirm(null)}>Cancel</Button>
						<Button variant="danger" onClick={() => void remove(confirm)}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}

			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</div>
	);
}
