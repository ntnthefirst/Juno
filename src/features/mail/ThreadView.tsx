import { useEffect, useRef, useState } from "react";
import type { MailFolder, MailMessage, MailReplyMode, MailThread, MailThreadOutgoing } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon, type IconName } from "../../components/Icon";
import { ActionMenu } from "../../components/ActionMenu";
import type { MenuHandlers } from "../../lib/native-menu";
import { messageOf } from "../../lib/errors";
import { describeMailFileResult } from "./format";
import { requestOpen } from "../../lib/open-entity";
import { LinkClientDialog } from "./LinkClientDialog";
import { LinkProjectDialog } from "./LinkProjectDialog";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { MessageView } from "./MessageView";
import { ConversationPanel, type ThreadEntry } from "./ConversationPanel";
import { OutgoingMessageView } from "./OutgoingMessageView";

type ThreadViewProps = {
	threadId: string;
	/** The message the clicked row stood for. It is the one that opens. */
	messageId?: string | null;
	/** Back to the list. Reading a thread replaces it rather than floating over it. */
	onBack: () => void;
	/** The thread's link changed, so the list needs a refresh. */
	onChanged: () => void;
	onNotice: (message: string) => void;
	onReply: (messageId: string, mode: MailReplyMode) => void;
	/** Opens a draft, a message waiting for approval or a failed send in the composer. */
	onEditDraft: (outboxId: string) => void;
	/** Answering or forwarding something sent from Juno that has not synced back yet. */
	onReplyOutgoing: (outboxId: string, mode: MailReplyMode) => void;
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
	messageId = null,
	onBack,
	onChanged,
	onNotice,
	onReply,
	onEditDraft,
	onReplyOutgoing,
}: ThreadViewProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [linking, setLinking] = useState(false);
	const [filing, setFiling] = useState(false);
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
	const [moving, setMoving] = useState<MailFolder[] | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [busy, setBusy] = useState(false);
	// Read from here rather than listed as dependencies: the screen passes fresh
	// functions every render, and the effect below must run once per thread.
	const latest = useRef({ onChanged, onNotice });
	useEffect(() => {
		latest.current = { onChanged, onNotice };
	});
	const markedRead = useRef<string | null>(null);

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

	// Opening a conversation reads all of it. A thread is one thing to the person
	// reading it, so one unread message left behind in it keeps the whole row bold
	// in the list, and the messages in the folders they filed away count too.
	// Once per thread: marking one unread afterwards on purpose must stay unread
	// until it is opened again.
	useEffect(() => {
		if (load.status !== "ready" || load.threadId !== threadId) return;
		if (markedRead.current === threadId) return;
		markedRead.current = threadId;
		if (!load.thread.messages.some((message) => !message.isSeen)) return;
		window.juno.mail.file
			.setThreadsSeen([threadId], true)
			.then(() => {
				setVersion((v) => v + 1);
				latest.current.onChanged();
			})
			// Silent on purpose. The server is written first, so offline or behind a
			// wrong password this fails, and an error every time a message is read
			// would be louder than the thing it reports. It stays unread and is
			// tried again the next time the thread is opened.
			.catch(() => undefined);
	}, [load, threadId]);

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

	async function unfile() {
		try {
			await window.juno.mail.threads.linkProject(threadId, null);
			refresh();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
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

	// Open the message the clicked row stood for. Keep the current choice across
	// a refresh as long as it still exists.
	if (load.thread !== derivedFrom) {
		const wanted = messageId && entries.some((e) => e.message.id === messageId) ? messageId : null;
		const fallback = messages.at(-1) ?? entries[0]?.message ?? null;
		const kept = openId && entries.some((e) => e.message.id === openId) ? openId : null;
		const next = kept ?? wanted ?? fallback?.id ?? null;
		setDerivedFrom(load.thread);
		if (next !== openId) setOpenId(next);
	}

	const selected = entries.find((e) => e.message.id === openId) ?? null;
	const openMessage = messages.find((m) => m.id === openId) ?? null;
	const senderAddress = summary.participants[0]?.address ?? null;
	// The buttons below act on the message that is open, never on the whole
	// conversation: it spans folders, so deleting the reply you sent must not
	// take the message you received with it. An entry that is not a synced
	// message (a reply still on its way to Sent) has nothing to file, so it gets
	// no filing buttons at all.
	const inTrash = openMessage?.folderUse === "trash";

	/** Reads the message that was just picked, if it was left unread. */
	function select(id: string) {
		setOpenId(id);
		const picked = messages.find((message) => message.id === id);
		if (!picked || picked.isSeen) return;
		window.juno.mail.file
			.setSeen([id], true)
			.then(refresh)
			.catch(() => undefined);
	}

	/** After a message left, either the conversation is empty or the rest is shown. */
	function afterFiled() {
		if (entries.length <= 1) onBack();
		refresh();
	}

	async function fileOpen(action: "archive" | "junk" | "trash") {
		if (!openMessage || busy) return;
		const verbs = { archive: "archived", junk: "moved to junk", trash: "moved to trash" };
		setBusy(true);
		try {
			const result = await window.juno.mail.file[`${action}Messages`]([openMessage.id]);
			onNotice(describeMailFileResult(verbs[action], 1, result, "message"));
			afterFiled();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function deleteOpenForever() {
		if (!openMessage || busy) return;
		setBusy(true);
		try {
			await window.juno.mail.file.deleteMessagesForever([openMessage.id]);
			setConfirmingDelete(false);
			onNotice("Message deleted.");
			afterFiled();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function chooseFolder() {
		if (!openMessage) return;
		try {
			setMoving(await window.juno.mail.folders.list(openMessage.accountId));
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function moveOpenTo(folderId: string) {
		if (!openMessage || busy) return;
		setBusy(true);
		try {
			const result = await window.juno.mail.file.moveMessagesToFolder([openMessage.id], folderId);
			onNotice(describeMailFileResult(`moved to ${result.folderName}`, 1, result, "message"));
			setMoving(null);
			afterFiled();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function markOpen(change: { seen: boolean } | { flagged: boolean }) {
		if (!openMessage) return;
		try {
			if ("seen" in change) await window.juno.mail.file.setSeen([openMessage.id], change.seen);
			else await window.juno.mail.file.setFlagged([openMessage.id], change.flagged);
			refresh();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	// The "..." is the platform's menu for this conversation (decision 59). Each
	// answer is one of the things this view already does to the message in view.
	const moreHandlers: MenuHandlers = {
		archive: () => void fileOpen("archive"),
		"mark-unread": () => void markOpen({ seen: false }),
		move: () => void chooseFolder(),
		junk: () => void fileOpen("junk"),
		link: () => setLinking(true),
		"unlink-client": () => void unlink(),
		"file-project": () => setFiling(true),
		"unfile-project": () => void unfile(),
		"copy-address": () => void copyOpenAddress(openMessage?.from?.address ?? ""),
	};

	return (
		<div className="flex h-full min-h-0 flex-col animate-fade">
			<div className="shrink-0 px-6 pt-4">
				<div className="flex h-8 items-center justify-between gap-4">
					<button
						type="button"
						onClick={onBack}
						className="-ml-1.5 inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-1.5 text-base text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
					>
						<Icon name="chevron-left" size={14} />
						Back
					</button>
					<div className="flex shrink-0 items-center gap-0.5">
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
						) : selected && selected.kind === "outgoing" && ["queued", "sending", "sent"].includes(selected.message.state) ? (
							<>
								<ToolbarAction
									icon="reply"
									label="Reply"
									onClick={() => onReplyOutgoing(selected.message.id, "reply")}
								/>
								<ToolbarAction
									icon="forward"
									label="Forward"
									onClick={() => onReplyOutgoing(selected.message.id, "forward")}
								/>
							</>
						) : null}
						{openMessage ? (
							<>
								<ToolbarDivider />
								<ToolbarAction
									icon="flag"
									label={openMessage.isFlagged ? "Clear flag" : "Flag"}
									pressed={openMessage.isFlagged}
									onClick={() => void markOpen({ flagged: !openMessage.isFlagged })}
								/>
								<ToolbarAction
									icon="remove"
									label={inTrash ? "Delete this message forever" : "Move this message to trash"}
									danger
									onClick={() => (inTrash ? setConfirmingDelete(true) : void fileOpen("trash"))}
								/>
							</>
						) : null}
						<ActionMenu
							target={{ kind: "mail", id: summary.id, context: "reader" }}
							handlers={moreHandlers}
							ariaLabel="More options"
							size="dense"
						/>
						<ToolbarDivider />
						<ToolbarAction
							icon="panel"
							label={overviewOpen ? "Hide the conversation" : "Show the conversation"}
							pressed={overviewOpen}
							onClick={toggleOverview}
						/>
					</div>
				</div>

				<h2 className="mt-1 min-w-0 text-h3 text-[var(--ink)]">{summary.subject}</h2>

				{/* What the conversation belongs to, as one quiet line. The link that
				    matched it on its own and the message count are not repeated here:
				    the conversation panel already shows both. */}
				{summary.clientName || (summary.projectId && summary.projectName) ? (
					<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-[var(--ink-muted)]">
						{summary.clientName ? (
							<span className="inline-flex min-w-0 items-center gap-1.5">
								<Icon name="client" size={14} className="flex-none" />
								<span className="truncate">{summary.clientName}</span>
							</span>
						) : null}
						{summary.clientName && summary.projectId && summary.projectName ? (
							<span aria-hidden className="text-[var(--ink-faint)]">
								{"\u203a"}
							</span>
						) : null}
						{summary.projectId && summary.projectName ? (
							<button
								type="button"
								onClick={() =>
									requestOpen({ kind: "project", id: summary.projectId!, name: summary.projectName! })
								}
								title="Open the project"
								className="inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] hover:text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<Icon name="projects" size={14} className="flex-none" />
								<span className="truncate">{summary.projectName}</span>
							</button>
						) : null}
					</div>
				) : null}
				<div className="h-3" />
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
					{selected ? (
						selected.kind === "message" ? (
							<MessageView
								key={selected.message.id}
								message={selected.message}
								clientLinked={summary.clientId !== null}
								project={
									summary.projectId && summary.projectName
										? { id: summary.projectId, name: summary.projectName }
										: null
								}
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
					<ConversationPanel entries={entries} openId={openId} onSelect={select} />
				) : null}
			</div>

			{moving ? (
				<MoveToFolderDialog
					folders={moving}
					count={1}
					kind="message"
					busy={busy}
					onClose={() => (!busy ? setMoving(null) : undefined)}
					onMove={(folderId) => void moveOpenTo(folderId)}
				/>
			) : null}

			{confirmingDelete && openMessage ? (
				<Dialog title="Delete message" width="narrow" onClose={() => (!busy ? setConfirmingDelete(false) : undefined)}>
					<p className="mt-3 text-[var(--ink-muted)]">
						Delete this message from {openMessage.from?.address ?? "this sender"} forever? It is removed from the
						mail server as well as from this machine, and the rest of the conversation stays.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button disabled={busy} onClick={() => setConfirmingDelete(false)}>
							Keep
						</Button>
						<Button variant="danger" disabled={busy} onClick={() => void deleteOpenForever()}>
							{busy ? "Deleting" : "Delete forever"}
						</Button>
					</div>
				</Dialog>
			) : null}

			{filing ? (
				<LinkProjectDialog
					thread={summary}
					onClose={() => setFiling(false)}
					onLinked={() => {
						setFiling(false);
						refresh();
					}}
				/>
			) : null}
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

/** A 40px icon button in the reader's toolbar, as the Icon Button in the design. The label is its only wording. */
function ToolbarAction({ icon, label, danger = false, pressed, onClick }: ToolbarActionProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			onClick={onClick}
			className={[
				"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] active:scale-90",
				"transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)]",
				danger
					? "text-[var(--risk)] hover:bg-[var(--risk-soft)]"
					: pressed
						? "bg-[var(--accent-soft)] text-[var(--accent)]"
						: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon name={icon} size={16} />
		</button>
	);
}

/** A hairline between groups of toolbar buttons, as the reader's top bar draws it. */
function ToolbarDivider() {
	return <span aria-hidden className="mx-1 h-4 w-px flex-none bg-[var(--line)]" />;
}
