import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { DocumentFolder, DocumentPlace, DocumentRecord, DocumentTemplate, DocumentTreeNode, GenerateDocumentResult } from "@shared/types";
import { usePublishBreadcrumb, type Crumb } from "../../app/breadcrumb-context";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { TitleSearch } from "../../app/TitleSearch";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { InlineAdd } from "../../components/InlineAdd";
import { MenuButton } from "../../components/Menu";
import { RowsSkeleton } from "../../components/RowsSkeleton";
import { Segmented } from "../../components/Segmented";
import { Toast } from "../../components/Toast";
import { blankMenuFor } from "../../lib/blank-menu";
import { messageOf } from "../../lib/errors";
import type { ListCommand } from "../../lib/list-keys";
import { NO_SELECTION, pruneSelection, selectOnly, type ListSelection } from "../../lib/list-selection";
import { contextMenuFor } from "../../lib/native-menu";
import { clearPending, peekPending } from "../../lib/open-entity";
import { announceDocumentsChanged, carriesFiles, describeOutcome, itemsFromFiles, itemsFromPicked, type ImportItem } from "../../lib/pdf-drop";
import { useScreenAction } from "../../lib/screen-actions";
import { dragDocumentsOut, isOwnDrag, ownDrop } from "../../lib/document-drag";
import { useRecentTouch } from "../../lib/use-recent-touch";
import { ComposePage } from "../mail/ComposePage";
import { ComponentCanvasEditor, DocumentCanvasEditor } from "../templates/CanvasTemplateEditor";
import { ComponentsScreen } from "../templates/ComponentsScreen";
import { TemplateEditor } from "../templates/TemplateEditor";
import { UseCanvasTemplateScreen } from "../templates/UseCanvasTemplateScreen";
import { UseDocumentTemplateScreen } from "../templates/UseDocumentTemplateScreen";
import { AddFilesFlow } from "./AddFilesFlow";
import { DocumentDetail } from "./DocumentDetail";
import { convertToPdf, needsConversion } from "./document-flows";
import { decodeDrag, DRAG_TYPE, routeDrop, type DragPayload } from "./drop-routing";
import { readClipboard, writeClipboard } from "./explorer-clipboard";
import {
	documentItem,
	documentKey,
	matchesSearch,
	nameOf,
	nextSort,
	nodeItem,
	sortItems,
	templateItem,
	templateKey,
	type ExplorerItem,
	type ExplorerSort,
} from "./explorer-items";
import { readPrefs, writePrefs } from "./explorer-prefs";
import {
	findNode,
	folderTargetOf,
	freeFolderName,
	keyOfRecord,
	moveTargetOf,
	parentOf,
	pathTo,
	ROOT_KEY,
	TEMPLATES_KEY,
} from "./explorer-tree";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { ExplorerView } from "./ExplorerView";
import { FolderTree } from "./FolderTree";
import { GenerateDialog } from "./GenerateDialog";
import { PageView } from "./PageView";
import { PlacePickerDialog } from "./PlacePickerDialog";
import { SignPage } from "./SignPage";
import type { StartPlace } from "./start-place";
import { TemplatePreview } from "./TemplatePreview";
import { ToolbarButton } from "./ToolbarButton";
import { useExplorerData } from "./use-explorer-data";

/** What takes the screen instead of the explorer: a page, a form or an editor (decision 30). */
type Mode =
	| { kind: "explorer" }
	| { kind: "page"; id: string; title: string }
	| { kind: "sign"; record: DocumentRecord }
	| { kind: "send"; record: DocumentRecord }
	| { kind: "generate"; start: StartPlace | null }
	| { kind: "template-edit"; id: string; canvas: boolean; flow?: boolean }
	| { kind: "template-use"; template: DocumentTemplate; start: StartPlace | null }
	| { kind: "components" }
	| { kind: "component"; id: string; from: string | null };

type Preview = { kind: "document"; id: string } | { kind: "template"; id: string };

type Picker =
	| { kind: "documents"; mode: "copy" | "move"; ids: string[]; current: string | null }
	| { kind: "folder"; node: DocumentTreeNode };

type Confirm = { documents: DocumentRecord[]; folders: DocumentTreeNode[]; templates: { id: string; name: string }[] };

type Deleted = { documents: DocumentRecord[]; folders: DocumentFolder[] };

