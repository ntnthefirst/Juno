import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
	CalendarColour,
	CalendarRefreshMinutes,
	CalendarSubscription,
	CalendarSubscriptionPreview,
} from "@shared/types";
import { Button } from "../../../components/Button";
import { Dialog } from "../../../components/Dialog";
import { Field } from "../../../components/Field";
import { FormPage } from "../../../components/FormPage";
import { Icon } from "../../../components/Icon";
import { Segmented } from "../../../components/Segmented";
import { CALENDAR_TONES, OFFERED_COLOURS } from "../../../lib/calendar-colours";
import { messageOf } from "../../../lib/errors";
import { isMac } from "../../../lib/platform";

type CalendarSubscriptionPageProps = {
	/** Null adds one, a subscription edits it. */
	subscription: CalendarSubscription | null;
	onClose: () => void;
	onSaved: (message: string) => void;
};

type Check =
	| { status: "idle" }
	| { status: "checking" }
	| { status: "found"; preview: CalendarSubscriptionPreview }
	| { status: "failed"; message: string };

const REFRESH_OPTIONS: { id: string; label: string }[] = [
	{ id: "15", label: "Every 15 minutes" },
	{ id: "60", label: "Every hour" },
	{ id: "1440", label: "Every day" },
];

/** Only what could be an address is checked, and only once the typing has stopped. */
const CHECK_DELAY_MS = 450;

function looksLikeAddress(value: string): boolean {
	return /^(https|webcals?):\/\/\S+\.\S+/i.test(value.trim());
}

/** "Thursday 12 November", with the year only when it is not this one. */
function whenNext(next: NonNullable<CalendarSubscriptionPreview["next"]>): string {
	const date = next.allDay ? new Date(`${next.startLocal.slice(0, 10)}T12:00:00`) : new Date(next.startUtc);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return new Intl.DateTimeFormat("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "long",
		...(sameYear ? {} : { year: "numeric" }),
	}).format(date);
}

function foundLine(preview: CalendarSubscriptionPreview): string {
	const name = preview.name ?? preview.host;
	const count = `${preview.eventCount} ${preview.eventCount === 1 ? "event" : "events"}`;
	return preview.next
		? `${name}, ${count}. The next one is ${whenNext(preview.next)}.`
		: `${name}, ${count}. Nothing is coming up in the next year.`;
}

/**
 * Add calendar (`190:797`), and the same page for one that exists. The
 * address is checked once it is pasted, which fills in the name the feed
 * gives itself; then the name, a colour and how often to fetch it.
 *
 * The address of a saved subscription is never shown again, because a
 * Google secret address is a password in all but name. Pasting a new one
 * replaces it.
 */
