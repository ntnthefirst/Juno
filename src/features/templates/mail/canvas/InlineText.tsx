import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../../../../components/Icon";
import { normaliseEditedHtml } from "./inline-html";

/**
 * Where the caret starts: where a double click landed, or with everything
 * selected, so that typing straight after adding a block or pressing Enter on
 * one replaces what is there.
 */
export type Caret = { x: number; y: number } | "all";

type InlineTextProps = {
	/** Rich text keeps bold, italic, underline, strikethrough and links. A heading is plain. */
	rich: boolean;
	value: string;
	tag: "div" | "h1" | "h2" | "h3";
	style: CSSProperties;
	caret: Caret;
	/**
	 * The element around the text, which is what sits in the section while the
	 * text is open: the block's own place in it, and the canvas's marks.
	 */
	host: { id: string; style: CSSProperties; className: string };
	onCommit: (value: string) => void;
	onClose: () => void;
};

type FormatButtonProps = {
	label: string;
	onPress: () => void;
	children: ReactNode;
	active?: boolean;
};

/**
 * One command on the format bar.
 *
 * It acts on mouse down and keeps the default from happening, because a
 * button that takes the focus takes the selection with it, and the command
 * would then have nothing to apply to.
 */
function FormatButton({ label, onPress, children, active = false }: FormatButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={active}
			onMouseDown={(event) => {
				event.preventDefault();
				onPress();
			}}
			className={`flex h-[32px] min-w-[32px] items-center justify-center rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-dense)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
				active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--ink)] hover:bg-[var(--hover)]"
			}`}
		>
			{children}
		</button>
	);
}

/**
 * Editing a text block where it stands on the canvas.
 *
 * Double-clicking a text block or a heading turns it into this, the way
 * double-clicking a text layer works in Figma: the text is edited in its own
 * type at its own width, and the bar above it does what Ctrl+B, Ctrl+I and
 * Ctrl+U already do from the keyboard, plus strikethrough and links. Leaving
 * it, by clicking elsewhere or pressing Escape, writes the text back.
 *
 * `document.execCommand` is deprecated and still the only thing that applies
 * inline formatting to a live selection, which is why the mail visual editor
 * uses it too. What it writes is cleaned by `normaliseEditedHtml` and then by
 * the compiler's own sanitiser, so what reaches the message is the set a text
 * block keeps and nothing else.
 */
