import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

type HtmlCodeEditorProps = {
	value: string;
	onChange: (value: string) => void;
	/** Whether this tab is the one currently shown. See VisualEditor for why this hides rather than unmounts. */
	active: boolean;
	disabled?: boolean;
};

/**
 * Every colour here comes from a token in tokens.css, mirroring
 * MarkdownEditor's theme block.
 */
function editorTheme() {
	return EditorView.theme({
		"&": {
			color: "var(--ink)",
			backgroundColor: "transparent",
			fontSize: "var(--text-dense)",
		},
		".cm-content": {
			padding: "var(--space-3) var(--space-4)",
			caretColor: "var(--ink)",
			fontFamily: "var(--font-mono)",
			lineHeight: "var(--leading-normal)",
			userSelect: "text",
			cursor: "text",
		},
		".cm-scroller": {
			fontFamily: "var(--font-mono)",
			lineHeight: "var(--leading-normal)",
			cursor: "text",
			overflow: "auto",
			minHeight: "320px",
			maxHeight: "480px",
		},
		".cm-line": {
			padding: "0",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "var(--accent-soft)",
		},
		".cm-cursor": {
			borderLeftColor: "var(--ink)",
		},
	});
}

/**
 * The template body as plain text, for the cases the visual editor is in the
 * way. There is no HTML grammar here: @codemirror/lang-html is not a
 * dependency of this project, so this is CodeMirror with a monospace theme
 * and nothing else, the same as opening the markup in an editor with syntax
 * highlighting turned off.
 *
 * Follows MarkdownEditor.tsx's own pattern for mounting once and reconciling
 * a controlled value without fighting the caret: build the view from
 * whatever `value` was at mount, and only push a later `value` back in when
 * it actually differs from the document already open, which is what lets
 * VisualEditor and this component share one string without either rewriting
 * the other's untouched edits.
 */
export function HtmlCodeEditor({ value, onChange, active, disabled = false }: HtmlCodeEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	const editableCompartmentRef = useRef(new Compartment());
	const initialRef = useRef({ value, disabled });

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const initial = initialRef.current;

		const view = new EditorView({
			doc: initial.value,
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				EditorView.lineWrapping,
				drawSelection(),
				editableCompartmentRef.current.of([
					EditorView.editable.of(!initial.disabled),
					EditorState.readOnly.of(initial.disabled),
				]),
				EditorView.contentAttributes.of({ role: "textbox", "aria-multiline": "true", "aria-label": "Body HTML" }),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) onChangeRef.current(update.state.doc.toString());
				}),
				editorTheme(),
			],
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
			ref={hostRef}
			style={{ display: active ? undefined : "none" }}
			className={`bg-[var(--surface)]${disabled ? " opacity-60" : ""}`}
		/>
	);
}