export function CalendarSubscriptionPage({ subscription, onClose, onSaved }: CalendarSubscriptionPageProps) {
	const formId = useId();
	const addressId = useId();
	const [address, setAddress] = useState("");
	const [name, setName] = useState(subscription?.name ?? "");
	const nameTouched = useRef(subscription !== null);
	const [colour, setColour] = useState<CalendarColour>(subscription?.colour ?? "accent");
	const [refresh, setRefresh] = useState<CalendarRefreshMinutes>(subscription?.refreshMinutes ?? 60);
	const [check, setCheck] = useState<Check>({ status: "idle" });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [removing, setRemoving] = useState(false);

	// The newest address wins: an answer for one typed over is dropped.
	useEffect(() => {
		const value = address.trim();
		if (!looksLikeAddress(value)) return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setCheck({ status: "checking" });
			window.juno.calendar.subscriptions
				.preview(value)
				.then((preview) => {
					if (cancelled) return;
					setCheck({ status: "found", preview });
					if (!nameTouched.current && preview.name) setName(preview.name);
				})
				.catch((cause: unknown) => {
					if (!cancelled) setCheck({ status: "failed", message: messageOf(cause) });
				});
		}, CHECK_DELAY_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [address]);

	function changeAddress(value: string) {
		setAddress(value);
		setError(null);
		if (!looksLikeAddress(value)) setCheck({ status: "idle" });
	}

	async function submit(event?: FormEvent) {
		event?.preventDefault();
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			if (subscription) {
				const saved = await window.juno.calendar.subscriptions.update(subscription.id, {
					name,
					colour,
					refreshMinutes: refresh,
					...(address.trim() ? { url: address.trim() } : {}),
				});
				onSaved(`${saved.name} saved.`);
			} else {
				const saved = await window.juno.calendar.subscriptions.create({
					url: address.trim(),
					name,
					colour,
					refreshMinutes: refresh,
				});
				onSaved(`${saved.name} added.`);
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setSaving(false);
		}
	}

	async function remove() {
		if (!subscription) return;
		setRemoving(false);
		try {
			await window.juno.calendar.subscriptions.remove(subscription.id);
			onSaved(`${subscription.name} removed.`);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const ready = name.trim().length > 0 && (subscription !== null || address.trim().length > 0);

	return (
		<FormPage
			title={subscription ? "Edit calendar" : "Add calendar"}
			onBack={onClose}
			backLabel="Mail accounts"
			description={
				subscription
					? "Juno fetches this calendar on its own. Its events cannot be changed here."
					: "Paste the address of a calendar. Juno reads it and fetches it again on its own. Its events cannot be changed here."
			}
			actions={
				<div className="flex w-full items-center gap-2">
					{subscription ? (
						<Button variant="danger" onClick={() => setRemoving(true)}>
							Remove
						</Button>
					) : null}
					<span className="flex-1" />
					<Button variant="quiet" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" type="submit" form={formId} disabled={!ready || saving}>
						{subscription ? "Save" : "Add calendar"}
					</Button>
				</div>
			}
		>
			<form id={formId} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<label htmlFor={addressId} className="text-sm font-[var(--weight-medium)] text-[var(--ink)]">
						Address
					</label>
					<input
						id={addressId}
						type="url"
						value={address}
						onChange={(event) => changeAddress(event.target.value)}
						placeholder={
							subscription ? `${subscription.host}, kept by ${isMac ? "macOS" : "Windows"}. Paste a new address to replace it.` : "https://"
						}
						spellCheck={false}
						autoComplete="off"
						autoFocus={subscription === null}
						className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 font-mono text-sm text-[var(--ink)] placeholder:font-sans placeholder:text-[var(--ink-muted)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]"
					/>
					{subscription && !address ? (
						<p className="text-sm text-[var(--ink-muted)]">
							{subscription.eventCount} {subscription.eventCount === 1 ? "event" : "events"} from {subscription.host}.
						</p>
					) : null}
				</div>

				<div aria-live="polite" className="min-h-5">
					{check.status === "checking" ? (
						<p className="text-sm text-[var(--ink-muted)]">Reading the calendar.</p>
					) : check.status === "found" ? (
						<p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
							<span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--ok-soft)] text-[var(--ok)]">
								<Icon name="check" size={12} strokeWidth={2} />
							</span>
							<span className="tabular">{foundLine(check.preview)}</span>
						</p>
					) : check.status === "failed" ? (
						<p data-selectable className="text-sm text-[var(--risk)]">
							{check.message}
						</p>
					) : null}
				</div>

				<div className="flex items-end gap-4">
					<div className="min-w-0 flex-1">
						<Field
							label="Name"
							value={name}
							onChange={(value) => {
								nameTouched.current = true;
								setName(value);
							}}
						/>
					</div>
					<fieldset className="flex-none">
						<legend className="mb-1.5 text-sm font-[var(--weight-medium)] text-[var(--ink)]">Colour</legend>
						<div className="flex h-10 items-center">
							{OFFERED_COLOURS.map((option) => {
								const picked = option === colour;
								return (
									<button
										key={option}
										type="button"
										aria-label={CALENDAR_TONES[option].label}
										aria-pressed={picked}
										onClick={() => setColour(option)}
										className="inline-flex h-8 w-[30px] items-center justify-center rounded-[var(--radius-full)]"
									>
										<span
											aria-hidden
											className={[
												"h-[22px] w-[22px] rounded-[var(--radius-full)]",
												CALENDAR_TONES[option].dot,
												picked ? "outline-2 outline-offset-1 outline-[var(--ink)]" : "",
											].join(" ")}
										/>
									</button>
								);
							})}
						</div>
					</fieldset>
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-[var(--weight-medium)] text-[var(--ink)]">Fetch it</span>
					<div>
						<Segmented
							label="Fetch it"
							value={String(refresh)}
							onChange={(id) => setRefresh(Number(id) as CalendarRefreshMinutes)}
							options={REFRESH_OPTIONS}
						/>
					</div>
				</div>

				{error ? (
					<p role="alert" data-selectable className="border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
						{error}
					</p>
				) : null}
			</form>

			{removing && subscription ? (
				<Dialog title="Remove calendar" onClose={() => setRemoving(false)} width="narrow">
					<p className="mt-4 text-[var(--ink-muted)]">
						Remove {subscription.name}? Its {subscription.eventCount} events leave the calendar and Juno forgets the
						address. Nothing changes where the calendar is kept.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setRemoving(false)}>Cancel</Button>
						<Button variant="danger" onClick={() => void remove()}>
							Remove
						</Button>
					</div>
				</Dialog>
			) : null}
		</FormPage>
	);
}
