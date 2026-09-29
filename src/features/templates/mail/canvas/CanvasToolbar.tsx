import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, type IconName } from "../../../../components/Icon";
import type { EditorMode } from "../EditorSidebar";
import {
	elementForKey,
	elementInfo,
	GROUPS,
	MEDIA_NOTE,
	type ElementId,
	type GroupId,
	type GroupInfo,
	type LastUsed,
} from "./elements";
import { keysFor } from "./shortcuts";
import { ShortcutList } from "./ShortcutList";

type CanvasToolbarProps = {
	/** Whether elements can be added: on the canvas, and not on a hand-written body. */
	insertable: boolean;
	/** What each group adds when its button is pressed. */
	last: LastUsed;
	/** The group whose menu is open, if any. Held by the editor, so a key can open it too. */
	menu: GroupId | null;
	onMenu: (group: GroupId | null) => void;
	onInsert: (id: ElementId) => void;
	onAddButton: () => void;
	mode: EditorMode;
	onMode: (mode: EditorMode) => void;
	/** A template without a canvas calls its first view the body. */
	hasLayout: boolean;
	inputCount: number;
	/** Whether the list of keyboard shortcuts is open over the toolbar. */
	help: boolean;
	onHelp: (open: boolean) => void;
};

const TOOL =
	"flex h-[34px] flex-none items-center justify-center text-[var(--ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus";

type ToolButtonProps = {
	label: string;
	icon: IconName;
	/** The key that does the same, shown in the tooltip. */
	keys: string | null;
	onClick: () => void;
};

/** One tool: a glyph, with its name and its key in the tooltip, and its name for a screen reader. */
function ToolButton({ label, icon, keys, onClick }: ToolButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={keys ? `${label} (${keys})` : label}
			onClick={onClick}
			className={`${TOOL} w-[34px] rounded-[var(--radius-md)]`}
		>
			<Icon name={icon} size={18} />
		</button>
	);
}

type GroupMenuProps = {
	group: GroupInfo;
	last: ElementId;
	/** Where the group's button is, so the menu opens over it. */
	anchor: { left: number; top: number };
	onPick: (id: ElementId) => void;
	onClose: (refocus: boolean) => void;
};

/**
 * A group's elements, each with its name and its key, opened over its button
 * the way Figma's frame tool opens Frame, Section and Slice.
 *
 * It is fixed to the window rather than placed in the toolbar, because the
 * toolbar scrolls sideways when it is narrow and would clip a menu that opens
 * upward out of it. Its keys are its own: an element's key adds it, the
 * arrows walk the rows, Enter presses the focused one and Escape closes. A
 * key it does not answer to goes on to the editor, so Shift and another
 * group's letter swaps to that group's menu.
 */
