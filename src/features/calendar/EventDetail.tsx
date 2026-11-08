import type { ReactNode } from "react";
import type { CalendarItem } from "@shared/types";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { SidePanel } from "../../components/SidePanel";
import { addDays, dateOf, formatDate, formatDateLong, formatTime, localDateOfInstant, machineTimeZone, timeOf } from "./dates";
import { KIND_LABELS, itemTitle } from "./format";
import { MarkdownNotes } from "../../components/MarkdownNotes";
import { CALENDAR_TONES } from "../../lib/calendar-colours";

type EventDetailProps = {
	item: CalendarItem;
	onEdit: () => void;
	onDelete: () => void;
	/** Only a reminder is completed or snoozed. */
	onComplete: () => void;
	onSnooze: () => void;
	onClose: () => void;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-4 py-1.5 text-dense">
			<span className="w-24 shrink-0 text-[var(--ink-muted)]">{label}</span>
			<span className="min-w-0 flex-1">{children}</span>
		</div>
	);
}

/** When the event's zone is not the machine's, both readings are worth showing. */
function whenOf(item: Extract<CalendarItem, { kind: "event" | "subscription" }>): { line: string; own: string | null } {
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

export function EventDetail({ item, onEdit, onDelete, onComplete, onSnooze, onClose }: EventDetailProps) {
	const title = itemTitle(item);

	return (
		<SidePanel
			title={title}
			subtitle={KIND_LABELS[item.kind]}
			onClose={onClose}
			tools={
				item.kind === "subscription" ? null : (
					<>
						<IconButton icon="edit" label={item.kind === "deadline" ? "Edit project" : "Edit"} onClick={onEdit} />
						<IconButton
							icon="remove"
							label={item.kind === "deadline" ? "Clear deadline" : "Delete"}
							danger
							onClick={onDelete}
						/>
					</>
				)
			}
			actions={
				item.kind === "reminder" ? (
					<>
						<IconButton icon="reminders" label="Snooze" onClick={onSnooze} />
						<Button variant="primary" onClick={onComplete}>
							Complete
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
									className="mt-0.5 inline-block text-sm text-[var(--accent)] hover:text-[var(--accent-hover)]"
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
				) : item.kind === "subscription" ? (
					<>
						<Row label="When">
							<span className="tabular">{whenOf(item).line}</span>
							{whenOf(item).own ? (
								<span className="tabular mt-0.5 block text-[var(--ink-muted)]">{whenOf(item).own}</span>
							) : null}
						</Row>
						{item.isRecurring ? <Row label="Repeats">{item.recurrenceLabel}</Row> : null}
						{item.location ? (
							<Row label="Where">
								<span className="block">{item.location}</span>
								<a
									href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(item.location)}`}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-0.5 inline-block text-sm text-[var(--accent)] hover:text-[var(--accent-hover)]"
								>
									Open in Maps
								</a>
							</Row>
						) : null}
						<Row label="Calendar">
							<span className="inline-flex items-center gap-2">
								<span aria-hidden className={`h-2.5 w-2.5 rounded-[var(--radius-full)] ${CALENDAR_TONES[item.colour].dot}`} />
								{item.subscriptionName}
							</span>
						</Row>
						{item.notes ? (
							// Written by whoever keeps that calendar, so it is shown as text and never as Markdown or links.
							<Row label="Notes">
								<span data-selectable className="block whitespace-pre-wrap break-words">
									{item.notes}
								</span>
							</Row>
						) : null}
						<p className="mt-3 text-sm text-[var(--ink-muted)]">
							From the {item.subscriptionName} subscription. It is read only here: change it in the calendar it comes from.
						</p>
					</>
				) : item.kind === "reminder" ? (
					<>
						<Row label="Due">
							<span className="tabular">{formatDateLong(item.dueOn)}</span>
						</Row>
						{item.recurrenceLabel && item.recurrenceLabel !== "Once" ? (
							<Row label="Repeats">{item.recurrenceLabel}</Row>
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
				) : (
					<>
						<Row label="Due">
							<span className="tabular">{formatDateLong(item.dueOn)}</span>
						</Row>
						{item.clientName ? <Row label="Client">{item.clientName}</Row> : null}
						<p className="mt-3 text-sm text-[var(--ink-muted)]">
							This is the project's own due date. Clearing it keeps the project.
						</p>
					</>
				)}
			</div>

		</SidePanel>
	);
}
