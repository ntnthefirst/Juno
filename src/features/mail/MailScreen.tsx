import { useCallback, useEffect, useState } from "react";
import type {
	MailAccount,
	MailFolder,
	MailOutboxMessage,
	MailSyncStatus,
	MailThreadSummary,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { ComposeDialog, type ComposeSeed } from "./ComposeDialog";
import { FolderNav, type NavSelection } from "./FolderNav";
import { describeMailFileResult, isSyncing } from "./format";
import { LinkClientDialog } from "./LinkClientDialog";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { OutboxDetail } from "./OutboxDetail";
import { OutboxList } from "./OutboxList";
import { ThreadList, type ThreadBulkAction, type ThreadRowAction } from "./ThreadList";
import { ThreadView } from "./ThreadView";

type LinkTarget = { threadId: string; currentClientId: string | null; senderAddress: string | null };

/** The widest horizon mail-accounts.ts accepts, which is ten years of mail. */
const EVERYTHING_DAYS = 3650;

/**
 * Three panes: where (accounts, folders and the outbox), what (threads or
 * composed messages), and the thing itself. Search replaces the folder with a
 * ranked list across the account.
 */
export function MailScreen() {
	const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
	const [folders, setFolders] = useState<Record<string, MailFolder[]>>({});
	const [selection, setSelection] = useState<NavSelection | null>(null);
	const [search, setSearch] = useState("");
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [threads, setThreads] = useState<MailThreadSummary[] | null>(null);
	const [outboxRows, setOutboxRows] = useState<MailOutboxMessage[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
	const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
	const [selectedOutboxId, setSelectedOutboxId] = useState<string | null>(null);
	const [sync, setSync] = useState<Record<string, MailSyncStatus>>({});
	const [notice, setNotice] = useState<string | null>(null);
	const [compose, setCompose] = useState<ComposeSeed | null>(null);
	const [accountsVersion, setAccountsVersion] = useState(0);
	const [outboxVersion, setOutboxVersion] = useState(0);
	const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [moveTarget, setMoveTarget] = useState<string[] | null>(null);
	const [moveBusy, setMoveBusy] = useState(false);
	const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);

	const loadAccounts = useCallback(async () => {
		const list = await window.juno.mail.accounts.list();
		const byAccount: Record<string, MailFolder[]> = {};
		for (const account of list) {
			byAccount[account.id] = await window.juno.mail.folders.list(account.id);
		}
		return { list, byAccount };
	}, []);

	useEffect(() => {
		let cancelled = false;
		loadAccounts()
			.then(({ list, byAccount }) => {
				if (cancelled) return;
				setAccounts(list);
				setFolders(byAccount);
				setSelection((current) => {
					if (current && list.some((a) => a.id === current.accountId)) return current;
					if (list.length === 0) return null;
					return current ?? { accountId: null, folderId: null, view: "inbox" };
				});
			})
			.catch((cause: unknown) => {
				if (!cancelled) setNotice(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [loadAccounts, accountsVersion, outboxVersion]);

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.sync
			.status()
			.then((list) => {
				if (cancelled) return;
				setSync(Object.fromEntries(list.map((s) => [s.accountId, s])));
			})
			.catch(() => undefined);
		const offSync = window.juno.mail.sync.onChange((status) => {
			setSync((current) => ({ ...current, [status.accountId]: status }));
			// A finished run means new rows: refresh the counts and the list.
			if (status.phase === "done" || status.phase === "failed") {
				setAccountsVersion((v) => v + 1);
			}
		});
		// The sender reports as it works, so the outbox moves without a reload.
		const offOutbox = window.juno.mail.outbox.onChange(() => setOutboxVersion((v) => v + 1));
		return () => {
			cancelled = true;
			offSync();
			offOutbox();
		};
	}, []);

	const term = search.trim();
	const showingOutbox = selection?.view === "outbox";
	const showingDrafts = selection?.view === "drafts" && !showingOutbox;

	const fetchThreads = useCallback(() => {
		if (!selection || selection.view === "outbox") return Promise.resolve<MailThreadSummary[]>([]);
		return window.juno.mail.threads.list({
			...(selection.accountId ? { accountId: selection.accountId } : {}),
			...(term
				? { search: term }
				: selection.folderId
					? { folderId: selection.folderId }
					: { folderSpecialUse: selection.view }),
			unreadOnly,
			limit: 100,
		});
	}, [selection, term, unreadOnly]);

	useEffect(() => {
		if (showingOutbox) return;
		let cancelled = false;
		const id = setTimeout(
			() => {
				fetchThreads()
					.then((rows) => {
						if (cancelled) return;
						setThreads(rows);
						setListError(null);
					})
					.catch((cause: unknown) => {
						if (!cancelled) setListError(messageOf(cause));
					});
			},
			term ? 200 : 0,
		);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [fetchThreads, term, accountsVersion, showingOutbox]);

	useEffect(() => {
		if (!showingOutbox || !selection) return;
		let cancelled = false;
		window.juno.mail.outbox
			.list({ ...(selection.accountId ? { accountId: selection.accountId } : {}), limit: 200 })
			.then((rows) => {
				if (cancelled) return;
				setOutboxRows(rows);
				setListError(null);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setListError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [showingOutbox, selection, outboxVersion]);

	/**
	 * Widens the horizon and pulls again.
	 *
	 * The horizon is what bounds a first sync, and at its default of ninety days
	 * an account whose mail is older than that looks almost empty with nothing
	 * on screen saying why. Raising it makes the next run list the folder from
	 * the new date, because the folder records the horizon it was walked with.
	 */
	async function pullEverything(ids: string[]) {
		try {
			for (const id of ids) {
				await window.juno.mail.accounts.update(id, { horizonDays: EVERYTHING_DAYS });
			}
			setAccountsVersion((v) => v + 1);
			setNotice("Pulling everything. A large mailbox takes several runs.");
			await Promise.all(ids.map((id) => window.juno.mail.sync.run(id)));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function syncNow(accountId?: string) {
		try {
			await window.juno.mail.sync.run(accountId);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function enableFolderSync(folder: MailFolder) {
		try {
			await window.juno.mail.folders.setSyncEnabled(folder.id, true);
			setAccountsVersion((v) => v + 1);
			await syncNow(folder.accountId);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function reply(messageId: string, all: boolean) {
		try {
			const seed = await window.juno.mail.outbox.replySeed(messageId, all);
			setCompose({
				accountId: seed.accountId,
				to: seed.to,
				cc: seed.cc,
				subject: seed.subject,
				bodyText: `\n\n${seed.quotedText}`,
				replyToMessageId: seed.replyToMessageId,
				clientId: seed.clientId,
			});
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function toggleThreadSelection(id: string) {
		setSelectedThreadIds((current) => {
			if (current.includes(id)) return current.filter((item) => item !== id);
			return [...current, id];
		});
	}

	function clearThreadSelection() {
		setSelectedThreadIds([]);
	}

	function threadById(id: string): MailThreadSummary | null {
		return threads?.find((t) => t.id === id) ?? null;
	}

	// After a filing action, the affected threads are gone from this list:
	// drop them from the selection and the open reader, and refresh the counts
	// and the list itself.
	function afterFile(ids: string[]) {
		setSelectedThreadIds((current) => current.filter((id) => !ids.includes(id)));
		setSelectedThreadId((current) => (current && ids.includes(current) ? null : current));
		setAccountsVersion((v) => v + 1);
	}

	async function fileThreads(action: "archive" | "junk", ids: string[]) {
		if (ids.length === 0) return;
		try {
			const result = await window.juno.mail.file[action](ids);
			afterFile(ids);
			setNotice(describeMailFileResult(action === "archive" ? "archived" : "moved to junk", ids.length, result));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function setThreadsReadState(ids: string[], seen: boolean) {
		if (ids.length === 0) return;
		try {
			await window.juno.mail.file.setThreadsSeen(ids, seen);
			setAccountsVersion((v) => v + 1);
			const noun = ids.length === 1 ? "thread" : "threads";
			setNotice(seen ? `Marked ${ids.length} ${noun} as read.` : `Marked ${ids.length} ${noun} as unread.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	function requestDelete(ids: string[]) {
		if (ids.length === 0) return;
		setDeleteConfirm(ids);
	}

	async function confirmDelete() {
		if (!deleteConfirm) return;
		setDeleteBusy(true);
		try {
			const count = await window.juno.mail.file.deleteForever(deleteConfirm);
			afterFile(deleteConfirm);
			setNotice(`${count} ${count === 1 ? "thread" : "threads"} deleted.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		} finally {
			setDeleteBusy(false);
			setDeleteConfirm(null);
		}
	}

	function requestMove(ids: string[]) {
		if (ids.length === 0) return;
		const accountIds = new Set(
			ids.map((id) => threadById(id)?.accountId).filter((id): id is string => Boolean(id)),
		);
		if (accountIds.size !== 1) {
			setNotice("Select threads from one account to move them together.");
			return;
		}
		setMoveTarget(ids);
	}

	async function confirmMove(folderId: string) {
		if (!moveTarget) return;
		setMoveBusy(true);
		try {
			const result = await window.juno.mail.file.moveToFolder(moveTarget, folderId);
			afterFile(moveTarget);
			setNotice(describeMailFileResult(`moved to ${result.folderName}`, moveTarget.length, result));
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		} finally {
			setMoveBusy(false);
			setMoveTarget(null);
		}
	}

	function handleBulkAction(action: ThreadBulkAction) {
		const ids = [...selectedThreadIds];
		if (action === "archive") void fileThreads("archive", ids);
		else if (action === "markRead") void setThreadsReadState(ids, true);
		else if (action === "move") requestMove(ids);
		else if (action === "delete") requestDelete(ids);
	}

	function handleRowAction(action: ThreadRowAction, thread: MailThreadSummary) {
		switch (action) {
			case "markRead":
				void setThreadsReadState([thread.id], true);
				break;
			case "markUnread":
				void setThreadsReadState([thread.id], false);
				break;
			case "archive":
				void fileThreads("archive", [thread.id]);
				break;
			case "junk":
				void fileThreads("junk", [thread.id]);
				break;
			case "move":
				requestMove([thread.id]);
				break;
			case "link":
				setLinkTarget({
					threadId: thread.id,
					currentClientId: thread.clientId,
					senderAddress: thread.participants[0]?.address ?? null,
				});
				break;
			case "delete":
				requestDelete([thread.id]);
				break;
		}
	}

	if (accounts === null) {
		return (
			<div className="p-8">
				<p className="text-[var(--ink-muted)]">Loading.</p>
			</div>
		);
	}

	if (accounts.length === 0) {
		return (
			<div className="p-8">
				<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">Mail</h1>
				<div className="mt-12 max-w-[52ch]">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">No accounts yet</h2>
					<p className="mt-2 text-[var(--ink-muted)]">
						Juno reads mail over IMAP, from an account you type in yourself. It pulls mail onto this machine
						and sends only what you press Send on.
					</p>
					{/*
						Settings is a separate window, so this opens it on the page that
						does the job rather than leaving someone to find the tab
						(main/windows/chrome.ts carries the section in the URL).
					*/}
					<div className="mt-6">
						<Button
							variant="primary"
							onClick={() => void window.juno.window.openSettings("mail")}
						>
							Connect an account
						</Button>
					</div>
				</div>
			</div>
		);
	}

	const anySyncing = Object.values(sync).some(isSyncing);
	const selectedOutbox = outboxRows?.find((m) => m.id === selectedOutboxId) ?? null;
	const activeFolders = selection?.accountId ? (folders[selection.accountId] ?? []) : [];
	const selectedFolder = selection?.folderId
		? (activeFolders.find((f) => f.id === selection.folderId) ?? null)
		: null;
	const moveAccountId = moveTarget ? (threadById(moveTarget[0] ?? "")?.accountId ?? null) : null;

	return (
		<div className="flex h-full min-h-0">
			<div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--line)]">
				<div className="flex items-center justify-between px-5 pt-6 pb-3">
					<h1 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
						Mail
					</h1>
					<Button
						size="dense"
						disabled={anySyncing}
						onClick={() => void syncNow()}
					>
						{anySyncing ? "Syncing" : "Sync now"}
					</Button>
				</div>
				<div className="px-5 pb-3">
					<Button
						variant="primary"
						size="dense"
						onClick={() => setCompose({ accountId: selection?.accountId ?? accounts[0]?.id })}
					>
						New message
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
					<FolderNav
						accounts={accounts}
						folders={folders}
						sync={sync}
						selection={selection}
						onSelect={(next) => {
							setSelection(next);
							setSelectedThreadId(null);
							setSelectedOutboxId(null);
							clearThreadSelection();
						}}
						onSyncAccount={(id) => void syncNow(id)}
					/>
				</div>
			</div>

			<div className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--line)]">
				{selectedThreadId && !showingOutbox ? (
					<ThreadView
						key={selectedThreadId}
						threadId={selectedThreadId}
						onChanged={() => setAccountsVersion((v) => v + 1)}
						onNotice={setNotice}
						onReply={(messageId, all) => void reply(messageId, all)}
					/>
				) : showingOutbox && selectedOutbox ? (
					<OutboxDetail
						key={`${selectedOutbox.id}:${selectedOutbox.updatedAt}`}
						message={selectedOutbox}
						onEdit={(draft) => setCompose({ draft })}
						onChanged={() => setOutboxVersion((v) => v + 1)}
						onNotice={setNotice}
					/>
				) : (
					<div className="flex h-full min-h-0 flex-col">
						{showingOutbox ? (
							<div className="px-4 pt-6 pb-3">
								<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Outbox</h2>
							</div>
						) : (
							<div className="flex items-center gap-2 px-4 pt-6 pb-3">
								<input
									type="search"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="Search mail"
									aria-label="Search mail"
									className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
								/>
								<Button
									size="dense"
									aria-pressed={unreadOnly}
									onClick={() => setUnreadOnly((current) => !current)}
								>
									<span className={unreadOnly ? "text-[var(--accent)]" : ""}>Unread</span>
								</Button>
							</div>
						)}

						{!showingOutbox && selectedFolder && !selectedFolder.syncEnabled ? (
							<div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 py-2">
								<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									This folder is not synced, so nothing here reflects the server yet.
								</p>
								<Button size="dense" onClick={() => void enableFolderSync(selectedFolder)}>
									Sync this folder
								</Button>
							</div>
						) : null}

						{showingDrafts ? (
							<div className="mx-4 mb-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Unsent drafts live in the outbox, not here.{" "}
								<button
									type="button"
									onClick={() => setSelection({ accountId: null, folderId: null, view: "outbox" })}
									className="text-[var(--accent)] hover:underline"
								>
									Go to outbox
								</button>
							</div>
						) : null}

						<div className="min-h-0 flex-1 overflow-y-auto">
							{showingOutbox ? (
								<OutboxList
									messages={outboxRows}
									error={listError}
									selectedId={selectedOutboxId}
									onSelect={setSelectedOutboxId}
								/>
							) : (
								<ThreadList
									threads={threads}
									error={listError}
									searching={term.length > 0}
									selectedId={selectedThreadId}
									selectedIds={selectedThreadIds}
									onSelect={setSelectedThreadId}
									onToggleSelect={toggleThreadSelection}
									onClearSelection={clearThreadSelection}
									onBulkAction={handleBulkAction}
									onRowAction={handleRowAction}
								/>
							)}
							{!showingOutbox && term.length === 0 ? (
								<HorizonNote
									accounts={
										selection?.accountId
											? accounts.filter((account) => account.id === selection.accountId)
											: accounts
									}
									onPullEverything={(ids) => void pullEverything(ids)}
								/>
							) : null}
						</div>
					</div>
				)}
			</div>

			{compose ? (
				<ComposeDialog
					seed={compose}
					onClose={() => setCompose(null)}
					onDone={(message, queued) => {
						setCompose(null);
						setNotice(queued ? "Message queued." : "Draft saved.");
						setOutboxVersion((v) => v + 1);
						setSelection({ accountId: message.accountId, folderId: null, view: "outbox" });
						setSelectedOutboxId(message.id);
					}}
				/>
			) : null}

			{deleteConfirm ? (
				<Dialog title="Delete" onClose={() => (!deleteBusy ? setDeleteConfirm(null) : undefined)} width="narrow">
					<p className="mt-4 text-[var(--ink-muted)]">
						Delete {deleteConfirm.length} {deleteConfirm.length === 1 ? "thread" : "threads"} forever? The copy
						on the mail server is deleted too. This cannot be undone.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button disabled={deleteBusy} onClick={() => setDeleteConfirm(null)}>
							Keep
						</Button>
						<Button variant="danger" disabled={deleteBusy} onClick={() => void confirmDelete()}>
							Delete forever
						</Button>
					</div>
				</Dialog>
			) : null}

			{moveTarget ? (
				<MoveToFolderDialog
					folders={moveAccountId ? (folders[moveAccountId] ?? []) : []}
					count={moveTarget.length}
					busy={moveBusy}
					onClose={() => (!moveBusy ? setMoveTarget(null) : undefined)}
					onMove={(folderId) => void confirmMove(folderId)}
				/>
			) : null}

			{linkTarget ? (
				<LinkClientDialog
					threadId={linkTarget.threadId}
					currentClientId={linkTarget.currentClientId}
					senderAddress={linkTarget.senderAddress}
					onClose={() => setLinkTarget(null)}
					onLinked={() => {
						setLinkTarget(null);
						setAccountsVersion((v) => v + 1);
					}}
				/>
			) : null}

			{notice ? (
				<Toast
					message={notice}
					onDismiss={() => setNotice(null)}
				/>
			) : null}
		</div>
	);
}

type HorizonNoteProps = {
	accounts: MailAccount[];
	onPullEverything: (accountIds: string[]) => void;
};

/**
 * Why the list stops where it does.
 *
 * A first sync reaches back as far as the account's horizon and no further, so
 * an address whose mail is older than that shows a handful of messages and
 * looks broken. Nothing said so anywhere, and the setting is in a different
 * window. This says it under the last row, where the question gets asked.
 */
function HorizonNote({ accounts, onPullEverything }: HorizonNoteProps) {
	const bounded = accounts.filter((account) => account.horizonDays < EVERYTHING_DAYS);
	if (bounded.length === 0) return null;
	const days = Math.min(...bounded.map((account) => account.horizonDays));

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
			<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Juno pulled the last <span className="tabular">{days}</span> days. Anything older is still
				on the server and is not on this machine yet.
			</p>
			<Button size="dense" onClick={() => onPullEverything(bounded.map((account) => account.id))}>
				Pull everything
			</Button>
		</div>
	);
}
