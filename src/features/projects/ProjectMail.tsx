import { useEffect, useState } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";

type ProjectMailProps = {
	projectId: string;
	/** The page's own section heading, so the two read the same. */
	heading: (title: string) => React.ReactNode;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; threads: MailThreadSummary[] }
	| { status: "error"; message: string };

/** A day, in the reader's own calendar. Local time is a display concern. */
function dayOf(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Who the conversation is with: the first other person on it. */
function withWhom(thread: MailThreadSummary): string {
	const first = thread.participants[0];
	if (!first) return "";
	const more = thread.participants.length > 1 ? ` and ${thread.participants.length - 1} more` : "";
	return `${first.name || first.address}${more}`;
}

/**
 * The conversations filed under this project, newest first: the client's, and
 * a supplier's about the same job. Filed from the reader's menu, or by a reply
 * sent from the project. Opening one goes to Mail.
 */
export function ProjectMail({ projectId, heading }: ProjectMailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.threads
			.list({ projectId, limit: 20 })
			.then((threads) => {
				if (!cancelled) setLoad({ status: "ready", threads });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	return (
		<section className="mt-8">
			{heading("Mail")}
			{load.status === "loading" ? (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Loading.</p>
			) : load.status === "error" ? (
				<p data-selectable className="text-[length:var(--text-sm)] text-[var(--risk)]">
					{load.message}
				</p>
			) : load.threads.length === 0 ? (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					No conversations yet. File one here from its menu in Mail.
				</p>
			) : (
				<ul className="flex flex-col">
					{load.threads.map((thread) => (
						<li key={thread.id} className="border-b border-[var(--line)]">
							<button
								type="button"
								onClick={() => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId })}
								className="flex w-full items-center gap-3 px-2 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								style={{ height: "var(--row-height)" }}
							>
								<span className="flex-none text-[var(--ink-muted)]">
									<Icon name="mail" size={16} />
								</span>
								<span
									className={`min-w-0 flex-1 truncate text-[length:var(--text-dense)] ${
										thread.unreadCount > 0 ? "font-[var(--weight-semibold)]" : ""
									}`}
								>
									{thread.subject}
								</span>
								<span className="hidden min-w-0 max-w-[30%] truncate text-[length:var(--text-micro)] text-[var(--ink-muted)] sm:block">
									{withWhom(thread)}
								</span>
								{thread.hasAttachments ? (
									<span className="flex-none text-[var(--ink-muted)]" aria-label="Has attachments">
										<Icon name="attachment" size={14} />
									</span>
								) : null}
								<span className="tabular flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
									{dayOf(thread.lastMessageAt)}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
