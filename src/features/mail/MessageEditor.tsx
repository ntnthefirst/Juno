import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { ComposeBlockKind, ComposeBlockVariable } from "@shared/types";
import { chipHtml, VARIABLE_ATTRIBUTE, VARIABLE_NAMES } from "@shared/mail-variables";
import { BoldIcon, ItalicIcon, LinkIcon, ListBulletIcon, NumberedListIcon, UnderlineIcon } from "@heroicons/react/24/outline";
import { Button } from "../../components/Button";
import { EmojiPicker } from "../../components/EmojiPicker";
import { Field } from "../../components/Field";
import { InsertImageControl } from "../../components/InsertImageControl";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ACTIVE } from "../../components/toolbar-styles";
import { escapeAttribute, isDrawable, REMOTE_IMAGE_NOTE } from "../../lib/remote-image";
import { linesToHtml } from "./blocks/block-text";

/**
 * What the composer can ask of the body: the intro and the outro sit in marked
 * elements, so one can be found, replaced or taken out without disturbing the
 * rest of what was typed.
 */
export type MessageEditorHandle = {
	/** The text of the block in the message as it reads now, variables as {{name}}, or null when there is none. */
	readBlock: (kind: ComposeBlockKind) => string | null;
	/**
	 * Puts the block at the start (intro) or end (outro), replacing the one there.
	 * The body is the stored text, and each {{name}} in it becomes a chip. Null
	 * takes the block out.
	 */
	setBlock: (kind: ComposeBlockKind, body: string | null) => void;
	/** Flags the chips that have nothing to put in for this message. */
	markMissing: (names: ComposeBlockVariable[]) => void;
};

const BLOCK_ATTRIBUTE = "data-juno-block";
const MISSING_ATTRIBUTE = "data-missing";
const TOKEN = new RegExp(String.raw`\{\{(${VARIABLE_NAMES.join("|")})\}\}`, "g");

/** A block body as markup: lines kept, each variable a chip. */
function bodyToHtml(body: string): string {
	return linesToHtml(body).replace(TOKEN, (_token, name: string) => chipHtml(name as ComposeBlockVariable));
}

/**
 * What an element reads as in the plain text twin: its words as laid out, with
 * every chip written as its {{name}} token, so the text never carries a label
 * that looks like a word. innerText needs a rendered element, so a copy is laid
 * out out of sight for the read.
 */
function textOf(element: HTMLElement): string {
	const probe = element.cloneNode(true) as HTMLElement;
	probe.querySelectorAll("[" + VARIABLE_ATTRIBUTE + "]").forEach((chip) => {
		chip.replaceWith(document.createTextNode("{{" + (chip.getAttribute(VARIABLE_ATTRIBUTE) ?? "") + "}}"));
	});
	probe.style.cssText = "position:fixed;left:-99999px;top:0;width:" + (element.clientWidth || 600) + "px;white-space:pre-wrap";
	document.body.appendChild(probe);
	const text = probe.innerText;
	probe.remove();
	return text;
}

/**
 * Where an outro goes. At the very end, except in a reply: the quoted original
 * and the line that introduces it ("On ... wrote") stay last, so the sign-off
 * sits under what was written and not under somebody else's mail.
 */
function outroAnchor(host: HTMLElement): Element | null {
	const quote = [...host.children].find((child) => child.tagName === "BLOCKQUOTE");
	if (!quote) return null;
	const before = quote.previousElementSibling;
	return before && before.tagName === "P" ? before : quote;
}

type MessageEditorProps = {
	text: string;
	html: string | null;
	onChange: (text: string, html: string | null) => void;
	/** Drawn at the start of the toolbar, before the formatting buttons. */
	toolbarStart?: ReactNode;
	ref?: Ref<MessageEditorHandle>;
};

/**
 * Where a picture at a web address keeps its address while it is in the
 * editor. The editor is part of Juno's window, which loads no picture from an
 * address (lib/remote-image.ts), so the picture is parked without a `src` and
 * drawn as a box with the note as its tooltip. Nothing is fetched, and the
 * address goes back before the message is saved.
 */
const PARKED = "data-juno-src";

function cleanDocument(value: string): Document {
	const document = new DOMParser().parseFromString(value, "text/html");
	document.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());
	document.querySelectorAll("*").forEach((node) => {
		for (const attribute of [...node.attributes]) {
			if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
		}
	});
	return document;
}

