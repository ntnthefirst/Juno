import type { CalendarItem } from "@shared/types";
import { formatDateLong, formatMinutes } from "./dates";
import { dotTone, itemTitle, KIND_LABELS, type Placed } from "./format";

type AgendaViewProps = {
	/** The dates covered, in order. Days with nothing on them are left out. */
	dates: string[];
	today: string;
	placed: Map<string, Placed[]>;
	onOpen: (item: CalendarItem) => void;
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
export function AgendaView({ dates, today, placed, onOpen }: AgendaViewProps) {
	const days = dates.filter((date) => (placed.get(date) ?? []).length > 0);
	if (days.length === 0) {
		return <p className="p-8 text-[var(--ink-muted)]">Nothing scheduled in these {dates.length} days.</p>;
	}
	return (
		<div className="h-full overflow-y-auto px-8 py-4">
			<div className="mx-auto w-full max-w-[var(--content-width)]">
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
		</div>
	);
}
