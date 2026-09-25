import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MailBlock, MailLayout, MailSection, MailTemplate, MailTextStyle, TemplateInput } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { FONT_WEIGHTS } from "./mail/canvas/box-style";
import {
	addSection,
	cloneBlock,
	cloneSection,
	dropBlock,
	insertBlockAfter,
	insertSectionAfter,
	moveBlock,
	moveSection,
	moveSectionTo,
	newBlock,
	removeBlock,
	removeSection,
	selectionIn,
	siblingOf,
	updateBlock,
	updateSection,
	type BlockKind,
} from "./mail/canvas/canvas-actions";
import { CanvasStage } from "./mail/canvas/CanvasStage";
import { PREVIEW_WIDTHS, type PreviewWidth } from "./mail/canvas/preview-width";
import { WidthSwitch } from "./mail/canvas/WidthSwitch";
import type { Editing, Measured, Selection } from "./mail/canvas/CanvasView";
import { DesignPanel } from "./mail/canvas/DesignPanel";
import { framed } from "./mail/canvas/framed-preview";
import { CanvasToolbar } from "./mail/canvas/CanvasToolbar";
import { isControl, isTyping, shortcutFor, type ShortcutAction } from "./mail/canvas/shortcuts";
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

/** The keys the toolbar's letters add, as the kinds they add. */
const TOOL_KINDS: Partial<Record<ShortcutAction, BlockKind>> = {
	"add-text": "text",
	"add-heading": "heading",
	"add-button": "button",
	"add-image": "image",
	"add-field": "field",
	"add-divider": "divider",
	"add-spacer": "spacer",
};

/**
 * What Ctrl+C last copied. Kept for the session rather than per editor, so a
 * block copied in one template pastes into the next one opened, the way a
 * copy works everywhere else.
 */
let copied: { kind: "block"; block: MailBlock } | { kind: "section"; section: MailSection } | null = null;

