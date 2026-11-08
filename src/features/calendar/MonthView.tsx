import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { CalendarItem, CalendarReminderItem } from "@shared/types";
import { Icon } from "../../components/Icon";
import { blankMenuFor } from "../../lib/blank-menu";
import { daysBetween, formatTime, weekdayShort } from "./dates";
import { chipTone, itemTitle, openItemMenu as openChipMenu, type Placed } from "./format";
import { useWheelPaging } from "./use-wheel-paging";
import { PageSlide } from "./PageSlide";

type MonthViewProps = {
	/** Forty-two dates, Monday first. */
	dates: string[];
	/** `YYYY-MM` of the month being shown; other months' days are dimmed. */
	month: string;
	today: string;
	placed: Map<string, Placed[]>;
	onOpen: (item: CalendarItem) => void;
	onCreateAt: (date: string) => void;
	onCreateReminderAt: (date: string) => void;
	onOpenDay: (date: string) => void;
	/** An item dragged onto another day. Whole days only; an event keeps its time. */
	onMove: (item: CalendarItem, dayDelta: number) => void;
	onEdit: (item: CalendarItem) => void;
	onDelete: (item: CalendarItem) => void;
	onComplete: (item: CalendarReminderItem) => void;
	onSnooze: (item: CalendarReminderItem) => void;
	onChanged: () => void;
	/** A wheel gesture past a step apart, over any part of the grid: page a month. */
	onStep: (direction: -1 | 1) => void;
	/** Which way the last step went, so the new month comes up from below or down from above. */
	direction: -1 | 1;
};

/**
 * The day cell as the design draws it (Day Cell, 20:501): 8px above the number,
 * a 26px number, 4px, then chips 24px high with 4px between, and 6px below.
 * How many chips fit is worked out from the height the grid was given, so a
 * short window shows "+N more" sooner instead of clipping a chip in half.
 */
const CELL_TOP = 8 + 26 + 4;
const CELL_BOTTOM = 6;
const CHIP_HEIGHT = 24;
const CHIP_GAP = 4;
const ROWS = 6;

function chipsThatFit(cellHeight: number): number {
	const room = cellHeight - CELL_TOP - CELL_BOTTOM;
	return Math.max(1, Math.floor((room + CHIP_GAP) / (CHIP_HEIGHT + CHIP_GAP)));
}

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
	onCreateReminderAt,
	onOpenDay,
	onMove,
	onEdit,
	onDelete,
	onComplete,
	onSnooze,
	onChanged,
	onStep,
	direction,
}: MonthViewProps) {
	const [dragging, setDragging] = useState<{ item: CalendarItem; fromDate: string } | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState(3);
	const page = useWheelPaging(onStep);

	// The six rows share the height equally, so one measurement covers every cell.
	// The grid is drawn afresh for each month, so it is watched afresh too.
	useLayoutEffect(() => {
		const node = grid.current;
		if (!node) return;
		const measure = () => setFit(chipsThatFit(node.clientHeight / ROWS));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [month]);

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
		openChipMenu(event, item, { onOpen, onEdit, onDelete, onComplete, onSnooze, onChanged });
	}

	function startDrag(event: DragEvent, p: Placed) {
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
			<div className="grid h-10 flex-none grid-cols-7 border-b border-[var(--line)]">
				{dates.slice(0, 7).map((date) => (
					<div key={date} className="flex items-center px-3 text-overline uppercase text-[var(--ink-muted)]">
						{weekdayShort(date)}
					</div>
				))}
			</div>

			<PageSlide pageKey={month} axis="y" direction={direction} className="min-h-0 flex-1">
			<div ref={grid} key={month} className="grid h-full grid-cols-7 grid-rows-6">
				{dates.map((date, index) => {
					const inMonth = date.slice(0, 7) === month;
					const isToday = date === today;
					const items = placed.get(date) ?? [];
					const overflow = items.length > fit ? items.length - (fit - 1) : 0;
					const visible = overflow > 0 ? items.slice(0, fit - 1) : items;
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
								if (event.target !== event.currentTarget) return;
								// A day knows where it was clicked, so these two start on that date.
								blankMenuFor("calendar", {
									"new-event": () => onCreateAt(date),
									"new-reminder": () => onCreateReminderAt(date),
								})(event);
							}}
							className={[
								"group flex min-h-0 flex-col gap-1 px-1.5 pb-1.5 pt-2",
								index % 7 !== 6 ? "border-r border-[var(--line)]" : "",
								index < 35 ? "border-b border-[var(--line)]" : "",
								over === date ? "bg-[var(--accent-soft)]" : inMonth ? "" : "bg-[var(--shade)]",
							].join(" ")}
						>
							<div className="flex flex-none items-center justify-between">
								<button
									type="button"
									onClick={() => onOpenDay(date)}
									aria-label={`Open ${date}`}
									className={[
										"tabular inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[var(--radius-full)] text-base",
										isToday
											? "bg-[var(--accent)] text-[var(--accent-ink)]"
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
									className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--hover)] text-[var(--ink-muted)] opacity-0 transition-[opacity,color] duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100"
								>
									<Icon name="add" size={14} strokeWidth={2} />
								</button>
							</div>

							<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
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
										className="tabular h-6 shrink-0 truncate rounded-[var(--radius-sm)] px-2 text-left text-dense text-[var(--ink-muted)] hover:bg-[var(--hover)]"
									>
										{overflow} more
									</button>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
			</PageSlide>

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
	const draggable = true;
	const time = item.kind === "event" && !item.allDay && !placed.continued ? formatTime(item.startUtc) : null;
	return (
		<button
			type="button"
			draggable={draggable}
			data-opens-panel
			onDragStart={(event) => onDragStart(event, placed)}
			onDragEnd={onDragEnd}
			onClick={() => onOpen(item)}
			onContextMenu={(event) => onContextMenu(event, item)}
			title={itemTitle(item)}
			className={[
				"flex h-6 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-left text-dense",
				chipTone(item),
				placed.continued ? "rounded-l-none" : "",
				placed.continues ? "rounded-r-none" : "",
				draggable ? "cursor-grab" : "",
			].join(" ")}
		>
			{time ? <span className="tabular shrink-0">{time}</span> : null}
			<span className="truncate">{itemTitle(item)}</span>
		</button>
	);
}
