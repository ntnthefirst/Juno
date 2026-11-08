import {
	useEffect,
	useRef,
	useState,
	type MouseEvent,
	type PointerEvent,
} from "react";
import type { CalendarItem, CalendarOccurrence, CalendarReminderItem } from "@shared/types";
import { formatMinutes, snap, weekdayShort } from "./dates";
import { chipTone, dotTone, openItemMenu as openChipMenu, itemTitle, laneLayout, type Placed } from "./format";
import { useWheelPaging } from "./use-wheel-paging";
import { PageSlide } from "./PageSlide";

type WeekViewProps = {
	/** Seven dates, Monday first. */
	dates: string[];
	today: string;
	placed: Map<string, Placed[]>;
	/** Minutes since midnight, for the current-time line. Null when today is not shown. */
	nowMinute: number | null;
	onOpen: (item: CalendarItem) => void;
	onCreateAt: (date: string, minute: number | null) => void;
	/** Dragged to another slot: whole days and minutes, both possibly zero. */
	onMove: (item: CalendarOccurrence, dayDelta: number, minuteDelta: number) => void;
	/** Bottom edge dragged: the end moves by this many minutes. */
	onResize: (item: CalendarOccurrence, minuteDelta: number) => void;
	onEdit: (item: CalendarItem) => void;
	onDelete: (item: CalendarItem) => void;
	onComplete: (item: CalendarReminderItem) => void;
	onSnooze: (item: CalendarReminderItem) => void;
	onChanged: () => void;
	/** A wheel gesture over the header, the all-day row or an edge: page a week. */
	onStep: (direction: -1 | 1) => void;
	/** Which way the last step went, so the new week slides in from that side. */
	direction: -1 | 1;
};

/** An hour is 56px tall, as the Week frame draws it (26:1026). */
const HOUR_PX = 56;
const SNAP = 15;
const MIN_PX = 20;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type Drag = {
	key: string;
	item: CalendarOccurrence;
	mode: "move" | "resize";
	originX: number;
	originY: number;
	dayDelta: number;
	minuteDelta: number;
	moved: boolean;
};

/**
 * Seven day columns over a 24-hour scale. Timed events are drawn by their
 * instants in the machine's zone; a drag reports whole days and quarter hours
 * and the screen turns that into a wall-clock edit on the event's own zone.
 */
