import type { ReactNode } from "react";
import type { CalendarItem } from "@shared/types";
import { Button } from "../../components/Button";
import { SidePanel } from "../../components/SidePanel";
import { addDays, dateOf, formatDate, formatDateLong, formatTime, localDateOfInstant, machineTimeZone, timeOf } from "./dates";
import { KIND_LABELS, itemTitle } from "./format";
import { MarkdownNotes } from "../../components/MarkdownNotes";

type EventDetailProps = {
	item: CalendarItem;
	onEdit: () => void;
	onDelete: () => void;
	onClose: () => void;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-4 py-1.5 text-[length:var(--text-dense)]">
			<span className="w-24 shrink-0 text-[var(--ink-muted)]">{label}</span>
			<span className="min-w-0 flex-1">{children}</span>
		</div>
	);
}

/** When the event's zone is not the machine's, both readings are worth showing. */
function whenOf(item: Extract<CalendarItem, { kind: "event" }>): { line: string; own: string | null } {
	if (item.allDay) {
		const last = addDays(dateOf(item.endLocal), -1);
		const first = dateOf(item.startLocal);
		return { line: first === last ? formatDateLong(first) : `${formatDate(first)} to ${formatDate(last)}`, own: null };
	}
	const startDate = localDateOfInstant(item.startUtc);
	const endDate = localDateOfInstant(item.endUtc);
	const line =
		startDate === endDate
			? `${formatDateLong(startDate)}, ${formatTime(item.startUtc)} to ${formatTime(item.endUtc)}`
			: `${formatDate(startDate)} ${formatTime(item.startUtc)} to ${formatDate(endDate)} ${formatTime(item.endUtc)}`;
	const own =
		item.timezone === machineTimeZone()
			? null
			: `${formatDate(dateOf(item.startLocal))} ${timeOf(item.startLocal)} to ${timeOf(item.endLocal)} in ${item.timezone}`;
	return { line, own };
}

export function EventDetail({ item, onEdit, onDelete, onClose }: EventDetailProps) {
	const title = itemTitle(item);

	return (
		<SidePanel
			title={title}
			subtitle={KIND_LABELS[item.kind]}
			onClose={onClose}
			actions={
				item.kind === "event" ? (
					<>
						<Button variant="danger" onClick={onDelete}>
							Delete
						</Button>
						<Button variant="primary" onClick={onEdit}>
							Edit
						</Button>
					</>
				) : null
			}
		>
			<div>
				{item.kind === "event" ? (
					<>
						<Row label="When">
							<span className="tabular">{whenOf(item).line}</span>
							{whenOf(item).own ? (
								<span className="tabular mt-0.5 block text-[var(--ink-muted)]">{whenOf(item).own}</span>
							) : null}
						</Row>
						{item.isRecurring ? (
							<Row label="Repeats">
								{item.recurrenceLabel}
								{item.isException ? <span className="text-[var(--ink-muted)]"> (this one was changed)</span> : null}
							</Row>
						) : null}
						{item.location ? (
							<Row label="Where">
								<span className="block">{item.location}</span>
								<a
									href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(item.location)}`}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-0.5 inline-block text-[length:var(--text-sm)] text-[var(--accent)] hover:text-[var(--accent-hover)]"
								>
									Open in Maps
								</a>
							</Row>
						) : null}
						{item.clientName ? (
							<Row label="Client">{[item.clientName, item.projectName].filter(Boolean).join(" / ")}</Row>
						) : null}
						{item.notes ? (
							<Row label="Notes">
								<MarkdownNotes text={item.notes} />
							</Row>
						) : null}
					</>
				) : item.kind === "reminder" ? (
					<>
						<Row label="Due">
							<span className="tabular">{formatDateLong(item.dueOn)}</span>
						</Row>
						{item.clientName ? <Row label="Client">{item.clientName}</Row> : null}
						<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Shown from Reminders. Complete, snooze or edit it there.
						</p>
					</>
				) : (
					<>
						<Row label="Due">
							<span className="tabular">{formatDateLong(item.dueOn)}</span>
						</Row>
						<Row label="Client">{item.clientName}</Row>
						<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Shown from the project. Change the date on the client's project.
						</p>
					</>
				)}
			</div>

		</SidePanel>
	);
}
