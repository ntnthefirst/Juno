import { useEffect, useState } from "react";
import type { MailMessage, MailReplyMode, MailThread, MailThreadOutgoing } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { LinkClientDialog } from "./LinkClientDialog";
import { MessageView } from "./MessageView";
import { ConversationPanel, type ThreadEntry } from "./ConversationPanel";
import { OutgoingMessageView } from "./OutgoingMessageView";
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
	/** Opens a draft, a message waiting for approval or a failed send in the composer. */
	onEditDraft: (outboxId: string) => void;
};

const OVERVIEW_KEY = "juno.mail.conversation-open";

function noop() {}

function readOverviewOpen(): boolean {
	try {
		return localStorage.getItem(OVERVIEW_KEY) !== "0";
	} catch {
		return true;
	}
}

/**
 * Synced messages and the replies still waiting for their Sent copy, in date
 * order. Both lists arrive oldest first, so this is a merge, and on a tie the
 * synced message goes first because it is the record.
 */
function interleave(messages: MailMessage[], outgoing: MailThreadOutgoing[]): ThreadEntry[] {
	const out: ThreadEntry[] = [];
	let m = 0;
	let o = 0;
	while (m < messages.length || o < outgoing.length) {
		const message = messages[m];
		const sent = outgoing[o];
		if (message && (!sent || message.internalDate <= sent.date)) {
			out.push({ kind: "message", message });
			m += 1;
		} else if (sent) {
			out.push({ kind: "outgoing", message: sent });
			o += 1;
		}
	}
	return out;
}

type Load =
	| { status: "loading" }
	| { status: "ready"; thread: MailThread; threadId: string }
	| { status: "error"; message: string; threadId: string };

