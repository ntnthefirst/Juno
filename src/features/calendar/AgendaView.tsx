import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { CalendarItem, CalendarOccurrence } from "@shared/types";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { formatDateLong, formatMinutes } from "./dates";
import { dotTone, itemMenuItems, itemTitle, KIND_LABELS, type Placed } from "./format";
import { useWheelPaging } from "./use-wheel-paging";

type AgendaViewProps = {
	/** The dates covered, in order. Days with nothing on them are left out. */
	dates: string[];
	today: string;
	placed: Map<string, Placed[]>;
	onOpen: (item: CalendarItem) => void;
	onEdit: (item: CalendarOccurrence) => void;
	onDelete: (item: CalendarOccurrence) => void;
	/** A wheel gesture past the top or bottom of the list: page the range. */
	onStep: (direction: -1 | 1) => void;
};

function subtitle(item: CalendarItem): string {
	switch (item.kind) {
		case "event":
			return [item.clientName, item.projectName, item.location].filter(Boolean).join(" / ");
		case "reminder":
			return [KIND_LABELS.reminder, item.clientName].filter(Boolean).join(" / ");
		case "deadline":
			return `${KIND_LABELS.deadline} / ${item.clientName}`;
	}
}

/** A list, one hairline per row, for reading a stretch of days rather than placing them. */
export function AgendaView({ dates, today, placed, onOpen, onEdit, onDelete, onStep }: AgendaViewProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const menu = useContextMenu();
	const [menuItem, setMenuItem] = useState<CalendarItem | null>(null);
	const page = useWheelPaging(onStep);
	const days = dates.filter((date) => (placed.get(date) ?? []).length > 0);

	// The list scrolls on its own first. Only once a wheel would go past its
	// top or bottom does it page the range, the same rule the week view's hour
	// scroller uses. No preventDefault is called, so this stays passive.
	useEffect(() => {
		const node = scroller.current;
		if (!node) return;
		function onWheel(event: WheelEvent) {
			const current = scroller.current;
			if (!current) return;
			const atTop = current.scrollTop <= 0;
			const atBottom = current.scrollTop + current.clientHeight >= current.scrollHeight - 1;
			if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) page(event.deltaY);
		}
		node.addEventListener("wheel", onWheel, { passive: true });
		return () => node.removeEventListener("wheel", onWheel);
	}, [page]);

	function openItemMenu(event: ReactMouseEvent<HTMLElement>, item: CalendarItem) {
		setMenuItem(item);
		menu.open(event);
	}

	const menuItems: MenuItem[] = menuItem ? itemMenuItems(menuItem, { onOpen, onEdit, onDelete }) : [];

	return (
		<div ref={scroller} className="h-full overflow-y-auto overscroll-contain">
			{days.length === 0 ? (
				<p className="p-8 text-[var(--ink-muted)]">Nothing scheduled in these {dates.length} days.</p>
			) : (
				<div className="mx-auto w-full max-w-[var(--content-width)] px-8 py-4">
					{days.map((date) => (
						<section key={date} className="mb-6">
							<h2
								className={`sticky top-0 border-b border-[var(--line)] bg-[var(--paper)] pb-1.5 pt-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] ${
									date === today ? "text-[var(--accent)]" : ""
								}`}
							>
								{formatDateLong(date)}
								{date === today ? <span className="ml-2 text-[var(--ink-muted)]">today</span> : null}
							</h2>
							{(placed.get(date) ?? []).map((p) => (
								<button
									key={p.key}
									type="button"
									onClick={() => onOpen(p.item)}
									onContextMenu={(event) => openItemMenu(event, p.item)}
									className="flex w-full items-center gap-3 border-b border-[var(--line)] px-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
									style={{ height: "var(--row-height)" }}
								>
									<span className="tabular w-24 shrink-0 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
										{p.dated
											? "all day"
											: `${formatMinutes(p.startMinute)}${p.endMinute > p.startMinute ? ` to ${formatMinutes(Math.min(1440, p.endMinute))}` : ""}`}
									</span>
									<span className={`h-2 w-2 shrink-0 rounded-[var(--radius-full)] ${dotTone(p.item)}`} aria-hidden />
									<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">{itemTitle(p.item)}</span>
									<span className="min-w-0 shrink truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{subtitle(p.item)}
									</span>
								</button>
							))}
						</section>
					))}
				</div>
			)}

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
