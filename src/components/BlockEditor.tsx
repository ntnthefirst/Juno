import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { newBlockId, plainText, safeLinkHref, sanitiseInline, type Block, type CheckBlock, type ImageBlock, type TableBlock, type TextBlock } from "@shared/blocks";
import { ASSET_ORIGIN } from "@shared/types";
import { Checkbox } from "./Checkbox";
import { Icon, type IconName } from "./Icon";
import { ContextMenu, type MenuItem } from "./Menu";

type BlockEditorProps = {
	blocks: Block[];
	onChange: (blocks: Block[]) => void;
	/** A page has marks, tables and a toolbar. A note is text, bullets and checklists. */
	variant: "note" | "page";
	/** The element the page's Find searches in, so the editor and the bar agree on one. */
	containerRef?: RefObject<HTMLDivElement | null>;
	autoFocus?: boolean;
	/** Drawn under the toolbar and above the first block: a page's title and what it is. */
	header?: ReactNode;
	/** The page being edited. A picture is a file the page keeps, so adding one needs it. */
	pageId?: string;
	/** Told when a picture or a link could not be handled, in a sentence. */
	onError?: (message: string) => void;
};

type Kind = "text" | "heading" | "bullet" | "check" | "table";

type Caret = { id: string; at: "start" | "end" };

const KIND_LABEL: Record<Kind, string> = {
	text: "Text",
	heading: "Heading",
	bullet: "Bullet list",
	check: "Checklist",
	table: "Table",
};

const SLASH_ITEMS: { kind: Kind; icon: IconName; hint: string; page?: boolean }[] = [
	{ kind: "text", icon: "align-left", hint: "Just start writing" },
	{ kind: "heading", icon: "rows", hint: "A section title" },
	{ kind: "check", icon: "check", hint: "Things to tick off" },
	{ kind: "bullet", icon: "list", hint: "A plain list" },
	{ kind: "table", icon: "file-sheet", hint: "Rows and columns", page: true },
];

/** Whether the caret sits at the very start or end of an editable line. */
function caretEdge(element: HTMLElement, edge: "start" | "end"): boolean {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
	const range = selection.getRangeAt(0);
	if (!element.contains(range.startContainer)) return false;
	const probe = document.createRange();
	probe.selectNodeContents(element);
	if (edge === "start") probe.setEnd(range.startContainer, range.startOffset);
	else probe.setStart(range.endContainer, range.endOffset);
	return probe.toString().length === 0;
}