export function ThreadView({
	threadId,
	onBack,
	inTrash = false,
	onChanged,
	onNotice,
	onReply,
	onAction,
	onEditDraft,
}: ThreadViewProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [linking, setLinking] = useState(false);
	// The overview of the whole conversation is a choice that holds between threads.
	const [overviewOpen, setOverviewOpen] = useState(readOverviewOpen);
	const [version, setVersion] = useState(0);
	// The thread shows one open message at a time. Opening another collapses
	// whichever was open, so there is always exactly one message whose content
	// is the thing filling the screen.
	const [openId, setOpenId] = useState<string | null>(null);
	// Which loaded thread `openId` was last derived from, so a fresh load (the
	// first one, or a refresh after a version bump) settles openId in the same
	// render rather than through an effect.
	const [derivedFrom, setDerivedFrom] = useState<MailThread | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.threads
			.get(threadId)
			.then((thread) => {
				if (cancelled) return;
				setLoad(
					thread
						? { status: "ready", thread, threadId }
						: { status: "error", message: "That thread is gone.", threadId },
				);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause), threadId });
			});
		return () => {
			cancelled = true;
		};
	}, [threadId, version]);

	// A reply to this thread moving from queued to sent, or being sent from
	// another window, changes what the reader lists as outgoing.
	useEffect(
		() =>
			window.juno.mail.outbox.onChange((message) => {
				if (message.threadId === threadId) setVersion((v) => v + 1);
			}),
		[threadId],
	);

	// A file action on one message (read, flag) or a client link change both
	// mean the thread and the list behind it are out of date.
	function toggleOverview() {
		const next = !overviewOpen;
		setOverviewOpen(next);
		try {
			localStorage.setItem(OVERVIEW_KEY, next ? "1" : "0");
		} catch {
			// The choice just does not outlive this window.
		}
	}

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

	async function copyOpenAddress(address: string) {
		try {
			await navigator.clipboard.writeText(address);
			onNotice("Address copied.");
		} catch {
			onNotice("Could not copy the address.");
		}
	}

	if (load.status === "loading" || load.threadId !== threadId) {
		return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (load.status === "error") {
		return (
			<div className="p-8">
				<p
					data-selectable
					className="text-[var(--risk)]"
				>
					{load.message}
				</p>
			</div>
		);
	}

	const { summary, messages, outgoing } = load.thread;
	const entries = interleave(messages, outgoing);

	// Start with the first message in the thread, so opening a conversation shows
	// the message represented by the clicked row rather than a later reply.
	// Keep the current choice across a refresh as long as it still exists.
	if (load.thread !== derivedFrom) {
		const fallback = messages[0] ?? entries[0]?.message ?? null;
		const next = openId && entries.some((e) => e.message.id === openId) ? openId : (fallback?.id ?? null);
		setDerivedFrom(load.thread);
		if (next !== openId) setOpenId(next);
	}

	const selected = entries.find((e) => e.message.id === openId) ?? null;
	const openMessage = messages.find((m) => m.id === openId) ?? null;
	const senderAddress = summary.participants[0]?.address ?? null;

	const moreItems: MenuItem[] = [
		{ id: "archive", label: "Archive", icon: "archive", onSelect: () => onAction("archive") },
		{ id: "mark-unread", label: "Mark unread", icon: "unread", onSelect: () => onAction("markUnread") },
		{ id: "move", label: "Move to folder", icon: "projects", onSelect: () => onAction("move") },
		{ id: "junk", label: "Junk", icon: "junk", onSelect: () => onAction("junk") },
		{
			id: "link-client",
			label: summary.clientName ? "Change client" : "Link to client",
			icon: "link",
			separatorBefore: true,
			onSelect: () => setLinking(true),
		},
		...(summary.clientName
			? [{ id: "unlink-client", label: "Unlink client", icon: "link" as const, onSelect: () => void unlink() }]
			: []),
		{
			id: "copy-address",
			label: "Copy sender address",
			icon: "copy",
			disabled: !openMessage?.from,
			separatorBefore: true,
			onSelect: () => void copyOpenAddress(openMessage?.from?.address ?? ""),
		},
	];

	return (
		<div className="flex h-full min-h-0 flex-col animate-fade">
			<div className="shrink-0 border-b border-[var(--line)] px-8 pb-4 pt-6">
				<button
					type="button"
					onClick={onBack}
					className="-ml-1.5 inline-flex h-[24px] items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon
						name="chevron-left"
						size={12}
					/>
					Back
				</button>

				<div className="mt-2 flex items-start justify-between gap-6">
					<h2 className="min-w-0 text-[length:var(--text-h3)] font-[var(--weight-semibold)] leading-[var(--leading-tight)] tracking-[-0.01em]">
						{summary.subject}
					</h2>
					<div className="flex shrink-0 items-center gap-1">
						{openMessage ? (
							<>
								<ToolbarAction
									icon="reply"
									label="Reply"
									onClick={() => onReply(openMessage.id, "reply")}
								/>
								<ToolbarAction
									icon="forward"
									label="Forward"
									onClick={() => onReply(openMessage.id, "forward")}
								/>
							</>
						) : null}
						<ToolbarAction
							icon="branch"
							label={overviewOpen ? "Hide the conversation" : "Show the conversation"}
							pressed={overviewOpen}
							onClick={toggleOverview}
						/>
						<ToolbarAction
							icon="flag"
							label={summary.isFlagged ? "Clear flag" : "Flag"}
							onClick={() => onAction(summary.isFlagged ? "unflag" : "flag")}
						/>
						<ToolbarAction
							icon="remove"
							label={inTrash ? "Delete forever" : "Move to trash"}
							danger
							onClick={() => onAction(inTrash ? "deleteForever" : "trash")}
						/>
						<MenuButton
							items={moreItems}
							ariaLabel="More options"
						/>
					</div>
				</div>

				<div className="mt-2 flex items-center gap-2">
					{summary.clientName ? (
						<span className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--accent)]">
							{summary.clientName}
							{summary.linkSource === "auto" ? (
								<span className="text-[var(--ink-muted)]"> (matched)</span>
							) : null}
						</span>
					) : null}
					<p className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{entries.length} {entries.length === 1 ? "message" : "messages"}
					</p>
				</div>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
					{selected ? (
						selected.kind === "message" ? (
							<MessageView
								key={selected.message.id}
								message={selected.message}
								clientLinked={summary.clientId !== null}
								open
								onToggle={noop}
								onNotice={onNotice}
								onReply={onReply}
								onChanged={refresh}
							/>
						) : (
							<OutgoingMessageView
								key={selected.message.id}
								message={selected.message}
								open
								onToggle={noop}
								onEdit={onEditDraft}
							/>
						)
					) : null}
				</div>
				{overviewOpen ? (
					<ConversationPanel entries={entries} openId={openId} onSelect={setOpenId} />
				) : null}
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
	/** A toggle that is on. */
	pressed?: boolean;
	onClick: () => void;
};

/** A 32px icon button in the reader's toolbar. The label is its only wording. */
function ToolbarAction({ icon, label, danger = false, pressed, onClick }: ToolbarActionProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			onClick={onClick}
			className={[
				"inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)]",
				"transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				danger
					? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
					: pressed
						? "bg-[var(--accent-soft)] text-[var(--accent)]"
						: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon
				name={icon}
				size={14}
			/>
		</button>
	);
}
