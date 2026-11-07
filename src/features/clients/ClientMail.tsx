import { useEffect, useState } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";

type ClientMailProps = {
	clientId: string;
	onNewMessage: () => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; threads: MailThreadSummary[] }
	| { status: "error"; message: string };

/** Time today, the weekday this week, the day and month before that. Local time is a display concern. */
function whenOf(iso: string): string {
	const date = new Date(iso);
	const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
	if (new Date().toDateString() === date.toDateString()) {
		return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	}
	if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "short" });
	return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function withWhom(thread: MailThreadSummary): string {
	const first = thread.participants[0];
	if (!first) return thread.clientName ?? "";
	return first.name || first.address;
}

/**
 * The conversations filed under this client, newest first, as the Mail tab of
 * the client record draws them. Opening one goes to Mail, like the palette.
 */
export function ClientMail({ clientId, onNewMessage }: ClientMailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.threads
			.list({ clientId, limit: 100 })
			.then((threads) => {
				if (!cancelled) setLoad({ status: "ready", threads });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	return (
		<section>
			<div className="mt-6 mb-4 flex items-center justify-between gap-4">
				<h3 className="text-h3">Mail</h3>
				<button
					type="button"
					onClick={onNewMessage}
					className="rounded-[var(--radius-sm)] text-base text-[var(--accent)] hover:text-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					New message
				</button>
			</div>

			{load.status === "loading" ? (
				<p className="text-base text-[var(--ink-muted)]">Loading.</p>
			) : load.status === "error" ? (
				<p data-selectable className="text-base text-[var(--risk)]">
					{load.message}
				</p>
			) : load.threads.length === 0 ? (
				<p className="text-base text-[var(--ink-muted)]">No mail linked to this client yet.</p>
			) : (
				<ul className="flex flex-col">
					{load.threads.map((thread) => (
						<li key={thread.id} className="border-b border-[var(--line)]">
							<button
								type="button"
								onClick={() => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId })}
								className="flex w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] px-1 py-3 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<span
									aria-hidden
									className={`h-1.5 w-1.5 flex-none rounded-[var(--radius-full)] ${thread.unreadCount > 0 ? "bg-[var(--accent)]" : "bg-transparent"}`}
								/>
								<Avatar name={withWhom(thread) || thread.subject} size={32} />
								<span className="min-w-0 flex-1">
									<span
										className={`block truncate text-base ${
											thread.unreadCount > 0 ? "font-[var(--weight-semibold)]" : "font-[var(--weight-medium)]"
										}`}
									>
										{withWhom(thread)}
									</span>
									<span className="block truncate text-base text-[var(--ink-muted)]">
										{thread.subject}
										{thread.snippet ? `  ${thread.snippet}` : ""}
									</span>
								</span>
								{thread.hasAttachments ? (
									<span className="flex-none text-[var(--ink-muted)]" aria-label="Has attachments">
										<Icon name="attachment" size={14} />
									</span>
								) : null}
								<span className="tabular flex-none text-base text-[var(--ink-muted)]">{whenOf(thread.lastMessageAt)}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