function placeCaret(element: HTMLElement, at: "start" | "end"): void {
	element.focus();
	const range = document.createRange();
	range.selectNodeContents(element);
	range.collapse(at === "start");
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** What lies after the caret, taken out of the line, as markup. */
function splitAtCaret(element: HTMLElement): { head: string; tail: string } {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return { head: sanitiseInline(element.innerHTML), tail: "" };
	const range = selection.getRangeAt(0);
	const rest = document.createRange();
	rest.selectNodeContents(element);
	rest.setStart(range.endContainer, range.endOffset);
	const holder = document.createElement("div");
	holder.appendChild(rest.extractContents());
	return { head: sanitiseInline(element.innerHTML), tail: sanitiseInline(holder.innerHTML) };
}

/** What the style button says for the block the caret is in. */
function styleLabel(block: Block | undefined): string {
	if (!block || block.type === "image") return "Text";
	return block.type === "bullet" ? "List" : KIND_LABEL[block.type];
}

function isTextual(block: Block): block is TextBlock | CheckBlock {
	return block.type !== "table" && block.type !== "image";
}

/** The address a page's picture is shown from. The path is relative and the service built it. */
function imageUrl(block: ImageBlock): string {
	return `${ASSET_ORIGIN}/${block.path.replace(/^pages\//, "page/")}`;
}

function blank(type: "text" | "heading" | "bullet" | "check" = "text", text = ""): TextBlock | CheckBlock {
	return type === "check" ? { id: newBlockId(), type, text, done: false } : { id: newBlockId(), type, text };
}

function emptyTable(): TableBlock {
	return { id: newBlockId(), type: "table", header: ["Item", "Quantity", "Price"], rows: [["", "", ""], ["", "", ""]] };
}

/** Turns a block into another kind, keeping its words. */
function convert(block: Block, kind: Kind): Block {
	if (kind === "table") return { ...emptyTable(), id: block.id };
	const text = isTextual(block) ? block.text : "";
	return kind === "check" ? { id: block.id, type: "check", text, done: block.type === "check" ? block.done : false } : { id: block.id, type: kind, text };
}

/**
 * The editor a note and a page are written in: one line per block, each a
 * contentEditable of its own. The text of a line is the DOM's while it has
 * focus, which is what keeps the caret where the person left it, and is copied
 * out through `onChange` on every input, so nothing waits for a save button.
 *
 * Typing a slash on an empty line opens the block menu. Enter splits the line,
 * Backspace at the start of one folds it into the line above, and an empty
 * list line turns back into text.
 */
export function BlockEditor({ blocks, onChange, variant, containerRef, autoFocus = false, header, pageId, onError }: BlockEditorProps) {
	const page = variant === "page";
	const [active, setActive] = useState<string | null>(null);
	const [slash, setSlash] = useState<{ id: string; query: string } | null>(null);
	const [slashIndex, setSlashIndex] = useState(0);
	const [marks, setMarks] = useState({ bold: false, italic: false, underline: false });
	const [menu, setMenu] = useState<{ at: { x: number; y: number }; label: string; items: MenuItem[] } | null>(null);
	const [link, setLink] = useState<LinkEdit | null>(null);
	const caret = useRef<Caret | null>(autoFocus && blocks[0] ? { id: blocks[0].id, at: "end" } : null);
	const root = useRef<HTMLDivElement>(null);
	const own = containerRef ?? root;

	// Focus is moved after the render that made the line, not before it.
	useLayoutEffect(() => {
		const wanted = caret.current;
		if (!wanted) return;
		const element = own.current?.querySelector<HTMLElement>(`[data-block-text="${CSS.escape(wanted.id)}"]`);
		if (!element) return;
		caret.current = null;
		placeCaret(element, wanted.at);
	});

	useEffect(() => {
		if (!page) return;
		function read() {
			setMarks({
				bold: document.queryCommandState("bold"),
				italic: document.queryCommandState("italic"),
				underline: document.queryCommandState("underline"),
			});
		}
		document.addEventListener("selectionchange", read);
		return () => document.removeEventListener("selectionchange", read);
	}, [page]);

	function replace(id: string, next: Block | Block[]): void {
		const list = blocks;
		const index = list.findIndex((block) => block.id === id);
		if (index < 0) return;
		onChange([...list.slice(0, index), ...(Array.isArray(next) ? next : [next]), ...list.slice(index + 1)]);
	}

	function patchText(id: string, text: string): void {
		const block = blocks.find((item) => item.id === id);
		if (!block || !isTextual(block) || block.text === text) return;
		replace(id, { ...block, text });
	}

	function slashChoices(query: string) {
		const needle = query.trim().toLowerCase();
		return SLASH_ITEMS.filter((item) => (page || !item.page) && KIND_LABEL[item.kind].toLowerCase().includes(needle));
	}

	function chooseSlash(id: string, kind: Kind): void {
		const block = blocks.find((item) => item.id === id);
		if (!block) return;
		setSlash(null);
		const converted = convert(isTextual(block) ? { ...block, text: "" } : { id: block.id, type: "text", text: "" }, kind);
		if (converted.type === "table") {
			// A table has no line to type in, so the cursor goes on to a fresh one after it.
			const after = blank();
			replace(id, [converted, after]);
			caret.current = { id: after.id, at: "start" };
		} else {
			replace(id, converted);
			caret.current = { id, at: "end" };
		}
	}

	function onInput(id: string, element: HTMLElement): void {
		const html = sanitiseInline(element.innerHTML);
		patchText(id, html);
		const block = blocks.find((item) => item.id === id);
		const words = plainText(html);
		if (block && block.type === "text" && words.startsWith("/")) {
			setSlash({ id, query: words.slice(1) });
			setSlashIndex(0);
		} else if (slash?.id === id) {
			setSlash(null);
		}
	}

	function onKeyDown(event: KeyboardEvent<HTMLElement>, block: TextBlock | CheckBlock): void {
		const element = event.currentTarget;
		const list = blocks;
		const index = list.findIndex((item) => item.id === block.id);

		if (slash?.id === block.id) {
			const choices = slashChoices(slash.query);
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				if (choices.length > 0) {
					const step = event.key === "ArrowDown" ? 1 : -1;
					setSlashIndex((slashIndex + step + choices.length) % choices.length);
				}
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const choice = choices[Math.min(slashIndex, choices.length - 1)];
				if (choice) chooseSlash(block.id, choice.kind);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setSlash(null);
				return;
			}
		}

		if (!page && (event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
			// A note is plain text, so the marks a contentEditable would add are refused.
			event.preventDefault();
			return;
		}

		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			const empty = plainText(sanitiseInline(element.innerHTML)).trim() === "";
			if (empty && (block.type === "check" || block.type === "bullet")) {
				replace(block.id, { id: block.id, type: "text", text: "" });
				caret.current = { id: block.id, at: "end" };
				return;
			}
			const { head, tail } = splitAtCaret(element);
			const kind = block.type === "check" || block.type === "bullet" ? block.type : "text";
			const created = blank(kind, tail);
			replace(block.id, [{ ...block, text: head }, created]);
			caret.current = { id: created.id, at: "start" };
			return;
		}

		if (event.key === "Backspace" && caretEdge(element, "start")) {
			if (block.type !== "text") {
				event.preventDefault();
				replace(block.id, { id: block.id, type: "text", text: block.text });
				caret.current = { id: block.id, at: "start" };
				return;
			}
			const before = list[index - 1];
			if (!before) return;
			event.preventDefault();
			if (!isTextual(before)) {
				if (plainText(block.text) === "") onChange(list.filter((item) => item.id !== block.id));
				return;
			}
			const merged = { ...before, text: before.text + sanitiseInline(element.innerHTML) };
			onChange([...list.slice(0, index - 1), merged, ...list.slice(index + 1)]);
			caret.current = { id: before.id, at: "end" };
			// Past the join: the caret has to land between the two texts, which is the end of the first.
			return;
		}

		if (event.key === "ArrowUp" && caretEdge(element, "start")) {
			const before = list.slice(0, index).reverse().find(isTextual);
			if (before) {
				event.preventDefault();
				caret.current = { id: before.id, at: "end" };
				setActive(before.id);
				const target = own.current?.querySelector<HTMLElement>(`[data-block-text="${CSS.escape(before.id)}"]`);
				if (target) placeCaret(target, "end");
			}
		} else if (event.key === "ArrowDown" && caretEdge(element, "end")) {
			const after = list.slice(index + 1).find(isTextual);
			if (after) {
				event.preventDefault();
				const target = own.current?.querySelector<HTMLElement>(`[data-block-text="${CSS.escape(after.id)}"]`);
				if (target) placeCaret(target, "start");
			}
		}
	}

	function onPaste(event: ClipboardEvent<HTMLElement>, block: TextBlock | CheckBlock): void {
		const text = event.clipboardData.getData("text/plain");
		event.preventDefault();
		const lines = text.split(/\r?\n/);
		if (lines.length === 1) {
			document.execCommand("insertText", false, text);
			return;
		}
		// Several lines are several blocks, the first one joining the line being typed in.
		const [first, ...rest] = lines;
		document.execCommand("insertText", false, first ?? "");
		const element = event.currentTarget;
		const { head, tail } = splitAtCaret(element);
		const kind = block.type === "check" || block.type === "bullet" ? block.type : "text";
		const created = rest.filter((line, i) => line !== "" || i === rest.length - 1).map((line) => blank(kind, sanitiseInline(line)));
		const last = created[created.length - 1];
		if (last) last.text = last.text + tail;
		replace(block.id, [{ ...block, text: head }, ...created]);
		if (last) caret.current = { id: last.id, at: "end" };
	}

	function applyMark(command: "bold" | "italic" | "underline"): void {
		document.execCommand(command);
		const target = document.activeElement;
		if (target instanceof HTMLElement && target.dataset.blockText) onInput(target.dataset.blockText, target);
	}

	function setActiveKind(kind: Kind): void {
		const id = active ?? blocks[blocks.length - 1]?.id;
		const block = blocks.find((item) => item.id === id);
		if (!block) return;
		const same = block.type === kind;
		const converted = convert(block, same && kind !== "text" ? "text" : kind);
		if (converted.type === "table") {
			const after = blank();
			replace(block.id, [converted, after]);
			caret.current = { id: after.id, at: "start" };
		} else {
			replace(block.id, converted);
			caret.current = { id: block.id, at: "end" };
		}
	}

	const current = blocks.find((item) => item.id === active);
	const choices = slash ? slashChoices(slash.query) : [];

	function renderBlock(block: Block, index: number): ReactNode {
		if (block.type === "image") {
			return <ImageView key={block.id} block={block} onRemove={() => onChange(blocks.filter((item) => item.id !== block.id))} />;
		}
		if (block.type === "table") {
			return <TableView key={block.id} block={block} onChange={(next) => replace(block.id, next)} />;
		}
		const lineClass = page ? "text-document" : "text-lg";
		const trailing = index === blocks.length - 1 && block.type === "text" && block.text === "";
		const editable = (
			<Line
				block={block}
				placeholder={
					trailing && page ? "Type to add a block" : block.type === "heading" ? "Heading" : block.type === "text" && index === 0 && !page ? "Start writing" : undefined
				}
				className={[
					"min-w-0 flex-1 outline-none",
					block.type === "heading" ? "text-h3 text-[var(--ink)]" : `${lineClass} text-[var(--ink)]`,
					block.type === "check" && block.done ? "text-[var(--ink-muted)] line-through" : "",
				].join(" ")}
				onFocus={() => setActive(block.id)}
				onInput={(element) => onInput(block.id, element)}
				onKeyDown={(event) => onKeyDown(event, block)}
				onPaste={(event) => onPaste(event, block)}
			/>
		);
		return (
			<div
				key={block.id}
				data-block={block.id}
				className={["relative flex items-start gap-3", block.type === "heading" ? "pt-4 pb-1" : "py-[5px]"].join(" ")}
			>
				{block.type === "check" ? (
					<span className="flex h-[26px] flex-none items-center">
						<Checkbox
							shape="round"
							aria-label="Done"
							checked={block.done}
							onChange={(event) => replace(block.id, { ...block, done: event.target.checked })}
						/>
					</span>
				) : null}
				{block.type === "bullet" ? <span aria-hidden className="w-5 flex-none text-center text-lg text-[var(--ink-muted)]">•</span> : null}
				{trailing && page ? <span aria-hidden className="text-document text-[var(--ink)]">/</span> : null}
				{editable}
				{slash?.id === block.id ? (
					<SlashMenu choices={choices} selected={Math.min(slashIndex, Math.max(0, choices.length - 1))} onChoose={(kind) => chooseSlash(block.id, kind)} onHover={setSlashIndex} />
				) : null}
			</div>
		);
	}

	function report(cause: unknown): void {
		onError?.(cause instanceof Error ? cause.message : String(cause));
	}

	/** Opens the link box on the words selected in a line, or on the link the caret is in. */
	function openLinkBox(box: DOMRect): void {
		const selection = window.getSelection();
		const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		const line = range ? lineOf(range.startContainer) : null;
		if (!range || !line || !own.current?.contains(line)) {
			onError?.("Put the cursor in a line and select the words to link.");
			return;
		}
		const anchor = anchorOf(range.startContainer);
		let saved = range.cloneRange();
		if (anchor && line.contains(anchor)) {
			saved = document.createRange();
			saved.selectNodeContents(anchor);
		}
		setLink({ at: { x: box.left, y: box.bottom + 6 }, range: saved, href: anchor?.getAttribute("href") ?? "", existing: Boolean(anchor), selected: !saved.collapsed });
	}

	function applyLink(href: string | null): void {
		const current = link;
		if (!current) return;
		setLink(null);
		const selection = window.getSelection();
		const line = lineOf(current.range.startContainer);
		if (!selection || !line) return;
		line.focus();
		selection.removeAllRanges();
		selection.addRange(current.range);
		if (href === null) document.execCommand("unlink");
		else document.execCommand("createLink", false, href);
		if (line.dataset.blockText) onInput(line.dataset.blockText, line);
	}

	async function addImage(): Promise<void> {
		if (!pageId) return;
		try {
			const picked = await window.juno.pages.chooseImage(pageId);
			if (!picked) return;
			const index = blocks.findIndex((item) => item.id === active);
			const at = index < 0 ? blocks.length : index + 1;
			const next = [...blocks.slice(0, at), picked, ...blocks.slice(at)];
			// The cursor needs a line to go on to after a picture.
			if (!next.slice(at + 1).some(isTextual)) {
				const after = blank();
				next.push(after);
				caret.current = { id: after.id, at: "start" };
			}
			onChange(next);
		} catch (cause: unknown) {
			report(cause);
		}
	}

	function openLinkAddress(href: string): void {
		window.juno.pages.openLink(href).catch(report);
	}

	// Built when a button is pressed, not while drawing, because choosing one moves the caret.
	function openStyleMenu(box: DOMRect): void {
		setMenu({
			at: { x: box.left, y: box.bottom + 4 },
			label: "Block style",
			items: (["text", "heading", "bullet", "check"] as Kind[]).map((kind) => ({
				id: kind,
				label: KIND_LABEL[kind],
				onSelect: () => setActiveKind(kind),
			})),
		});
	}

	function openMoreMenu(box: DOMRect): void {
		setMenu({
			at: { x: box.left, y: box.bottom + 4 },
			label: "More",
			items: [{ id: "table", label: "Insert a table", icon: "file-sheet", onSelect: () => setActiveKind("table") }],
		});
	}

	function onContainerClick(event: MouseEvent<HTMLDivElement>): void {
		if (!page || !(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return;
		const href = event.target.closest("a[href]")?.getAttribute("href");
		if (!href) return;
		event.preventDefault();
		openLinkAddress(href);
	}

	return (
		<div ref={own} className="relative" onClick={onContainerClick}>
			{page ? (
				<div className="pointer-events-none sticky top-3 z-20 mb-6 flex justify-center">
					<div
						role="toolbar"
						aria-label="Format"
						className="pointer-events-auto flex items-center gap-[2px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-2 py-[6px] shadow-[var(--shadow-popover)]"
					>
						<button
							type="button"
							onMouseDown={(event) => event.preventDefault()}
							onClick={(event) => openStyleMenu(event.currentTarget.getBoundingClientRect())}
							className="flex h-8 w-[72px] items-center gap-[6px] rounded-[var(--radius-md)] pr-[6px] pl-2 text-dense font-[var(--weight-medium)] text-[var(--ink)] hover:bg-[var(--hover)]"
						>
							{styleLabel(current)}
							<Icon name="chevron-down" size={12} strokeWidth={2} />
						</button>
						<Divider />
						<MarkButton label="Bold" on={marks.bold} onClick={() => applyMark("bold")}>B</MarkButton>
						<MarkButton label="Italic" on={marks.italic} onClick={() => applyMark("italic")}><span className="italic">I</span></MarkButton>
						<MarkButton label="Underline" on={marks.underline} onClick={() => applyMark("underline")}><span className="underline">U</span></MarkButton>
						<Divider />
						<ToolButton icon="list" label="Bullet list" on={current?.type === "bullet"} onClick={() => setActiveKind("bullet")} />
						<ToolButton icon="check" label="Checklist" on={current?.type === "check"} onClick={() => setActiveKind("check")} />
						<ToolButton icon="link" label="Link" on={link !== null} onClick={openLinkBox} />
						<ToolButton icon="image" label="Picture" disabled={!pageId} onClick={() => void addImage()} />
						<ToolButton
							icon="more"
							label="More"
							onClick={openMoreMenu}
						/>
					</div>
				</div>
			) : null}
			{header}
			{blocks.map(renderBlock)}
			{link ? (
				<LinkBox
					link={link}
					onApply={applyLink}
					onOpen={openLinkAddress}
					onClose={() => setLink(null)}
				/>
			) : null}
			{menu ? (
				<ContextMenu
					at={menu.at}
					items={menu.items}
					ariaLabel={menu.label}
					onClose={() => setMenu(null)}
				/>
			) : null}
		</div>
	);
}

function Divider() {
	return <span aria-hidden className="mx-[2px] h-4 w-px flex-none bg-[var(--line)]" />;
}

type MarkButtonProps = { label: string; on: boolean; onClick: () => void; children: ReactNode };

function MarkButton({ label, on, onClick, children }: MarkButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={on}
			title={label}
			// The press must not take focus, or the selection it formats is gone.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className={[
				"flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] text-base font-[var(--weight-semibold)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				on ? "bg-[var(--hover)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			{children}
		</button>
	);
}

type ToolButtonProps = { icon: IconName; label: string; on?: boolean; disabled?: boolean; onClick: (box: DOMRect) => void };

function ToolButton({ icon, label, on = false, disabled = false, onClick }: ToolButtonProps) {
	return (
		<button
			type="button"
			disabled={disabled}
			aria-label={label}
			title={label}
			onMouseDown={(event) => event.preventDefault()}
			onClick={(event) => onClick(event.currentTarget.getBoundingClientRect())}
			className={[
				"flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] disabled:opacity-40",
				on ? "bg-[var(--hover)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={16} />
		</button>
	);
}

type LineProps = {
	block: TextBlock | CheckBlock;
	placeholder: string | undefined;
	className: string;
	onFocus: () => void;
	onInput: (element: HTMLElement) => void;
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	onPaste: (event: ClipboardEvent<HTMLElement>) => void;
};

/**
 * One editable line. React never rewrites its markup while it has focus,
 * because that would throw the caret to the start; it is set when the line
 * mounts and whenever the block changed somewhere else.
 */
function Line({ block, placeholder, className, onFocus, onInput, onKeyDown, onPaste }: LineProps) {
	const element = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = element.current;
		if (el && document.activeElement !== el && el.innerHTML !== block.text) el.innerHTML = block.text;
	});
	return (
		<div
			ref={element}
			role="textbox"
			aria-multiline="false"
			aria-label={block.type === "heading" ? "Heading" : "Text"}
			contentEditable
			suppressContentEditableWarning
			spellCheck
			data-block-text={block.id}
			data-placeholder={placeholder}
			onFocus={onFocus}
			onInput={(event) => onInput(event.currentTarget)}
			onKeyDown={onKeyDown}
			onPaste={onPaste}
			className={`${className} empty:before:text-[var(--ink-faint)] empty:before:content-[attr(data-placeholder)]`}
		/>
	);
}

type SlashMenuProps = {
	choices: typeof SLASH_ITEMS;
	selected: number;
	onChoose: (kind: Kind) => void;
	onHover: (index: number) => void;
};

function SlashMenu({ choices, selected, onChoose, onHover }: SlashMenuProps) {
	return (
		<div
			role="listbox"
			aria-label="Add a block"
			className="animate-scale absolute top-full left-0 z-30 mt-2 w-[198px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--shadow-popover)]"
		>
			<p className="px-2 pt-2 pb-1 text-overline text-[var(--ink-muted)] uppercase">Add a block</p>
			{choices.length === 0 ? <p className="px-2 py-2 text-dense text-[var(--ink-muted)]">Nothing matches that.</p> : null}
			{choices.map((choice, index) => (
				<button
					key={choice.kind}
					type="button"
					role="option"
					aria-selected={index === selected}
					onMouseDown={(event) => event.preventDefault()}
					onMouseEnter={() => onHover(index)}
					onClick={() => onChoose(choice.kind)}
					className={[
						"flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-[6px] text-left",
						index === selected ? "bg-[var(--hover)]" : "",
					].join(" ")}
				>
					<span className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--sunken)] text-[var(--ink-muted)]">
						<Icon name={choice.icon} size={16} />
					</span>
					<span className="min-w-0">
						<span className="block text-dense font-[var(--weight-medium)] text-[var(--ink)]">{KIND_LABEL[choice.kind]}</span>
						<span className="block text-sm text-[var(--ink-muted)]">{choice.hint}</span>
					</span>
				</button>
			))}
		</div>
	);
}

