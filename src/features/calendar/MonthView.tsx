import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { CalendarItem, CalendarOccurrence } from "@shared/types";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { daysBetween, formatTime, weekdayShort } from "./dates";
import { chipTone, itemMenuItems, itemTitle, type Placed } from "./format";
import { useWheelPaging } from "./use-wheel-paging";

type MonthViewProps = {
	/** Forty-two dates, Monday first. */
	dates: string[];
	/** `YYYY-MM` of the month being shown; other months' days are dimmed. */
	month: string;
	today: string;
	placed: Map<string, Placed[]>;
	onOpen: (item: CalendarItem) => void;
	onCreateAt: (date: string) => void;
	onOpenDay: (date: string) => void;
	/** An event dragged onto another day. Whole days only; the time stays. */
	onMove: (item: CalendarOccurrence, dayDelta: number) => void;
	onEdit: (item: CalendarOccurrence) => void;
	onDelete: (item: CalendarOccurrence) => void;
	/** A wheel gesture past a step apart, over any part of the grid: page a month. */
	onStep: (direction: -1 | 1) => void;
};

const MAX_CHIPS = 4;

type MenuTarget = { kind: "item"; item: CalendarItem } | { kind: "cell"; date: string };

/**
 * Six rows of seven. Each cell is a hairline and a number, not a card, and an
 * event is a chip a person can drag to another day.
 */
export function MonthView({
	dates,
	month,
	today,
	placed,
	onOpen,
	onCreateAt,
	onOpenDay,
	onMove,
	onEdit,
	onDelete,
	onStep,
}: MonthViewProps) {
	const [dragging, setDragging] = useState<{ item: CalendarOccurrence; fromDate: string } | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const menu = useContextMenu();
	const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
	const page = useWheelPaging(onStep);

	// The grid has nothing of its own to scroll, so a wheel anywhere on it pages
	// the month. No preventDefault is called, so this stays a passive listener.
	useEffect(() => {
		const node = root.current;
		if (!node) return;
		function onWheel(event: WheelEvent) {
			page(event.deltaY);
		}
		node.addEventListener("wheel", onWheel, { passive: true });
		return () => node.removeEventListener("wheel", onWheel);
	}, [page]);

	function openItemMenu(event: ReactMouseEvent, item: CalendarItem) {
		setMenuTarget({ kind: "item", item });
		menu.open(event);
	}

	function openCellMenu(event: ReactMouseEvent, date: string) {
		setMenuTarget({ kind: "cell", date });
		menu.open(event);
	}

	const menuItems: MenuItem[] =
		menuTarget?.kind === "item"
			? itemMenuItems(menuTarget.item, { onOpen, onEdit, onDelete })
			: menuTarget?.kind === "cell"
				? [{ id: "new-event", label: "New event here", icon: "add", onSelect: () => onCreateAt(menuTarget.date) }]
				: [];

	function startDrag(event: DragEvent, p: Placed) {
		if (p.item.kind !== "event") return;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", p.key);
		setDragging({ item: p.item, fromDate: p.date });
	}

	function drop(event: DragEvent, date: string) {
		event.preventDefault();
		setOver(null);
		if (!dragging) return;
		const delta = daysBetween(dragging.fromDate, date);
		setDragging(null);
		if (delta !== 0) onMove(dragging.item, delta);
	}

	return (
		<div ref={root} className="flex h-full min-h-0 flex-col">
			<div className="grid grid-cols-7 border-b border-[var(--line)]">
				{dates.slice(0, 7).map((date) => (
					<div
						key={date}
						className="px-2 py-1.5 text-[length:var(--text-micro)] uppercase tracking-[0.08em] text-[var(--ink-muted)]"
					>
						{weekdayShort(date)}
					</div>
				))}
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
				{dates.map((date, index) => {
					const inMonth = date.slice(0, 7) === month;
					const isToday = date === today;
					const items = placed.get(date) ?? [];
					const overflow = items.length > MAX_CHIPS ? items.length - (MAX_CHIPS - 1) : 0;
					const visible = overflow > 0 ? items.slice(0, MAX_CHIPS - 1) : items;
					return (
						<div
							key={date}
							role="gridcell"
							aria-label={date}
							onDragOver={(event) => {
								if (!dragging) return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								if (over !== date) setOver(date);
							}}
							onDragLeave={() => {
								if (over === date) setOver(null);
							}}
							onDrop={(event) => drop(event, date)}
							onDoubleClick={(event) => {
								if (event.target === event.currentTarget) onCreateAt(date);
							}}
							onContextMenu={(event) => {
								if (event.target === event.currentTarget) openCellMenu(event, date);
							}}
							className={[
								"group flex min-h-0 flex-col border-b border-[var(--line)] px-1 pb-1 pt-1",
								index % 7 !== 0 ? "border-l" : "",
								over === date ? "bg-[var(--accent-soft)]" : inMonth ? "" : "bg-[var(--sunken)]/60",
							].join(" ")}
						>
							<div className="mb-0.5 flex items-center justify-between px-1">
								<button
									type="button"
									onClick={() => onOpenDay(date)}
									aria-label={`Open ${date}`}
									className={[
										"tabular inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-full)] px-1 text-[length:var(--text-dense)]",
										isToday
											? "bg-[var(--accent)] font-[var(--weight-medium)] text-[var(--accent-ink)]"
											: inMonth
												? "text-[var(--ink)] hover:bg-[var(--hover)]"
												: "text-[var(--ink-muted)] hover:bg-[var(--hover)]",
									].join(" ")}
								>
									{Number(date.slice(8, 10))}
								</button>
								<button
									type="button"
									onClick={() => onCreateAt(date)}
									aria-label={`New event on ${date}`}
									className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-faint)] opacity-0 hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100"
								>
									+
								</button>
							</div>

							<div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
								{visible.map((p) => (
									<Chip
										key={p.key}
										placed={p}
										onOpen={onOpen}
										onDragStart={startDrag}
										onDragEnd={() => setDragging(null)}
										onContextMenu={openItemMenu}
									/>
								))}
								{overflow > 0 ? (
									<button
										type="button"
										onClick={() => onOpenDay(date)}
										className="tabular truncate rounded-[var(--radius-sm)] px-1.5 text-left text-[length:var(--text-micro)] text-[var(--ink-muted)] hover:bg-[var(--hover)]"
									>
										{overflow} more
									</button>
								) : null}
							</div>
						</div>
					);
				})}
			</div>

			{menu.at && menuTarget ? (
				<ContextMenu
					at={menu.at}
					items={menuItems}
					ariaLabel={menuTarget.kind === "item" ? "Event" : "Day"}
					onClose={() => {
						menu.close();
						setMenuTarget(null);
					}}
				/>
			) : null}
		</div>
	);
}