/** A message as the editor shows it, each remote picture parked. */
function forEditor(value: string): string {
	const document = cleanDocument(value);
	document.querySelectorAll("img[src]").forEach((image) => {
		const src = image.getAttribute("src") ?? "";
		if (isDrawable(src)) return;
		image.removeAttribute("src");
		image.setAttribute(PARKED, src);
		if (!image.hasAttribute("title")) image.setAttribute("title", REMOTE_IMAGE_NOTE);
	});
	// A chip is one unit: it is deleted whole and the caret cannot enter it.
	document
		.querySelectorAll("[" + VARIABLE_ATTRIBUTE + "]")
		.forEach((chip) => chip.setAttribute("contenteditable", "false"));
	return document.body.innerHTML;
}

/** What the editor holds, as the message it saves, each parked picture back at its address. */
function forMessage(value: string): string {
	const document = cleanDocument(value);
	document.querySelectorAll(`img[${PARKED}]`).forEach((image) => {
		image.setAttribute("src", image.getAttribute(PARKED) ?? "");
		image.removeAttribute(PARKED);
		if (image.getAttribute("title") === REMOTE_IMAGE_NOTE) image.removeAttribute("title");
	});
	// The warning is for the screen only; a draft keeps the chip as it is.
	document.querySelectorAll("[" + MISSING_ATTRIBUTE + "]").forEach((chip) => {
		chip.removeAttribute(MISSING_ATTRIBUTE);
		chip.removeAttribute("title");
	});
	return document.body.innerHTML;
}

/**
 * The message body. Same formatting bar as a template's visual editor
 * (features/templates/mail/VisualEditor.tsx: bold, a list, a link, an image),
 * plus an emoji picker a template does not need. No border, radius or shadow
 * around the body itself, so it reads as the page continuing rather than a
 * box sitting on it.
 */
