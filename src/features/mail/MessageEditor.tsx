import { useCallback, useEffect, useRef, useState } from "react";
import { BoldIcon, ItalicIcon, LinkIcon, ListBulletIcon, NumberedListIcon, UnderlineIcon } from "@heroicons/react/24/outline";
import { Button } from "../../components/Button";
import { EmojiPicker } from "../../components/EmojiPicker";
import { Field } from "../../components/Field";
import { InsertImageControl } from "../../components/InsertImageControl";
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ACTIVE } from "../../components/toolbar-styles";

type MessageEditorProps = {
	text: string;
	html: string | null;
	onChange: (text: string, html: string | null) => void;
};

function cleanHtml(value: string): string {
	const document = new DOMParser().parseFromString(value, "text/html");
	document.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());
	document.querySelectorAll("*").forEach((node) => {
		for (const attribute of [...node.attributes]) {
			if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
		}
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
export default function MessageEditor({ text, html, onChange }: MessageEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const savedRangeRef = useRef<Range | null>(null);

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
		const next = html ? cleanHtml(html) : text.replace(/\n/g, "<br>");
		if (host.innerHTML !== next) host.innerHTML = next;
	}, [html, text]);

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
		const nextHtml = cleanHtml(host.innerHTML);
		onChange(host.innerText, nextHtml || null);
		refreshActiveFormats();
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

				<InsertImageControl onInsert={(src) => insertAtSelection("insertImage", src)} />
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
				onKeyUp={refreshActiveFormats}
				onMouseUp={refreshActiveFormats}
				onFocus={refreshActiveFormats}
				onBlur={refreshActiveFormats}
				data-placeholder="Write your message"
				className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] px-6 py-4 text-[length:var(--text-lg)] leading-[var(--leading-relaxed)] text-[var(--ink)] outline-none empty:before:text-[var(--ink-faint)] empty:before:content-[attr(data-placeholder)] [&_a]:text-[var(--accent)] [&_a]:underline [&_img]:max-w-full [&_img]:rounded-[var(--radius-md)]"
			/>
		</div>
	);
}
