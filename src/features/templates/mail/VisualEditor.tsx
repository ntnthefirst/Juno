import { useEffect, useRef, useState } from "react";
import {
	BoldIcon,
	H2Icon,
	ItalicIcon,
	LinkIcon,
	ListBulletIcon,
	NumberedListIcon,
	UnderlineIcon,
	VariableIcon,
} from "@heroicons/react/24/outline";
import { Button } from "../../../components/Button";
import { Field } from "../../../components/Field";
import { InsertImageControl } from "./InsertImageControl";
import type { PlaceholderGroup } from "./placeholders";
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ACTIVE } from "./toolbar-styles";

type VisualEditorProps = {
	value: string;
	onChange: (value: string) => void;
	/** Whether this tab is the one currently shown. See the note above the host div. */
	active: boolean;
	disabled?: boolean;
	placeholderGroups: PlaceholderGroup[];
};

/**
 * What the message will look like, edited in place. Unlike HtmlCodeEditor,
 * there is no CodeMirror model underneath this: `contentEditable` plus
 * `document.execCommand` is deprecated, but it is the only pair that edits a
 * live selection inside rendered HTML (bold, a list, a heading) without
 * pulling in a rich-text framework, and that trade is deliberate here. The
 * whole `innerHTML` is read back after every edit, so it stays the single
 * source of truth the Code tab also reads.
 *
 * A caveat that comes with `contentEditable`: any edit re-serialises the
 * *entire* body through the browser's own HTML writer, not just the part
 * that was touched, so a hand-written table elsewhere in the same body can
 * come back with its quoting or whitespace normalised. Switching tabs alone
 * never does this (see the reconciliation effect below); only typing here
 * does, and that is accepted rather than solved, because avoiding it needs a
 * real editor framework this project has deliberately not taken on.
 */
