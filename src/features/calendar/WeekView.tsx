import {
	useEffect,
	useRef,
	useState,
	type MouseEvent,
	type PointerEvent,
} from "react";
import type { CalendarItem, CalendarOccurrence } from "@shared/types";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { formatMinutes, snap, weekdayShort } from "./dates";
import { chipTone, itemMenuItems, itemTitle, laneLayout, type Placed } from "./format";
import { useWheelPaging } from "./use-wheel-paging";

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
	onEdit: (item: CalendarOccurrence) => void;
	onDelete: (item: CalendarOccurrence) => void;
	/** A wheel gesture over the header, the all-day row or an edge: page a week. */
	onStep: (direction: -1 | 1) => void;
};

const HOUR_PX = 48;
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
	onStep,
}: WeekViewProps) {
	const root = useRef<HTMLDivElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	const menu = useContextMenu();
	const [menuItem, setMenuItem] = useState<CalendarItem | null>(null);
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
		setMenuItem(item);
		menu.open(event);
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

	function slotClick(event: MouseEvent<HTMLDivElement>, date: string) {
		if (event.target !== event.currentTarget) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const minute = snap(((event.clientY - rect.top) / HOUR_PX) * 60, 30);
		onCreateAt(date, Math.min(23 * 60 + 30, Math.max(0, minute)));
	}

	const menuItems: MenuItem[] = menuItem ? itemMenuItems(menuItem, { onOpen, onEdit, onDelete }) : [];

	return (
		<div ref={root} className="flex h-full min-h-0 flex-col">
			<div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] overflow-y-auto border-b border-[var(--line)] [scrollbar-gutter:stable]">
				<div />
				{dates.map((date) => (
					<div key={date} className="flex items-baseline gap-1.5 px-2 py-1.5">
						<span className="text-[length:var(--text-micro)] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
							{weekdayShort(date)}
						</span>
						<span
							className={`tabular text-[length:var(--text-dense)] ${
								date === today
									? "rounded-[var(--radius-full)] bg-[var(--accent)] px-1.5 font-[var(--weight-medium)] text-[var(--accent-ink)]"
									: ""
							}`}
						>
							{Number(date.slice(8, 10))}
						</span>
					</div>
				))}
			</div>

			<div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] overflow-y-auto border-b border-[var(--line)] [scrollbar-gutter:stable]">
				<div className="px-2 py-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]">all day</div>
				{dates.map((date, index) => {
					const dated = (placed.get(date) ?? []).filter((p) => p.dated);
					return (
						<div
							key={date}
							className={`flex min-h-7 flex-col gap-px px-1 py-1 ${index !== 0 ? "border-l border-[var(--line)]" : ""}`}
							onDoubleClick={(event) => {
								if (event.target === event.currentTarget) onCreateAt(date, null);
							}}
						>
							{dated.map((p) => (
								<button
									key={p.key}
									type="button"
									onClick={() => onOpen(p.item)}
									onContextMenu={(event) => openItemMenu(event, p.item)}
									title={itemTitle(p.item)}
									className={[
										"h-5 truncate rounded-[var(--radius-sm)] px-1.5 text-left text-[length:var(--text-micro)] font-[var(--weight-medium)] leading-none",
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

			<div
				ref={scroller}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
			>
				<div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
					<div className="relative">
						{HOURS.map((hour) => (
							<div
								key={hour}
								className="tabular absolute right-2 -translate-y-1/2 text-[length:var(--text-micro)] text-[var(--ink-muted)]"
								style={{ top: hour * HOUR_PX }}
							>
								{hour === 0 ? "" : formatMinutes(hour * 60)}
							</div>
						))}
					</div>
					<div ref={grid} className="col-span-7 grid grid-cols-7">
						{dates.map((date, index) => {
							const timed = (placed.get(date) ?? []).filter((p) => !p.dated);
							const lanes = laneLayout(timed);
							return (
								<div
									key={date}
									className={`relative ${index !== 0 ? "border-l border-[var(--line)]" : ""}`}
									onClick={(event) => slotClick(event, date)}
								>
									{HOURS.map((hour) => (
										<div
											key={hour}
											aria-hidden
											className="pointer-events-none absolute inset-x-0 border-t border-[var(--line)]/70"
											style={{ top: hour * HOUR_PX }}
										/>
									))}
									{date === today && nowMinute !== null ? (
										<div
											aria-hidden
											className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-[var(--risk)]"
											style={{ top: (nowMinute / 60) * HOUR_PX }}
										/>
									) : null}
									{timed.map((p) => {
										const active = drag && drag.key === p.key ? drag : null;
										const dayShift = active?.mode === "move" ? active.dayDelta : 0;
										const startMinute = p.startMinute + (active?.mode === "move" ? active.minuteDelta : 0);
										const endMinute = p.endMinute + (active ? active.minuteDelta : 0);
										const top = (startMinute / 60) * HOUR_PX;
										const height = Math.max(MIN_PX, ((Math.max(endMinute, startMinute) - startMinute) / 60) * HOUR_PX);
										const lane = lanes.get(p.key) ?? { lane: 0, lanes: 1 };
										const item = p.item;
										const label = item.kind === "event" ? item.title : itemTitle(item);
										return (
											<div
												key={p.key}
												role="button"
												tabIndex={0}
												aria-label={label}
												onPointerDown={(event) => beginDrag(event, p, "move")}
												onPointerMove={trackDrag}
												onPointerUp={endDrag}
												onKeyDown={(event) => {
													if (event.key === "Enter" || event.key === " ") {
														event.preventDefault();
														onOpen(item);
													}
												}}
												onContextMenu={(event) => openItemMenu(event, item)}
												className={[
													"absolute z-[1] flex cursor-grab select-none flex-col overflow-hidden rounded-[var(--radius-sm)] border border-[var(--surface)] px-1.5 py-0.5 text-[length:var(--text-micro)] leading-tight",
													chipTone(item),
													active ? "opacity-80 shadow-[var(--shadow-popover)]" : "",
												].join(" ")}
												style={{
													top,
													height,
													left: `calc(${(lane.lane / lane.lanes) * 100}% + ${dayShift * 100}%)`,
													width: `${(1 / lane.lanes) * 100}%`,
												}}
											>
												<span className="truncate font-[var(--weight-medium)]">{label}</span>
												{height >= 34 ? (
													<span className="tabular truncate opacity-80">
														{formatMinutes(Math.max(0, startMinute))}
														{" to "}
														{formatMinutes(Math.min(1440, endMinute))}
													</span>
												) : null}
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
				</div>
			</div>

			{menu.at && menuItem ? (
				<ContextMenu
					at={menu.at}
					items={menuItems}
					ariaLabel="Event"
					onClose={() => {
						menu.close();
						setMenuItem(null);
					}}
				/>
			) : null}
		</div>
	);
}
