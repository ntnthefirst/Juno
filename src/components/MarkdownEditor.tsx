import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Range } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	drawSelection,
	EditorView,
	keymap,
	placeholder as placeholderExtension,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages as codeLanguages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";

type MarkdownEditorProps = {
	value: string;
	onChange: (value: string) => void;
	id?: string;
	placeholder?: string;
	/** Rows of visible text before it scrolls. Default 8. */
	rows?: number;
	ariaLabel?: string;
	disabled?: boolean;
};

/**
 * The dash or asterisk of a bullet list item, replaced by a real bullet glyph
 * on every line except the one holding the cursor. Ordered list numbers stay
 * as typed, because the number itself is information a raw dash is not.
 */
class BulletWidget extends WidgetType {
	eq(other: WidgetType): boolean {
		return other instanceof BulletWidget;
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "cm-md-bullet";
		span.textContent = "•";
		return span;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * The lines touched by any selection range, cursor-only selections included.
 * Markup on one of these lines, or markup a selection directly overlaps,
 * shows its raw characters instead of being hidden. A selection elsewhere in
 * the document does not blank-reveal every marker: that would defeat live
 * styling for the rest of a note while one word is selected.
 */
function activeLineSet(state: EditorState): Set<number> {
	const lines = new Set<number>();
	for (const range of state.selection.ranges) {
		const fromLine = state.doc.lineAt(range.from).number;
		const toLine = state.doc.lineAt(range.to).number;
		for (let n = fromLine; n <= toLine; n++) lines.add(n);
	}
	return lines;
}

function buildDecorations(view: EditorView): DecorationSet {
	const { state } = view;
	const doc = state.doc;
	const ranges: Range<Decoration>[] = [];
	const activeLines = activeLineSet(state);

	function revealed(from: number, to: number): boolean {
		if (activeLines.has(doc.lineAt(from).number)) return true;
		for (const range of state.selection.ranges) {
			if (range.from < to && range.to > from) return true;
		}
		return false;
	}

	function hideMarker(from: number, to: number) {
		if (!revealed(from, to)) ranges.push(Decoration.replace({}).range(from, to));
	}

	function lineDecoration(fromPos: number, toPos: number, cls: string) {
		const first = doc.lineAt(fromPos).number;
		const last = doc.lineAt(toPos).number;
		for (let n = first; n <= last; n++) {
			ranges.push(Decoration.line({ class: cls }).range(doc.line(n).from));
		}
	}

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				const name = node.name;

				if (name.startsWith("ATXHeading")) {
					const level = name.slice(-1);
					lineDecoration(node.from, node.from, `cm-md-heading cm-md-heading-${level}`);
					return;
				}
				if (name === "HeaderMark" && node.node.parent?.name.startsWith("ATXHeading")) {
					const hasTrailingSpace = doc.sliceString(node.to, node.to + 1) === " ";
					hideMarker(node.from, hasTrailingSpace ? node.to + 1 : node.to);
					return;
				}
				if (name === "StrongEmphasis") {
					ranges.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
					return;
				}
				if (name === "Emphasis") {
					ranges.push(Decoration.mark({ class: "cm-md-em" }).range(node.from, node.to));
					return;
				}
				if (name === "Strikethrough") {
					ranges.push(Decoration.mark({ class: "cm-md-strike" }).range(node.from, node.to));
					return;
				}
				if (name === "EmphasisMark" || name === "StrikethroughMark") {
					hideMarker(node.from, node.to);
					return;
				}
				if (name === "InlineCode") {
					ranges.push(Decoration.mark({ class: "cm-md-code" }).range(node.from, node.to));
					return;
				}
				if (name === "CodeMark" && node.matchContext(["InlineCode"])) {
					hideMarker(node.from, node.to);
					return;
				}
				if (name === "Link") {
					ranges.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
					return;
				}
				if ((name === "LinkMark" || name === "URL") && node.matchContext(["Link"])) {
					hideMarker(node.from, node.to);
					return;
				}
				if (name === "Blockquote") {
					lineDecoration(node.from, node.to, "cm-md-quote");
					return;
				}
				if (name === "ListItem") {
					lineDecoration(node.from, node.to, "cm-md-list-line");
					return;
				}
				if (name === "ListMark" && node.matchContext(["BulletList", "ListItem"])) {
					if (!revealed(node.from, node.to)) {
						ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
					}
					return;
				}
				if (name === "FencedCode" || name === "CodeBlock") {
					lineDecoration(node.from, node.to, "cm-md-code-block");
					return;
				}
			},
		});
	}

	return Decoration.set(ranges, true);
}

class LiveMarkdownPlugin {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildDecorations(view);
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.selectionSet || update.viewportChanged) {
			this.decorations = buildDecorations(update.view);
		}
	}
}

const liveMarkdownPlugin = ViewPlugin.fromClass(LiveMarkdownPlugin, {
	decorations: (plugin) => plugin.decorations,
});

/**
 * Every colour, size and radius below comes from a token in tokens.css. A
 * heading in a note is a smaller step than an app heading (--text-h1 is
 * reserved for one per screen, and a note is not the screen), so ATX levels
 * map onto --text-h2 down to --text-base rather than the full type scale.
 */