function GroupMenu({ group, last, anchor, onPick, onClose }: GroupMenuProps) {
	const list = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const rows = list.current?.querySelectorAll<HTMLElement>("[role=menuitem]");
		const target = [...(rows ?? [])].find((row) => row.dataset.element === last) ?? rows?.[0];
		target?.focus();
	}, [last]);

	function move(by: number | "first" | "last"): void {
		const rows = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		if (rows.length === 0) return;
		const at = rows.findIndex((row) => row === document.activeElement);
		const next = by === "first" ? 0 : by === "last" ? rows.length - 1 : (at + by + rows.length) % rows.length;
		rows[next]?.focus();
	}

	function onKeyDown(event: ReactKeyboardEvent): void {
		const picked = elementForKey(group.id, event.nativeEvent);
		if (picked) {
			event.preventDefault();
			event.stopPropagation();
			onPick(picked);
			return;
		}
		const handled = (fn: () => void) => {
			event.preventDefault();
			event.stopPropagation();
			fn();
		};
		if (event.key === "Escape") return handled(() => onClose(true));
		if (event.key === "ArrowDown") return handled(() => move(1));
		if (event.key === "ArrowUp") return handled(() => move(-1));
		if (event.key === "Home") return handled(() => move("first"));
		if (event.key === "End") return handled(() => move("last"));
		if (event.key === "Tab") onClose(false);
	}

	return (
		<div
			ref={list}
			role="menu"
			aria-label={`${group.label} menu`}
			onKeyDown={onKeyDown}
			style={{ left: anchor.left, bottom: window.innerHeight - anchor.top + 8 }}
			className="fixed z-30 w-[236px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--shadow-popover)]"
		>
			{group.elements.map((element) => (
				<button
					key={element.id}
					type="button"
					role="menuitem"
					data-element={element.id}
					onClick={() => onPick(element.id)}
					className="flex h-[32px] w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[length:var(--text-sm)] text-[var(--ink)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
				>
					<Icon name={element.icon} size={14} className="flex-none text-[var(--ink-muted)]" />
					<span className="flex-1 truncate">{element.label}</span>
					{element.tag !== element.label.toLowerCase() ? (
						<span className="flex-none font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)]">{element.tag}</span>
					) : null}
					<kbd className="w-[20px] flex-none rounded-[var(--radius-sm)] bg-[var(--sunken)] py-0.5 text-center font-[family-name:var(--font-ui)] text-[length:var(--text-micro)] text-[var(--ink-muted)]">
						{element.key}
					</kbd>
				</button>
			))}
			{group.id === "media" ? (
				<p className="mt-1 border-t border-[var(--line)] px-2 pt-2 pb-1 text-[length:var(--text-micro)] leading-[var(--leading-normal)] text-[var(--ink-muted)]">
					{MEDIA_NOTE}
				</p>
			) : null}
		</div>
	);
}

type GroupToolProps = {
	group: GroupInfo;
	last: ElementId;
	open: boolean;
	onOpen: (open: boolean) => void;
	onInsert: (id: ElementId) => void;
};

/**
 * One group: a button that adds the group's last-used element, and a chevron
 * beside it that opens the rest. The button says which element that is, in its
 * glyph, its name and its tooltip.
 */
function GroupTool({ group, last, open, onOpen, onInsert }: GroupToolProps) {
	const unit = useRef<HTMLDivElement>(null);
	const chevron = useRef<HTMLButtonElement>(null);
	const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
	const { element } = elementInfo(last);

	useLayoutEffect(() => {
		if (!open || !unit.current) return;
		const box = unit.current.getBoundingClientRect();
		setAnchor({ left: Math.max(8, Math.min(box.left, window.innerWidth - 244)), top: box.top });
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const outside = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (unit.current?.contains(target)) return;
			onOpen(false);
		};
		const resize = () => onOpen(false);
		document.addEventListener("pointerdown", outside);
		window.addEventListener("resize", resize);
		return () => {
			document.removeEventListener("pointerdown", outside);
			window.removeEventListener("resize", resize);
		};
	}, [open, onOpen]);

	return (
		<div ref={unit} className="flex flex-none items-center" data-tool-group={group.id}>
			<button
				type="button"
				aria-label={`Add ${element.label.toLowerCase()}`}
				title={`Add ${element.label.toLowerCase()} (${group.key})`}
				onClick={() => onInsert(last)}
				className={`${TOOL} w-[34px] rounded-l-[var(--radius-md)]`}
			>
				<Icon name={element.icon} size={18} />
			</button>
			<button
				ref={chevron}
				type="button"
				aria-label={`${group.label} menu`}
				title={`${group.label} (Shift+${group.key})`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => onOpen(!open)}
				className={`${TOOL} w-[20px] rounded-r-[var(--radius-md)] text-[var(--ink-muted)] ${open ? "bg-[var(--hover)]" : ""}`}
			>
				<Icon name="chevron-down" size={10} />
			</button>
			{open && anchor ? (
				<GroupMenu
					group={group}
					last={last}
					anchor={anchor}
					onPick={(id) => {
						onInsert(id);
						onOpen(false);
					}}
					onClose={(refocus) => {
						onOpen(false);
						if (refocus) chevron.current?.focus();
					}}
				/>
			) : null}
		</div>
	);
}

