import { useEffect, useId, useRef, useState } from "react";
import type { CalendarSubscription, MailAccount } from "@shared/types";
import { Toggle } from "../../../components/Toggle";
import { subscribeAccountCalendar } from "../../../lib/calendar-subscriptions";
import { messageOf } from "../../../lib/errors";

type AccountCalendarRowProps = {
	/** The account just added. The subscription is listed under it. */
	account: MailAccount;
};

type State =
	| { status: "idle" }
	| { status: "saving" }
	| { status: "added"; subscription: CalendarSubscription }
	| { status: "failed"; message: string };

const SAVE_DELAY_MS = 600;

function isGoogle(account: MailAccount): boolean {
	return /(^|\.)(gmail|googlemail)\.com$/i.test(account.imapHost) || /@(gmail|googlemail)\.com$/i.test(account.email);
}

function looksLikeAddress(value: string): boolean {
	return /^(https|webcals?):\/\/\S+\.\S+/i.test(value.trim());
}

/**
 * The calendar row under "Bring in" on the last step of adding an account
 * (frame `190:473`): a switch, and the secret address in iCal format. Pasting
 * the address subscribes at once, so the step needs no button of its own;
 * pasting another replaces it, and switching it off removes it again.
 */
export function AccountCalendarRow({ account }: AccountCalendarRowProps) {
	const google = isGoogle(account);
	const fieldId = useId();
	const helpId = useId();
	const [on, setOn] = useState(google);
	const [address, setAddress] = useState("");
	const [state, setState] = useState<State>({ status: "idle" });
	// Read inside the timer, so a later paste updates what the earlier one made.
	const made = useRef<CalendarSubscription | null>(null);

	useEffect(() => {
		const value = address.trim();
		if (!on || !looksLikeAddress(value)) return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setState({ status: "saving" });
			const existing = made.current;
			const work = existing
				? window.juno.calendar.subscriptions.update(existing.id, { url: value })
				: subscribeAccountCalendar(value, google ? "Google Calendar" : account.label, account.id);
			work
				.then((subscription) => {
					made.current = subscription;
					if (!cancelled) setState({ status: "added", subscription });
				})
				.catch((cause: unknown) => {
					if (!cancelled) setState({ status: "failed", message: messageOf(cause) });
				});
		}, SAVE_DELAY_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [address, on, google, account.id, account.label]);

	function toggle(next: boolean) {
		setOn(next);
		if (next) return;
		const existing = made.current;
		made.current = null;
		setState({ status: "idle" });
		if (existing) void window.juno.calendar.subscriptions.remove(existing.id).catch(() => undefined);
	}

	return (
		<div className="flex flex-col gap-3">
			<Toggle
				label={google ? "Google Calendar" : "Calendar"}
				description={
					google
						? "Read only, fetched every hour. Paste the secret address from Google Calendar."
						: "Read only, fetched every hour. Paste the address of the calendar in iCal format."
				}
				checked={on}
				onChange={toggle}
			/>
			{on ? (
				<div className="flex flex-col gap-1.5">
					<label htmlFor={fieldId} className="text-sm font-[var(--weight-medium)] text-[var(--ink)]">
						{google ? "Secret address in iCal format" : "Address in iCal format"}
					</label>
					<input
						id={fieldId}
						type="url"
						value={address}
						onChange={(event) => {
							setAddress(event.target.value);
							if (!looksLikeAddress(event.target.value)) setState({ status: "idle" });
						}}
						placeholder="https://"
						spellCheck={false}
						autoComplete="off"
						aria-describedby={helpId}
						className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 font-mono text-sm text-[var(--ink)] placeholder:font-sans placeholder:text-[var(--ink-muted)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]"
					/>
					<p id={helpId} aria-live="polite" className="text-sm text-[var(--ink-muted)]">
						{state.status === "saving" ? (
							"Reading the calendar."
						) : state.status === "added" ? (
							<span className="tabular">
								Added, {state.subscription.eventCount} {state.subscription.eventCount === 1 ? "event" : "events"}. It is
								listed under Calendar subscriptions.
							</span>
						) : state.status === "failed" ? (
							<span data-selectable className="text-[var(--risk)]">
								{state.message}
							</span>
						) : google ? (
							"In Google Calendar: Settings, your calendar, Integrate calendar."
						) : (
							"Your calendar's settings give this address, often under sharing or publishing."
						)}
					</p>
				</div>
			) : null}
		</div>
	);
}
