import type { MailThreadSummary } from "@shared/types";
import { formatWhen, participantsLine } from "./format";

type ThreadListProps = {
	threads: MailThreadSummary[] | null;
	error: string | null;
	searching: boolean;
	selectedId: string | null;
	onSelect: (id: string) => void;
};

/**
 * Two lines per thread: who and when, then the subject and a snippet. Unread
 * is a weight change and a dot, not a colour, so it still reads in both themes.
 */
export function ThreadList({ threads, error, searching, selectedId, onSelect }: ThreadListProps) {
	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load mail.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (threads === null) {
		return <p className="px-4 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (threads.length === 0) {
		return (
			<p className="px-4 text-[var(--ink-muted)]">
				{searching ? "Nothing matches." : "Nothing here yet."}
			</p>
		);
	}

	return (
		<ul className="flex flex-col">
			{threads.map((thread) => {
				const active = thread.id === selectedId;
				const unread = thread.unreadCount > 0;
				return (
					<li key={thread.id} className="border-b border-[var(--line)]/60">
						<button
							type="button"
							onClick={() => onSelect(thread.id)}
							aria-current={active ? "true" : undefined}
							className={[
								"block w-full px-4 py-2 text-left",
								active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
							].join(" ")}
						>
							<div className="flex items-baseline gap-2">
								<span
									aria-hidden
									className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${unread ? "bg-[var(--accent)]" : "bg-transparent"}`}
								/>
								<span
									className={`min-w-0 flex-1 truncate text-[length:var(--text-dense)] ${
										unread ? "font-[var(--weight-semibold)] text-[var(--ink)]" : "text-[var(--ink)]"
									}`}
								>
									{participantsLine(thread.participants, "Me")}
								</span>
								{thread.messageCount > 1 ? (
									<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										{thread.messageCount}
									</span>
								) : null}
								<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
									{formatWhen(thread.lastMessageAt)}
								</span>
							</div>
							<div className="mt-0.5 flex items-baseline gap-2 pl-3.5">
								<span
									className={`min-w-0 flex-1 truncate text-[length:var(--text-dense)] ${
										unread ? "font-[var(--weight-medium)]" : ""
									}`}
								>
									{thread.subject}
								</span>
								{thread.hasAttachments ? (
									<span
										className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]"
										title="Has attachments"
									>
										file
									</span>
								) : null}
							</div>
							<div className="mt-0.5 flex items-baseline gap-2 pl-3.5">
								<span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{thread.snippet}
								</span>
								{thread.clientName ? (
									<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										{thread.clientName}
									</span>
								) : null}
							</div>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