type ModeButtonProps = {
	label: string;
	icon: IconName;
	active: boolean;
	onClick: () => void;
	count?: number;
};

function ModeButton({ label, icon, active, onClick, count = 0 }: ModeButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={active}
			onClick={onClick}
			className={`relative flex h-[30px] w-[34px] flex-none items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
				active
					? "bg-[var(--surface)] text-[var(--accent)] shadow-[var(--shadow-popover)]"
					: "text-[var(--ink-muted)] hover:text-[var(--ink)]"
			}`}
		>
			<Icon name={icon} size={16} />
			{count > 0 ? (
				<span className="tabular absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent)] px-1 text-[length:var(--text-micro)] leading-none font-[var(--weight-semibold)] text-[var(--accent-ink)]">
					{count}
				</span>
			) : null}
		</button>
	);
}

/**
 * The toolbar that floats over the bottom of the canvas, the way Figma's does.
 *
 * On the left, the five groups of everything that can go in a message:
 * containers, text, columns, media and the rest. Each is a button that adds
 * the element it added last, with a chevron beside it that opens the group's
 * menu. Pressing one adds it inside the selected container or cell, or after
 * the selected element. On the right, in a group of their own, the four ways
 * of looking at the template, which is where Figma keeps its modes, and the
 * list of keyboard shortcuts. A code block is not a tool: any element becomes
 * one with "Convert to HTML" in the design panel.
 */
export function CanvasToolbar({
	insertable,
	last,
	menu,
	onMenu,
	onInsert,
	onAddButton,
	mode,
	onMode,
	hasLayout,
	inputCount,
	help,
	onHelp,
}: CanvasToolbarProps) {
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
			<div className="pointer-events-auto relative flex max-w-full">
				{help ? <ShortcutList onClose={() => onHelp(false)} /> : null}
				<div
					role="toolbar"
					aria-label="Canvas tools"
					className="flex max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-popover)]"
				>
					{insertable ? (
						<>
							{GROUPS.map((group) => (
								<GroupTool
									key={group.id}
									group={group}
									last={last[group.id]}
									open={menu === group.id}
									onOpen={(open) => onMenu(open ? group.id : null)}
									onInsert={onInsert}
								/>
							))}
							<ToolButton label="Add button" icon="tool-button" keys="B" onClick={onAddButton} />
							<span aria-hidden className="mx-1 h-[24px] w-px flex-none bg-[var(--line)]" />
						</>
					) : null}
					<div
						role="group"
						aria-label="View"
						className="flex flex-none items-center gap-0.5 rounded-[var(--radius-lg)] bg-[var(--sunken)] p-0.5"
					>
						<ModeButton
							label={hasLayout ? "The canvas" : "The body"}
							icon={hasLayout ? "view-canvas" : "note"}
							active={mode === "canvas"}
							onClick={() => onMode("canvas")}
						/>
						<ModeButton
							label="The message as it will be sent"
							icon="visible"
							active={mode === "preview"}
							onClick={() => onMode("preview")}
						/>
						<ModeButton label="The HTML under it" icon="view-code" active={mode === "code"} onClick={() => onMode("code")} />
						<ModeButton
							label="What this template asks for"
							icon="list"
							active={mode === "inputs"}
							onClick={() => onMode("inputs")}
							count={inputCount}
						/>
					</div>
					<button
						type="button"
						data-shortcut-toggle
						aria-label="Keyboard shortcuts"
						title={`Keyboard shortcuts (${keysFor("These shortcuts") ?? "?"})`}
						aria-expanded={help}
						onClick={() => onHelp(!help)}
						className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
							help
								? "bg-[var(--accent-soft)] text-[var(--accent)]"
								: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						}`}
					>
						<Icon name="keyboard" size={18} />
					</button>
				</div>
			</div>
		</div>
	);
}
