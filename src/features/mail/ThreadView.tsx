import { useEffect, useRef, useState } from "react";
import type { MailReplyMode, MailThread } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
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

	async function copyOpenAddress(address: string) {
		try {
			await navigator.clipboard.writeText(address);
			onNotice("Address copied.");
		} catch {
			onNotice("Could not copy the address.");
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

	// Newest unseen message first, else the newest message, the same rule a
	// person reading top to bottom would end up at. Keeps the current choice
	// across a refresh as long as it still exists in the thread.
	if (load.thread !== derivedFrom) {
		const fallback = messages.find((m) => !m.isSeen) ?? messages[messages.length - 1] ?? null;
		const next = openId && messages.some((m) => m.id === openId) ? openId : (fallback?.id ?? null);
		setDerivedFrom(load.thread);
		if (next !== openId) setOpenId(next);
	}

	const openMessage = messages.find((m) => m.id === openId) ?? null;
	const senderAddress = summary.participants[0]?.address ?? null;
	const showReplyAll = openMessage ? openMessage.to.length + openMessage.cc.length > 1 : false;

	const moreItems: MenuItem[] = [
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
					<Icon name="chevron-left" size={12} />
					Back
				</button>

				<div className="mt-2 flex items-start justify-between gap-6">
					<h2 className="min-w-0 text-[length:var(--text-h3)] font-[var(--weight-semibold)] leading-[var(--leading-tight)] tracking-[-0.01em]">
						{summary.subject}
					</h2>
					<div className="flex shrink-0 items-center gap-1">
						{openMessage ? (
							<ReplyButton onReply={(mode) => onReply(openMessage.id, mode)} showReplyAll={showReplyAll} />
						) : null}
						<ToolbarAction
							icon="flag"
							label={summary.isFlagged ? "Clear flag" : "Flag"}
							onClick={() => onAction(summary.isFlagged ? "unflag" : "flag")}
						/>
						<ToolbarAction icon="archive" label="Archive" onClick={() => onAction("archive")} />
						<ToolbarAction
							icon="remove"
							label={inTrash ? "Delete forever" : "Move to trash"}
							danger
							onClick={() => onAction(inTrash ? "deleteForever" : "trash")}
						/>
						<MenuButton items={moreItems} ariaLabel="More options" />
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
						{messages.length} {messages.length === 1 ? "message" : "messages"}
					</p>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{messages.map((message) => (
					<MessageView
						key={message.id}
						message={message}
						open={message.id === openId}
						onToggle={() => setOpenId((current) => (current === message.id ? null : message.id))}
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

type ReplyButtonProps = {
	onReply: (mode: MailReplyMode) => void;
	/** Whether more than one person other than the sender is on this message. */
	showReplyAll: boolean;
};

/**
 * Reply, plus a chevron for reply all and forward. Answering is the point of
 * reading a message, so it is one click rather than something behind a menu;
 * the chevron holds the two modes that are not the common case.
 */
function ReplyButton({ onReply, showReplyAll }: ReplyButtonProps) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [at, setAt] = useState<{ x: number; y: number } | null>(null);

	function open() {
		const box = trigger.current?.getBoundingClientRect();
		if (!box) return;
		setAt({ x: box.left, y: box.bottom + 4 });
	}

	const items: MenuItem[] = [
		...(showReplyAll
			? [{ id: "reply-all", label: "Reply all", icon: "reply" as const, onSelect: () => onReply("reply_all") }]
			: []),
		{ id: "forward", label: "Forward", icon: "forward", onSelect: () => onReply("forward") },
	];

	return (
		<div className="inline-flex h-[32px] shrink-0 items-stretch overflow-hidden rounded-[var(--radius-md)]">
			<button
				type="button"
				onClick={() => onReply("reply")}
				className="inline-flex items-center gap-1.5 bg-[var(--accent)] px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"
			>
				<Icon name="reply" size={14} />
				Reply
			</button>
			<button
				ref={trigger}
				type="button"
				aria-label="More reply options"
				aria-haspopup="menu"
				aria-expanded={at !== null}
				onClick={() => (at ? setAt(null) : open())}
				className={`inline-flex w-[22px] items-center justify-center border-l border-[var(--accent-ink)]/25 bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] ${at !== null ? "bg-[var(--accent-hover)]" : ""}`}
			>
				<Icon name="chevron-down" size={12} />
			</button>
			{at ? <ContextMenu at={at} items={items} onClose={() => setAt(null)} ariaLabel="More reply options" /> : null}
		</div>
	);
}
