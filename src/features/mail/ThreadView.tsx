import { useEffect, useState } from "react";
import type { MailReplyMode, MailThread } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { LinkClientDialog } from "./LinkClientDialog";
import { MessageView } from "./MessageView";
import type { ThreadAction } from "./ThreadList";

type ThreadViewProps = {
	threadId: string;
	/** Back to the list. Reading a thread replaces it rather than floating over it. */
	onBack: () => void;
	/** Whether this thread is in the trash, where the delete is the final one. */
	inTrash?: boolean;
	/** The thread's link changed, so the list needs a refresh. */
	onChanged: () => void;
	onNotice: (message: string) => void;
	onReply: (messageId: string, mode: MailReplyMode) => void;
	/** Filing the whole thread. The screen owns it, the same as from a list row. */
	onAction: (action: ThreadAction) => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; thread: MailThread }
	| { status: "error"; message: string };

export function ThreadView({
	threadId,
	onBack,
	inTrash = false,
	onChanged,
	onNotice,
	onReply,
	onAction,
}: ThreadViewProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [linking, setLinking] = useState(false);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.threads
			.get(threadId)
			.then((thread) => {
				if (cancelled) return;
				setLoad(thread ? { status: "ready", thread } : { status: "error", message: "That thread is gone." });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [threadId, version]);

	// A file action on one message (read, flag) or a client link change both
	// mean the thread and the list behind it are out of date.
	function refresh() {
		setVersion((v) => v + 1);
		onChanged();
	}

	async function unlink() {
		try {
			await window.juno.mail.threads.unlinkClient(threadId);
			refresh();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	if (load.status === "loading") {
		return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (load.status === "error") {
		return (
			<div className="p-8">
				<p data-selectable className="text-[var(--risk)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { summary, messages } = load.thread;
	// Everything read is collapsed except the newest, which is what a person
	// opened the thread for. Unread ones stay open too.
	const openByDefault = new Set(
		messages.filter((m, index) => !m.isSeen || index === messages.length - 1).map((m) => m.id),
	);
	const senderAddress = summary.participants[0]?.address ?? null;

	return (
		<div className="animate-fade px-8 py-6">
			{/*
				The reader's own toolbar. The same actions the list row offers, because
				the decision to archive something is usually made while reading it.
			*/}
			<div className="mb-4 flex items-center gap-1 border-b border-[var(--line)] pb-3">
				<button
					type="button"
					onClick={onBack}
					className="inline-flex h-[32px] items-center gap-1 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon name="chevron-left" size={14} />
					Back
				</button>
				<span className="flex-1" />
				<ToolbarAction icon="unread" label="Mark unread" onClick={() => onAction("markUnread")} />
				<ToolbarAction
					icon="flag"
					label={summary.isFlagged ? "Clear flag" : "Flag"}
					onClick={() => onAction(summary.isFlagged ? "unflag" : "flag")}
				/>
				<ToolbarAction icon="archive" label="Archive" onClick={() => onAction("archive")} />
				<ToolbarAction icon="projects" label="Move to folder" onClick={() => onAction("move")} />
				<ToolbarAction icon="junk" label="Junk" onClick={() => onAction("junk")} />
				<ToolbarAction
					icon="remove"
					label={inTrash ? "Delete forever" : "Move to trash"}
					danger
					onClick={() => onAction(inTrash ? "deleteForever" : "trash")}
				/>
			</div>

			<div className="flex items-start justify-between gap-6">
				<h2 className="min-w-0 text-[length:var(--text-h2)] font-[var(--weight-semibold)] leading-[var(--leading-tight)] tracking-[-0.01em]">
					{summary.subject}
				</h2>
				<div className="flex shrink-0 items-center gap-2">
					{summary.clientName ? (
						<>
							<span className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--accent)]">
								{summary.clientName}
								{summary.linkSource === "auto" ? (
									<span className="text-[var(--ink-muted)]"> (matched)</span>
								) : null}
							</span>
							<Button size="dense" onClick={() => setLinking(true)}>
								Change
							</Button>
							<Button size="dense" onClick={() => void unlink()}>
								Unlink
							</Button>
						</>
					) : (
						<Button size="dense" onClick={() => setLinking(true)}>
							Link to client
						</Button>
					)}
				</div>
			</div>
			<p className="tabular mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{messages.length} {messages.length === 1 ? "message" : "messages"}
			</p>

			<div className="mt-6 flex flex-col">
				{messages.map((message) => (
					<MessageView
						key={message.id}
						message={message}
						initiallyOpen={openByDefault.has(message.id)}
						onNotice={onNotice}
						onReply={onReply}
						onChanged={refresh}
					/>
				))}
			</div>

			{linking ? (
				<LinkClientDialog
					threadId={threadId}
					currentClientId={summary.clientId}
					senderAddress={senderAddress}
					onClose={() => setLinking(false)}
					onLinked={() => {
						setLinking(false);
						refresh();
					}}
				/>
			) : null}
		</div>
	);
}

type ToolbarActionProps = {
	icon: IconName;
	label: string;
	danger?: boolean;
	onClick: () => void;
};

/** A 32px icon button in the reader's toolbar. The label is its only wording. */
function ToolbarAction({ icon, label, danger = false, onClick }: ToolbarActionProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={[
				"inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)]",
				"transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				danger
					? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={14} />
		</button>
	);
}