export function VisualEditor({ value, onChange, active, disabled = false, placeholderGroups }: VisualEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const onChangeRef = useRef(onChange);
	const initialRef = useRef(value);
	const savedRangeRef = useRef<Range | null>(null);

	const [linkOpen, setLinkOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("");
	const [linkReady, setLinkReady] = useState(false);
	const [placeholderOpen, setPlaceholderOpen] = useState(false);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	// A click into the link field or the placeholder menu moves focus off the
	// contentEditable host, so closing on its blur would dismiss the popover
	// before the click inside it registers. Closing on an outside click instead
	// leaves both open while the person is using them.
	useEffect(() => {
		if (!linkOpen && !placeholderOpen) return;
		function onPointerDown(event: MouseEvent) {
			if (toolbarRef.current?.contains(event.target as Node)) return;
			setLinkOpen(false);
			setPlaceholderOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [linkOpen, placeholderOpen]);

	// Hydrate once. The value prop is only pushed back into this DOM when it
	// changed from outside (the effect below), never merely because this tab
	// became active again.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		host.innerHTML = initialRef.current;
	}, []);

	// Picks up an edit made in the Code tab. Comparing against the DOM's own
	// current innerHTML, not against a remembered copy of the prop, means a
	// plain tab switch with no edit on either side never touches the DOM: the
	// two strings already agree, so this is a no-op precisely in the case
	// docs/editors.md section 2 calls out ("a round trip that rewrites the
	// markup is a bug").
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		if (host.innerHTML === value) return;
		host.innerHTML = value;
	}, [value]);

	function emit() {
		const host = hostRef.current;
		if (!host) return;
		onChangeRef.current(host.innerHTML);
	}

	function captureSelection() {
		const host = hostRef.current;
		if (!host) return;
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0 && host.contains(selection.anchorNode)) {
			savedRangeRef.current = selection.getRangeAt(0).cloneRange();
		}
	}

	function restoreSelection() {
		const host = hostRef.current;
		if (!host) return;
		host.focus();
		const range = savedRangeRef.current;
		if (!range) return;
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function exec(command: string, arg?: string) {
		if (disabled) return;
		hostRef.current?.focus();
		document.execCommand(command, false, arg);
		emit();
	}

	function toggleHeading() {
		if (disabled) return;
		hostRef.current?.focus();
		const current = document.queryCommandValue("formatBlock").toLowerCase();
		document.execCommand("formatBlock", false, current === "h2" ? "p" : "h2");
		emit();
	}

	function openLink() {
		if (disabled) return;
		captureSelection();
		setLinkReady(Boolean(savedRangeRef.current && !savedRangeRef.current.collapsed));
		setLinkOpen((wasOpen) => !wasOpen);
		setPlaceholderOpen(false);
	}

	function confirmLink() {
		const url = linkUrl.trim();
		if (!url || !linkReady) return;
		restoreSelection();
		document.execCommand("createLink", false, url);
		emit();
		setLinkOpen(false);
		setLinkUrl("");
	}

	function openPlaceholders() {
		if (disabled) return;
		captureSelection();
		if (!savedRangeRef.current && hostRef.current) {
			const range = document.createRange();
			range.selectNodeContents(hostRef.current);
			range.collapse(false);
			savedRangeRef.current = range;
		}
		setPlaceholderOpen((wasOpen) => !wasOpen);
		setLinkOpen(false);
	}

	function insertPlaceholder(path: string) {
		restoreSelection();
		document.execCommand("insertText", false, `{{${path}}}`);
		emit();
		setPlaceholderOpen(false);
	}

	function insertImage(src: string) {
		restoreSelection();
		document.execCommand("insertImage", false, src);
		emit();
	}

	return (
		<div>
			<div ref={toolbarRef} className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] bg-[var(--sunken)] p-1.5">
				<button type="button" disabled={disabled} aria-label="Bold" title="Bold" onClick={() => exec("bold")} className={TOOLBAR_BUTTON}>
					<BoldIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button type="button" disabled={disabled} aria-label="Italic" title="Italic" onClick={() => exec("italic")} className={TOOLBAR_BUTTON}>
					<ItalicIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button
					type="button"
					disabled={disabled}
					aria-label="Underline"
					title="Underline"
					onClick={() => exec("underline")}
					className={TOOLBAR_BUTTON}
				>
					<UnderlineIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button type="button" disabled={disabled} aria-label="Heading" title="Heading" onClick={toggleHeading} className={TOOLBAR_BUTTON}>
					<H2Icon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button
					type="button"
					disabled={disabled}
					aria-label="Bullet list"
					title="Bullet list"
					onClick={() => exec("insertUnorderedList")}
					className={TOOLBAR_BUTTON}
				>
					<ListBulletIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button
					type="button"
					disabled={disabled}
					aria-label="Numbered list"
					title="Numbered list"
					onClick={() => exec("insertOrderedList")}
					className={TOOLBAR_BUTTON}
				>
					<NumberedListIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>

				<span aria-hidden className="mx-1 h-5 w-px bg-[var(--line-strong)]" />

				<div className="relative">
					<button
						type="button"
						disabled={disabled}
						aria-label="Link"
						title="Link"
						onClick={openLink}
						className={`${TOOLBAR_BUTTON}${linkOpen ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
					>
						<LinkIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
					</button>
					{linkOpen ? (
						<div
							className="absolute left-0 top-[calc(100%+4px)] z-10 w-[280px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4"
							style={{ boxShadow: "var(--shadow-popover)" }}
						>
							{linkReady ? (
								<Field label="Link to" value={linkUrl} onChange={setLinkUrl} placeholder="https://example.com" />
							) : (
								<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									Select the words that should become the link, then open this again.
								</p>
							)}
							{linkReady ? (
								<div className="mt-2 flex justify-end">
									<Button size="dense" variant="primary" disabled={!linkUrl.trim()} onClick={confirmLink}>
										Insert
									</Button>
								</div>
							) : null}
						</div>
					) : null}
				</div>

				<div className="relative">
					<button
						type="button"
						disabled={disabled}
						aria-label="Insert a placeholder"
						title="Insert a placeholder"
						onClick={openPlaceholders}
						className={`${TOOLBAR_BUTTON}${placeholderOpen ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
					>
						<VariableIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
					</button>
					{placeholderOpen ? (
						<div
							role="menu"
							aria-label="Insert a placeholder"
							className="absolute left-0 top-[calc(100%+4px)] z-10 max-h-[320px] w-[280px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-2"
							style={{ boxShadow: "var(--shadow-popover)" }}
						>
							{placeholderGroups.map((group) => (
								<div key={group.label} className="mb-2 last:mb-0">
									<p className="px-2 py-1 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-wide text-[var(--ink-faint)]">
										{group.label}
									</p>
									{group.items.map((item) => (
										<button
											key={item.path}
											type="button"
											role="menuitem"
											onClick={() => insertPlaceholder(item.path)}
											className="flex w-full items-baseline justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--hover)]"
										>
											<span className="font-mono text-[length:var(--text-sm)] text-[var(--accent)]">{`{{${item.path}}}`}</span>
											<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">{item.description}</span>
										</button>
									))}
								</div>
							))}
						</div>
					) : null}
				</div>

				<InsertImageControl disabled={disabled} onInsert={insertImage} />
			</div>

			<div
				ref={hostRef}
				contentEditable={!disabled}
				suppressContentEditableWarning
				onInput={emit}
				role="textbox"
				aria-multiline="true"
				aria-label="Message body"
				style={{ display: active ? undefined : "none" }}
				// Tailwind's preflight zeroes margin and list style on every element, so
				// without this a sent message's spaced paragraphs, headings and lists
				// collapse into one dense block here. The values mirror what mailShell
				// (electron/main/services/mail-html.ts) actually sends: 12px between
				// paragraphs, the same as textToHtml's own paragraph margin.
				className={`min-h-[320px] max-h-[480px] overflow-y-auto bg-[var(--surface)] px-4 py-3 text-[length:var(--text-base)] leading-[var(--leading-relaxed)] text-[var(--ink)] focus:outline-none [&_p]:mb-3 [&_p:last-child]:mb-0 [&_h2]:mt-4 [&_h2]:mb-2 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1${
					disabled ? " opacity-60" : ""
				}`}
			/>
		</div>
	);
}
