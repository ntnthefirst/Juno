import { useCallback, useEffect, useState } from "react";
import type { CalendarSubscription } from "@shared/types";
import { Button } from "../../../components/Button";
import { Icon } from "../../../components/Icon";
import { IconButton } from "../../../components/IconButton";
import { CALENDAR_TONES } from "../../../lib/calendar-colours";
import { updatedLabel } from "../../../lib/calendar-subscriptions";
import { messageOf } from "../../../lib/errors";
import { SectionError } from "../Section";

type CalendarSubscriptionsSectionProps = {
	/** Opens the Add calendar page, or the page of one subscription. */
	onOpen: (subscription: CalendarSubscription | null) => void;
	/** Bumped by the page behind it when something changed, so the list reads again. */
	refreshKey: number;
};

/**
 * Calendar subscriptions, under the mail accounts as the frame draws it
 * (`190:628`): a heading with Add calendar at its right, and one row per
 * calendar with its colour, its name, where it comes from and when it was
 * last read. Fetch now reads it again on the spot.
 */
export function CalendarSubscriptionsSection({ onOpen, refreshKey }: CalendarSubscriptionsSectionProps) {
	const [rows, setRows] = useState<CalendarSubscription[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [fetching, setFetching] = useState<string | null>(null);

	const load = useCallback(() => {
		window.juno.calendar.subscriptions
			.list()
			.then(setRows)
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.calendar.subscriptions
			.list()
			.then((list) => {
				if (!cancelled) setRows(list);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	async function fetchNow(subscription: CalendarSubscription) {
		setFetching(subscription.id);
		setError(null);
		try {
			await window.juno.calendar.subscriptions.refresh(subscription.id);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setFetching(null);
			load();
		}
	}

	return (
		<section data-setting="calendar-subscriptions" className="mt-4 pt-2">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-h3">Calendar subscriptions</h2>
					<p className="mt-0.5 text-sm text-[var(--ink-muted)]">
						Calendars Juno reads from an address and keeps up to date. Read only.
					</p>
				</div>
				<Button variant="quiet" size="dense" onClick={() => onOpen(null)}>
					<Icon name="add" size={14} />
					Add calendar
				</Button>
			</div>

			<div className="mt-4">
				{rows === null ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : rows.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No calendars yet. Add one with its address in iCal format.</p>
				) : (
					<ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]">
						{rows.map((subscription) => (
							<li
								key={subscription.id}
								className="flex min-h-[52px] items-center gap-2.5 border-b border-[var(--line)] py-1.5 pl-3.5 pr-2 last:border-b-0"
							>
								<span
									aria-hidden
									className={`h-2.5 w-2.5 flex-none rounded-[var(--radius-full)] ${CALENDAR_TONES[subscription.colour].dot}`}
								/>
								<div className="min-w-0 flex-1">
									<p className="truncate text-base font-[var(--weight-medium)] text-[var(--ink)]">
										{subscription.name}
										{subscription.shown ? null : (
											<span className="font-[var(--weight-normal)] text-[var(--ink-muted)]"> (hidden on the calendar)</span>
										)}
									</p>
									<p className="tabular truncate text-sm text-[var(--ink-muted)]">
										{[
											subscription.host,
											subscription.mailAccountEmail ? `from ${subscription.mailAccountEmail}` : null,
											fetching === subscription.id ? "fetching" : updatedLabel(subscription.lastFetchedAt),
										]
											.filter(Boolean)
											.join(" · ")}
									</p>
									{subscription.lastError ? (
										<p data-selectable className="text-sm text-[var(--risk)]">
											{subscription.lastError}
										</p>
									) : null}
								</div>
								<IconButton
									icon="sync"
									label={`Fetch ${subscription.name} now`}
									size="dense"
									disabled={fetching === subscription.id}
									onClick={() => void fetchNow(subscription)}
								/>
								<Button variant="quiet" size="dense" onClick={() => onOpen(subscription)}>
									Edit
								</Button>
							</li>
						))}
					</ul>
				)}
				<SectionError message={error} />
			</div>
		</section>
	);
}
