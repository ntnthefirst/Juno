import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MailBlock, MailLayout, MailNode, MailTemplate, MailTextStyle, TemplateInput } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { FONT_WEIGHTS } from "./mail/canvas/box-style";
import { absorb, copyOverrides, layoutAt, widestFirst } from "./mail/canvas/breakpoints";
import {
	cloneNode,
	duplicateNode,
	findNode,
	firstChildOf,
	insertNode,
	insertTarget,
	moveNode,
	moveWithinParent,
	newBlock,
	parentOf,
	removeNode,
	selectionIn,
	siblingOf,
	updateBlock,
	updateCell,
	updateColumns,
	updateSection,
} from "./mail/canvas/canvas-actions";
import { CanvasStage } from "./mail/canvas/CanvasStage";
import { PREVIEW_WIDTHS, type PreviewWidth } from "./mail/canvas/preview-width";
import { WidthSwitch } from "./mail/canvas/WidthSwitch";
import type { Editing, Measured, Selection } from "./mail/canvas/CanvasView";
import { DesignPanel } from "./mail/canvas/DesignPanel";
import { framed } from "./mail/canvas/framed-preview";
import { CanvasToolbar } from "./mail/canvas/CanvasToolbar";
import {
	elementInfo,
	newElement,
	readLastUsed,
	writeLastUsed,
	type ElementId,
	type GroupId,
	type LastUsed,
} from "./mail/canvas/elements";
import { GROUP_ACTIONS, isControl, isTyping, shortcutFor, type ShortcutAction } from "./mail/canvas/shortcuts";
import { alignAcross, flowOf, type Across } from "./mail/canvas/sizing";
import { useCanvasFonts } from "./mail/canvas/use-canvas-fonts";
import { EditorSidebar, type EditorMode } from "./mail/EditorSidebar";
import { HtmlCodeEditor } from "./mail/HtmlCodeEditor";
import { mailPlaceholderGroups } from "./mail/placeholders";
import { TemplateInputsEditor } from "./mail/TemplateInputsEditor";
import { VisualEditor } from "./mail/VisualEditor";

type MailTemplateEditorProps = {
	templateId: string;
	onBack: () => void;
	onSaved: () => void;
};

type Draft = {
	name: string;
	description: string;
	subject: string;
	bodyHtml: string;
	inputs: TemplateInput[];
	layout: MailLayout | null;
};

type Preview = { subject: string; html: string; missing: string[] };

/** The layouts an undo and a redo go back and forward to. */
type History = { past: MailLayout[]; future: MailLayout[] };

const AUTOSAVE_KEY = "juno.mailTemplates.autosave";

const NO_HISTORY: History = { past: [], future: [] };

/** How many steps back an undo can go. */
const HISTORY_DEPTH = 100;

/**
 * Edits to the same thing closer together than this are one step to undo, so
 * typing a word into a field is undone as the word and not letter by letter.
 */
const MERGE_MS = 800;

/** The keys that add what a group added last, and the keys that open its menu, as the groups they belong to. */
const ADD_GROUPS = Object.fromEntries(
	(Object.keys(GROUP_ACTIONS) as GroupId[]).map((group) => [GROUP_ACTIONS[group].add, group]),
) as Partial<Record<ShortcutAction, GroupId>>;
const MENU_GROUPS = Object.fromEntries(
	(Object.keys(GROUP_ACTIONS) as GroupId[]).map((group) => [GROUP_ACTIONS[group].menu, group]),
) as Partial<Record<ShortcutAction, GroupId>>;

/**
 * What Ctrl+C last copied: one node, wherever it came from. Kept for the
 * session rather than per editor, so a block copied in one template pastes
 * into the next one opened, the way a copy works everywhere else.
 */
let copied: MailNode | null = null;

/** Every id in the tree and the order its parent holds it in, one level at a time: what a structural edit changes. */
function shapeOf(layout: MailLayout): string {
	function walk(nodes: MailNode[]): string {
		return nodes
			.map((node) => {
				if (node.kind === "container") return `${node.id}:[${walk(node.children)}]`;
				if (node.kind === "columns") {
					return `${node.id}:{${node.rows.map((row) => `${row.id}[${row.cells.map((cell) => `${cell.id}(${walk(cell.children)})`).join(",")}]`).join(",")}}`;
				}
				return node.id;
			})
			.join(",");
	}
	return walk(layout.children);
}

