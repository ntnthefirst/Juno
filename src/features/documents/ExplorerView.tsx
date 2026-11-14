import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { useClickGate } from "../../lib/click-timing";
import { listCommandFor, stepFor, type ListCommand } from "../../lib/list-keys";
import {
	clickSelection,
	moveSelection,
	selectEverything,
	selectOnly,
	type ListSelection,
} from "../../lib/list-selection";
import { stagger } from "../../lib/motion";
import { DRAG_TYPE, encodeDrag, type DragPayload } from "./drop-routing";
import type { ExplorerItem, ExplorerSort, SortColumn, WhereColumn } from "./explorer-items";
import { ExplorerRow } from "./ExplorerRow";
import { ExplorerTile } from "./ExplorerTile";

type ExplorerViewProps = {
	/** In the order they are drawn, which is the order the keys and a Shift run go by. */
	items: ExplorerItem[];
	view: "list" | "grid";
	selection: ListSelection;
	onSelection: (next: ListSelection) => void;
	statusLabels: ReadonlyMap<string, string>;
	/** Null for a list in an order of its own, such as search results by relevance. */
	sort: ExplorerSort | null;
	onSort?: (by: SortColumn) => void;
	/**
	 * Adds a column after the name: where each document is kept, for results
	 * from everywhere, or which project, for a client's documents.
	 */
	whereColumn?: WhereColumn | null;
	renamingKey: string | null;
	onRename: (item: ExplorerItem, name: string) => void;
	onRenameEnd: () => void;
	cutKeys: ReadonlySet<string>;
	/** A single click or Space previews; a double click or Enter opens. */
	onActivate: (item: ExplorerItem, how: "preview" | "open") => void;
	/** Every list key the list does not answer itself: rename, delete, copy and the rest. */
	onCommand: (command: ListCommand) => void;
	onItemMenu: (item: ExplorerItem, event: MouseEvent) => void;
	onBlankMenu?: (event: MouseEvent) => void;
	/** What dragging this row carries. Null for a row that cannot be dragged. */
	dragOf: (item: ExplorerItem) => DragPayload | null;
	/**
	 * Takes the drag over as the platform's, carrying the files themselves, so
	 * they can be let go of outside Juno. True when it did; the row's own drag
	 * is then not started.
	 */
	onDragOut?: (item: ExplorerItem, event: DragEvent) => boolean;
	/** Whether this row is a folder something can be dropped on. */
	canDropOn: (item: ExplorerItem) => boolean;
	onDropOn: (item: ExplorerItem, event: DragEvent) => void;
	/** The list's accessible name. */
	label: string;
	empty: ReactNode;
};

/** The columns of the list: name, (where or project), type, size, modified, status, versions. */
function columnsFor(showWhere: boolean): string {
	return showWhere
		? "minmax(0,1fr) minmax(0,200px) 112px 76px 136px 104px 56px"
		: "minmax(0,1fr) 128px 84px 148px 112px 64px";
}

/** The tiles that read their picture straight away rather than when they first scroll near: what fills a screen. */
const EAGER_TILES = 24;

const HEADERS: { label: string; column: SortColumn | null; align?: "right" }[] = [
	{ label: "Name", column: "name" },
	{ label: "Type", column: "type" },
	{ label: "Size", column: "size", align: "right" },
	{ label: "Modified", column: "modified" },
	{ label: "Status", column: null },
	{ label: "Versions", column: null, align: "right" },
];

/** A drag counts as ours, or as files from outside, by the types it declares. */
function carriesSomething(event: DragEvent): boolean {
	const types = Array.from(event.dataTransfer.types);
	return types.includes(DRAG_TYPE) || types.includes("Files");
}

/**
 * The content of a folder, as a dense list or a grid of tiles, behaving like
 * the file manager it stands in for: a click selects and, held for a moment
 * so a double click is not mistaken for it, previews; a double click opens;
 * Ctrl and Shift select without opening. The keys work while the list has
 * the focus: arrows move, Space previews, Enter opens, and the rest are
 * handed to the screen.
 *
 * One row has the tab stop at a time (the focused one, or the first), so Tab
 * goes into the list once and out of it once.
 */
