import { useMemo } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { groupByDay } from "../../lib/day-groups";
import { requestOpen } from "../../lib/open-entity";
import type { Loaded } from "../../lib/use-loaded";
import { formatWhen, leadParticipant } from "../mail/format";
import { Card, CardError, CardLink, CardNote, GroupLabel } from "./Card";

type RecentMailCardProps = {
	/** The unread conversations in the inbox, newest first, read once by the screen. */
	state: Loaded<MailThreadSummary[]>;
	/** Whether any mail account exists at all, so an empty inbox and no inbox read differently. */
	hasAccounts: boolean | null;
};

const SHOWN = 8;

/**
 * What is waiting in the inbox, split by day, with who it is from. Only unread
 * conversations: a card that repeated the whole inbox would be the mail screen
 * again, a smaller one.
 */
export function RecentMailCard({ state, hasAccounts }: RecentMailCardProps) {
	const threads = useMemo(() => (state.status === "ready" ? state.value.slice(0, SHOWN) : []), [state]);
	const groups = useMemo(() => groupByDay(threads, (thread) => thread.lastMessageAt), [threads]);

	return (
		<Card
			title="Unread mail"
			action={<CardLink label="Mailbox" onClick={() => requestOpen({ kind: "screen", screen: "mail" })} />}
		>
			<CardError what="your mail" state={state} />
			{state.status === "loading" ? (
				<CardNote>Loading.</CardNote>
			) : state.status === "ready" && threads.length === 0 ? (
				<CardNote>{hasAccounts === false ? "No mail account is connected yet." : "You are all caught up."}</CardNote>
			) : (
				groups.map((group) => (
					<div key={group.key}>
						<GroupLabel>{group.label}</GroupLabel>
						{group.items.map((thread) => {
							const sender = leadParticipant(thread.participants);
							return (
								<button
									key={thread.id}
									type="button"
									onClick={() => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId })}
									className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
								>
									<Avatar name={sender} size={32} />
									<span className="min-w-0 flex-1">
										<span className="flex items-baseline gap-2">
											<span className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-[var(--weight-semibold)]">
												{sender}
											</span>
											<span className="tabular flex-none text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												{formatWhen(thread.lastMessageAt)}
											</span>
										</span>
										<span className="block truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
											<span className="text-[var(--ink)]">{thread.subject}</span>
											{thread.snippet ? ` ${thread.snippet}` : ""}
										</span>
									</span>
								</button>
							);
						})}
					</div>
				))
			)}
		</Card>
	);
}