/**
 * Editing one mail template, on a canvas with a panel on each side.
 *
 * The shape is the one every canvas tool has, because the job is the same
 * one: what the thing is and what is in it on the left, what is selected on
 * the right, everything that can be added along the bottom, and the sheet in
 * the middle with nothing else on it. There is no header bar over the canvas,
 * since the window's own breadcrumb already says where this is and how to
 * leave. The keyboard is Figma's (shortcuts.ts), undo included.
 *
 * Saving is a choice rather than a mechanism. The preview renders values in
 * hand (`mail.templates.preview`), so it is a read, which is what lets the
 * autosave switch exist at all: the editor this replaced wrote on a timer to
 * keep its preview honest and stamped `customisedAt` on templates nobody had
 * deliberately edited.
 *
 * A template with a layout is edited on the canvas and its HTML is compiled
 * from it. A template without one is what everything written before the canvas
 * is, and it keeps the visual and code editors it has always had.
 */
export function MailTemplateEditor({ templateId, onBack, onSaved }: MailTemplateEditorProps) {
	const [template, setTemplate] = useState<MailTemplate | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [mode, setMode] = useState<EditorMode>("canvas");
	const [code, setCode] = useState<string | null>(null);

	const [selection, setSelection] = useState<Selection>(null);
	const [editing, setEditing] = useState<Editing | null>(null);
	const [measured, setMeasured] = useState<Measured | null>(null);
	const [contentHeight, setContentHeight] = useState(0);
	// A hand-written template is previewed at three widths; a canvas at its breakpoints.
	const [previewWidth, setPreviewWidth] = useState<PreviewWidth>("wide");
	// The breakpoint being edited and looked at, or null for the default.
	const [breakpoint, setBreakpoint] = useState<string | null>(null);
	const [sidebar, setSidebar] = useState(true);
	const [help, setHelp] = useState(false);
	// What each toolbar group adds when its button, or its letter, is pressed.
	const [last, setLast] = useState<LastUsed>(readLastUsed);
	// The group whose menu is open, from the chevron or from Shift and its letter.
	const [groupMenu, setGroupMenu] = useState<GroupId | null>(null);

	const [history, setHistory] = useState<History>(NO_HISTORY);
	// The last change to the layout that could be merged with the next one:
	// when it was made, and to what.
	const lastEdit = useRef<{ at: number; key: string } | null>(null);

	const [preview, setPreview] = useState<Preview | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [savedAt, setSavedAt] = useState<number | null>(null);

	// Remembered per machine rather than per template: it is a habit about how
	// somebody works, not a property of one piece of text.
	const [autosave, setAutosave] = useState(() => {
		try {
			return window.localStorage.getItem(AUTOSAVE_KEY) === "on";
		} catch {
			return false;
		}
	});

	// State, not a ref: `dirty` below is read during render, so what is saved
	// has to be something React re-renders on.
	const [savedKey, setSavedKey] = useState("");

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.templates
			.get(templateId)
			.then((row) => {
				if (cancelled) return;
				if (!row) {
					setError("That template no longer exists.");
					return;
				}
				const loaded: Draft = {
					name: row.name,
					description: row.description ?? "",
					subject: row.subject,
					bodyHtml: row.bodyHtml,
					inputs: row.inputs,
					layout: row.layout,
				};
				setTemplate(row);
				setDraft(loaded);
				setSavedKey(JSON.stringify(loaded));
				setHistory(NO_HISTORY);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	const draftKey = draft ? JSON.stringify(draft) : "";
	const dirty = Boolean(draft) && draftKey !== savedKey;

	const save = useCallback(async (): Promise<void> => {
		if (!draft) return;
		setSaving(true);
		setError(null);
		try {
			const updated = await window.juno.mail.templates.update(templateId, {
				name: draft.name,
				description: draft.description.trim() || null,
				subject: draft.subject,
				bodyHtml: draft.bodyHtml,
				inputs: draft.inputs,
				layout: draft.layout,
			});
			setTemplate(updated);
			setSavedKey(JSON.stringify(draft));
			setSavedAt(Date.now());
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setSaving(false);
		}
	}, [draft, onSaved, templateId]);

	// Autosave: a pause of 1.5s, or 15s after the oldest unsaved edit whichever
	// comes first, and never when nothing changed. Written here rather than in
	// a shared hook because it has to close over the same `dirty` the button
	// reads, so the two can never disagree about whether there is work to do.
	const dirtySince = useRef<number | null>(null);
	useEffect(() => {
		if (!dirty) {
			dirtySince.current = null;
			return;
		}
		if (dirtySince.current === null) dirtySince.current = Date.now();
		if (!autosave || saving) return;
		const age = Date.now() - dirtySince.current;
		const wait = Math.max(0, Math.min(1500, 15000 - age));
		const timer = window.setTimeout(() => void save(), wait);
		return () => window.clearTimeout(timer);
	}, [dirty, draftKey, autosave, saving, save]);

	// The preview is a read, so it runs whether or not anything is being saved,
	// and it is debounced on its own clock.
	useEffect(() => {
		if (!draft) return;
		const timer = window.setTimeout(() => {
			let cancelled = false;
			window.juno.mail.templates
				.preview({
					subject: draft.subject,
					bodyHtml: draft.bodyHtml,
					layout: draft.layout,
					inputs: draft.inputs,
					clientId: null,
				})
				.then((result) => {
					if (cancelled) return;
					setPreview({ subject: result.subject, html: result.bodyHtml, missing: result.missing });
					setPreviewError(null);
				})
				.catch((cause: unknown) => {
					if (!cancelled) setPreviewError(messageOf(cause));
				});
			return () => {
				cancelled = true;
			};
		}, 500);
		return () => window.clearTimeout(timer);
	}, [draftKey, draft]);

	const patch = useCallback((next: Partial<Draft>) => {
		setDraft((current) => (current ? { ...current, ...next } : current));
	}, []);

	// The size the canvas measured what is selected at. Kept when it has not
	// changed, so a measurement that comes back the same does not render again.
	const onMeasure = useCallback((size: Measured | null) => {
		setMeasured((current) =>
			current === size || (current && size && current.width === size.width && current.height === size.height)
				? current
				: size,
		);
	}, []);

	const placeholderGroups = useMemo(() => mailPlaceholderGroups(draft?.inputs ?? []), [draft?.inputs]);

	const layout = draft?.layout ?? null;
	// A breakpoint that has gone, by undo or by removing it, is the default again.
	const active = layout && breakpoint && layout.breakpoints.some((entry) => entry.id === breakpoint) ? breakpoint : null;
	// The canvas as the selected breakpoint draws it. The canvas, the layers
	// and the design panel show this; how something looks is changed on it and
	// folded back by `restyleLayout`, and what is in it is changed on `layout`.
	const shown = layout ? layoutAt(layout, active) : null;
	const canvasFonts = useCanvasFonts(layout?.fonts ?? []);
	// An undo can take away what was selected. What is gone is not selected.
	const liveId = layout && selection && selectionIn(layout, selection.id) ? selection.id : null;
	const live: Selection = liveId ? { id: liveId } : null;
	// The selected node as the stored layout has it (structure: order, content,
	// what it holds) and as the active breakpoint draws it (look: size,
	// position, appearance). A structural change goes through `onLayout`
	// against the first; a change to how something looks goes through
	// `restyleLayout` against the second.
	const liveNode = layout && liveId ? findNode(layout, liveId) : null;
	const shownNode = shown && liveId ? findNode(shown, liveId) : null;
	const onCanvas = mode === "canvas" && layout !== null;

	/**
	 * Every change to the layout goes through here, which is what makes it one
	 * that can be undone. A change to what is in the sections and in what
	 * order is always a step of its own; a change to how something looks is
	 * merged with the one before it when it is to the same selection and quick
	 * on its heels, so a colour dragged across the picker is one step.
	 */
	function onLayout(next: MailLayout): void {
		const current = draft?.layout ?? null;
		if (current && next !== current) {
			const now = Date.now();
			const restyle = shapeOf(next) === shapeOf(current);
			const key = restyle ? JSON.stringify(live) : "";
			const previous = lastEdit.current;
			const merge = restyle && previous !== null && previous.key === key && now - previous.at < MERGE_MS;
			lastEdit.current = restyle ? { at: now, key } : null;
			setHistory((known) =>
				merge
					? known.future.length > 0
						? { ...known, future: [] }
						: known
					: { past: [...known.past.slice(-(HISTORY_DEPTH - 1)), current], future: [] },
			);
		}
		patch({ layout: next });
	}

	/**
	 * A change to how things look, made on the canvas as the selected breakpoint
	 * draws it. At a breakpoint it becomes what that breakpoint changes; on the
	 * default it is the layout.
	 */
	function restyleLayout(next: MailLayout): void {
		if (layout) onLayout(absorb(layout, active, next));
	}

	function undo(): void {
		const current = draft?.layout;
		const previous = history.past[history.past.length - 1];
		if (!current || !previous) return;
		setHistory({ past: history.past.slice(0, -1), future: [current, ...history.future] });
		lastEdit.current = null;
		setEditing(null);
		patch({ layout: previous });
	}

	function redo(): void {
		const current = draft?.layout;
		const next = history.future[0];
		if (!current || !next) return;
		setHistory({ past: [...history.past, current], future: history.future.slice(1) });
		lastEdit.current = null;
		setEditing(null);
		patch({ layout: next });
	}

	/** Where a new element lands: see insertTarget. */
	function landing(structural: boolean): { parentId: string | null; afterId: string | null } | null {
		return layout ? insertTarget(layout, liveId, structural) : null;
	}

	/** Remembers what a group added, so its button and its letter add that next time. */
	function remember(id: ElementId): void {
		const { group } = elementInfo(id);
		const next = { ...last, [group.id]: id };
		setLast(next);
		writeLastUsed(next);
	}

	/** Adds one element of the toolbar, from its group's button or menu or from a key. */
	function insertElement(id: ElementId): void {
		if (!layout) return;
		const node = newElement(layout, id);
		const at = landing(node.kind === "container" || node.kind === "columns");
		if (!at) return;
		onLayout(insertNode(layout, at.parentId, node, at.afterId));
		setSelection({ id: node.id });
		// Figma's text tool: the new text is open with its words selected, so
		// what is typed next replaces them.
		setEditing(node.kind === "text" || node.kind === "heading" ? { blockId: node.id, caret: "all" } : null);
		remember(id);
	}

	/** The button block, which stays on the toolbar until actions replace it. */
	function insertButton(): void {
		if (!layout) return;
		const at = landing(false);
		if (!at) return;
		const block = newBlock("button");
		onLayout(insertNode(layout, at.parentId, block, at.afterId));
		setSelection({ id: block.id });
		setEditing(null);
	}

	/** Figma's eye. At a breakpoint it hides or shows at that width and narrower. */
	function setHidden(id: string, hidden: boolean): void {
		if (!shown) return;
		const node = findNode(shown, id);
		if (!node) return;
		if (node.kind === "container") return restyleLayout(updateSection(shown, id, { hidden }));
		if (node.kind === "columns") return restyleLayout(updateColumns(shown, id, { hidden }));
		restyleLayout(updateBlock(shown, id, { hidden } as Partial<MailBlock>));
	}

	/** Alt and an arrow on a layer, or an arrow on the canvas: one place earlier or later, in its own parent. */
	function stepLayer(id: string, by: -1 | 1): void {
		if (!layout) return;
		onLayout(moveWithinParent(layout, id, by));
	}

	/** Deleting what is selected lets go of it, so a second Delete does not take its parent too. */
	function remove(): void {
		if (!layout || !liveId) return;
		onLayout(removeNode(layout, liveId));
		setSelection(null);
		setEditing(null);
	}

	function copy(): boolean {
		if (!liveNode) return false;
		copied = structuredClone(liveNode);
		return true;
	}

	function paste(): void {
		if (!layout || !copied) return;
		const at = landing(copied.kind === "container" || copied.kind === "columns");
		if (!at) return;
		const clone = cloneNode(copied);
		onLayout(insertNode(layout, at.parentId, clone, at.afterId));
		setSelection({ id: clone.id });
	}

	/** A copy right after the original, in the same parent, every id under it new. It looks at every breakpoint the way its original does. */
	function duplicate(): void {
		if (!layout || !liveId) return;
		const result = duplicateNode(layout, liveId);
		if (!result) return;
		onLayout(copyOverrides(result.layout, result.pairs));
		setSelection({ id: result.id });
	}

	/** Enter: open a text for typing, or step into a container's, a columns table's or a cell's first child. */
	function enter(): void {
		if (!layout || !liveId) return;
		if (liveNode && (liveNode.kind === "text" || liveNode.kind === "heading")) {
			if (!liveNode.hidden) setEditing({ blockId: liveNode.id, caret: "all" });
			return;
		}
		const first = firstChildOf(layout, liveId);
		if (first) setSelection({ id: first });
	}

	/** A change to the selected block's type, from the keyboard. */
	function restyle(change: (text: MailTextStyle) => Partial<MailTextStyle>): void {
		if (!shown || !shownNode || !("text" in shownNode)) return;
		const text = { ...shownNode.text, ...change(shownNode.text) };
		restyleLayout(updateBlock(shown, shownNode.id, { text } as Partial<MailBlock>));
	}

	/** Alt with a letter: across the block's own parent, and only along the way that parent lets it move. Only a block has an alignment of its own to change this way. */
	function alignSelected(across: Across, axis: "h" | "v"): void {
		if (!shown || !shownNode || shownNode.kind === "container" || shownNode.kind === "columns" || !liveId) return;
		const parentId = parentOf(shown, liveId);
		const parent = parentId ? findNode(shown, parentId) : null;
		if (!parent || parent.kind !== "container") return;
		const free = flowOf(parent) === "column" ? "h" : "v";
		if (axis !== free) return;
		restyleLayout(updateBlock(shown, shownNode.id, alignAcross(shownNode, parent, across)));
	}

	/**
	 * One block into the HTML and CSS it compiles to. The main process does the
	 * compiling, so the code is exactly what the message would have carried,
	 * and the result is part of the draft like any other edit.
	 */
	function convertNode(nodeId: string): void {
		if (!draft?.layout) return;
		const parentId = parentOf(draft.layout, nodeId);
		if (parentId === undefined) return;
		setError(null);
		void window.juno.mail.templates
			.convertBlock({ layout: draft.layout, parentId, nodeId, inputs: draft.inputs })
			.then((next) => onLayout(next))
			.catch((cause: unknown) => setError(messageOf(cause)));
	}

	function convert(): void {
		setError(null);
		// Going to or from a canvas is not a step on the canvas, and there is
		// nothing to go back to on the other side of it.
		setHistory(NO_HISTORY);
		setEditing(null);
		if (draft?.layout) {
			// The HTML the canvas compiled to is kept, so nothing on screen
			// changes except that it is now hand-written.
			patch({ layout: null });
			setSelection(null);
			return;
		}
		// The body it already has becomes one code block, which the author can
		// then break into sections. Compiling it into blocks automatically would
		// rewrite somebody's hand-written table without being asked.
		void window.juno.mail.templates
			.parseBody(draft?.bodyHtml ?? "")
			.then((next) => {
				patch({ layout: next });
				setMode("canvas");
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}

	/**
	 * The editor's keyboard. A press typed into a field belongs to the field,
	 * except Ctrl+S, and Escape, which leaves the field first. A press on a
	 * button keeps what the button does with it: Enter presses it, Tab moves
	 * on, an arrow moves along the layers.
	 */
	function onKey(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (document.querySelector("[role='dialog']")) return;
		const action = shortcutFor(event);

		if (isTyping(event.target)) {
			if (action === "save") {
				event.preventDefault();
				if (dirty && !saving) void save();
			} else if (event.key === "Escape" && event.target instanceof HTMLElement && !event.target.isContentEditable) {
				event.preventDefault();
				event.target.blur();
			}
			return;
		}

		if (event.key === "Escape") {
			if (groupMenu) setGroupMenu(null);
			else if (help) setHelp(false);
			else if (live) setSelection(null);
			else onBack();
			return;
		}

		if (action === "save") {
			event.preventDefault();
			if (dirty && !saving) void save();
			return;
		}
		if (action === "help") {
			event.preventDefault();
			setHelp((open) => !open);
			return;
		}
		if (!onCanvas || !action) return;

		const control = isControl(event.target);
		const inLayers = event.target instanceof Element && event.target.closest("[data-layers]") !== null;
		const run = (fn: () => void) => {
			event.preventDefault();
			fn();
		};
		const addGroup = ADD_GROUPS[action];
		if (addGroup) return run(() => insertElement(last[addGroup]));
		const menuGroup = MENU_GROUPS[action];
		if (menuGroup) return run(() => setGroupMenu((open) => (open === menuGroup ? null : menuGroup)));

		switch (action) {
			case "add-heading":
				return run(() => insertElement("h2"));
			case "add-button":
				return run(insertButton);
			case "undo":
				return run(undo);
			case "redo":
				return run(redo);
			case "paste":
				return run(paste);
		}

		if (!live) return;
		switch (action) {
			case "delete":
				// A Delete on the Save button is not meant for the canvas; on a
				// layer row it is.
				if (control && !inLayers) return;
				return run(remove);
			case "copy":
				return run(() => void copy());
			case "cut":
				return run(() => {
					if (copy()) remove();
				});
			case "duplicate":
				return run(duplicate);
			case "hide":
				return run(() => {
					if (!shownNode) return;
					setHidden(live.id, !shownNode.hidden);
				});
			case "bold":
				return run(() => restyle((text) => ({ weight: FONT_WEIGHTS[text.weight] >= 600 ? "normal" : "bold" })));
			case "italic":
				return run(() => restyle((text) => ({ italic: !text.italic })));
			case "underline":
				return run(() => restyle((text) => ({ decoration: text.decoration === "underline" ? "none" : "underline" })));
			case "strike":
				return run(() => restyle((text) => ({ decoration: text.decoration === "strike" ? "none" : "strike" })));
			case "text-left":
				return run(() => restyle(() => ({ align: "left" })));
			case "text-center":
				return run(() => restyle(() => ({ align: "center" })));
			case "text-right":
				return run(() => restyle(() => ({ align: "right" })));
			case "text-justify":
				return run(() => restyle(() => ({ align: "justify" })));
			case "align-left":
				return run(() => alignSelected("start", "h"));
			case "align-center":
				return run(() => alignSelected("center", "h"));
			case "align-right":
				return run(() => alignSelected("end", "h"));
			case "align-top":
				return run(() => alignSelected("start", "v"));
			case "align-middle":
				return run(() => alignSelected("center", "v"));
			case "align-bottom":
				return run(() => alignSelected("end", "v"));
		}

		// The keys a focused control already answers to.
		if (control) return;
		switch (action) {
			case "edit":
				return run(enter);
			case "parent":
				return run(() => {
					if (!layout) return;
					const parentId = parentOf(layout, live.id);
					setSelection(parentId ? { id: parentId } : null);
				});
			case "next":
				return run(() => {
					if (layout) setSelection({ id: siblingOf(layout, live.id, 1) });
				});
			case "previous":
				return run(() => {
					if (layout) setSelection({ id: siblingOf(layout, live.id, -1) });
				});
			case "earlier":
				return run(() => stepLayer(live.id, -1));
			case "later":
				return run(() => stepLayer(live.id, 1));
		}
	}

	// One listener for the life of the editor, calling whichever handler the
	// last render made, so it always reads the current layout and selection.
	const keyHandler = useRef(onKey);
	useEffect(() => {
		keyHandler.current = onKey;
	});
	useEffect(() => {
		const listener = (event: KeyboardEvent) => keyHandler.current(event);
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, []);

	if (!draft || !template) {
		return (
			<div className="flex h-full flex-col overflow-y-auto p-8">
				<div className="mx-auto w-full max-w-[var(--content-width)]">
					<p className="text-[var(--ink-muted)]">{error ?? "Loading."}</p>
				</div>
			</div>
		);
	}

	const unreviewed = template.isSystem && template.customisedAt === null;
	const status = saving ? "Saving" : dirty ? (autosave ? "Unsaved" : "Not saved") : savedAt ? "Saved." : "";

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--paper)]">
			<div className="relative flex min-h-0 flex-1">
				{sidebar ? (
					<EditorSidebar
						name={draft.name}
						description={draft.description}
						subject={draft.subject}
						onName={(name) => patch({ name })}
						onDescription={(description) => patch({ description })}
						onSubject={(subject) => patch({ subject })}
						layout={shown}
						selection={live}
						onSelect={setSelection}
						onHidden={setHidden}
						onDrop={(id, target) => {
							if (layout) onLayout(moveNode(layout, id, target.parentId, target.beforeId));
						}}
						onStep={stepLayer}
						onConvert={convert}
						unreviewed={unreviewed}
						autosave={autosave}
						onAutosave={(on) => {
							setAutosave(on);
							try {
								window.localStorage.setItem(AUTOSAVE_KEY, on ? "on" : "off");
							} catch {
								// A browser with storage blocked still gets the switch for this
								// session; only the memory of it is lost.
							}
						}}
						status={status}
						dirty={dirty}
						saving={saving}
						onSave={() => void save()}
						onCollapse={() => setSidebar(false)}
					/>
				) : (
					<div className="absolute top-2 left-2 z-10 flex h-[34px] max-w-[240px] items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] pr-1 pl-3 shadow-[var(--shadow-popover)]">
						<span className="truncate text-[length:var(--text-sm)] font-[var(--weight-semibold)]">
							{draft.name || "Untitled template"}
						</span>
						<button
							type="button"
							aria-label="Show the panel"
							title="Show the panel"
							onClick={() => setSidebar(true)}
							className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						>
							<Icon name="sidebar" size={14} />
						</button>
					</div>
				)}

				<main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
					{error ? (
						<p
							role="alert"
							data-selectable
							className="flex-none border-b border-[var(--line)] bg-[var(--risk-soft)] px-4 py-2 text-[length:var(--text-dense)] text-[var(--risk)]"
						>
							{error}
						</p>
					) : null}

					{onCanvas && layout && shown ? (
						<CanvasStage
							layout={shown}
							label={active ? (layout.breakpoints.find((entry) => entry.id === active)?.name ?? "") : "Default"}
							inputs={draft.inputs}
							selection={live}
							onSelect={setSelection}
							onDrop={(id, target) => onLayout(moveNode(layout, id, target.parentId, target.beforeId))}
							onEdit={(blockId, blockPatch) => onLayout(updateBlock(layout, blockId, blockPatch))}
							editing={editing}
							onEditing={setEditing}
							onMeasure={onMeasure}
							onHeight={(minHeight) => onLayout({ ...layout, minHeight })}
							contentHeight={contentHeight}
							onContentHeight={setContentHeight}
						/>
					) : null}

					{mode === "canvas" && !layout ? (
						<div className="min-h-0 flex-1 overflow-y-auto bg-[var(--sunken)] p-6 pb-24">
							<div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
								<VisualEditor
									active
									value={draft.bodyHtml}
									onChange={(bodyHtml) => patch({ bodyHtml })}
									disabled={saving}
									placeholderGroups={placeholderGroups}
								/>
							</div>
						</div>
					) : null}

					{mode === "preview" ? (
						<div className="flex min-h-0 flex-1 flex-col bg-[var(--sunken)]">
							<div className="flex h-[40px] flex-none items-center justify-center gap-2 px-3">
								{layout && shown ? (
									// A canvas is looked at at its own breakpoints, so the media
									// queries in the preview are the ones being edited.
									<div
										role="group"
										aria-label="Preview width"
										className="flex h-[30px] items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--surface)] p-0.5 shadow-[var(--shadow-popover)]"
									>
										{[
											// Default has no width of its own: it is the message without a
											// media query, looked at here at the width it is designed at.
											{ id: null, name: "Default", width: null },
											...widestFirst(layout.breakpoints).map((entry) => ({
												id: entry.id,
												name: entry.name,
												width: entry.maxWidth,
											})),
										].map((entry) => (
											<button
												key={entry.id ?? "default"}
												type="button"
												aria-pressed={active === entry.id}
												onClick={() => setBreakpoint(entry.id)}
												className={`h-[26px] rounded-[var(--radius-sm)] px-2 text-[length:var(--text-sm)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
													active === entry.id
														? "bg-[var(--accent-soft)] text-[var(--accent)]"
														: "text-[var(--ink-muted)] hover:text-[var(--ink)]"
												}`}
											>
												{entry.name}
												{entry.width !== null ? (
													<span className="tabular text-[length:var(--text-micro)]"> {entry.width}</span>
												) : null}
											</button>
										))}
									</div>
								) : (
									<WidthSwitch value={previewWidth} onChange={setPreviewWidth} />
								)}
							</div>
							<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-24">
								{previewError ? (
									<p
										role="alert"
										data-selectable
										className="mx-auto max-w-[620px] border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
									>
										{previewError}
									</p>
								) : preview ? (
									<div className="mx-auto" style={{ width: shown ? shown.width : PREVIEW_WIDTHS[previewWidth] }}>
										<p className="truncate pb-2 text-[length:var(--text-dense)] font-[var(--weight-medium)]">
											{preview.subject || "No subject yet"}
										</p>
										{preview.missing.length > 0 ? (
											<p className="pb-2 text-[length:var(--text-micro)] text-[var(--risk)]">
												No value for: {preview.missing.join(", ")}
											</p>
										) : null}
										<iframe
											title="Template preview"
											srcDoc={framed(preview.html, canvasFonts.css)}
											sandbox=""
											referrerPolicy="no-referrer"
											className="block h-[70vh] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--canvas-paper)]"
										/>
									</div>
								) : (
									<p className="text-center text-[var(--ink-muted)]">Rendering.</p>
								)}
							</div>
						</div>
					) : null}

					{mode === "code" ? (
						<div className="flex min-h-0 flex-1 flex-col pb-16">
							<div className="min-h-0 flex-1 overflow-auto">
								<HtmlCodeEditor
									active
									value={code ?? draft.bodyHtml}
									onChange={(value) => {
										setCode(value);
										// Without a canvas the HTML is the template, so typing here
										// is editing it directly.
										if (!draft.layout) patch({ bodyHtml: value });
									}}
									disabled={saving}
								/>
							</div>
							{layout ? (
								<div className="flex flex-none items-center gap-3 border-t border-[var(--line)] px-3 py-2">
									<Button
										size="dense"
										disabled={code === null}
										onClick={() => {
											void window.juno.mail.templates
												.parseBody(code ?? draft.bodyHtml)
												.then((next) => {
													// Fonts and breakpoints live in the head of the message, not
													// in the markup that was edited, so they come across from the
													// canvas, and so does the width a filling frame is drawn at,
													// which is not in the markup either.
													onLayout({
														...next,
														fonts: layout.fonts,
														breakpoints: layout.breakpoints,
														width: next.widthMode === "fill" ? layout.width : next.width,
													});
													setCode(null);
													setMode("canvas");
												})
												.catch((cause: unknown) => setError(messageOf(cause)));
										}}
									>
										Apply to canvas
									</Button>
									<p className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										Markup the canvas knows comes back as the block it was. Anything else comes back as
										a code block where you wrote it, so nothing is lost. The structure is kept, the
										exact spacing is not.
									</p>
								</div>
							) : null}
						</div>
					) : null}

					{mode === "inputs" ? (
						<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-24">
							<div className="mx-auto w-full max-w-[var(--content-width)]">
								<h2 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
									What this asks for
								</h2>
								<p className="mt-1 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									A value nothing in the records can answer. Each one becomes a placeholder in the body,
									so it can be written in and filled every time this template is used. An input of kind
									image can be dropped on the canvas as a picture.
								</p>
								<div className="mt-4">
									<TemplateInputsEditor
										inputs={draft.inputs}
										onChange={(inputs) => patch({ inputs })}
										disabled={saving}
									/>
								</div>
							</div>
						</div>
					) : null}

					<CanvasToolbar
						insertable={onCanvas}
						last={last}
						menu={groupMenu}
						onMenu={setGroupMenu}
						onInsert={insertElement}
						onAddButton={insertButton}
						mode={mode}
						onMode={setMode}
						hasLayout={layout !== null}
						inputCount={draft.inputs.length}
						help={help}
						onHelp={setHelp}
					/>
				</main>

				{onCanvas && layout ? (
					<aside className="relative w-[256px] flex-none overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)]">
						{/* Relative so the panel's screen-reader labels, which are
						    absolutely positioned, scroll and clip with it rather than
						    stretching the window's main area. */}
						<DesignPanel
							base={layout}
							active={active}
							onActive={setBreakpoint}
							onBase={onLayout}
							layout={shown ?? layout}
							inputs={draft.inputs}
							selection={live}
							contentHeight={contentHeight}
							measured={measured}
							fonts={canvasFonts}
							onLayout={(next) => restyleLayout({ ...(shown ?? layout), ...next })}
							onReplace={restyleLayout}
							onSection={(id, sectionPatch) => restyleLayout(updateSection(shown ?? layout, id, sectionPatch))}
							onColumns={(id, columnsPatch) => restyleLayout(updateColumns(shown ?? layout, id, columnsPatch))}
							onCell={(id, cellPatch) => restyleLayout(updateCell(shown ?? layout, id, cellPatch))}
							onBlock={(id, blockPatch) => restyleLayout(updateBlock(shown ?? layout, id, blockPatch))}
							onRemove={(id) => {
								onLayout(removeNode(layout, id));
								setSelection(null);
							}}
							onConvert={convertNode}
							onSelect={setSelection}
						/>
					</aside>
				) : null}
			</div>
		</div>
	);
}