export function WeekView({
	dates,
	today,
	placed,
	nowMinute,
	onOpen,
	onCreateAt,
	onMove,
	onResize,
	onEdit,
	onDelete,
	onComplete,
	onSnooze,
	onChanged,
	onStep,
	direction,
}: WeekViewProps) {
	const root = useRef<HTMLDivElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	// The empty half hour under the pointer, drawn as the slot a click would fill.
	const [ghost, setGhost] = useState<{ date: string; minute: number } | null>(null);
	const page = useWheelPaging(onStep);

	// Open on the working day, not on midnight.
	useEffect(() => {
		const node = scroller.current;
		if (node) node.scrollTop = 7 * HOUR_PX - 12;
	}, []);

	// Wheeling over the header, the all-day row or the hour gutter pages the
	// week. Wheeling inside the hour grid scrolls the hours first, and only
	// pages once that scroller is already against its top or bottom.
	//
	// Both decisions are made in this one native listener rather than in a
	// second handler on the scroller itself. React dispatches onWheel from its
	// own root container, which is above this node, so every native listener on
	// the way up has already run by the time a React handler could call
	// stopPropagation. A guard written that way looks right and pages the week
	// while the hours are still scrolling.
	//
	// Nothing calls preventDefault, so this stays passive.
	useEffect(() => {
		const node = root.current;
		if (!node) return;
		function onWheel(event: WheelEvent) {
			// A sideways swipe pages the week, wherever it is made.
			if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
				page(event.deltaX);
				return;
			}
			const hours = scroller.current;
			if (hours && event.target instanceof Node && hours.contains(event.target)) {
				const atTop = hours.scrollTop <= 0;
				const atBottom = hours.scrollTop + hours.clientHeight >= hours.scrollHeight - 1;
				const pastTheEdge = (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
				if (!pastTheEdge) return;
			}
			page(event.deltaY);
		}
		node.addEventListener("wheel", onWheel, { passive: true });
		return () => node.removeEventListener("wheel", onWheel);
	}, [page]);

	function openItemMenu(event: MouseEvent<HTMLElement>, item: CalendarItem) {
		openChipMenu(event, item, { onOpen, onEdit, onDelete, onComplete, onSnooze, onChanged });
	}

	function columnWidth(): number {
		const node = grid.current;
		return node ? node.getBoundingClientRect().width / 7 : 1;
	}

	function beginDrag(event: PointerEvent<HTMLElement>, p: Placed, mode: Drag["mode"]) {
		if (p.item.kind !== "event" || event.button !== 0) return;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrag({ key: p.key, item: p.item, mode, originX: event.clientX, originY: event.clientY, dayDelta: 0, minuteDelta: 0, moved: false });
	}

	function trackDrag(event: PointerEvent<HTMLElement>) {
		if (!drag) return;
		const dx = event.clientX - drag.originX;
		const dy = event.clientY - drag.originY;
		const dayDelta = drag.mode === "move" ? Math.round(dx / columnWidth()) : 0;
		const minuteDelta = snap((dy / HOUR_PX) * 60, SNAP);
		if (dayDelta === drag.dayDelta && minuteDelta === drag.minuteDelta) return;
		setDrag({ ...drag, dayDelta, minuteDelta, moved: true });
	}

	function endDrag(event: PointerEvent<HTMLElement>) {
		if (!drag) return;
		event.currentTarget.releasePointerCapture(event.pointerId);
		const finished = drag;
		setDrag(null);
		if (!finished.moved) {
			onOpen(finished.item);
			return;
		}
		if (finished.mode === "move") {
			if (finished.dayDelta !== 0 || finished.minuteDelta !== 0) onMove(finished.item, finished.dayDelta, finished.minuteDelta);
		} else if (finished.minuteDelta !== 0) {
			onResize(finished.item, finished.minuteDelta);
		}
	}

	/** The half hour a point in a day column falls in, the start of what a click there makes. */
	function slotAt(event: MouseEvent<HTMLDivElement>): number {
		const rect = event.currentTarget.getBoundingClientRect();
		const minute = Math.floor(((event.clientY - rect.top) / HOUR_PX) * 2) * 30;
		return Math.min(23 * 60, Math.max(0, minute));
	}

	function slotClick(event: MouseEvent<HTMLDivElement>, date: string) {
		if (event.target !== event.currentTarget) return;
		onCreateAt(date, slotAt(event));
	}

	function slotHover(event: MouseEvent<HTMLDivElement>, date: string) {
		if (drag || event.target !== event.currentTarget) {
			if (ghost) setGhost(null);
			return;
		}
		const minute = slotAt(event);
		if (ghost?.date !== date || ghost.minute !== minute) setGhost({ date, minute });
	}

	return (
		<div ref={root} className="flex h-full min-h-0 flex-col">
			{/* The dates and the all-day row are one band, with no rule between them. */}
			<div className="grid grid-cols-[56px_minmax(0,1fr)] overflow-hidden overflow-y-auto [scrollbar-gutter:stable]">
				<div />
				<PageSlide pageKey={dates[0]} axis="x" direction={direction}>
				<div key={dates[0]} className="grid grid-cols-7">
				{dates.map((date) => (
					<div key={date} className="flex h-[42px] items-center gap-2 px-3">
						<span
							className={`tabular inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[var(--radius-full)] text-base ${
								date === today ? "bg-[var(--accent)] text-[var(--accent-ink)]" : ""
							}`}
						>
							{Number(date.slice(8, 10))}
						</span>
						<span className="text-overline uppercase text-[var(--ink-muted)]">{weekdayShort(date)}</span>
					</div>
				))}
				</div>
				</PageSlide>
			</div>

			<div className="grid grid-cols-[56px_minmax(0,1fr)] overflow-hidden overflow-y-auto border-b border-[var(--line)] [scrollbar-gutter:stable]">
				<div className="flex min-h-8 items-center whitespace-nowrap pl-3 text-sm text-[var(--ink-muted)]">All day</div>
				<PageSlide pageKey={dates[0]} axis="x" direction={direction}>
				<div key={dates[0]} className="grid grid-cols-7">
				{dates.map((date) => {
					const dated = (placed.get(date) ?? []).filter((p) => p.dated);
					return (
						// One row, 32px: two all-day items on a day sit side by side.
						<div
							key={date}
							className="flex min-h-8 min-w-0 items-start gap-1 p-1"
							onDoubleClick={(event) => {
								if (event.target === event.currentTarget) onCreateAt(date, null);
							}}
						>
							{dated.map((p) => (
								<button
									key={p.key}
									type="button"
									data-opens-panel
									onClick={() => onOpen(p.item)}
									onContextMenu={(event) => openItemMenu(event, p.item)}
									title={itemTitle(p.item)}
									className={[
										"h-6 min-w-0 flex-1 basis-0 truncate rounded-[var(--radius-sm)] px-2 text-left text-dense",
										chipTone(p.item),
										p.continued ? "rounded-l-none" : "",
										p.continues ? "rounded-r-none" : "",
									].join(" ")}
								>
									{itemTitle(p.item)}
								</button>
							))}
						</div>
					);
				})}
				</div>
				</PageSlide>
			</div>

			<div
				ref={scroller}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
			>
				<div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
					<div className="relative">
						{HOURS.map((hour) => (
							<div
								key={hour}
								className="tabular absolute right-2 font-mono text-micro text-[var(--ink-muted)]"
								style={{ top: hour * HOUR_PX }}
							>
								{hour === 0 ? "" : formatMinutes(hour * 60)}
							</div>
						))}
						{nowMinute !== null ? (
							<div
								aria-hidden
								className="tabular absolute right-2 z-[2] -translate-y-1/2 bg-[var(--surface)] pl-1 font-mono text-micro text-[var(--risk)]"
								style={{ top: (nowMinute / 60) * HOUR_PX }}
							>
								{formatMinutes(nowMinute)}
							</div>
						) : null}
					</div>
					<PageSlide pageKey={dates[0]} axis="x" direction={direction} className="col-span-7">
					<div
						ref={grid}
						key={dates[0]}
						className="relative grid h-full grid-cols-7"
						onMouseLeave={() => setGhost(null)}
					>
						{nowMinute !== null ? (
							// Now, faintly across the whole week. Today's own column draws it in full.
							<div
								aria-hidden
								className="pointer-events-none absolute inset-x-0 z-[2] h-px bg-[var(--ink-faint)]/60"
								style={{ top: (nowMinute / 60) * HOUR_PX }}
							/>
						) : null}
						{dates.map((date, index) => {
							const timed = (placed.get(date) ?? []).filter((p) => !p.dated);
							const lanes = laneLayout(timed);
							return (
								<div
									key={date}
									className={`relative ${index !== 0 ? "border-l border-[var(--line)]" : ""} ${index >= 5 ? "bg-[var(--shade)]" : ""}`}
									onClick={(event) => slotClick(event, date)}
									onMouseMove={(event) => slotHover(event, date)}
								>
									{HOURS.map((hour) => (
										<div
											key={hour}
											aria-hidden
											className="pointer-events-none absolute inset-x-0 border-t border-[var(--line)]/70"
											style={{ top: hour * HOUR_PX }}
										/>
									))}
									{ghost?.date === date && !drag ? (
										<div
											aria-hidden
											className="animate-fade pointer-events-none absolute inset-x-1 z-0 rounded-[var(--radius-sm)] border border-dashed border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1 text-sm text-[var(--accent)]"
											style={{ top: (ghost.minute / 60) * HOUR_PX + 2, height: HOUR_PX - 4 }}
										>
											<span className="tabular">+ {formatMinutes(ghost.minute)}</span>
										</div>
									) : null}
									{date === today && nowMinute !== null ? (
										<div
											aria-hidden
											className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 bg-[var(--risk)]"
											style={{ top: (nowMinute / 60) * HOUR_PX }}
										>
											<span className="absolute top-1/2 -left-1 h-2 w-2 -translate-y-1/2 rounded-[var(--radius-full)] bg-[var(--risk)]" />
										</div>
									) : null}
									{timed.map((p) => {
										const active = drag && drag.key === p.key ? drag : null;
										const dayShift = active?.mode === "move" ? active.dayDelta : 0;
										const startMinute = p.startMinute + (active?.mode === "move" ? active.minuteDelta : 0);
										const endMinute = p.endMinute + (active ? active.minuteDelta : 0);
										// Inset 2px above and below, so two blocks that meet do not touch.
										const top = (startMinute / 60) * HOUR_PX + 2;
										const height = Math.max(MIN_PX, ((Math.max(endMinute, startMinute) - startMinute) / 60) * HOUR_PX - 4);
										const lane = lanes.get(p.key) ?? { lane: 0, lanes: 1 };
										const item = p.item;
										const label = item.kind === "event" ? item.title : itemTitle(item);
										// Read only: no drag, no resize, a click opens it.
										const fixed = item.kind === "subscription";
										return (
											<div
												key={p.key}
												role="button"
												tabIndex={0}
												aria-label={label}
												data-opens-panel
												onPointerDown={(event) => beginDrag(event, p, "move")}
												onPointerMove={trackDrag}
												onPointerUp={endDrag}
												onClick={fixed ? () => onOpen(item) : undefined}
												onKeyDown={(event) => {
													if (event.key === "Enter" || event.key === " ") {
														event.preventDefault();
														onOpen(item);
													}
												}}
												onContextMenu={(event) => openItemMenu(event, item)}
												className={[
													"absolute z-[1] flex select-none gap-2 overflow-hidden rounded-[var(--radius-sm)] pr-2",
													fixed ? "cursor-pointer" : "cursor-grab",
													chipTone(item),
													active ? "opacity-80 shadow-[var(--shadow-popover)]" : "",
												].join(" ")}
												style={{
													top,
													height,
													left: `calc(${(lane.lane / lane.lanes) * 100}% + ${dayShift * 100}% + 4px)`,
													width: `calc(${(1 / lane.lanes) * 100}% - 8px)`,
												}}
											>
												<span aria-hidden className={`w-[3px] shrink-0 ${dotTone(item)}`} />
												<span className="flex min-w-0 flex-1 flex-col justify-center">
													<span className="truncate text-dense font-[var(--weight-medium)]">{label}</span>
													{height >= 44 ? (
														<span className="tabular truncate text-sm">
															{formatMinutes(Math.max(0, startMinute))}
															{" to "}
															{formatMinutes(Math.min(1440, endMinute))}
														</span>
													) : null}
												</span>
												{item.kind === "event" && !p.continues ? (
													<span
														aria-hidden
														onPointerDown={(event) => beginDrag(event, p, "resize")}
														onPointerMove={trackDrag}
														onPointerUp={endDrag}
														className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
													/>
												) : null}
											</div>
										);
									})}
								</div>
							);
						})}
					</div>
					</PageSlide>
				</div>
			</div>

		</div>
	);
}
