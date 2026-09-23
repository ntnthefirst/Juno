import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

/**
 * One choice in a menu.
 *
 * `onSelect` runs after the menu has closed, so a handler that opens a dialog
 * or moves focus is not fighting the menu's own focus restore on the way out.
 */
export type MenuItem = {
	id: string;
	label: string;
	onSelect: () => void;
	icon?: IconName;
	disabled?: boolean;
	/** Drawn in --risk. Delete, remove, discard. */
	danger?: boolean;
	/** A hairline above this item, for grouping. Ignored on the first item. */
	separatorBefore?: boolean;
	/** Right-aligned and dim: a shortcut, a count, a state. Under 12 characters. */
	hint?: string;
};

type Point = { x: number; y: number };

const MARGIN = 8;
const MIN_WIDTH = 200;

type SurfaceProps = {
	at: Point;
	items: MenuItem[];
	onClose: () => void;
	ariaLabel: string;
	/**
	 * Which corner of the menu sits at `at`. A menu hung off a button aligns its
	 * right edge with the button's, so a control at the right end of a row opens
	 * inwards rather than off the edge.
	 */
	anchor?: "top-left" | "top-right";
	/** Kept at least this wide, so a menu under a wide button does not shrink. */
	minWidth?: number;
};

/**
 * The floating list itself, portalled to the body.
 *
 * Shared by the button menu and the right-click menu, because the only thing
 * that differs between them is where the corner goes. Everything a person
 * expects from a menu, keyboard included, is written here once.
 */
function MenuSurface({ at, items, onClose, ariaLabel, anchor = "top-left", minWidth }: SurfaceProps) {
	const surface = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
	const [active, setActive] = useState(-1);

	// Measured after the first paint, because where a menu fits depends on how
	// tall it turned out to be. Hidden until then rather than drawn at a guessed
	// position, which flickers across the screen on every open.
	useLayoutEffect(() => {
		const node = surface.current;
		if (!node) return;
		const { width, height } = node.getBoundingClientRect();
		const room = { w: window.innerWidth, h: window.innerHeight };

		let left = anchor === "top-right" ? at.x - width : at.x;
		let top = at.y;

		if (left + width > room.w - MARGIN) left = room.w - MARGIN - width;
		if (left < MARGIN) left = MARGIN;
		// Not enough room below: hang it above the point instead, which is what a
		// menu opened near the bottom of a list has to do to stay readable.
		if (top + height > room.h - MARGIN) {
			top = height + MARGIN < at.y ? at.y - height : Math.max(MARGIN, room.h - MARGIN - height);
		}

		setPosition({ left, top });
	}, [at.x, at.y, anchor]);

	// Anything that moves the menu away from what it is anchored to closes it,
	// rather than leaving it floating over unrelated content.
	useEffect(() => {
		const close = () => onClose();
		window.addEventListener("resize", close);
		document.addEventListener("scroll", close, true);
		return () => {
			window.removeEventListener("resize", close);
			document.removeEventListener("scroll", close, true);
		};
	}, [onClose]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key === "Tab") {
				onClose();
				return;
			}

			const order = items
				.map((item, index) => ({ item, index }))
				.filter((entry) => !entry.item.disabled);
			if (order.length === 0) return;

			const step = (delta: number) => {
				event.preventDefault();
				setActive((current) => {
					const here = order.findIndex((entry) => entry.index === current);
					const next =
						here === -1
							? delta > 0
								? 0
								: order.length - 1
							: (here + delta + order.length) % order.length;
					return order[next]?.index ?? -1;
				});
			};

			if (event.key === "ArrowDown") step(1);
			else if (event.key === "ArrowUp") step(-1);
			else if (event.key === "Home") {
				event.preventDefault();
				setActive(order[0]?.index ?? -1);
			} else if (event.key === "End") {
				event.preventDefault();
				setActive(order[order.length - 1]?.index ?? -1);
			} else if (event.key === "Enter" || event.key === " ") {
				const item = items[active];
				if (item && !item.disabled) {
					event.preventDefault();
					onClose();
					item.onSelect();
				}
			}
		}

		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [items, active, onClose]);

	// Focus follows the active item rather than only a highlight, so a screen
	// reader says the item as well as the menu drawing it.
	useEffect(() => {
		if (active < 0) return;
		surface.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
	}, [active]);

	return createPortal(
		<>
			{/* Catches the click that dismisses the menu before it lands on
			    whatever is underneath. Clicking a row behind an open menu should
			    close the menu and do nothing else. */}
			<div
				className="fixed inset-0 z-[60]"
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}}
				onContextMenu={(event) => {
					event.preventDefault();
					onClose();
				}}
			/>
			<div
				ref={surface}
				role="menu"
				aria-label={ariaLabel}
				className="fixed z-[61] flex flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] py-1"
				style={{
					left: position?.left ?? 0,
					top: position?.top ?? 0,
					minWidth: Math.max(minWidth ?? 0, MIN_WIDTH),
					maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
					boxShadow: "var(--shadow-popover)",
					visibility: position ? "visible" : "hidden",
				}}
			>
				{items.map((item, index) => (
					<div key={item.id} className="contents">
						{item.separatorBefore && index > 0 ? (
							<div role="separator" className="my-1 h-px bg-[var(--line)]" />
						) : null}
						<button
							type="button"
							role="menuitem"
							data-index={index}
							disabled={item.disabled}
							tabIndex={-1}
							onMouseEnter={() => setActive(index)}
							onClick={() => {
								onClose();
								item.onSelect();
							}}
							style={{ height: "var(--row-height)" }}
							className={[
								"flex w-full shrink-0 items-center gap-2.5 px-3 text-left text-[length:var(--text-dense)]",
								"focus:outline-none disabled:pointer-events-none disabled:opacity-40",
								item.danger
									? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
									: "text-[var(--ink)] hover:bg-[var(--hover)]",
								active === index
									? item.danger
										? "bg-[var(--risk-soft)]"
										: "bg-[var(--hover)]"
									: "",
							].join(" ")}
						>
							{item.icon ? (
								<Icon name={item.icon} className={item.danger ? "" : "text-[var(--ink-muted)]"} />
							) : (
								<span className="w-4 shrink-0" aria-hidden />
							)}
							<span className="min-w-0 flex-1 truncate">{item.label}</span>
							{item.hint ? (
								<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-faint)]">
									{item.hint}
								</span>
							) : null}
						</button>
					</div>
				))}
			</div>
		</>,
		document.body,
	);
}

