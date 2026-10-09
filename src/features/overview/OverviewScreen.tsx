import { useCallback, useEffect, useState } from "react";
import type { Reminder } from "@shared/types";
import { AddButton } from "../../components/AddButton";
import { Avatar } from "../../components/Avatar";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { useScreenAction } from "../../lib/screen-actions";
import { useLoaded } from "../../lib/use-loaded";
import { BUCKET_LABELS, BUCKET_ORDER, todayIso } from "../reminders/format";
import { ReminderForm } from "../reminders/ReminderForm";
import { ReminderRow } from "../reminders/ReminderRow";
import { SnoozeDialog } from "../reminders/SnoozeDialog";
import { SuggestionList } from "../reminders/SuggestionList";
import { Card, CardError, CardLink, CardNote, CardSkeleton, GroupLabel } from "./Card";
import { ClientsCard } from "./ClientsCard";
import { RecentDocumentsCard } from "./RecentDocumentsCard";
import { RecentMailCard } from "./RecentMailCard";
import { StatTiles } from "./StatTiles";
import { UpNextCard } from "./UpNextCard";

type Clock = { today: string; hour: number; dateLabel: string };

function readClock(): Clock {
	const now = new Date();
	return {
		today: todayIso(),
		hour: now.getHours(),
		dateLabel: now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
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
const loadProjects = () => window.juno.projects.list();
const loadDocuments = () => window.juno.documents.list();
const loadStatuses = () => window.juno.reference.getSet("document_status");
const loadOwner = () => window.juno.settings.getOwner();
const loadBriefing = () => window.juno.briefing.today();
const loadAccounts = () => window.juno.mail.accounts.list();
const loadAttention = () => window.juno.reminders.list({ actionableOnly: true });
const loadSuggestions = () => window.juno.reminders.suggestions();
const loadUnread = () =>
	window.juno.mail.threads.list({ folderSpecialUse: "inbox", unreadOnly: true, limit: 200 });

/**
 * The page Juno opens on. It answers what needs doing, what is coming and what
 * changed last, in that order, and every row on it opens the record it shows.
 * The work itself happens on the other screens: this one reads and points.
 *
 * Each card reads for itself, so a mail server that is slow or a calendar that
 * fails says so in its own card and the rest of the page is already there.
 */
export function OverviewScreen() {
	const [clock, setClock] = useState<Clock | null>(null);
	const [form, setForm] = useState<{ reminder: Reminder | null } | null>(null);
	useScreenAction("overview", () => setForm({ reminder: null }));
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
	const briefing = useLoaded(loadBriefing);
	const clients = useLoaded(loadClients);
	const projects = useLoaded(loadProjects);
	const documents = useLoaded(loadDocuments);
	const statuses = useLoaded(loadStatuses);
	const accounts = useLoaded(loadAccounts);
	const unread = useLoaded(loadUnread);
	const attention = useLoaded(loadAttention);
	const suggestions = useLoaded(loadSuggestions);

	const reloadAttention = attention.reload;
	const reloadSuggestions = suggestions.reload;
	const accepted = useCallback(() => {
		reloadSuggestions();
		reloadAttention();
	}, [reloadSuggestions, reloadAttention]);

	const dismissUndo = useCallback(() => setDeleted(null), []);
	const dismissNotice = useCallback(() => setNotice(null), []);

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		setDeleted(null);
		try {
			await window.juno.reminders.restore(id);
			reloadAttention();
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
					reloadAttention();
				}}
			/>
		);
	}

	const first = owner.status === "ready" ? owner.value.firstName.trim() : "";
	const who =
		owner.status === "ready"
			? [owner.value.firstName, owner.value.lastName].join(" ").trim() || owner.value.businessName || "You"
			: "You";
	const greeting = clock ? `${greetingFor(clock.hour)}${first ? `, ${first}` : ""}` : "Welcome";
	const headline = briefing.status === "ready" ? briefing.value.headline : "";

	const reminders = attention.status === "ready" ? attention.value : [];
	const suggested = suggestions.status === "ready" ? suggestions.value : [];

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full px-8 pb-12 pt-8">
				<header className="animate-rise flex items-center gap-4">
					<Avatar name={who} size={48} />
					<div className="min-w-0">
						<h1 className="text-[length:var(--text-h2)] font-[var(--weight-semibold)] leading-tight tracking-[-0.02em]">
							{greeting}
						</h1>
						<p className="mt-0.5 text-[length:var(--text-base)] text-[var(--ink-muted)]">
							{clock?.dateLabel ?? "Checking the date."}
							{headline ? ` · ${headline}` : ""}
						</p>
					</div>
				</header>

				<div className="mt-6">
					<StatTiles
						clients={clients.status === "ready" ? clients.value.length : null}
						projects={projects.status === "ready" ? projects.value.length : null}
						documents={documents.status === "ready" ? documents.value.length : null}
						unread={unread.status === "ready" ? unread.value.length : null}
					/>
				</div>

				<div className="mt-6 grid gap-6 min-[1000px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
					<div className="flex min-w-0 flex-col gap-6 [&>*]:animate-rise [&>:nth-child(1)]:[animation-delay:150ms] [&>:nth-child(2)]:[animation-delay:200ms] [&>:nth-child(3)]:[animation-delay:250ms]">
						<Card
							title="Needs attention"
							count={reminders.length}
							action={
								<>
									<CardLink
										label="All reminders"
										onClick={() => requestOpen({ kind: "screen", screen: "reminders" })}
									/>
									<AddButton label="New reminder" onClick={() => setForm({ reminder: null })} />
								</>
							}
						>
							<CardError what="your reminders" state={attention} />
							{attention.status === "loading" ? (
								<CardSkeleton />
							) : attention.status === "ready" && reminders.length === 0 ? (
								<CardNote>Nothing is due or overdue.</CardNote>
							) : (
								BUCKET_ORDER.map((bucket) => {
									const group = reminders.filter((row) => row.bucket === bucket);
									if (group.length === 0) return null;
									return (
										<div key={bucket}>
											<GroupLabel>{BUCKET_LABELS[bucket]}</GroupLabel>
											{group.map((row) => (
												<ReminderRow
													key={row.id}
													reminder={row}
													today={clock?.today ?? null}
													onChanged={reloadAttention}
													onEdit={(reminder) => setForm({ reminder })}
													onSnooze={setSnoozing}
													onDeleted={setDeleted}
													onError={setNotice}
												/>
											))}
										</div>
									);
								})
							)}
						</Card>

						{suggested.length > 0 ? (
							<Card title="Suggestions" count={suggested.length}>
								<SuggestionList suggestions={suggested} onAccepted={accepted} />
							</Card>
						) : null}

						<RecentMailCard
							state={unread}
							hasAccounts={accounts.status === "ready" ? accounts.value.length > 0 : null}
						/>
					</div>

					<div className="flex min-w-0 flex-col gap-6 [&>*]:animate-rise [&>:nth-child(1)]:[animation-delay:175ms] [&>:nth-child(2)]:[animation-delay:225ms] [&>:nth-child(3)]:[animation-delay:275ms]">
						<UpNextCard today={clock?.today ?? null} />
						<RecentDocumentsCard
							documents={documents}
							statuses={statuses.status === "ready" && statuses.value ? statuses.value.items : []}
						/>
						<ClientsCard clients={clients} />
					</div>
				</div>
			</div>

			{snoozing ? (
				<SnoozeDialog
					reminder={snoozing}
					onClose={() => setSnoozing(null)}
					onSnoozed={() => {
						setSnoozing(null);
						reloadAttention();
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