export function ExplorerView({
	items,
	view,
	selection,
	onSelection,
	statusLabels,
	sort,
	onSort,
	whereColumn = null,
	renamingKey,
	onRename,
	onRenameEnd,
	cutKeys,
	onActivate,
	onCommand,
	onItemMenu,
	onBlankMenu,
	dragOf,
	onDragOut,
	canDropOn,
	onDropOn,
	label,
	empty,
}: ExplorerViewProps) {
	const container = useRef<HTMLDivElement>(null);
	const buttons = useRef(new Map<string, HTMLElement>());
	const [columns, setColumns] = useState(1);
	const [dropKey, setDropKey] = useState<string | null>(null);
	// Set by a key that moved the focus, so the row it landed on takes the
	// browser's focus too; a click already put it there.
	const moved = useRef(false);

	const keys = useMemo(() => items.map((item) => item.key), [items]);
	const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
	const held = useMemo(() => new Set(selection.selected), [selection.selected]);
	const stop = selection.focus !== null && byKey.has(selection.focus) ? selection.focus : (keys[0] ?? null);

	const gate = useClickGate<string>({
		single: (key) => {
			const item = byKey.get(key);
			if (item) onActivate(item, "preview");
		},
		double: (key) => {
			const item = byKey.get(key);
			if (item) onActivate(item, "open");
		},
	});

	// How many tiles fit across, for the arrow keys in the grid: the tiles on
	// the first row are the ones level with the first.
	useLayoutEffect(() => {
		const element = container.current;
		if (!element || view !== "grid") return;
		const measure = () => {
			const tiles = Array.from(element.querySelectorAll<HTMLElement>("[data-explorer-item]"));
			const first = tiles[0];
			if (!first) return setColumns(1);
			const top = first.offsetTop;
			setColumns(Math.max(1, tiles.filter((tile) => tile.offsetTop === top).length));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [view, items]);

	useEffect(() => {
		if (!moved.current || !selection.focus) return;
		moved.current = false;
		const element = buttons.current.get(selection.focus);
		element?.focus({ preventScroll: true });
		element?.scrollIntoView({ block: "nearest" });
	}, [selection.focus]);

	const register = useCallback((key: string) => (element: HTMLElement | null) => {
		if (element) buttons.current.set(key, element);
		else buttons.current.delete(key);
	}, []);

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (renamingKey !== null) return;
		const command = listCommandFor(event.nativeEvent);
		if (!command) return;
		const focused = stop ? byKey.get(stop) : undefined;
		switch (command.kind) {
			case "move": {
				const across = view === "grid" ? columns : 1;
				const step = command.by === "first" || command.by === "last" ? command.by : stepFor(command.by, across);
				if (step === 0) return;
				event.preventDefault();
				moved.current = true;
				onSelection(moveSelection(selection, keys, step, command.extend));
				return;
			}
			case "select-all":
				event.preventDefault();
				onSelection(selectEverything(selection, keys));
				return;
			case "clear":
				if (selection.selected.length === 0) return;
				event.preventDefault();
				onSelection({ ...selection, selected: [] });
				return;
			case "preview":
			case "open":
				if (!focused) return;
				event.preventDefault();
				gate.cancel();
				if (!held.has(focused.key)) onSelection(selectOnly(focused.key));
				onActivate(focused, command.kind);
				return;
			default:
				event.preventDefault();
				onCommand(command);
		}
	}

	function bindFor(item: ExplorerItem) {
		const drag = renamingKey === item.key ? null : dragOf(item);
		const droppable = canDropOn(item);
		return {
			ref: register(item.key),
			role: "option",
			"aria-selected": held.has(item.key),
			tabIndex: item.key === stop ? 0 : -1,
			"data-explorer-item": item.key,
			draggable: drag !== null,
			onClick: (event: MouseEvent<HTMLElement>) => {
				const toggle = event.ctrlKey || event.metaKey;
				if (toggle || event.shiftKey) {
					gate.cancel();
					onSelection(clickSelection(selection, keys, item.key, { toggle, range: event.shiftKey }));
					return;
				}
				onSelection(selectOnly(item.key));
				gate.click(item.key, event.detail);
			},
			onContextMenu: (event: MouseEvent<HTMLElement>) => {
				gate.cancel();
				if (!held.has(item.key)) onSelection(selectOnly(item.key));
				onItemMenu(item, event);
			},
			onDragStart: (event: DragEvent<HTMLElement>) => {
				if (!drag) return;
				gate.cancel();
				if (onDragOut?.(item, event)) return;
				event.dataTransfer.setData(DRAG_TYPE, encodeDrag(drag));
				event.dataTransfer.effectAllowed = "move";
			},
			...(droppable
				? {
						onDragOver: (event: DragEvent<HTMLElement>) => {
							if (!carriesSomething(event)) return;
							event.preventDefault();
							event.stopPropagation();
							event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes("Files") ? "copy" : "move";
							setDropKey(item.key);
						},
						onDragLeave: (event: DragEvent<HTMLElement>) => {
							if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
							setDropKey((current) => (current === item.key ? null : current));
						},
						onDrop: (event: DragEvent<HTMLElement>) => {
							if (!carriesSomething(event)) return;
							event.preventDefault();
							event.stopPropagation();
							setDropKey(null);
							onDropOn(item, event);
						},
					}
				: {}),
		};
	}

	if (items.length === 0) {
		return (
			<div className="h-full" onContextMenu={onBlankMenu}>
				{empty}
			</div>
		);
	}

	const grid = columnsFor(whereColumn !== null);
	const headers = whereColumn
		? [HEADERS[0]!, { label: whereColumn === "project" ? "Project" : "Where", column: null }, ...HEADERS.slice(1)]
		: HEADERS;

	const listbox = {
		ref: container,
		role: "listbox",
		"aria-label": label,
		"aria-multiselectable": true,
		onKeyDown,
	} as const;

	return (
		<div
			onMouseDown={(event) => {
				// A press on the empty space between rows lets the selection go.
				if (event.button === 0 && !(event.target as Element).closest("[data-explorer-item], button")) {
					onSelection({ ...selection, selected: [] });
				}
			}}
			onContextMenu={(event) => {
				if ((event.target as Element).closest("[data-explorer-item]")) return;
				onBlankMenu?.(event);
			}}
			className="min-h-full pb-10"
		>
			{view === "list" ? (
				<>
					{/* Outside the listbox, so the sort buttons are reachable with Tab and the list holds only its options. */}
					<div
						style={{ gridTemplateColumns: grid }}
						// px-4 is the rows' own inset (px-1 around them, px-3 inside each), so a header sits over its column.
						className="sticky top-0 z-10 grid h-[32px] items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--ink-muted)]"
					>
						{headers.map((header) =>
							header.column && sort && onSort ? (
								<button
									key={header.label}
									type="button"
									onClick={() => onSort(header.column!)}
									aria-label={
										sort.by === header.column
											? `Sorted by ${header.label.toLowerCase()}, ${sort.descending ? "descending" : "ascending"}. Sort the other way`
											: `Sort by ${header.label.toLowerCase()}`
									}
									className={`flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${header.align === "right" ? "justify-end" : ""} ${sort.by === header.column ? "text-[var(--ink)]" : ""}`}
								>
									<span className="truncate">{header.label}</span>
									{sort.by === header.column ? (
										<Icon name="chevron-down" size={12} className={sort.descending ? "" : "rotate-180"} />
									) : null}
								</button>
							) : (
								<span key={header.label} className={`truncate ${header.align === "right" ? "text-right" : ""}`}>
									{header.label}
								</span>
							),
						)}
					</div>
					<div {...listbox} aria-orientation="vertical" className="animate-fade flex flex-col gap-px px-1 pt-1">
						{items.map((item) => (
							<ExplorerRow
								key={item.key}
								item={item}
								bind={bindFor(item)}
								columns={grid}
								selected={held.has(item.key)}
								cut={cutKeys.has(item.key)}
								dropping={dropKey === item.key}
								renaming={renamingKey === item.key}
								onRename={(name) => onRename(item, name)}
								onRenameEnd={onRenameEnd}
								statusLabels={statusLabels}
								whereColumn={whereColumn}
							/>
						))}
					</div>
				</>
			) : (
				<div {...listbox} className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3">
					{items.map((item, index) => (
						<ExplorerTile
							key={item.key}
							item={item}
							bind={bindFor(item)}
							selected={held.has(item.key)}
							cut={cutKeys.has(item.key)}
							dropping={dropKey === item.key}
							renaming={renamingKey === item.key}
							onRename={(name) => onRename(item, name)}
							onRenameEnd={onRenameEnd}
							statusLabels={statusLabels}
							showProject={whereColumn === "project"}
							style={stagger(index)}
							eager={index < EAGER_TILES}
						/>
					))}
				</div>
			)}
		</div>
	);
}
