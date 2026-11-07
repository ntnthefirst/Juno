import { useCallback, useEffect, useState } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { MenuButton } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";

type ProjectMailProps = {
	projectId: string;
	/** Bumped by the page when something it did changes the list, such as linking a mail. */
	version: number;
	onLinkMail: () => void;
	/** The list changed here, so the counts on the page behind it have to read again. */
	onChanged: () => void;
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

/** Who the conversation is with: the first other person on it. */
function withWhom(thread: MailThreadSummary): string {
	const first = thread.participants[0];
	if (!first) return thread.clientName ?? "";
	return first.name || first.address;
}

/**
 * The conversations filed under this project, newest first: the client's, and
 * a supplier's about the same job. Linking is the picker's job (LinkMailDialog)
 * or the reader's menu in Mail, and a reply sent from the project files itself.
 * Opening one goes to Mail. Unlinking takes it off the project and nothing else:
 * the mail stays in the mailbox.
 */
export function ProjectMail({ projectId, version, onLinkMail, onChanged }: ProjectMailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [local, setLocal] = useState(0);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.threads
			.list({ projectId, limit: 100 })
			.then((threads) => {
				if (!cancelled) setLoad({ status: "ready", threads });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, version, local]);

	const unlink = useCallback(
		(thread: MailThreadSummary) => {
			void window.juno.mail.threads
				.linkProject(thread.id, null)
				.then(() => {
					setLocal((value) => value + 1);
					onChanged();
				})
				.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
		},
		[onChanged],
	);

	return (
		<section className="flex min-h-[320px] flex-1 flex-col rounded-[var(--radius-lg)] border border-[var(--line)] p-5">
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-baseline gap-3">
					<h2 className="text-base font-[var(--weight-medium)]">Linked mail</h2>
					<span className="text-sm text-[var(--ink-muted)]">Threads you linked to this project</span>
				</div>
				<Button size="dense" onClick={onLinkMail}>
					Link a mail
				</Button>
			</div>

			<div className="mt-3 flex-1">
				{load.status === "loading" ? (
					<p className="text-sm text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<p data-selectable className="text-sm text-[var(--risk)]">
						{load.message}
					</p>
				) : load.threads.length === 0 ? (
					<p className="text-sm text-[var(--ink-muted)]">
						No conversations linked yet. Link one here, or from its menu in Mail.
					</p>
				) : (
					<ul className="flex flex-col">
						{load.threads.map((thread) => (
							<li key={thread.id} className="group flex items-center gap-1">
								<button
									type="button"
									onClick={() => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId })}
									className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] px-1 py-2 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								>
									<Avatar name={withWhom(thread) || thread.subject} size={32} />
									<span className="min-w-0 flex-1">
										<span
											className={`block truncate text-dense ${
												thread.unreadCount > 0 ? "font-[var(--weight-semibold)]" : "font-[var(--weight-medium)]"
											}`}
										>
											{withWhom(thread)}
										</span>
										<span className="block truncate text-sm text-[var(--ink-muted)]">
											{thread.subject}
											{thread.snippet ? `  ${thread.snippet}` : ""}
										</span>
									</span>
									{thread.hasAttachments ? (
										<span className="flex-none text-[var(--ink-muted)]" aria-label="Has attachments">
											<Icon name="attachment" size={14} />
										</span>
									) : null}
									<span className="tabular flex-none text-sm text-[var(--ink-muted)]">
										{whenOf(thread.lastMessageAt)}
									</span>
								</button>
								<MenuButton
									ariaLabel={`Actions for ${thread.subject}`}
									items={[
										{
											id: "unlink",
											label: "Unlink from this project",
											icon: "remove",
											onSelect: () => unlink(thread),
										},
									]}
								/>
							</li>
						))}
					</ul>
				)}
			</div>

			<p className="mt-4 text-sm text-[var(--ink-muted)]">
				Mail stays in your mailbox. Linking only shows the thread here.
			</p>
		</section>
	);
}