type ChipProps = {
	placed: Placed;
	onOpen: (item: CalendarItem) => void;
	onDragStart: (event: DragEvent, placed: Placed) => void;
	onDragEnd: () => void;
	onContextMenu: (event: ReactMouseEvent, item: CalendarItem) => void;
};

function Chip({ placed, onOpen, onDragStart, onDragEnd, onContextMenu }: ChipProps) {
	const { item } = placed;
	const draggable = item.kind === "event";
	const time = item.kind === "event" && !item.allDay && !placed.continued ? formatTime(item.startUtc) : null;
	return (
		<button
			type="button"
			draggable={draggable}
			onDragStart={(event) => onDragStart(event, placed)}
			onDragEnd={onDragEnd}
			onClick={() => onOpen(item)}
			onContextMenu={(event) => onContextMenu(event, item)}
			title={itemTitle(item)}
			className={[
				"flex h-5 w-full min-w-0 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-left text-[length:var(--text-micro)] font-[var(--weight-medium)] leading-none",
				chipTone(item),
				placed.continued ? "rounded-l-none" : "",
				placed.continues ? "rounded-r-none" : "",
				draggable ? "cursor-grab" : "",
			].join(" ")}
		>
			{time ? <span className="tabular shrink-0 opacity-80">{time}</span> : null}
			<span className="truncate">{itemTitle(item)}</span>
		</button>
	);
}