/** Which blocks are in which sections, and in what order: what a structural edit changes. */
function shapeOf(layout: MailLayout): string {
	return layout.sections.map((section) => `${section.id}:${section.blocks.map((block) => block.id).join(",")}`).join("|");
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
	const [previewWidth, setPreviewWidth] = useState<PreviewWidth>("wide");
	const [sidebar, setSidebar] = useState(true);
	const [help, setHelp] = useState(false);

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
	const canvasFonts = useCanvasFonts(layout?.fonts ?? []);
	// An undo can take away what was selected. What is gone is not selected.
	const live = layout && selection && selectionIn(layout, selection) ? selection : null;
	const selectedSection = layout && live ? (layout.sections.find((section) => section.id === live.sectionId) ?? null) : null;
	const selectedBlock =
		selectedSection && live?.blockId ? (selectedSection.blocks.find((block) => block.id === live.blockId) ?? null) : null;
	// With nothing selected a new block lands in the last section that is
	// showing, which is where an author is usually working. A hidden one would
	// swallow the block where nobody can see it land.
	const shownSections = layout ? layout.sections.filter((section) => !section.hidden) : [];
	const lastSectionId =
		shownSections[shownSections.length - 1]?.id ?? (layout ? (layout.sections[layout.sections.length - 1]?.id ?? null) : null);
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

	/** Where a new block goes: after the selected one, or at the end of the selected or last section. */
	function landing(): { sectionId: string; afterBlockId: string | null } | null {
		if (selectedSection && !selectedSection.hidden) {
			return { sectionId: selectedSection.id, afterBlockId: selectedBlock?.id ?? null };
		}
		return lastSectionId ? { sectionId: lastSectionId, afterBlockId: null } : null;
	}

	function insert(kind: BlockKind): void {
		const at = landing();
		if (!layout || !at) return;
		const block = newBlock(kind);
		onLayout(insertBlockAfter(layout, at.sectionId, at.afterBlockId, block));
		setSelection({ sectionId: at.sectionId, blockId: block.id });
		// Figma's text tool: the new text is open with its words selected, so
		// what is typed next replaces them.
		setEditing(kind === "text" || kind === "heading" ? { blockId: block.id, caret: "all" } : null);
	}

	function insertSection(): void {
		if (!layout) return;
		const next = addSection(layout, selectedSection?.id);
		onLayout(next);
		const added = next.sections.find((section) => !layout.sections.some((old) => old.id === section.id));
		if (added) setSelection({ sectionId: added.id });
	}

	function setHidden(target: { sectionId: string; blockId?: string }, hidden: boolean): void {
		if (!layout) return;
		onLayout(
			target.blockId
				? updateBlock(layout, target.sectionId, target.blockId, { hidden })
				: updateSection(layout, target.sectionId, { hidden }),
		);
	}

	/** Alt and an arrow on a layer, or an arrow on the canvas: one place earlier or later. */
	function stepLayer(target: { sectionId: string; blockId?: string }, by: -1 | 1): void {
		if (!layout) return;
		onLayout(
			target.blockId
				? moveBlock(layout, target.sectionId, target.blockId, by)
				: moveSection(layout, target.sectionId, by),
		);
	}

	/** Deleting what is selected lets go of it, so a second Delete does not take its section too. */
	function remove(): void {
		if (!layout || !live) return;
		onLayout(live.blockId ? removeBlock(layout, live.sectionId, live.blockId) : removeSection(layout, live.sectionId));
		setSelection(null);
		setEditing(null);
	}

	function copy(): boolean {
		if (selectedBlock) copied = { kind: "block", block: structuredClone(selectedBlock) };
		else if (selectedSection) copied = { kind: "section", section: structuredClone(selectedSection) };
		else return false;
		return true;
	}

	function paste(): void {
		if (!layout || !copied) return;
		if (copied.kind === "block") {
			const at = landing();
			if (!at) return;
			const block = cloneBlock(copied.block);
			onLayout(insertBlockAfter(layout, at.sectionId, at.afterBlockId, block));
			setSelection({ sectionId: at.sectionId, blockId: block.id });
			return;
		}
		const section = cloneSection(copied.section);
		onLayout(insertSectionAfter(layout, selectedSection?.id ?? null, section));
		setSelection({ sectionId: section.id });
	}

	function duplicate(): void {
		if (!layout || !selectedSection) return;
		if (selectedBlock) {
			const block = cloneBlock(selectedBlock);
			onLayout(insertBlockAfter(layout, selectedSection.id, selectedBlock.id, block));
			setSelection({ sectionId: selectedSection.id, blockId: block.id });
			return;
		}
		const section = cloneSection(selectedSection);
		onLayout(insertSectionAfter(layout, selectedSection.id, section));
		setSelection({ sectionId: section.id });
	}

	/** Enter: open a text for typing, or step into a section's first block. */
	function enter(): void {
		if (selectedBlock) {
			if ((selectedBlock.kind === "text" || selectedBlock.kind === "heading") && !selectedBlock.hidden) {
				setEditing({ blockId: selectedBlock.id, caret: "all" });
			}
			return;
		}
		const first = selectedSection?.blocks[0];
		if (selectedSection && first) setSelection({ sectionId: selectedSection.id, blockId: first.id });
	}

	/** A change to the selected block's type, from the keyboard. */
	function restyle(change: (text: MailTextStyle) => Partial<MailTextStyle>): void {
		if (!layout || !selectedSection || !selectedBlock || !("text" in selectedBlock)) return;
		const text = { ...selectedBlock.text, ...change(selectedBlock.text) };
		onLayout(updateBlock(layout, selectedSection.id, selectedBlock.id, { text } as Partial<MailBlock>));
	}

	/** Alt with a letter: across the section, and only along the way the section lets a block move. */
	function alignSelected(across: Across, axis: "h" | "v"): void {
		if (!layout || !selectedSection || !selectedBlock) return;
		const free = flowOf(selectedSection) === "column" ? "h" : "v";
		if (axis !== free) return;
		onLayout(updateBlock(layout, selectedSection.id, selectedBlock.id, alignAcross(selectedBlock, selectedSection, across)));
	}

	/**
	 * One block into the HTML and CSS it compiles to. The main process does the
	 * compiling, so the code is exactly what the message would have carried,
	 * and the result is part of the draft like any other edit.
	 */
	function convertBlock(sectionId: string, blockId: string): void {
		if (!draft?.layout) return;
		setError(null);
		void window.juno.mail.templates
			.convertBlock({ layout: draft.layout, sectionId, blockId, inputs: draft.inputs })
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
			if (help) setHelp(false);
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
		const tool = TOOL_KINDS[action];
		if (tool) return run(() => insert(tool));

		switch (action) {
			case "add-section":
				return run(insertSection);
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
					const hidden = selectedBlock ? selectedBlock.hidden : Boolean(selectedSection?.hidden);
					setHidden(live, !hidden);
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
				return run(() => setSelection(live.blockId ? { sectionId: live.sectionId } : null));
			case "next":
				return run(() => {
					if (layout) setSelection(siblingOf(layout, live, 1));
				});
			case "previous":
				return run(() => {
					if (layout) setSelection(siblingOf(layout, live, -1));
				});
			case "earlier":
				return run(() => stepLayer(live, -1));
			case "later":
				return run(() => stepLayer(live, 1));
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
						layout={layout}
						selection={live}
						onSelect={setSelection}
						onHidden={setHidden}
						onDropBlock={(from, blockId, target) => {
							if (layout) onLayout(dropBlock(layout, from, target.sectionId, blockId, target.beforeBlockId));
						}}
						onDropSection={(sectionId, beforeSectionId) => {
							if (layout) onLayout(moveSectionTo(layout, sectionId, beforeSectionId));
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

					{onCanvas && layout ? (
						<CanvasStage
							layout={layout}
							inputs={draft.inputs}
							selection={live}
							onSelect={setSelection}
							onDrop={(from, blockId, target) =>
								onLayout(dropBlock(layout, from, target.sectionId, blockId, target.beforeBlockId))
							}
							onEdit={(sectionId, blockId, blockPatch) =>
								onLayout(updateBlock(layout, sectionId, blockId, blockPatch))
							}
							editing={editing}
							onEditing={setEditing}
							onMeasure={onMeasure}
							onHeight={(minHeight) => onLayout({ ...layout, minHeight })}
							contentHeight={contentHeight}
							onContentHeight={setContentHeight}
							preview={previewWidth}
							onPreview={setPreviewWidth}
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
								<WidthSwitch value={previewWidth} onChange={setPreviewWidth} />
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
									<div className="mx-auto" style={{ width: PREVIEW_WIDTHS[previewWidth] }}>
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
													// Fonts live in the head of the message, not in the markup
													// that was edited, so they come across from the canvas.
													onLayout({ ...next, fonts: layout.fonts });
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
						onInsert={insert}
						onAddSection={insertSection}
						mode={mode}
						onMode={setMode}
						hasLayout={layout !== null}
						inputCount={draft.inputs.length}
						help={help}
						onHelp={setHelp}
					/>
				</main>

				{onCanvas && layout ? (
					<aside className="w-[256px] flex-none overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)]">
						<DesignPanel
							layout={layout}
							inputs={draft.inputs}
							selection={live}
							contentHeight={contentHeight}
							measured={measured}
							fonts={canvasFonts}
							onLayout={(next) => onLayout({ ...layout, ...next })}
							onReplace={onLayout}
							onSection={(sectionId, sectionPatch) => onLayout(updateSection(layout, sectionId, sectionPatch))}
							onBlock={(sectionId, blockId, blockPatch) =>
								onLayout(updateBlock(layout, sectionId, blockId, blockPatch))
							}
							onRemoveSection={(sectionId) => {
								onLayout(removeSection(layout, sectionId));
								setSelection(null);
							}}
							onRemoveBlock={(sectionId, blockId) => {
								onLayout(removeBlock(layout, sectionId, blockId));
								setSelection(null);
							}}
							onConvert={convertBlock}
						/>
					</aside>
				) : null}
			</div>
		</div>
	);
}