function editorTheme(rows: number) {
	return EditorView.theme({
		"&": {
			color: "var(--ink)",
			backgroundColor: "transparent",
			fontSize: "var(--text-base)",
		},
		".cm-content": {
			padding: "var(--space-2) var(--space-3)",
			caretColor: "var(--ink)",
			fontFamily: "var(--font-ui)",
			lineHeight: "var(--leading-normal)",
			// The app turns off user-select globally so dragging over the chrome
			// does not look like a broken selection. A text editor is the one
			// place that rule does not apply.
			userSelect: "text",
			cursor: "text",
		},
		".cm-scroller": {
			fontFamily: "var(--font-ui)",
			lineHeight: "var(--leading-normal)",
			cursor: "text",
			overflow: "auto",
			minHeight: `calc(${rows} * var(--text-base) * var(--leading-normal))`,
			maxHeight: `calc(${rows} * var(--text-base) * var(--leading-normal))`,
		},
		".cm-line": {
			padding: "0",
		},
		".cm-placeholder": {
			color: "var(--ink-faint)",
			fontFamily: "var(--font-ui)",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "var(--accent-soft)",
		},
		".cm-cursor": {
			borderLeftColor: "var(--ink)",
		},
		".cm-md-heading": {
			fontWeight: "var(--weight-semibold)",
		},
		".cm-md-heading-1": {
			fontSize: "var(--text-h2)",
		},
		".cm-md-heading-2": {
			fontSize: "var(--text-h3)",
		},
		".cm-md-heading-3": {
			fontSize: "var(--text-lg)",
		},
		".cm-md-heading-4, .cm-md-heading-5, .cm-md-heading-6": {
			fontSize: "var(--text-base)",
		},
		".cm-md-strong": {
			fontWeight: "var(--weight-semibold)",
		},
		".cm-md-em": {
			fontStyle: "italic",
		},
		".cm-md-strike": {
			textDecoration: "line-through",
			color: "var(--ink-muted)",
		},
		".cm-md-code": {
			fontFamily: "var(--font-mono)",
			fontSize: "var(--text-dense)",
			backgroundColor: "var(--sunken)",
			borderRadius: "var(--radius-sm)",
			padding: "0 var(--space-1)",
		},
		".cm-md-link": {
			color: "var(--accent)",
			textDecoration: "underline",
			textUnderlineOffset: "2px",
		},
		".cm-md-quote": {
			borderLeft: "2px solid var(--line)",
			paddingLeft: "var(--space-3)",
			color: "var(--ink-muted)",
		},
		".cm-md-list-line": {
			paddingLeft: "var(--space-2)",
		},
		".cm-md-bullet": {
			color: "var(--ink-muted)",
			marginRight: "var(--space-1)",
		},
		".cm-md-code-block": {
			backgroundColor: "var(--sunken)",
			fontFamily: "var(--font-mono)",
			fontSize: "var(--text-dense)",
		},
	});
}

function buildExtensions(options: {
	rows: number;
	placeholder?: string;
	disabled: boolean;
	id?: string;
	ariaLabel?: string;
	onChange: (value: string) => void;
	editableCompartment: Compartment;
}) {
	const attributes: Record<string, string> = {
		role: "textbox",
		"aria-multiline": "true",
	};
	if (options.id) attributes.id = options.id;
	if (options.ariaLabel) attributes["aria-label"] = options.ariaLabel;

	const reducedMotion =
		typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	return [
		markdown({ base: markdownLanguage, codeLanguages, extensions: GFM }),
		history(),
		keymap.of([...defaultKeymap, ...historyKeymap]),
		liveMarkdownPlugin,
		EditorView.lineWrapping,
		drawSelection({ cursorBlinkRate: reducedMotion ? 0 : 1200 }),
		options.editableCompartment.of([
			EditorView.editable.of(!options.disabled),
			EditorState.readOnly.of(options.disabled),
		]),
		...(options.placeholder ? [placeholderExtension(options.placeholder)] : []),
		EditorView.contentAttributes.of(attributes),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) options.onChange(update.state.doc.toString());
		}),
		editorTheme(options.rows),
	];
}

/**
 * A single editing surface that renders Markdown as it is typed, the way
 * Obsidian's live preview does. There is no split pane and no toggle: heading
 * text grows, `**bold**` turns bold, a link becomes a link, and the markup
 * characters that make it so fade out except on the line the cursor sits on.
 */
export function MarkdownEditor({ value, onChange, id, placeholder, rows = 8, ariaLabel, disabled = false }: MarkdownEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	const editableCompartmentRef = useRef(new Compartment());
	// useRef's argument is only ever read on the very first render, which is
	// exactly the "build once" lifetime id, placeholder and rows have: none of
	// the forms this ships in change them after mount.
	const initialRef = useRef({ value, rows, placeholder, disabled, id, ariaLabel });

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const initial = initialRef.current;

		const view = new EditorView({
			doc: initial.value,
			extensions: buildExtensions({
				rows: initial.rows,
				placeholder: initial.placeholder,
				disabled: initial.disabled,
				id: initial.id,
				ariaLabel: initial.ariaLabel,
				onChange: (next) => onChangeRef.current(next),
				editableCompartment: editableCompartmentRef.current,
			}),
			parent: host,
		});
		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	// The prop is the source of truth. Only push it into the document when it
	// actually differs, or every keystroke's own onChange would round-trip
	// back in and fight the cursor.
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.toString();
		if (current === value) return;
		view.dispatch({
			changes: { from: 0, to: current.length, insert: value },
			selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
		});
	}, [value]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: editableCompartmentRef.current.reconfigure([
				EditorView.editable.of(!disabled),
				EditorState.readOnly.of(disabled),
			]),
		});
	}, [disabled]);

	return (
		<div
			className={`w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)] motion-safe:transition-colors motion-safe:duration-[var(--duration-fast)] motion-safe:ease-[var(--ease)]${disabled ? " opacity-60" : ""}`}
			ref={hostRef}
		/>
	);
}