export function InlineText({ rich, value, tag, style, caret, host: frame, onCommit, onClose }: InlineTextProps) {
	const host = useRef<HTMLElement | null>(null);
	const bar = useRef<HTMLDivElement>(null);
	const range = useRef<Range | null>(null);
	const [linking, setLinking] = useState(false);
	const [url, setUrl] = useState("https://");
	const [marks, setMarks] = useState({ bold: false, italic: false, underline: false, strike: false });
	// What it opened with. Written into the element once, when it opens:
	// writing it again on a later render would throw away what is being typed.
	const opening = useRef({ rich, value, caret });

	useLayoutEffect(() => {
		const element = host.current;
		if (!element) return;
		const { rich, value, caret } = opening.current;
		if (rich) element.innerHTML = value;
		else element.textContent = value;
		element.focus();
		// Tags rather than inline styles, because the set a text block keeps is
		// tags: a bold written as a styled span would survive, but as a span.
		document.execCommand("styleWithCSS", false, "false");
		const selection = window.getSelection();
		const at = caret === "all" ? null : document.caretRangeFromPoint(caret.x, caret.y);
		if (selection) {
			selection.removeAllRanges();
			if (at && element.contains(at.startContainer)) {
				selection.addRange(at);
			} else {
				const whole = document.createRange();
				whole.selectNodeContents(element);
				// A click that missed the text puts the caret at the end.
				if (caret !== "all") whole.collapse(false);
				selection.addRange(whole);
			}
		}
	}, []);

	function readMarks(): void {
		if (!rich) return;
		setMarks({
			bold: document.queryCommandState("bold"),
			italic: document.queryCommandState("italic"),
			underline: document.queryCommandState("underline"),
			strike: document.queryCommandState("strikeThrough"),
		});
	}

	function finish(): void {
		const element = host.current;
		if (!element) return;
		const next = rich
			? normaliseEditedHtml(element.innerHTML)
			: (element.textContent ?? "").replace(/\s+/g, " ").trim();
		if (next !== value) onCommit(next);
		onClose();
	}

	function run(command: string): void {
		host.current?.focus();
		document.execCommand(command, false);
		readMarks();
	}

	function openLink(): void {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0 && host.current?.contains(selection.anchorNode)) {
			range.current = selection.getRangeAt(0).cloneRange();
		}
		setLinking(true);
	}

	function applyLink(): void {
		const target = url.trim();
		const element = host.current;
		setLinking(false);
		if (!element) return;
		element.focus();
		const saved = range.current;
		const selection = window.getSelection();
		if (saved && selection) {
			selection.removeAllRanges();
			selection.addRange(saved);
		}
		// The same rule the compiler keeps: https or mailto, or no link at all.
		if (saved && !saved.collapsed && /^(https:\/\/.+|mailto:.+)$/i.test(target)) {
			document.execCommand("createLink", false, target);
		}
		setUrl("https://");
	}

	const Tag = tag;
	return (
		<div
			data-canvas-id={frame.id}
			style={frame.style}
			className={`relative ${frame.className}`}
			// A press on the format bar is still inside the block, not on the
			// section around it.
			onClick={(event) => event.stopPropagation()}
			role="presentation"
		>
			{rich ? (
				<div
					ref={bar}
					data-canvas-chrome
					role="toolbar"
					aria-label="Text format"
					className="absolute bottom-full left-0 z-20 mb-1 flex items-center gap-px rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-0.5 font-[family-name:var(--font-ui)] text-[var(--ink)] shadow-[var(--shadow-popover)]"
				>
					{linking ? (
						<>
							<input
								autoFocus
								value={url}
								aria-label="Link address"
								onChange={(event) => setUrl(event.target.value)}
								onBlur={(event) => {
									const next = event.relatedTarget;
									const staying =
										next instanceof Node &&
										(bar.current?.contains(next) === true || host.current?.contains(next) === true);
									if (!staying) finish();
								}}
								onKeyDown={(event) => {
									event.stopPropagation();
									if (event.key === "Enter") {
										event.preventDefault();
										applyLink();
									}
									if (event.key === "Escape") {
										event.preventDefault();
										setLinking(false);
										host.current?.focus();
									}
								}}
								className="h-[32px] w-[220px] rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 text-[length:var(--text-dense)] text-[var(--ink)] focus:outline-none"
							/>
							<FormatButton label="Add the link" onPress={applyLink}>
								<Icon name="check" size={14} />
							</FormatButton>
						</>
					) : (
						<>
							<FormatButton label="Bold" active={marks.bold} onPress={() => run("bold")}>
								<span className="font-[var(--weight-semibold)]">B</span>
							</FormatButton>
							<FormatButton label="Italic" active={marks.italic} onPress={() => run("italic")}>
								<span className="italic">I</span>
							</FormatButton>
							<FormatButton label="Underline" active={marks.underline} onPress={() => run("underline")}>
								<span className="underline">U</span>
							</FormatButton>
							<FormatButton label="Strikethrough" active={marks.strike} onPress={() => run("strikeThrough")}>
								<span className="line-through">S</span>
							</FormatButton>
							<span aria-hidden className="mx-0.5 h-[18px] w-px bg-[var(--line)]" />
							<FormatButton label="Link" onPress={openLink}>
								<Icon name="link" size={14} />
							</FormatButton>
							<FormatButton
								label="Clear formatting"
								onPress={() => {
									run("removeFormat");
									run("unlink");
								}}
							>
								<span className="text-[length:var(--text-micro)]">Clear</span>
							</FormatButton>
						</>
					)}
				</div>
			) : null}

			<Tag
				ref={(element: HTMLElement | null) => {
					host.current = element;
				}}
				contentEditable={rich ? true : "plaintext-only"}
				suppressContentEditableWarning
				role="textbox"
				aria-multiline={rich}
				aria-label={rich ? "Text" : "Heading"}
				style={{ ...style, outline: "none", cursor: "text" }}
				onClick={(event) => event.stopPropagation()}
				onKeyUp={readMarks}
				onMouseUp={readMarks}
				onKeyDown={(event) => {
					// Escape leaves the text, not the editor, and not the selection.
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						finish();
						return;
					}
					if (!rich && event.key === "Enter") {
						event.preventDefault();
						finish();
					}
				}}
				onBlur={(event) => {
					// Focus moving to the bar's own link field is not leaving.
					if (bar.current && event.relatedTarget instanceof Node && bar.current.contains(event.relatedTarget)) return;
					finish();
				}}
			/>
		</div>
	);
}