export default function MessageEditor({ text, html, onChange, toolbarStart, ref }: MessageEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const savedRangeRef = useRef<Range | null>(null);
	const menu = useContextMenu();
	const [hasSelection, setHasSelection] = useState(false);
	const missingRef = useRef<ComposeBlockVariable[]>([]);

	const applyMissing = useCallback(() => {
		hostRef.current?.querySelectorAll("[" + VARIABLE_ATTRIBUTE + "]").forEach((chip) => {
			const empty = missingRef.current.includes(chip.getAttribute(VARIABLE_ATTRIBUTE) as ComposeBlockVariable);
			if (empty) {
				chip.setAttribute(MISSING_ATTRIBUTE, "");
				chip.setAttribute("title", "Nothing to put here yet. Fill in the recipient, client or project, or remove it.");
			} else {
				chip.removeAttribute(MISSING_ATTRIBUTE);
				chip.removeAttribute("title");
			}
		});
	}, []);

	const [linkOpen, setLinkOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("");
	const [linkReady, setLinkReady] = useState(false);
	const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

	// What the caret currently sits inside, so the toolbar can show it: a
	// button stays highlighted for as long as typing there would still be
	// bold, the same way a word processor's ribbon does.
	const refreshActiveFormats = useCallback(() => {
		const host = hostRef.current;
		const selection = window.getSelection();
		if (!host || !selection || selection.rangeCount === 0 || !host.contains(selection.anchorNode)) {
			setActiveFormats(new Set());
			return;
		}
		const next = new Set<string>();
		if (document.queryCommandState("bold")) next.add("bold");
		if (document.queryCommandState("italic")) next.add("italic");
		if (document.queryCommandState("underline")) next.add("underline");
		if (document.queryCommandState("insertUnorderedList")) next.add("ul");
		if (document.queryCommandState("insertOrderedList")) next.add("ol");
		const anchor = selection.anchorNode;
		const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
		if (anchorElement?.closest("a")) next.add("link");
		setActiveFormats(next);
	}, []);

	useEffect(() => {
		document.addEventListener("selectionchange", refreshActiveFormats);
		return () => document.removeEventListener("selectionchange", refreshActiveFormats);
	}, [refreshActiveFormats]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		if (html) {
			// What the editor holds is compared as the message it would save, so the
			// screen-only warning on a chip is not mistaken for a change.
			const next = forEditor(html);
			if (forMessage(host.innerHTML) !== forMessage(next)) host.innerHTML = next;
		} else {
			const next = text.replace(/\n/g, "<br>");
			if (host.innerHTML !== next) host.innerHTML = next;
		}
		applyMissing();
	}, [html, text, applyMissing]);

	// A click into the link field moves focus off the contentEditable host, so
	// closing the popover on its blur would dismiss it before that click
	// registers. Closing on an outside click instead leaves it open while it
	// is being used.
	useEffect(() => {
		if (!linkOpen) return;
		function onPointerDown(event: MouseEvent) {
			if (toolbarRef.current?.contains(event.target as Node)) return;
			setLinkOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [linkOpen]);

	function update() {
		const host = hostRef.current;
		if (!host) return;
		const nextHtml = forMessage(host.innerHTML);
		onChange(textOf(host), nextHtml || null);
		refreshActiveFormats();
	}

	useImperativeHandle(ref, () => ({
		readBlock(kind) {
			const element = hostRef.current?.querySelector<HTMLElement>(`[${BLOCK_ATTRIBUTE}="${kind}"]`);
			return element ? textOf(element) : null;
		},
		markMissing(names) {
			missingRef.current = names;
			applyMissing();
		},
		setBlock(kind, body) {
			const host = hostRef.current;
			if (!host) return;
			host.querySelector(`[${BLOCK_ATTRIBUTE}="${kind}"]`)?.remove();
			if (body !== null) {
				const element = document.createElement("div");
				element.setAttribute(BLOCK_ATTRIBUTE, kind);
				// Inline, because the message leaves this window and a stylesheet does not.
				element.setAttribute("style", kind === "intro" ? "margin:0 0 16px 0;" : "margin:16px 0 0 0;");
				element.innerHTML = bodyToHtml(body);
				host.insertBefore(element, kind === "intro" ? host.firstChild : outroAnchor(host));
			}
			applyMissing();
			const nextHtml = forMessage(host.innerHTML);
			onChange(textOf(host), nextHtml || null);
		},
	}));

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
		hostRef.current?.focus();
		document.execCommand(command, false, arg);
		update();
	}

	function insertAtSelection(command: string, arg: string) {
		restoreSelection();
		document.execCommand(command, false, arg);
		update();
	}

	function openLink() {
		captureSelection();
		setLinkReady(Boolean(savedRangeRef.current && !savedRangeRef.current.collapsed));
		setLinkOpen((wasOpen) => !wasOpen);
	}

	function confirmLink() {
		const url = linkUrl.trim();
		if (!url || !linkReady) return;
		restoreSelection();
		document.execCommand("createLink", false, url);
		update();
		setLinkOpen(false);
		setLinkUrl("");
	}

	// The right-click menu. The selection is taken when it opens, because pressing
	// a menu item moves focus off the message, and the edit then has to land
	// where the person right-clicked rather than nowhere.
	function openEditMenu(event: React.MouseEvent<HTMLDivElement>) {
		captureSelection();
		setHasSelection(Boolean(savedRangeRef.current && !savedRangeRef.current.collapsed));
		menu.open(event);
	}

	// The edit itself fires an input event, so the message state follows on its own.
	function runEdit(kind: "cut" | "copy" | "paste" | "pasteAsText" | "selectAll") {
		restoreSelection();
		void window.juno.app.edit[kind]();
	}

	const editItems: MenuItem[] = [
		{ id: "cut", label: "Cut", icon: "cut", hint: "Ctrl+X", disabled: !hasSelection, onSelect: () => runEdit("cut") },
		{ id: "copy", label: "Copy", icon: "copy", hint: "Ctrl+C", disabled: !hasSelection, onSelect: () => runEdit("copy") },
		{
			id: "paste",
			label: "Paste with formatting",
			icon: "paste",
			hint: "Ctrl+V",
			separatorBefore: true,
			onSelect: () => runEdit("paste"),
		},
		{
			id: "paste-text",
			label: "Paste as plain text",
			icon: "paste",
			hint: "Ctrl+Shift+V",
			onSelect: () => runEdit("pasteAsText"),
		},
		{
			id: "select-all",
			label: "Select all",
			separatorBefore: true,
			hint: "Ctrl+A",
			onSelect: () => runEdit("selectAll"),
		},
	];

	function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
		const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
		if (!image) return;
		event.preventDefault();
		const file = image.getAsFile();
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			document.execCommand("insertImage", false, String(reader.result));
			update();
		};
		reader.readAsDataURL(file);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				ref={toolbarRef}
				className="flex flex-none flex-wrap items-center gap-1 border-b border-[var(--line)] bg-[var(--sunken)] p-1.5"
			>
				{toolbarStart ? (
					<>
						{toolbarStart}
						<span aria-hidden className="mx-1 h-5 w-px bg-[var(--line-strong)]" />
					</>
				) : null}
				<button
					type="button"
					aria-label="Bold"
					aria-pressed={activeFormats.has("bold")}
					title="Bold"
					onClick={() => exec("bold")}
					className={`${TOOLBAR_BUTTON}${activeFormats.has("bold") ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
				>
					<BoldIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button
					type="button"
					aria-label="Italic"
					aria-pressed={activeFormats.has("italic")}
					title="Italic"
					onClick={() => exec("italic")}
					className={`${TOOLBAR_BUTTON}${activeFormats.has("italic") ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
				>
					<ItalicIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button
					type="button"
					aria-label="Underline"
					aria-pressed={activeFormats.has("underline")}
					title="Underline"
					onClick={() => exec("underline")}
					className={`${TOOLBAR_BUTTON}${activeFormats.has("underline") ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
				>
					<UnderlineIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>

				<span aria-hidden className="mx-1 h-5 w-px bg-[var(--line-strong)]" />

				<button
					type="button"
					aria-label="Bullet list"
					aria-pressed={activeFormats.has("ul")}
					title="Bullet list"
					onClick={() => exec("insertUnorderedList")}
					className={`${TOOLBAR_BUTTON}${activeFormats.has("ul") ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
				>
					<ListBulletIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>
				<button
					type="button"
					aria-label="Numbered list"
					aria-pressed={activeFormats.has("ol")}
					title="Numbered list"
					onClick={() => exec("insertOrderedList")}
					className={`${TOOLBAR_BUTTON}${activeFormats.has("ol") ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
				>
					<NumberedListIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				</button>

				<span aria-hidden className="mx-1 h-5 w-px bg-[var(--line-strong)]" />

				<div className="relative">
					<button
						type="button"
						aria-label="Link"
						aria-pressed={linkOpen || activeFormats.has("link")}
						title="Link"
						onClick={openLink}
						className={`${TOOLBAR_BUTTON}${linkOpen || activeFormats.has("link") ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
					>
						<LinkIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
					</button>
					{linkOpen ? (
						<div
							className="absolute top-[calc(100%+4px)] left-0 z-10 w-[280px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4"
							style={{ boxShadow: "var(--shadow-popover)" }}
						>
							{linkReady ? (
								<Field label="Link to" value={linkUrl} onChange={setLinkUrl} placeholder="https://example.com" />
							) : (
								<p className="text-sm text-[var(--ink-muted)]">
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

				<InsertImageControl
					onInsert={(src) =>
						isDrawable(src)
							? insertAtSelection("insertImage", src)
							: insertAtSelection(
									"insertHTML",
									`<img ${PARKED}="${escapeAttribute(src)}" alt="" title="${escapeAttribute(REMOTE_IMAGE_NOTE)}">`,
								)
					}
				/>
				<EmojiPicker onInsert={(emoji) => insertAtSelection("insertText", emoji)} />
			</div>

			<div
				ref={hostRef}
				contentEditable
				role="textbox"
				aria-label="Message"
				aria-multiline="true"
				onInput={update}
				onPaste={handlePaste}
				onContextMenu={openEditMenu}
				onKeyUp={refreshActiveFormats}
				onMouseUp={refreshActiveFormats}
				onFocus={refreshActiveFormats}
				onBlur={refreshActiveFormats}
				data-placeholder="Write your message"
				className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] px-6 py-4 text-document text-[var(--ink)] outline-none empty:before:text-[var(--ink-faint)] empty:before:content-[attr(data-placeholder)] [&_a]:text-[var(--accent)] [&_a]:underline [&_[data-juno-variable]]:mx-0.5 [&_[data-juno-variable]]:inline-flex [&_[data-juno-variable]]:h-[22px] [&_[data-juno-variable]]:items-center [&_[data-juno-variable]]:rounded-[var(--radius-sm)] [&_[data-juno-variable]]:bg-[var(--accent-soft)] [&_[data-juno-variable]]:px-1.5 [&_[data-juno-variable]]:align-baseline [&_[data-juno-variable]]:text-sm [&_[data-juno-variable]]:font-[var(--weight-medium)] [&_[data-juno-variable]]:text-[var(--accent)] [&_[data-missing]]:bg-[var(--warn-soft)] [&_[data-missing]]:text-[var(--warn)] [&_img]:max-w-full [&_img]:rounded-[var(--radius-md)] [&_img[data-juno-src]]:inline-block [&_img[data-juno-src]]:min-h-12 [&_img[data-juno-src]]:min-w-32 [&_img[data-juno-src]]:border [&_img[data-juno-src]]:border-dashed [&_img[data-juno-src]]:border-[var(--line-strong)] [&_img[data-juno-src]]:bg-[var(--sunken)] [&_img[data-juno-src]]:p-2 [&_img[data-juno-src]]:text-sm [&_img[data-juno-src]]:text-[var(--ink-muted)]"
			/>
			{menu.at ? <ContextMenu at={menu.at} items={editItems} onClose={menu.close} ariaLabel="Edit message" /> : null}
		</div>
	);
}