const NUMERIC = /^[€$]?\s?-?\d[\d\s.,]*(\s?[a-zA-Z%]{0,3})?$/;

type TableViewProps = { block: TableBlock; onChange: (block: TableBlock) => void };

/** A table of plain cells. A column whose cells are numbers lines up on the right. */
function TableView({ block, onChange }: TableViewProps) {
	const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
	const right = Array.from({ length: columns }, (_, column) => {
		const cells = block.rows.map((row) => row[column] ?? "").filter((cell) => cell.trim() !== "");
		return cells.length > 0 && cells.every((cell) => NUMERIC.test(cell.trim()));
	});

	function setCell(row: number | "head", column: number, value: string): void {
		if (row === "head") {
			const header = Array.from({ length: columns }, (_, i) => block.header[i] ?? "");
			header[column] = value;
			onChange({ ...block, header });
			return;
		}
		const rows = block.rows.map((cells, index) => {
			if (index !== row) return cells;
			const next = Array.from({ length: columns }, (_, i) => cells[i] ?? "");
			next[column] = value;
			return next;
		});
		onChange({ ...block, rows });
	}

	const cell = (value: string, row: number | "head", column: number, strong: boolean) => (
		<input
			aria-label={row === "head" ? `Column ${column + 1} title` : `Row ${row + 1}, column ${column + 1}`}
			value={value}
			onChange={(event) => setCell(row, column, event.target.value)}
			className={[
				"block w-full bg-transparent px-0 py-2 outline-none",
				row === "head" ? "text-dense text-[var(--ink-muted)]" : "text-base text-[var(--ink)]",
				strong ? "font-[var(--weight-semibold)]" : "",
				right[column] ? "text-right tabular-nums" : "",
			].join(" ")}
		/>
	);

	return (
		<div className="group/table py-3" data-block={block.id}>
			<table className="w-full border-collapse">
				<thead>
					<tr className="border-b border-[var(--line)]">
						{Array.from({ length: columns }, (_, column) => (
							<th key={column} className="px-2 font-normal first:pl-0 last:pr-0">
								{cell(block.header[column] ?? "", "head", column, false)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{block.rows.map((row, index) => {
						const total = (row[0] ?? "").trim().toLowerCase() === "total";
						return (
							<tr key={index} className="border-b border-[var(--line)]">
								{Array.from({ length: columns }, (_, column) => (
									<td key={column} className="px-2 first:pl-0 last:pr-0">
										{cell(row[column] ?? "", index, column, total && column > 0)}
									</td>
								))}
							</tr>
						);
					})}
				</tbody>
			</table>
			<div className="mt-1 flex gap-1 opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within/table:opacity-100 group-hover/table:opacity-100">
				<button
					type="button"
					onClick={() => onChange({ ...block, rows: [...block.rows, Array.from({ length: columns }, () => "")] })}
					className="h-8 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					Add row
				</button>
				<button
					type="button"
					onClick={() =>
						onChange({
							...block,
							header: [...Array.from({ length: columns }, (_, i) => block.header[i] ?? ""), ""],
							rows: block.rows.map((row) => [...Array.from({ length: columns }, (_, i) => row[i] ?? ""), ""]),
						})
					}
					className="h-8 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					Add column
				</button>
				{block.rows.length > 1 ? (
					<button
						type="button"
						onClick={() => onChange({ ...block, rows: block.rows.slice(0, -1) })}
						className="h-8 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						Remove row
					</button>
				) : null}
			</div>
		</div>
	);
}

type LinkEdit = {
	at: { x: number; y: number };
	/** The words the link will wrap, kept because the box takes focus from the line. */
	range: Range;
	href: string;
	existing: boolean;
	selected: boolean;
};

/** The editable line a node sits in. */
function lineOf(node: Node): HTMLElement | null {
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest<HTMLElement>("[data-block-text]") ?? null;
}

function anchorOf(node: Node): HTMLAnchorElement | null {
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest("a") ?? null;
}

type LinkBoxProps = {
	link: LinkEdit;
	onApply: (href: string | null) => void;
	onOpen: (href: string) => void;
	onClose: () => void;
};

/**
 * Where a link's address is typed. It checks the address with the same rule
 * the page is saved with (https or mail, a bare domain gets https), so what is
 * accepted here is what survives the save.
 */
function LinkBox({ link, onApply, onOpen, onClose }: LinkBoxProps) {
	const [value, setValue] = useState(link.href);
	const [error, setError] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => input.current?.focus(), []);

	function submit(): void {
		const href = safeLinkHref(value);
		if (!href) {
			setError("Use an https address or a mail address.");
			return;
		}
		onApply(href);
	}

	return (
		<>
			<div className="fixed inset-0 z-40" onMouseDown={onClose} aria-hidden />
			<div
				role="dialog"
				aria-label="Link"
				style={{ left: Math.max(8, link.at.x - 120), top: link.at.y }}
				className="animate-scale fixed z-50 w-[320px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onClose();
					}
				}}
			>
				<input
					ref={input}
					value={value}
					aria-label="Address"
					placeholder="https://"
					onChange={(event) => {
						setValue(event.target.value);
						setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						}
					}}
					className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--paper)] px-2 text-dense text-[var(--ink)] outline-none focus-visible:border-[var(--accent)]"
				/>
				{error ? <p className="mt-1 text-sm text-[var(--risk)]">{error}</p> : null}
				{!link.selected && !link.existing ? (
					<p className="mt-1 text-sm text-[var(--ink-muted)]">Select the words to link first.</p>
				) : null}
				<div className="mt-3 flex items-center justify-end gap-1">
					{link.existing ? (
						<>
							<button
								type="button"
								onClick={() => onOpen(link.href)}
								className="h-8 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
							>
								Open
							</button>
							<button
								type="button"
								onClick={() => onApply(null)}
								className="h-8 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
							>
								Remove
							</button>
						</>
					) : null}
					<button
						type="button"
						disabled={!link.selected && !link.existing}
						onClick={submit}
						className="h-8 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 text-dense font-[var(--weight-medium)] text-[var(--accent-ink)] disabled:opacity-40"
					>
						Apply
					</button>
				</div>
			</div>
		</>
	);
}

type ImageViewProps = { block: ImageBlock; onRemove: () => void };

/** A picture the page keeps. If the file has gone, the line says so instead of showing a broken image. */
function ImageView({ block, onRemove }: ImageViewProps) {
	const [missing, setMissing] = useState(false);
	return (
		<figure data-block={block.id} className="group/image relative py-3">
			{missing ? (
				<p className="rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] px-4 py-6 text-dense text-[var(--ink-muted)]">
					This picture is no longer on this machine.
				</p>
			) : (
				<img
					src={imageUrl(block)}
					alt={block.alt}
					onError={() => setMissing(true)}
					className="max-h-[480px] max-w-full rounded-[var(--radius-md)] border border-[var(--line)]"
				/>
			)}
			<button
				type="button"
				onClick={onRemove}
				className="absolute top-5 right-2 h-8 rounded-[var(--radius-md)] bg-[var(--surface)] px-2 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] opacity-0 shadow-[var(--shadow-popover)] transition-opacity duration-[var(--duration-fast)] group-focus-within/image:opacity-100 group-hover/image:opacity-100 hover:text-[var(--ink)]"
			>
				Remove
			</button>
		</figure>
	);
}
