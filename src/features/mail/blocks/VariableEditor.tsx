import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { ComposeBlockVariable } from "@shared/types";
import { splitTokens, VARIABLE_LABEL } from "./block-text";

export type VariableEditorHandle = {
	/** Puts a chip for the variable at the caret, or at the end when there is no caret. */
	insert: (name: ComposeBlockVariable) => void;
};

type VariableEditorProps = {
	/** The text with {{variable}} tokens. */
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
	ref?: Ref<VariableEditorHandle>;
};

const CHIP =
	"mx-0.5 inline-flex h-[22px] items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1.5 align-baseline text-micro text-[var(--accent)] select-none";

function chip(name: ComposeBlockVariable): HTMLSpanElement {
	const element = document.createElement("span");
	element.contentEditable = "false";
	element.dataset.variable = name;
	element.className = CHIP;
	element.textContent = VARIABLE_LABEL[name];
	return element;
}

function build(host: HTMLElement, value: string): void {
	host.replaceChildren();
	for (const part of splitTokens(value)) {
		host.append(part.kind === "text" ? document.createTextNode(part.text) : chip(part.name));
	}
}

/** What is in the field as a stored text: chips back to tokens, breaks back to line ends. */
function read(node: Node): string {
	let out = "";
	for (const child of node.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			out += child.nodeValue ?? "";
		} else if (child instanceof HTMLElement) {
			if (child.dataset.variable) out += `{{${child.dataset.variable}}}`;
			else if (child.tagName === "BR") out += "\n";
			else out += `${out && !out.endsWith("\n") ? "\n" : ""}${read(child)}`;
		}
	}
	return out;
}

/**
 * The text of an intro or an outro, with each variable drawn as a chip. The
 * chip is one unit: it is deleted as one and the caret cannot enter it, and the
 * field's value is the stored text with the token in its place, so nothing here
 * ever shows curly braces.
 */
export function VariableEditor({ value, onChange, ariaLabel, ref }: VariableEditorProps) {
	const host = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const element = host.current;
		if (element && read(element) !== value) build(element, value);
	}, [value]);

	useImperativeHandle(ref, () => ({
		insert(name) {
			const element = host.current;
			if (!element) return;
			element.focus();
			const selection = window.getSelection();
			if (!selection) return;
			let range: Range;
			if (selection.rangeCount > 0 && element.contains(selection.anchorNode)) {
				range = selection.getRangeAt(0);
			} else {
				range = document.createRange();
				range.selectNodeContents(element);
				range.collapse(false);
			}
			range.deleteContents();
			const inserted = chip(name);
			range.insertNode(inserted);
			range.setStartAfter(inserted);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			onChange(read(element));
		},
	}));

	return (
		<div
			ref={host}
			contentEditable
			role="textbox"
			aria-label={ariaLabel}
			aria-multiline="true"
			onInput={() => host.current && onChange(read(host.current))}
			onPaste={(event) => {
				event.preventDefault();
				document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
			}}
			className="min-h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-base whitespace-pre-wrap text-[var(--ink)] outline-none focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]"
		/>
	);
}