const VIEW_OPTIONS = [
	{ id: "list" as const, icon: "list" as const, name: "List" },
	{ id: "grid" as const, icon: "grid" as const, name: "Tiles" },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The node a request from elsewhere names, before the tree is read. */
function requestedKey(): string | null {
	return peekPending("document-folder")?.key ?? (peekPending("document-template") ? TEMPLATES_KEY : null);
}

/**
 * Documents is a file explorer (decision 75): the tree of clients, projects,
 * the owner's own folders, Unfiled and Templates at the left, and what is
 * directly in the open one at the right, as a dense list or as tiles.
 *
 * A click previews over the content area and a double click opens the file
 * in its own app. Files dropped anywhere on the screen go into the folder
 * that is open, and one that looks like a document already here is shown
 * beside it before anything is filed. Templates is a folder too, and its
 * editors, the use flow and Components take the screen the way they did.
 */
export function DocumentsScreen() {
	const [prefs] = useState(readPrefs);
	const [wantedKey, setOpenKey] = useState(() => requestedKey() ?? prefs.openKey);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(prefs.expanded));
	const [view, setView] = useState(prefs.view);
	const [sort, setSort] = useState<ExplorerSort>(prefs.sort);
	const [details, setDetails] = useState(prefs.details);
	const [search, setSearch] = useState("");
	const [heldSelection, setSelection] = useState<ListSelection>(NO_SELECTION);
	const [preview, setPreview] = useState<Preview | null>(() => {
		const template = peekPending("document-template");
		return template ? { kind: "template", id: template.id } : null;
	});
	const [previewTitle, setPreviewTitle] = useState<string | null>(() => peekPending("document-template")?.name ?? null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [mode, setMode] = useState<Mode>({ kind: "explorer" });
	const [adding, setAdding] = useState<{ items: ImportItem[]; place: DocumentPlace | null; name: string } | null>(null);
	const [picker, setPicker] = useState<Picker | null>(null);
	const [confirm, setConfirm] = useState<Confirm | null>(null);
	const [deleted, setDeleted] = useState<Deleted | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [dropping, setDropping] = useState(false);
	// What Ctrl C or Ctrl X holds, mirrored here so a cut row is drawn faded until it is pasted.
	const [clip, setClip] = useState(readClipboard);
	// The document a Use flow made, shown when the person presses Done.
	const made = useRef<DocumentRecord | null>(null);
	const cutKeys = useMemo(() => new Set(clip && clip.mode === "cut" ? clip.ids.map(documentKey) : []), [clip]);

	const needle = search.trim();
	const data = useExplorerData(wantedKey, needle.length > 0);
	const roots = useMemo(() => (data.tree.status === "ready" ? data.tree.tree.roots : []), [data.tree]);
	// A node that went away (a folder deleted, a client removed) leaves the explorer at its top.
	const openKey = data.tree.status === "ready" && wantedKey !== ROOT_KEY && !findNode(roots, wantedKey) ? ROOT_KEY : wantedKey;
	const templates = useMemo(() => (data.tree.status === "ready" ? data.tree.tree.templates : []), [data.tree]);
	const node = openKey === ROOT_KEY ? null : findNode(roots, openKey);
	const path = useMemo(() => pathTo(roots, openKey), [roots, openKey]);
	const statusLabels = useMemo(() => new Map(data.statuses.map((item) => [item.id, item.label])), [data.statuses]);

	useRecentTouch("document", preview?.kind === "document" ? preview.id : mode.kind === "page" ? mode.id : null);

	useEffect(() => writePrefs({ view }), [view]);
	useEffect(() => writePrefs({ sort }), [sort]);
	useEffect(() => writePrefs({ details }), [details]);
	useEffect(() => writePrefs({ expanded: [...expanded] }), [expanded]);
	useEffect(() => writePrefs({ openKey }), [openKey]);

	// The node open before Templates: a document made from a template there is kept in it.
	const cameFrom = useRef(wantedKey === TEMPLATES_KEY ? ROOT_KEY : wantedKey);
	useEffect(() => {
		if (openKey !== TEMPLATES_KEY) cameFrom.current = openKey;
	}, [openKey]);

	/** Opens a node, and every node above it in the tree, so it can be seen. */
	const openNode = useCallback(
		(key: string) => {
			setOpenKey(key);
			setSelection(NO_SELECTION);
			setPreview(null);
			setRenaming(null);
			setSearch("");
			const above = pathTo(roots, key).slice(0, -1);
			if (above.length > 0) {
				setExpanded((current) => {
					if (above.every((ancestor) => current.has(ancestor.key))) return current;
					const next = new Set(current);
					for (const ancestor of above) next.add(ancestor.key);
					return next;
				});
			}
		},
		[roots],
	);

	// Something elsewhere asked for a document: open the folder it is in and preview it, or its page.
	useEffect(() => {
		const asked = peekPending("document");
		clearPending();
		if (!asked) return;
		let cancelled = false;
		void window.juno.documents.get(asked.id).then((record) => {
			if (cancelled || !record) return;
			setOpenKey(keyOfRecord(record));
			setSelection(selectOnly(documentKey(record.id)));
			if (record.sourceKind === "page") setMode({ kind: "page", id: record.id, title: record.title });
			else {
				setPreview({ kind: "document", id: record.id });
				setPreviewTitle(record.title);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// Once the tree is in, the folder a request opened is shown open in it.
	// Decided while rendering, the way React asks for state that follows other state.
	const [expandedFor, setExpandedFor] = useState<string | null>(null);
	if (data.tree.status === "ready" && expandedFor !== openKey) {
		setExpandedFor(openKey);
		const above = pathTo(roots, openKey).slice(0, -1);
		if (above.some((ancestor) => !expanded.has(ancestor.key))) {
			const next = new Set(expanded);
			for (const ancestor of above) next.add(ancestor.key);
			setExpanded(next);
		}
	}

	/* ------------------------------------------------------------ items */

	const items = useMemo((): ExplorerItem[] => {
		if (needle) {
			const records = (data.everything ?? []).filter((record) => matchesSearch(record, needle));
			const lower = needle.toLocaleLowerCase();
			const named = templates.filter((template) => template.name.toLocaleLowerCase().includes(lower));
			return sortItems([...records.map(documentItem), ...named.map(templateItem)], sort);
		}
		if (openKey === ROOT_KEY) return roots.map(nodeItem);
		if (openKey === TEMPLATES_KEY) return sortItems(templates.map(templateItem), sort);
		if (!node) return [];
		return sortItems([...node.children.map(nodeItem), ...(data.records ?? []).map(documentItem)], sort);
	}, [needle, data.everything, data.records, templates, openKey, roots, node, sort]);

	const keys = useMemo(() => items.map((item) => item.key), [items]);
	const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);

	// What the list no longer shows is not selected, whatever was held before a reload.
	const selection = useMemo(() => pruneSelection(heldSelection, keys), [heldSelection, keys]);

	const selectedItems = selection.selected.map((key) => byKey.get(key)).filter((item): item is ExplorerItem => Boolean(item));
	const selectedRecords = selectedItems.flatMap((item) => (item.kind === "document" ? [item.record] : []));

	// What Previous and Next go through: the files of the list, in its order. A page opens as a page, not here.
	const previewable = items.filter(
		(item) => (item.kind === "document" && item.record.sourceKind !== "page") || item.kind === "template",
	);
	const previewIndex = preview
		? previewable.findIndex((item) =>
				preview.kind === "document" ? item.kind === "document" && item.record.id === preview.id : item.kind === "template" && item.template.id === preview.id,
			)
		: -1;

	const showItem = useCallback((item: ExplorerItem) => {
		setSelection(selectOnly(item.key));
		if (item.kind === "document") {
			setPreview({ kind: "document", id: item.record.id });
			setPreviewTitle(item.record.title);
		} else if (item.kind === "template") {
			setPreview({ kind: "template", id: item.template.id });
			setPreviewTitle(item.template.name);
		}
	}, []);

	/**
	 * Closes the preview with the focus on the row of the file it ended on,
	 * which Previous and Next may have moved from the one it opened from, so
	 * the arrow keys carry on from there.
	 */
	function closePreview() {
		const key = preview ? (preview.kind === "document" ? documentKey(preview.id) : templateKey(preview.id)) : null;
		setPreview(null);
		if (!key) return;
		window.requestAnimationFrame(() => {
			const row = document.querySelector<HTMLElement>(`[data-explorer-item="${CSS.escape(key)}"]`);
			row?.focus({ preventScroll: true });
			row?.scrollIntoView({ block: "nearest" });
		});
	}

	const position =
		previewIndex >= 0
			? {
					index: previewIndex,
					total: previewable.length,
					onPrevious: () => {
						const before = previewable[previewIndex - 1];
						if (before) showItem(before);
					},
					onNext: () => {
						const after = previewable[previewIndex + 1];
						if (after) showItem(after);
					},
				}
			: null;

	/* ---------------------------------------------------------- actions */

	const fail = (cause: unknown) => setNotice(messageOf(cause));

	const changed = useCallback(() => {
		announceDocumentsChanged();
		data.reload();
	}, [data]);

	/** Where something added to the open node is kept. Documents itself adds to Unfiled. */
	const placeHere: DocumentPlace | null = openKey === ROOT_KEY ? { clientId: null, projectId: null, folderId: null } : (node?.place ?? null);
	const placeName = openKey === ROOT_KEY ? "Unfiled" : (node?.name ?? "Documents");

	function addFiles(items_: ImportItem[], target: DocumentPlace | null, name: string) {
		if (items_.length === 0) return;
		setAdding({ items: items_, place: target, name });
	}

	async function pickAndAdd(target: DocumentTreeNode | null = node) {
		const place = target ? target.place : placeHere;
		if (!place) {
			setNotice("Templates holds templates. Open a client, a project or a folder to add files.");
			return;
		}
		try {
			const picked = await window.juno.documents.pickFiles();
			addFiles(itemsFromPicked(picked), place, target?.name ?? placeName);
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	/** A folder inside the node, named "New folder", with its name ready to type over. */
	async function newFolder(inside: DocumentTreeNode | null = node) {
		const parent = inside ?? findNode(roots, "unfiled");
		if (!parent?.place) {
			setNotice("Templates holds templates. Make a folder in a client, a project or Unfiled.");
			return;
		}
		const siblings = parent.children.filter((child) => child.kind === "folder");
		try {
			const made = await window.juno.documents.folders.create({
				name: freeFolderName(siblings),
				...(parent.folderId ? { parentId: parent.folderId } : { clientId: parent.place.clientId, projectId: parent.place.projectId }),
			});
			const key = `folder:${made.id}`;
			setExpanded((current) => new Set(current).add(parent.key));
			changed();
			if (parent.key === openKey) setSelection(selectOnly(key));
			setRenaming(key);
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	/** A page is a document with no file, made empty in the open node and opened to write in. */
	async function newPage() {
		const place = placeHere ?? { clientId: null, projectId: null, folderId: null };
		try {
			const page = await window.juno.pages.create(
				place.folderId ? { folderId: place.folderId } : { clientId: place.clientId, projectId: place.projectId },
			);
			changed();
			setMode({ kind: "page", id: page.document.id, title: page.document.title });
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	/** Where a document made from a template starts out kept: the open node, or in Templates the one open before it. */
	function startPlace(): StartPlace | null {
		const key = openKey === TEMPLATES_KEY ? cameFrom.current : openKey;
		const at = key === ROOT_KEY ? null : findNode(roots, key);
		return at?.place ? { place: at.place, name: at.name } : null;
	}

	/** Opens the node a document is kept in, with it selected and previewed. */
	function land(record: DocumentRecord) {
		setOpenKey(keyOfRecord(record));
		setSelection(selectOnly(documentKey(record.id)));
		setPreview({ kind: "document", id: record.id });
		setPreviewTitle(record.title);
	}

	function generated(result: GenerateDocumentResult) {
		setMode({ kind: "explorer" });
		const record = result.document;
		changed();
		setNotice(
			result.pdfError !== null
				? "The document was saved, but its PDF was not written. Create it from the preview."
				: result.missing.length > 0
					? `${plural(result.missing.length, "value was", "values were")} missing and marked in the document.`
						: "Document generated.",
		);
		land(record);
	}

	async function openOutside(record: DocumentRecord) {
		if (!record.latestVersion) {
			showItem(documentItem(record));
			return;
		}
		try {
			const opened = await window.juno.documents.open(record.id);
			if (opened.readOnly) setNotice(`${record.title} opened read only, because it is signed.`);
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	function activate(item: ExplorerItem, how: "preview" | "open") {
		if (item.kind === "node") {
			openNode(item.node.key);
			return;
		}
		if (item.kind === "template") {
			if (how === "open") setMode({ kind: "template-edit", id: item.template.id, canvas: item.template.hasCanvas });
			else showItem(item);
			return;
		}
		const { record } = item;
		if (record.sourceKind === "page") {
			setMode({ kind: "page", id: record.id, title: record.title });
			return;
		}
		if (how === "open") void openOutside(record);
		else showItem(item);
	}

	async function convert(record: DocumentRecord, then?: (converted: DocumentRecord) => void) {
		try {
			const done = await convertToPdf(record);
			changed();
			setNotice(done.notice);
			then?.(done.record);
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	function sign(record: DocumentRecord) {
		if (needsConversion(record)) void convert(record, (converted) => setMode({ kind: "sign", record: converted }));
		else setMode({ kind: "sign", record });
	}

	async function duplicate(records: DocumentRecord[]) {
		const files = records.filter((record) => record.latestVersion !== null);
		if (files.length === 0) return;
		try {
			const made: DocumentRecord[] = [];
			for (const record of files) made.push(await window.juno.documents.duplicate(record.id));
			changed();
			setNotice(made.length === 1 ? `Duplicated as ${made[0]!.title}.` : `${made.length} documents duplicated.`);
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	function copyOrCut(mode_: "copy" | "cut") {
		const ids = selectedRecords.map((record) => record.id);
		if (ids.length === 0) return;
		writeClipboard({ mode: mode_, ids });
		setClip(readClipboard());
		setNotice(
			mode_ === "copy"
				? `${plural(ids.length, "document", "documents")} copied. Open a folder and paste.`
				: `${plural(ids.length, "document", "documents")} cut. Open a folder and paste to move.`,
		);
	}

	async function paste() {
		const held = readClipboard();
		if (!held) return;
		const target = node ? moveTargetOf(node) : null;
		if (!target || needle) {
			setNotice("Open a client, a project or a folder to paste into it.");
			return;
		}
		// Cut and pasted into the folder it is already in: nothing moves, and the cut is let go, as in Explorer.
		const ids = held.mode === "cut" ? held.ids.filter((id) => !byKey.has(documentKey(id))) : held.ids;
		try {
			for (const id of ids) {
				if (held.mode === "copy") await window.juno.documents.copyTo(id, target);
				else await window.juno.documents.move(id, target);
			}
			if (held.mode === "cut") writeClipboard(null);
			setClip(readClipboard());
			if (ids.length === 0) return;
			changed();
			setNotice(`${plural(ids.length, "document", "documents")} ${held.mode === "copy" ? "copied" : "moved"} to ${node?.name ?? "here"}.`);
		} catch (cause: unknown) {
			fail(cause);
			changed();
		}
	}

	async function moveDocuments(ids: string[], target: DocumentTreeNode) {
		const into = moveTargetOf(target);
		if (!into) return;
		try {
			for (const id of ids) await window.juno.documents.move(id, into);
			changed();
			setNotice(`${plural(ids.length, "document", "documents")} moved to ${target.name}.`);
		} catch (cause: unknown) {
			fail(cause);
			changed();
		}
	}

	async function copyDocuments(ids: string[], target: DocumentTreeNode) {
		const into = moveTargetOf(target);
		if (!into) return;
		try {
			for (const id of ids) await window.juno.documents.copyTo(id, into);
			changed();
			setNotice(`${plural(ids.length, "document", "documents")} copied to ${target.name}.`);
		} catch (cause: unknown) {
			fail(cause);
			changed();
		}
	}

	async function moveFolder(folder: DocumentTreeNode, target: DocumentTreeNode) {
		const into = folderTargetOf(target);
		if (!into || !folder.folderId) return;
		try {
			await window.juno.documents.folders.move(folder.folderId, into);
			setExpanded((current) => new Set(current).add(target.key));
			changed();
			setNotice(`${folder.name} moved to ${target.name}.`);
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	async function renameItem(item: ExplorerItem, name: string) {
		if (item.kind === "node") {
			await renameNode(item.node, name);
			return;
		}
		setRenaming(null);
		try {
			if (item.kind === "document") await window.juno.documents.rename(item.record.id, name);
			else await window.juno.templates.update(item.template.id, { name });
			changed();
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	async function renameNode(target: DocumentTreeNode, name: string) {
		setRenaming(null);
		if (!target.folderId) return;
		try {
			await window.juno.documents.folders.rename(target.folderId, name);
			changed();
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	function askDelete(chosen: ExplorerItem[]) {
		const documents = chosen.flatMap((item) => (item.kind === "document" ? [item.record] : []));
		const folders = chosen.flatMap((item) => (item.kind === "node" && item.node.kind === "folder" ? [item.node] : []));
		const named = chosen.flatMap((item) => (item.kind === "template" ? [{ id: item.template.id, name: item.template.name }] : []));
		if (documents.length + folders.length + named.length === 0) return;
		setConfirm({ documents, folders, templates: named });
	}

	async function remove(what: Confirm) {
		setConfirm(null);
		const gone: Deleted = { documents: [], folders: [] };
		try {
			for (const record of what.documents) gone.documents.push(await window.juno.documents.remove(record.id));
			for (const folder of what.folders) if (folder.folderId) gone.folders.push(await window.juno.documents.folders.remove(folder.folderId));
			for (const template of what.templates) await window.juno.templates.remove(template.id);
			if (preview && what.documents.some((record) => record.id === preview.id)) setPreview(null);
			if (preview && what.templates.some((template) => template.id === preview.id)) setPreview(null);
		} catch (cause: unknown) {
			fail(cause);
		}
		setSelection(NO_SELECTION);
		changed();
		if (gone.documents.length + gone.folders.length > 0) setDeleted(gone);
		else if (what.templates.length > 0) setNotice(`${plural(what.templates.length, "template", "templates")} deleted.`);
	}

	async function restore() {
		if (!deleted) return;
		const gone = deleted;
		setDeleted(null);
		try {
			for (const folder of gone.folders) await window.juno.documents.folders.restore(folder.id);
			for (const record of gone.documents) await window.juno.documents.restore(record.id);
			changed();
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	function command(next: ListCommand) {
		const only = selectedItems.length === 1 ? selectedItems[0]! : null;
		switch (next.kind) {
			case "rename":
				if (only && (only.kind !== "node" || only.node.kind === "folder")) setRenaming(only.key);
				return;
			case "delete":
				askDelete(selectedItems);
				return;
			case "duplicate":
				void duplicate(selectedRecords);
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
			case "up-folder":
				if (openKey !== ROOT_KEY) openNode(parentOf(roots, openKey)?.key ?? ROOT_KEY);
				return;
			default:
				return;
		}
	}

	/* ------------------------------------------------------------- menus */

	function nodeMenu(target: DocumentTreeNode, event: MouseEvent) {
		contextMenuFor(
			{ kind: "folder", id: target.key },
			{
				open: () => openNode(target.key),
				"new-folder": () => void newFolder(target),
				"add-files": () => void pickAndAdd(target),
				rename: () => setRenaming(target.key),
				"move-to": () => setPicker({ kind: "folder", node: target }),
				delete: () => setConfirm({ documents: [], folders: [target], templates: [] }),
				failed: setNotice,
			},
		)(event);
	}

	function itemMenu(item: ExplorerItem, event: MouseEvent) {
		if (item.kind === "node") {
			nodeMenu(item.node, event);
			return;
		}
		// An action on one of several selected rows is an action on all of them.
		const together = selection.selected.includes(item.key) && selectedItems.length > 1 ? selectedItems : [item];
		const records = together.flatMap((entry) => (entry.kind === "document" ? [entry.record] : []));
		if (item.kind === "template") {
			const { template } = item;
			contextMenuFor(
				{ kind: "document-template", id: template.id },
				{
					preview: () => showItem(item),
					edit: () => setMode({ kind: "template-edit", id: template.id, canvas: template.hasCanvas }),
					"use-template": () => void startTemplate(template.id),
					delete: () => askDelete(together),
					failed: setNotice,
				},
			)(event);
			return;
		}
		const { record } = item;
		contextMenuFor(
			{ kind: "file", id: record.id },
			{
				preview: () => showItem(item),
				open: () => activate(item, "open"),
				"copy-to": () => setPicker({ kind: "documents", mode: "copy", ids: records.map((entry) => entry.id), current: null }),
				"move-to": () => setPicker({ kind: "documents", mode: "move", ids: records.map((entry) => entry.id), current: keyOfRecord(record) }),
				rename: () => setRenaming(item.key),
				"convert-pdf": () => void convert(record),
				sign: () => sign(record),
				"send-file": () => setMode({ kind: "send", record }),
				delete: () => askDelete(together),
				done: (message) => {
					changed();
					if (message) setNotice(message);
				},
				failed: setNotice,
			},
		)(event);
	}

	const blankMenu = blankMenuFor("documents", {
		"add-files": () => void pickAndAdd(),
		"new-folder": () => void newFolder(),
		"new-page": () => void newPage(),
		"new-document": () => setMode({ kind: "generate", start: startPlace() }),
	});

	async function startTemplate(id: string) {
		try {
			const template = await window.juno.templates.get(id);
			if (template) setMode({ kind: "template-use", template, start: startPlace() });
		} catch (cause: unknown) {
			fail(cause);
		}
	}

	useScreenAction("documents", (action) => {
		if (action === "new-page") void newPage();
		else if (action === "import") void pickAndAdd();
		else setMode({ kind: "generate", start: startPlace() });
	});

	/* ------------------------------------------------------------ drops */

	function payloadOf(event: DragEvent): DragPayload | null {
		const raw = event.dataTransfer.getData(DRAG_TYPE);
		return raw ? decodeDrag(raw) : null;
	}

	async function dropOn(target: DocumentTreeNode | null, event: DragEvent) {
		setDropping(false);
		const route = routeDrop({ ...dropPayload(event), target, roots });
		if (route.kind === "none") {
			if (route.reason) setNotice(route.reason);
			return;
		}
		if (route.kind === "add-files") {
			const files = Array.from(event.dataTransfer.files);
			addFiles(await itemsFromFiles(files), route.place, target?.name ?? "Unfiled");
			return;
		}
		if (route.kind === "move-documents" && target) {
			// Let go of over the folder they are already in: a drag that went nowhere.
			const elsewhere = route.ids.filter((id) => {
				const shown = byKey.get(documentKey(id));
				return !(shown?.kind === "document" && keyOfRecord(shown.record) === target.key);
			});
			if (elsewhere.length > 0) await moveDocuments(elsewhere, target);
		}
		if (route.kind === "move-folder" && target) {
			const folder = findNode(roots, `folder:${route.folderId}`);
			if (folder) await moveFolder(folder, target);
		}
	}

	/** Documents that all have a file go out as the platform's drag, so they can land outside Juno too. */
	function dragOut(item: ExplorerItem, event: DragEvent): boolean {
		const payload = dragOf(item);
		if (payload?.kind !== "documents") return false;
		const records = payload.ids.map((id) => byKey.get(documentKey(id))).flatMap((entry) => (entry?.kind === "document" ? [entry.record] : []));
		if (records.length === 0 || records.some((record) => !record.latestVersion)) return false;
		dragDocumentsOut(event, records.map((record) => record.id));
		return true;
	}

	/** A drop of files that is Juno's own drag coming back in reads as the documents it carries. */
	function dropPayload(event: DragEvent): { types: string[]; payload: DragPayload | null } {
		const own = ownDrop(Array.from(event.dataTransfer.files));
		if (own) return { types: [DRAG_TYPE], payload: { kind: "documents", ids: own } };
		return { types: Array.from(event.dataTransfer.types), payload: payloadOf(event) };
	}

	function dragOf(item: ExplorerItem): DragPayload | null {
		if (item.kind === "document") {
			const ids = selection.selected.includes(item.key) ? selectedRecords.map((record) => record.id) : [item.record.id];
			return { kind: "documents", ids: ids.length > 0 ? ids : [item.record.id] };
		}
		if (item.kind === "node" && item.node.kind === "folder" && item.node.folderId) {
			return { kind: "folder", key: item.node.key, folderId: item.node.folderId };
		}
		return null;
	}

	// Files dragged from outside anywhere over the screen: drawn as a drop over the content.
	const screenDrop = {
		onDragOver: (event: DragEvent<HTMLDivElement>) => {
			if (!carriesFiles(event) && !Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
			event.preventDefault();
			const files = carriesFiles(event);
			event.dataTransfer.dropEffect = files ? "copy" : "move";
			if (files && !isOwnDrag() && mode.kind === "explorer" && !adding && !preview) setDropping(true);
		},
		onDragLeave: (event: DragEvent<HTMLDivElement>) => {
			if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
			setDropping(false);
		},
		onDrop: (event: DragEvent<HTMLDivElement>) => {
			if (!carriesFiles(event) && !Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
			event.preventDefault();
			if (needle || openKey === TEMPLATES_KEY) {
				setDropping(false);
				if (carriesFiles(event) && !isOwnDrag() && openKey === TEMPLATES_KEY) setNotice("Templates holds templates. Drop files on a client, a project or a folder.");
				return;
			}
			void dropOn(node, event);
		},
	};

	/* ------------------------------------------------------- breadcrumb */

	const crumbs: Crumb[] = [];
	if (mode.kind === "template-edit" || mode.kind === "template-use" || mode.kind === "components" || mode.kind === "component") {
		const back = () => setMode({ kind: "explorer" });
		crumbs.push({ label: "Documents", onSelect: () => { back(); openNode(ROOT_KEY); } }, { label: "Templates", onSelect: back });
		if (mode.kind === "components") crumbs.push({ label: "Components" });
		else if (mode.kind === "component") crumbs.push({ label: "Components", onSelect: () => setMode({ kind: "components" }) }, { label: "Edit" });
		else crumbs.push({ label: mode.kind === "template-use" ? `Use ${mode.template.name}` : "Edit" });
	} else if (openKey !== ROOT_KEY || preview || mode.kind !== "explorer") {
		crumbs.push({ label: "Documents", onSelect: () => { setMode({ kind: "explorer" }); openNode(ROOT_KEY); } });
		path.forEach((step, at) => {
			const last = at === path.length - 1 && !preview && mode.kind === "explorer";
			crumbs.push(
				last
					? { label: step.name }
					: {
							label: step.name,
							onSelect: () => {
								setMode({ kind: "explorer" });
								openNode(step.key);
							},
						},
			);
		});
		if (mode.kind === "page") crumbs.push({ label: mode.title });
		else if (mode.kind === "generate") crumbs.push({ label: "New document" });
		else if (mode.kind === "sign") crumbs.push({ label: `Sign ${mode.record.title}` });
		else if (mode.kind === "send") crumbs.push({ label: "New message" });
		else if (preview) crumbs.push({ label: previewTitle ?? "Preview" });
	}
	usePublishBreadcrumb(crumbs);

	/* ------------------------------------------------------------ modes */

	const toExplorer = () => setMode({ kind: "explorer" });

	if (mode.kind === "send") {
		return (
			<ComposePage
				seed={{ clientId: mode.record.clientId, projectId: mode.record.projectId, documentIds: [mode.record.id], subject: mode.record.title }}
				onClose={toExplorer}
				onDeleted={() => {
					toExplorer();
					setNotice("Draft deleted.");
				}}
				onDone={(_message, queued) => {
					toExplorer();
					setNotice(queued ? "Message queued. Follow it in the mail outbox." : "Draft saved in the mail outbox.");
				}}
			/>
		);
	}

	if (mode.kind === "generate") {
		return (
			<GenerateDialog
				start={mode.start}
				backLabel={placeName}
				onClose={toExplorer}
				onGenerated={generated}
			/>
		);
	}

	if (mode.kind === "sign") {
		return (
			<SignPage
				record={mode.record}
				onClose={toExplorer}
				onSigned={() => {
					toExplorer();
					changed();
				}}
			/>
		);
	}

	if (mode.kind === "page") {
		return (
			<div className="h-full min-h-0">
				<PageView
					key={mode.id}
					pageId={mode.id}
					onDeleted={(record) => {
						toExplorer();
						changed();
						setDeleted({ documents: [record], folders: [] });
					}}
					onChanged={changed}
					onTitleChange={(title) => setMode((current) => (current.kind === "page" && current.title !== title ? { ...current, title } : current))}
				/>
			</div>
		);
	}

	if (mode.kind === "components") {
		return (
			<div className="h-full min-h-0">
				<ComponentsScreen onOpen={(id) => setMode({ kind: "component", id, from: null })} onBack={toExplorer} />
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
					onSaved={data.reload}
					onBack={() => setMode(from ? { kind: "template-edit", id: from, canvas: true } : { kind: "components" })}
				/>
			</div>
		);
	}

	if (mode.kind === "template-edit") {
		const id = mode.id;
		return (
			<div className="h-full min-h-0">
				{mode.canvas ? (
					<DocumentCanvasEditor
						key={id}
						templateId={id}
						flowOnOpen={mode.flow === true}
						onSaved={data.reload}
						onOpenComponent={(componentId) => setMode({ kind: "component", id: componentId, from: id })}
						onBack={() => {
							toExplorer();
							data.reload();
						}}
					/>
				) : (
					<TemplateEditor
						key={id}
						templateId={id}
						onSaved={data.reload}
						onBack={() => {
							toExplorer();
							data.reload();
						}}
					/>
				)}
			</div>
		);
	}

	if (mode.kind === "template-use") {
		// Done shows the document in the folder it went into, the way generating from the explorer does.
		const done = () => {
			toExplorer();
			changed();
			if (made.current) land(made.current);
			made.current = null;
		};
		const created = (record: DocumentRecord) => {
			made.current = record;
		};
		return (
			<div className="h-full min-h-0">
				{mode.template.canvas ? (
					<UseCanvasTemplateScreen
						key={mode.template.id}
						template={mode.template}
						start={mode.start}
						onBack={toExplorer}
						onCreated={created}
						onDone={done}
					/>
				) : (
					<UseDocumentTemplateScreen
						key={mode.template.id}
						templateId={mode.template.id}
						start={mode.start}
						onBack={toExplorer}
						onCreated={created}
						onDone={done}
					/>
				)}
			</div>
		);
	}

	/* --------------------------------------------------------- explorer */

	const pickedName = (ids: string[]) => {
		const first = ids.length === 1 ? byKey.get(documentKey(ids[0]!)) : undefined;
		return first ? nameOf(first) : plural(ids.length, "document", "documents");
	};

	const heading = needle ? `Results for "${needle}"` : (node?.name ?? "Documents");
	const count = needle
		? data.everything === null
			? "Searching"
			: plural(items.length, "result", "results")
		: selection.selected.length > 1
			? `${selection.selected.length} of ${items.length} selected`
			: plural(items.length, "item", "items");

	const inTemplates = openKey === TEMPLATES_KEY && !needle;
	const loading = data.tree.status === "loading" || (!needle && openKey !== ROOT_KEY && !inTemplates && data.records === null);

	const empty = loading ? (
		<div className="px-2 pt-8">
			<RowsSkeleton rows={8} divided={false} label="Loading the folder" />
		</div>
	) : data.tree.status === "error" ? (
		<div className="m-8 border-l-2 border-[var(--risk)] pl-4">
			<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load your documents.</p>
			<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
				{data.tree.message}
			</p>
		</div>
	) : needle ? (
		<EmptyState
			icon="search"
			title="Nothing matches that"
			description="Try other words, or clear the search to see this folder again."
			secondaryAction={{ label: "Clear search", onClick: () => setSearch("") }}
		/>
	) : inTemplates ? (
		<EmptyState
			icon="templates"
			title="No templates yet"
			description="Make one with New template, or import a Word file to start from."
		/>
	) : (
		<EmptyState
			icon="folder-open"
			title="This folder is empty"
			description="Drop files here, or press Add files, to keep them in this folder."
			action={{ label: "Add files", icon: "import", onClick: () => void pickAndAdd() }}
		/>
	);

	return (
		<div className="relative flex h-full min-h-0" {...screenDrop}>
			<TitleSearch value={search} onChange={setSearch} placeholder="Search documents" />
			<TitleBarSlot side="right">
				<Segmented size="icons-compact" label="Layout" value={view} onChange={setView} options={VIEW_OPTIONS} />
			</TitleBarSlot>
			<TitleBarSlot side="overflow">
				<MenuButton
					size="dense"
					ariaLabel="More document actions"
					items={[
						{ id: "add", label: "Add files", icon: "import", onSelect: () => void pickAndAdd() },
						{ id: "folder", label: "New folder", icon: "folder-add", disabled: inTemplates, onSelect: () => void newFolder() },
						{ id: "page", label: "New page", icon: "note", separatorBefore: true, onSelect: () => void newPage() },
						{ id: "generate", label: "New document from a template", icon: "templates", onSelect: () => setMode({ kind: "generate", start: startPlace() }) },
						{ id: "components", label: "Template components", icon: "templates", separatorBefore: true, onSelect: () => setMode({ kind: "components" }) },
					]}
				/>
			</TitleBarSlot>

			<nav aria-label="Folders" className="w-[264px] flex-none overflow-y-auto border-r border-[var(--line)] p-2">
				{data.tree.status === "ready" ? (
					<FolderTree
						roots={roots}
						templateCount={templates.length}
						openKey={needle ? "" : openKey}
						expanded={expanded}
						onToggle={(key) =>
							setExpanded((current) => {
								const next = new Set(current);
								if (next.has(key)) next.delete(key);
								else next.add(key);
								return next;
							})
						}
						onOpen={openNode}
						renamingKey={renaming}
						onStartRename={(target) => setRenaming(target.key)}
						onRename={(target, name) => void renameNode(target, name)}
						onRenameEnd={() => setRenaming(null)}
						onNodeMenu={nodeMenu}
						onDeleteNode={(target) => setConfirm({ documents: [], folders: [target], templates: [] })}
						canDrop={(target) => target === null || target.place !== null}
						onDrop={(target, event) => void dropOn(target, event)}
					/>
				) : (
					<RowsSkeleton rows={8} avatar divided={false} trailing={false} label="Loading the folders" />
				)}
			</nav>

			<section aria-label={heading} className="flex min-w-0 flex-1 flex-col">
				<ExplorerToolbar node={needle ? null : node} heading={heading} count={count}>
					{inTemplates ? (
						<>
							<InlineAdd
								label="New document template"
								placeholder="Template name"
								onSubmit={(name) =>
									void (async () => {
										try {
											const made = await window.juno.templates.create({ name });
											data.reload();
											setMode({ kind: "template-edit", id: made.id, canvas: made.canvas !== null });
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
											const made = await window.juno.templates.pickDocx();
											if (!made) return;
											data.reload();
											setMode({ kind: "template-edit", id: made.id, canvas: made.canvas !== null, flow: true });
										} catch (cause: unknown) {
											fail(cause);
										}
									})()
								}
							/>
							<ToolbarButton icon="templates" label="Components" onClick={() => setMode({ kind: "components" })} />
						</>
					) : needle ? null : (
						<>
							<ToolbarButton icon="folder-add" label="New folder" onClick={() => void newFolder()} />
							<ToolbarButton icon="import" label="Add files" onClick={() => void pickAndAdd()} />
						</>
					)}
				</ExplorerToolbar>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ExplorerView
						items={loading ? [] : items}
						view={view}
						selection={selection}
						onSelection={setSelection}
						statusLabels={statusLabels}
						sort={openKey === ROOT_KEY && !needle ? null : sort}
						onSort={(by) => setSort((current) => nextSort(current, by))}
						showWhere={needle.length > 0}
						renamingKey={renaming}
						onRename={(item, name) => void renameItem(item, name)}
						onRenameEnd={() => setRenaming(null)}
						cutKeys={cutKeys}
						onActivate={activate}
						onCommand={command}
						onItemMenu={itemMenu}
						onBlankMenu={inTemplates || needle ? undefined : blankMenu}
						dragOf={dragOf}
						onDragOut={dragOut}
						canDropOn={(item) => item.kind === "node" && item.node.place !== null}
						onDropOn={(item, event) => item.kind === "node" && void dropOn(item.node, event)}
						label={heading}
						empty={empty}
					/>
				</div>
			</section>

			{dropping ? (
				<div aria-hidden className="animate-fade pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[var(--accent-soft)]/70">
					<div className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--accent)] bg-[var(--surface)] px-8 py-6 text-center shadow-[var(--shadow-popover)]">
						<p className="text-lg font-[var(--weight-medium)] text-[var(--accent)]">Drop to add to {placeName}</p>
						<p className="mt-1 text-sm text-[var(--ink-muted)]">A file that looks like one already here is shown beside it first.</p>
					</div>
				</div>
			) : null}

			{preview?.kind === "document" ? (
				<DocumentDetail
					documentId={preview.id}
					position={position}
					closeLabel={`Back to ${needle ? "the results" : placeName}`}
					onClose={closePreview}
					revision={data.changedOutside.ids.includes(preview.id) ? data.changedOutside.at : 0}
					details={details}
					onToggleDetails={() => setDetails((value) => !value)}
					onDeleted={(record) => {
						setPreview(null);
						changed();
						setDeleted({ documents: [record], folders: [] });
					}}
					onChanged={data.reload}
					onSign={sign}
					onSend={(record) => setMode({ kind: "send", record })}
					onCopyTo={(record) => setPicker({ kind: "documents", mode: "copy", ids: [record.id], current: null })}
					onMoveTo={(record) => setPicker({ kind: "documents", mode: "move", ids: [record.id], current: keyOfRecord(record) })}
					onNotice={setNotice}
					onTitleChange={setPreviewTitle}
				/>
			) : preview?.kind === "template" ? (
				<TemplatePreview
					templateId={preview.id}
					position={position}
					details={details}
					onToggleDetails={() => setDetails((value) => !value)}
					onClose={closePreview}
					onEdit={(template) => setMode({ kind: "template-edit", id: template.id, canvas: template.canvas !== null })}
					onUse={(template) => setMode({ kind: "template-use", template, start: startPlace() })}
					onDelete={(template) => setConfirm({ documents: [], folders: [], templates: [{ id: template.id, name: template.name }] })}
				/>
			) : null}

			{adding ? (
				<AddFilesFlow
					items={adding.items}
					place={adding.place}
					placeName={adding.name}
					onDone={(outcome) => {
						setAdding(null);
						data.reload();
						const failures = outcome.failures.map((entry) => `${entry.name}: ${entry.message}`).join(" ");
						setNotice([describeOutcome(outcome), failures].filter(Boolean).join(" ") || null);
					}}
				/>
			) : null}

			{picker ? (
				<PlacePickerDialog
					title={
						picker.kind === "folder"
							? `Move ${picker.node.name}`
							: `${picker.mode === "copy" ? "Copy" : "Move"} ${pickedName(picker.ids)}`
					}
					confirmLabel={picker.kind === "documents" && picker.mode === "copy" ? "Copy here" : "Move here"}
					roots={roots}
					exclude={picker.kind === "folder" ? picker.node.key : undefined}
					current={picker.kind === "folder" ? (parentOf(roots, picker.node.key)?.key ?? null) : picker.current}
					onClose={() => setPicker(null)}
					onPick={(target) => {
						const chosen = picker;
						setPicker(null);
						if (chosen.kind === "folder") void moveFolder(chosen.node, target);
						else if (chosen.mode === "copy") void copyDocuments(chosen.ids, target);
						else void moveDocuments(chosen.ids, target);
					}}
				/>
			) : null}

			{confirm ? (
				<Dialog title="Delete" width="narrow" onClose={() => setConfirm(null)}>
					<p className="mt-3 text-base">{deleteSentence(confirm)}</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirm(null)}>Cancel</Button>
						<Button variant="danger" onClick={() => void remove(confirm)}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}

			{deleted ? (
				<Toast
					message={
						deleted.documents.length + deleted.folders.length === 1
							? `${deleted.documents[0]?.title ?? deleted.folders[0]?.name ?? "It"} deleted.`
							: `${deleted.documents.length + deleted.folders.length} items deleted.`
					}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={() => setDeleted(null)}
				/>
			) : notice ? (
				<Toast message={notice} onDismiss={() => setNotice(null)} />
			) : null}
		</div>
	);
}

/** The confirmation's one sentence: what goes, how many, and whether it can come back. */
function deleteSentence(confirm: Confirm): string {
	const parts: string[] = [];
	if (confirm.documents.length === 1) parts.push(confirm.documents[0]!.title);
	else if (confirm.documents.length > 1) parts.push(plural(confirm.documents.length, "document", "documents"));
	if (confirm.folders.length === 1) parts.push(`the folder ${confirm.folders[0]!.name}`);
	else if (confirm.folders.length > 1) parts.push(plural(confirm.folders.length, "folder", "folders"));
	const undoable = parts.length > 0 ? `Delete ${parts.join(" and ")}? You can undo this straight after.` : "";
	const templates =
		confirm.templates.length === 0
			? ""
			: `${confirm.templates.length === 1 ? `The template ${confirm.templates[0]!.name} is` : `${plural(confirm.templates.length, "template", "templates")} are`} deleted for good. This cannot be undone.`;
	return [undoable, templates].filter(Boolean).join(" ");
}
