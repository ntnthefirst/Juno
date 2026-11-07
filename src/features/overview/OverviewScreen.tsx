import { useCallback, useEffect, useState } from "react";
import type { Reminder } from "@shared/types";
import { Icon } from "../../components/Icon";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { blankMenuFor } from "../../lib/blank-menu";
import { useLoaded } from "../../lib/use-loaded";
import { todayIso } from "../reminders/format";
import { ReminderForm } from "../reminders/ReminderForm";
import { SnoozeDialog } from "../reminders/SnoozeDialog";
import { Agenda } from "./Agenda";
import { CountLinks } from "./CountLinks";
import { SideLists } from "./SideLists";
import { StartHere } from "./StartHere";
import { Suggestions } from "./Suggestions";

type Clock = { today: string; hour: number; dateLabel: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function readClock(): Clock {
	const now = new Date();
	return {
		today: todayIso(),
		hour: now.getHours(),
		// Built from parts, so the separators are the design's whatever the locale does.
		dateLabel: `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`,
	};
}

function greetingFor(hour: number): string {
	if (hour < 5) return "Good night";
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

// Reads that take no arguments, kept outside the component so each is one
// stable function and not a new read on every render.
const loadClients = () => window.juno.clients.list();
const loadDocuments = () => window.juno.documents.list();
const loadStatuses = () => window.juno.reference.getSet("document_status");
const loadOwner = () => window.juno.settings.getOwner();
const loadSummary = () => window.juno.briefing.overview();
const loadAccounts = () => window.juno.mail.accounts.list();
const loadAttention = () => window.juno.reminders.list({ actionableOnly: true });
const loadRequests = () => window.juno.agent.actions.list({ states: ["pending"] });
const loadSuggestions = () => window.juno.reminders.suggestions();
const loadUnread = () =>
	window.juno.mail.threads.list({ folderSpecialUse: "inbox", unreadOnly: true, limit: 200 });

type HeadingLinkProps = {
	label: string;
	onClick: () => void;
};

function HeadingLink({ label, onClick }: HeadingLinkProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex items-center gap-1 text-dense text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-accent"
		>
			{label}
			<Icon name="chevron-right" size={12} />
		</button>
	);
}

/**
 * The page Juno opens on. A greeting, what is waiting, four counts, what is
 * coming up, and a quiet column of what changed last. Every row on it opens the
 * record it shows, and every number comes from the briefing service.
 *
 * Each block reads for itself, so a mail server that is slow or a calendar that
 * fails says so in its own block and the rest of the page is already there.
 */
export function OverviewScreen() {
	const [clock, setClock] = useState<Clock | null>(null);
	const [form, setForm] = useState<{ reminder: Reminder } | null>(null);
	const [snoozing, setSnoozing] = useState<Reminder | null>(null);
	const [deleted, setDeleted] = useState<Reminder | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// The clock is impure, so it is read here rather than during render.
	useEffect(() => {
		let cancelled = false;
		Promise.resolve(readClock()).then((value) => {
			if (!cancelled) setClock(value);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const owner = useLoaded(loadOwner);
	const summary = useLoaded(loadSummary);
	const clients = useLoaded(loadClients);
	const documents = useLoaded(loadDocuments);
	const statuses = useLoaded(loadStatuses);
	const accounts = useLoaded(loadAccounts);
	const unread = useLoaded(loadUnread);
	const attention = useLoaded(loadAttention);
	const requests = useLoaded(loadRequests);
	const suggestions = useLoaded(loadSuggestions);

	const reloadAttention = attention.reload;
	const reloadSuggestions = suggestions.reload;
	const reloadSummary = summary.reload;
	const changed = useCallback(() => {
		reloadAttention();
		reloadSummary();
	}, [reloadAttention, reloadSummary]);
	const accepted = useCallback(() => {
		reloadSuggestions();
		changed();
	}, [reloadSuggestions, changed]);

	const dismissUndo = useCallback(() => setDeleted(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		setDeleted(null);
		try {
			await window.juno.reminders.restore(id);
			changed();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	if (form) {
		return (
			<ReminderForm
				reminder={form.reminder}
				onClose={() => setForm(null)}
				onSaved={() => {
					setForm(null);
					changed();
				}}
			/>
		);
	}

	const first = owner.status === "ready" ? owner.value.firstName.trim() : "";
	const greeting = clock ? `${greetingFor(clock.hour)}${first ? `, ${first}` : ""}` : "Welcome";
	const counts = summary.status === "ready" ? summary.value : null;
	const sentence = counts?.headline ?? "";

	const reminders = attention.status === "ready" ? attention.value : [];
	const waiting = requests.status === "ready" ? requests.value : [];
	const suggested = suggestions.status === "ready" ? suggestions.value : [];

	// Nothing in Juno yet: the agenda has nothing to say, so the first steps take its place.
	const fresh =
		counts !== null &&
		attention.status === "ready" &&
		requests.status === "ready" &&
		counts.clients + counts.projects + counts.documents === 0 &&
		reminders.length === 0 &&
		waiting.length === 0;

	return (
		<div className="h-full overflow-y-auto" onContextMenu={blankMenuFor("overview")}>
			<div className="flex min-h-full flex-col min-[1000px]:flex-row">
				<div className="min-w-0 flex-1 p-10">
					<header className="animate-rise">
						<h1 className="text-h1">{greeting}</h1>
						<p className="mt-2 text-lg text-ink-muted">
							{clock?.dateLabel ?? "Checking the date."}
							{sentence ? `. ${sentence}` : ""}
						</p>
						<div className="mt-4">
							<CountLinks
								clients={counts?.clients ?? null}
								projects={counts?.projects ?? null}
								documents={counts?.documents ?? null}
								unread={counts?.unreadMail ?? null}
							/>
						</div>
					</header>

					{fresh ? (
						<div className="animate-rise mt-8 [animation-delay:100ms]">
							<StartHere />
						</div>
					) : (
						<section className="animate-rise mt-8 [animation-delay:100ms]">
							<div className="flex h-[33px] items-center gap-5">
								<h2 className="min-w-0 flex-1 text-h3">Coming up</h2>
								<HeadingLink
									label="Reminders"
									onClick={() => requestOpen({ kind: "screen", screen: "reminders" })}
								/>
								<HeadingLink
									label="Calendar"
									onClick={() => requestOpen({ kind: "screen", screen: "calendar" })}
								/>
							</div>
							{attention.status === "error" ? (
								<p data-selectable className="mt-2 border-l-2 border-risk pl-3 text-dense text-risk">
									Could not load your reminders. {attention.message}
								</p>
							) : null}
							<Agenda
								today={clock?.today ?? null}
								reminders={reminders}
								requests={waiting}
								loading={attention.status === "loading" || requests.status === "loading"}
								onChanged={changed}
								onEdit={(reminder) => setForm({ reminder })}
								onSnooze={setSnoozing}
								onDeleted={setDeleted}
								onError={setNotice}
							/>
						</section>
					)}

					{suggested.length > 0 ? (
						<div className="animate-rise mt-8 [animation-delay:150ms]">
							<Suggestions suggestions={suggested} onAccepted={accepted} />
						</div>
					) : null}
				</div>

				<aside className="animate-rise w-full flex-none border-t border-line px-[33px] py-10 [animation-delay:125ms] min-[1000px]:w-[420px] min-[1000px]:border-t-0 min-[1000px]:border-l">
					<SideLists
						unread={unread}
						unreadCount={counts?.unreadMail ?? null}
						documents={documents}
						statuses={statuses.status === "ready" && statuses.value ? statuses.value.items : []}
						clients={clients}
						hasAccounts={accounts.status === "ready" ? accounts.value.length > 0 : null}
					/>
				</aside>
			</div>

			{snoozing ? (
				<SnoozeDialog
					reminder={snoozing}
					onClose={() => setSnoozing(null)}
					onSnoozed={() => {
						setSnoozing(null);
						changed();
					}}
				/>
			) : null}

			{deleted ? (
				<Toast
					message={`${deleted.title} deleted.`}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={dismissUndo}
				/>
			) : null}

			{deleted === null && notice ? <Toast message={notice} onDismiss={dismissNotice} /> : null}
		</div>
	);
}