type MenuButtonProps = {
	items: MenuItem[];
	/** Spoken name. Required, because most of these buttons are a glyph alone. */
	ariaLabel: string;
	/** Drawn beside the glyph. Left out for the three-dots button. */
	label?: string;
	icon?: IconName;
	title?: string;
	disabled?: boolean;
	/** dense sits inside a row, base stands on its own. Both clear the target. */
	size?: "base" | "dense";
};

/**
 * A button that opens a menu under itself.
 *
 * This is the shape for "everything else you can do here": the three dots on a
 * record, the overflow on a toolbar. It keeps a row down to the one or two
 * actions worth a button of their own, which is the point of having it.
 */
export function MenuButton({
	items,
	ariaLabel,
	label,
	icon = "more",
	title,
	disabled,
	size = "dense",
}: MenuButtonProps) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [at, setAt] = useState<Point | null>(null);

	const close = useCallback(() => {
		setAt(null);
		trigger.current?.focus();
	}, []);

	function open() {
		const box = trigger.current?.getBoundingClientRect();
		if (!box) return;
		setAt({ x: box.right, y: box.bottom + 4 });
	}

	const metrics =
		size === "dense"
			? label
				? "h-[32px] px-2 text-[length:var(--text-dense)]"
				: "h-[32px] w-[32px]"
			: label
				? "h-[40px] px-4 text-[length:var(--text-base)]"
				: "h-[40px] w-[40px]";

	return (
		<>
			<button
				ref={trigger}
				type="button"
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={at !== null}
				title={title ?? ariaLabel}
				disabled={disabled}
				onClick={() => (at ? close() : open())}
				className={[
					"inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)]",
					"font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
					"disabled:pointer-events-none disabled:opacity-50",
					metrics,
					at !== null
						? "bg-[var(--hover)] text-[var(--ink)]"
						: "text-[var(--ink)] hover:bg-[var(--hover)]",
				].join(" ")}
			>
				<Icon name={icon} />
				{label ? <span>{label}</span> : null}
			</button>
			{at ? (
				<MenuSurface at={at} items={items} onClose={close} ariaLabel={ariaLabel} anchor="top-right" />
			) : null}
		</>
	);
}

/**
 * The right-click menu state for one surface.
 *
 * Electron draws no menu of its own on right click, so without this a right
 * click anywhere in Juno does nothing at all, which reads as a broken window
 * rather than as a deliberate omission.
 */
export function useContextMenu() {
	const [at, setAt] = useState<Point | null>(null);

	const open = useCallback((event: ReactMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		// The keyboard menu key fires this with no coordinates. Hanging the menu
		// off the focused element is what a platform menu does in that case.
		if (event.clientX === 0 && event.clientY === 0 && event.currentTarget instanceof HTMLElement) {
			const box = event.currentTarget.getBoundingClientRect();
			setAt({ x: box.left + 8, y: box.top + box.height });
			return;
		}
		setAt({ x: event.clientX, y: event.clientY });
	}, []);

	const close = useCallback(() => setAt(null), []);

	return { at, open, close };
}

type ContextMenuProps = {
	at: Point;
	items: MenuItem[];
	onClose: () => void;
	ariaLabel: string;
};

export function ContextMenu({ at, items, onClose, ariaLabel }: ContextMenuProps) {
	return <MenuSurface at={at} items={items} onClose={onClose} ariaLabel={ariaLabel} />;
}
