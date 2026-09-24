import { useCallback, useEffect, useState } from "react";
import type {
	MailAccount,
	MailFolder,
	MailOutboxMessage,
	MailReplyMode,
	MailSyncStatus,
	MailThreadSummary,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { ComposePage, type ComposeSeed } from "./ComposePage";
import { FolderFormPage, type FolderFormTarget } from "./FolderFormPage";
import { FolderNav, type FolderAction, type NavSelection } from "./FolderNav";
import { describeMailFileResult, isSyncing } from "./format";
import { LinkClientDialog } from "./LinkClientDialog";
import { NO_FILTERS, type MailFilters } from "./mail-filters";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { OutboxDetail } from "./OutboxDetail";
import { OutboxList } from "./OutboxList";
import { ThreadList, type ThreadAction } from "./ThreadList";
import { ThreadToolbar } from "./ThreadToolbar";
import { ThreadView } from "./ThreadView";

type LinkTarget = { threadId: string; currentClientId: string | null; senderAddress: string | null };

/** The widest horizon mail-accounts.ts accepts, which is ten years of mail. */
const EVERYTHING_DAYS = 3650;

/**
 * Rows per page, and the ceiling the service will answer with.
 *
 * Asking for a bigger page rather than keeping a cursor is deliberate here: a
 * filing action refreshes the list, and a cursor would collapse it back to the
 * first page every time somebody archived something halfway down.
 */
const PAGE = 100;
const MAX_ROWS = 500;

/**
 * Three panes: where (accounts and folders), what (threads or, inside
 * Drafts, whatever an account has not sent yet), and the thing itself. Search
 * replaces the folder with a ranked list across the account.
 *
 * Writing a message and making a folder take the screen over rather than
 * floating above it, because both have fields in them (decision 30).
 */
export function MailScreen() {
	const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
	const [folders, setFolders] = useState<Record<string, MailFolder[]>>({});
	const [selection, setSelection] = useState<NavSelection | null>(null);
	const [search, setSearch] = useState("");
	const [filters, setFilters] = useState<MailFilters>(NO_FILTERS);
	const [rowLimit, setRowLimit] = useState(PAGE);
	const [threads, setThreads] = useState<MailThreadSummary[] | null>(null);
	const [outboxRows, setOutboxRows] = useState<MailOutboxMessage[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
	const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
	const [lastPicked, setLastPicked] = useState<string | null>(null);
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
	const [folderForm, setFolderForm] = useState<FolderFormTarget | null>(null);
	const [folderDelete, setFolderDelete] = useState<MailFolder | null>(null);
	const [folderEmpty, setFolderEmpty] = useState<MailFolder | null>(null);
	const [folderBusy, setFolderBusy] = useState(false);

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
					// The inbox of the first account, by id, so the list is a folder
					// rather than everything that has ever been synced.
					const first = list[0];
					const inbox = first ? byAccount[first.id]?.find((f) => f.specialUse === "inbox") : undefined;
					if (current) return current;
					return first && inbox
						? { accountId: first.id, folderId: inbox.id, view: "inbox" }
						: { accountId: null, folderId: null, view: "inbox" };
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
	// Drafts is where a draft, a pending approval, a queued or failed send all
	// show: everything not sent yet, for the account it belongs to. A sent
	// message drops out of this list on its own and shows up in Sent instead.
	const showingDrafts = selection?.view === "drafts";
	const inTrash = selection?.view === "trash";

	const fetchThreads = useCallback(() => {
		if (!selection || selection.view === "drafts") return Promise.resolve<MailThreadSummary[]>([]);
		return window.juno.mail.threads.list({
			...(selection.accountId ? { accountId: selection.accountId } : {}),
			...(term
				? { search: term }
				: selection.folderId
					? { folderId: selection.folderId }
					: { folderSpecialUse: selection.view }),
			unreadOnly: filters.unreadOnly,
			flaggedOnly: filters.flaggedOnly,
			withAttachments: filters.withAttachments,
			...(filters.fromAddress.trim() ? { fromAddress: filters.fromAddress.trim() } : {}),
			...(filters.since ? { since: filters.since } : {}),
			...(filters.until ? { until: filters.until } : {}),
			limit: rowLimit,
		});
	}, [selection, term, filters, rowLimit]);

	useEffect(() => {
		if (showingDrafts) return;
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
	}, [fetchThreads, term, accountsVersion, showingDrafts]);

	useEffect(() => {
		if (!showingDrafts || !selection) return;
		let cancelled = false;
		window.juno.mail.outbox
			.list({
				...(selection.accountId ? { accountId: selection.accountId } : {}),
				// Everything not sent yet. A sent message already has its place in
				// Sent once it syncs, so it drops out of this list rather than
				// doubling up.
				states: ["draft", "pending", "queued", "sending", "failed", "cancelled"],
				limit: 200,
			})
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
	}, [showingDrafts, selection, outboxVersion]);

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

	async function reply(messageId: string, mode: MailReplyMode) {
		try {
			const seed = await window.juno.mail.outbox.replySeed(messageId, mode);
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

	/**
	 * Shift extends from the row picked last, which is what a list does
	 * everywhere else. A plain pick toggles the one row.
	 */
	function toggleThreadSelection(id: string, extend: boolean) {
		const rows = threads ?? [];
		if (extend && lastPicked) {
			const from = rows.findIndex((t) => t.id === lastPicked);
			const to = rows.findIndex((t) => t.id === id);
			if (from >= 0 && to >= 0) {
				const span = rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((t) => t.id);
				setSelectedThreadIds((current) => [...new Set([...current, ...span])]);
				setLastPicked(id);
				return;
			}
		}
		setSelectedThreadIds((current) =>
			current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
		);
		setLastPicked(id);
	}

	/**
	 * The box takes the rows on screen without dropping what a previous search
	 * put in the selection. Picking a few, searching again and adding a few more
	 * is the whole point of leaving search working.
	 */
	function selectEveryThread() {
		const rows = (threads ?? []).map((thread) => thread.id);
		setSelectedThreadIds((current) => [...new Set([...current, ...rows])]);
		setLastPicked(rows[rows.length - 1] ?? null);
	}

	function clearThreadSelection() {
		setSelectedThreadIds([]);
		setLastPicked(null);
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

	async function fileThreads(action: "archive" | "junk" | "trash", ids: string[]) {
		if (ids.length === 0) return;
		const verbs = { archive: "archived", junk: "moved to junk", trash: "moved to trash" };
		try {
			const result = await window.juno.mail.file[action](ids);
			afterFile(ids);
			setNotice(describeMailFileResult(verbs[action], ids.length, result));
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

	async function setThreadsFlagged(ids: string[], flagged: boolean) {
		if (ids.length === 0) return;
		try {
			// Flags live on messages, and a thread's flag is every message in it.
			const messageIds: string[] = [];
			for (const id of ids) {
				const thread = await window.juno.mail.threads.get(id);
				for (const message of thread?.messages ?? []) messageIds.push(message.id);
			}
			await window.juno.mail.file.setFlagged(messageIds, flagged);
			setAccountsVersion((v) => v + 1);
			const noun = ids.length === 1 ? "thread" : "threads";
			setNotice(flagged ? `Flagged ${ids.length} ${noun}.` : `Cleared the flag on ${ids.length} ${noun}.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
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

	async function moveThreadsTo(ids: string[], folderId: string) {
		const result = await window.juno.mail.file.moveToFolder(ids, folderId);
		afterFile(ids);
		setNotice(describeMailFileResult(`moved to ${result.folderName}`, ids.length, result));
	}

	async function confirmMove(folderId: string) {
		if (!moveTarget) return;
		setMoveBusy(true);
		try {
			await moveThreadsTo(moveTarget, folderId);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		} finally {
			setMoveBusy(false);
			setMoveTarget(null);
		}
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

	function handleThreadAction(action: ThreadAction, ids: string[]) {
		if (ids.length === 0) return;
		switch (action) {
			case "open":
				setSelectedThreadId(ids[0] ?? null);
				break;
			case "markRead":
				void setThreadsReadState(ids, true);
				break;
			case "markUnread":
				void setThreadsReadState(ids, false);
				break;
			case "flag":
				void setThreadsFlagged(ids, true);
				break;
			case "unflag":
				void setThreadsFlagged(ids, false);
				break;
			case "archive":
				void fileThreads("archive", ids);
				break;
			case "junk":
				void fileThreads("junk", ids);
				break;
			case "trash":
				void fileThreads("trash", ids);
				break;
			case "move":
				requestMove(ids);
				break;
			case "link": {
				const thread = threadById(ids[0] ?? "");
				if (thread) {
					setLinkTarget({
						threadId: thread.id,
						currentClientId: thread.clientId,
						senderAddress: thread.participants[0]?.address ?? null,
					});
				}
				break;
			}
			case "deleteForever":
				setDeleteConfirm(ids);
				break;
		}
	}

	function handleFolderAction(action: FolderAction, folder: MailFolder) {
		switch (action) {
			case "new":
				setFolderForm({ mode: "create", accountId: folder.accountId, parent: null });
				break;
			case "newInside":
				setFolderForm({ mode: "create", accountId: folder.accountId, parent: folder });
				break;
			case "rename":
				setFolderForm({ mode: "rename", folder });
				break;
			case "toggleSync":
				void (async () => {
					try {
						await window.juno.mail.folders.setSyncEnabled(folder.id, !folder.syncEnabled);
						setAccountsVersion((v) => v + 1);
						if (!folder.syncEnabled) await syncNow(folder.accountId);
					} catch (cause: unknown) {
						setNotice(messageOf(cause));
					}
				})();
				break;
			case "markAllRead":
				void (async () => {
					try {
						const count = await window.juno.mail.file.setFolderSeen(folder.id, true);
						setAccountsVersion((v) => v + 1);
						setNotice(`Marked ${count} ${count === 1 ? "message" : "messages"} as read.`);
					} catch (cause: unknown) {
						setNotice(messageOf(cause));
					}
				})();
				break;
			case "empty":
				setFolderEmpty(folder);
				break;
			case "remove":
				setFolderDelete(folder);
				break;
		}
	}

	async function confirmFolderEmpty() {
		if (!folderEmpty) return;
		setFolderBusy(true);
		try {
			const count = await window.juno.mail.file.emptyFolder(folderEmpty.id);
			setSelectedThreadId(null);
			clearThreadSelection();
			setAccountsVersion((v) => v + 1);
			setNotice(`${count} ${count === 1 ? "message" : "messages"} deleted from ${folderEmpty.name}.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		} finally {
			setFolderBusy(false);
			setFolderEmpty(null);
		}
	}

	async function confirmFolderDelete() {
		if (!folderDelete) return;
		setFolderBusy(true);
		try {
			await window.juno.mail.folders.remove(folderDelete.id);
			if (selection?.folderId === folderDelete.id) {
				setSelection({ accountId: folderDelete.accountId, folderId: null, view: "inbox" });
			}
			setAccountsVersion((v) => v + 1);
			setNotice(`${folderDelete.name} deleted.`);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		} finally {
			setFolderBusy(false);
			setFolderDelete(null);
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
						<Button variant="primary" onClick={() => void window.juno.window.openSettings("mail")}>
							Connect an account
						</Button>
					</div>
				</div>
			</div>
		);
	}

	// A form takes the screen. Both of these have fields in them, and neither
	// belongs over the top of the list it came from.
	if (compose) {
		return (
			<ComposePage
				seed={compose}
				onClose={() => setCompose(null)}
				onDone={(message, queued) => {
					setCompose(null);
					setNotice(queued ? "Message queued." : "Draft saved.");
					setOutboxVersion((v) => v + 1);
					const draftsFolderId = folders[message.accountId]?.find((f) => f.specialUse === "drafts")?.id ?? null;
					setSelection({ accountId: message.accountId, folderId: draftsFolderId, view: "drafts" });
					setSelectedOutboxId(message.id);
				}}
			/>
		);
	}

	if (folderForm) {
		return (
			<FolderFormPage
				target={folderForm}
				onClose={() => setFolderForm(null)}
				onDone={(folder, verb) => {
					setFolderForm(null);
					setAccountsVersion((v) => v + 1);
					setNotice(`${folder.name} ${verb}.`);
				}}
			/>
		);
	}

	const anySyncing = Object.values(sync).some(isSyncing);
	const selectedOutbox = outboxRows?.find((m) => m.id === selectedOutboxId) ?? null;
	const activeFolders = selection?.accountId ? (folders[selection.accountId] ?? []) : [];
	const selectedFolder = selection?.folderId
		? (activeFolders.find((f) => f.id === selection.folderId) ?? null)
		: null;
	const moveAccountId = moveTarget ? (threadById(moveTarget[0] ?? "")?.accountId ?? null) : null;
	const pending = Object.values(sync).reduce((total, status) => total + status.pending, 0);

	return (
		<div className="flex h-full min-h-0">
			<div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--line)]">
				<div className="flex items-center justify-between px-5 pt-6 pb-3">
					<h1 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
						Mail
					</h1>
					{/*
						Syncing is continuous and says so here. There is no button for it:
						a mail client that needs to be told to fetch mail is one that has
						already failed at the only thing it has to do on its own.
					*/}
					{anySyncing ? (
						<span
							className="flex items-center gap-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]"
							title="Syncing"
						>
							<Icon name="sync" size={12} />
							Syncing
						</span>
					) : null}
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
							setRowLimit(PAGE);
						}}
						onSyncAccount={(id) => void syncNow(id)}
						onFolderAction={handleFolderAction}
						onNewFolder={(accountId) => setFolderForm({ mode: "create", accountId, parent: null })}
						onDropThreads={(folderId, ids) => {
							void moveThreadsTo(ids, folderId).catch((cause: unknown) => setNotice(messageOf(cause)));
						}}
					/>
				</div>
			</div>

			<div className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--line)]">
				{selectedThreadId && !showingDrafts ? (
					<ThreadView
						key={selectedThreadId}
						threadId={selectedThreadId}
						onBack={() => setSelectedThreadId(null)}
						inTrash={inTrash}
						onChanged={() => setAccountsVersion((v) => v + 1)}
						onNotice={setNotice}
						onReply={(messageId, mode) => void reply(messageId, mode)}
						onAction={(action) => handleThreadAction(action, [selectedThreadId])}
					/>
				) : showingDrafts && selectedOutbox ? (
					<OutboxDetail
						key={`${selectedOutbox.id}:${selectedOutbox.updatedAt}`}
						message={selectedOutbox}
						onEdit={(draft) => setCompose({ draft })}
						onChanged={() => setOutboxVersion((v) => v + 1)}
						onNotice={setNotice}
					/>
				) : (
					<div className="flex h-full min-h-0 flex-col">
						{showingDrafts ? (
							<div className="px-4 pt-6 pb-3">
								<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Drafts</h2>
							</div>
						) : (
							<ThreadToolbar
								search={search}
								onSearch={(value) => {
									setSearch(value);
									setRowLimit(PAGE);
								}}
								filters={filters}
								onFilters={(next) => {
									setFilters(next);
									setRowLimit(PAGE);
								}}
								inTrash={inTrash}
								visibleIds={(threads ?? []).map((thread) => thread.id)}
								selectedIds={selectedThreadIds}
								onSelectAll={selectEveryThread}
								onClearSelection={clearThreadSelection}
								onAction={handleThreadAction}
							/>
						)}

						{!showingDrafts && selectedFolder && !selectedFolder.syncEnabled ? (
							<div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 py-2">
								<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									This folder is not synced, so nothing here reflects the server yet.
								</p>
								<Button size="dense" onClick={() => void enableFolderSync(selectedFolder)}>
									Sync this folder
								</Button>
							</div>
						) : null}

						<div className="min-h-0 flex-1 overflow-y-auto">
							{showingDrafts ? (
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
									inTrash={inTrash}
									selectedId={selectedThreadId}
									selectedIds={selectedThreadIds}
									onSelect={setSelectedThreadId}
									onToggleSelect={toggleThreadSelection}
									onAction={handleThreadAction}
								/>
							)}
							{!showingDrafts && threads !== null && threads.length >= rowLimit && rowLimit < MAX_ROWS ? (
								<div className="flex justify-center px-4 py-3">
									<Button
										size="dense"
										onClick={() => setRowLimit((current) => Math.min(current + PAGE, MAX_ROWS))}
									>
										Show more
									</Button>
								</div>
							) : null}

							{!showingDrafts && term.length === 0 ? (
								<HorizonNote
									accounts={
										selection?.accountId
											? accounts.filter((account) => account.id === selection.accountId)
											: accounts
									}
									pending={pending}
									onPullEverything={(ids) => void pullEverything(ids)}
								/>
							) : null}
						</div>
					</div>
				)}
			</div>

			{deleteConfirm ? (
				<Dialog
					title="Delete"
					onClose={() => (!deleteBusy ? setDeleteConfirm(null) : undefined)}
					width="narrow"
				>
					<p className="mt-4 text-[var(--ink-muted)]">
						Delete {deleteConfirm.length} {deleteConfirm.length === 1 ? "thread" : "threads"} forever? The
						copy on the mail server is deleted too. This cannot be undone.
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

			{folderDelete ? (
				<Dialog
					title="Delete folder"
					onClose={() => (!folderBusy ? setFolderDelete(null) : undefined)}
					width="narrow"
				>
					<p className="mt-4 text-[var(--ink-muted)]">
						Delete {folderDelete.name} from the mail server, with the{" "}
						<span className="tabular">{folderDelete.messageCount}</span>{" "}
						{folderDelete.messageCount === 1 ? "message" : "messages"} in it? This cannot be undone.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button disabled={folderBusy} onClick={() => setFolderDelete(null)}>
							Keep
						</Button>
						<Button variant="danger" disabled={folderBusy} onClick={() => void confirmFolderDelete()}>
							Delete folder
						</Button>
					</div>
				</Dialog>
			) : null}

			{folderEmpty ? (
				<Dialog
					title={`Empty ${folderEmpty.name}`}
					onClose={() => (!folderBusy ? setFolderEmpty(null) : undefined)}
					width="narrow"
				>
					<p className="mt-4 text-[var(--ink-muted)]">
						Delete all <span className="tabular">{folderEmpty.messageCount}</span>{" "}
						{folderEmpty.messageCount === 1 ? "message" : "messages"} in {folderEmpty.name}? They are deleted
						from the mail server too. This cannot be undone.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button disabled={folderBusy} onClick={() => setFolderEmpty(null)}>
							Keep
						</Button>
						<Button variant="danger" disabled={folderBusy} onClick={() => void confirmFolderEmpty()}>
							Empty folder
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

			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</div>
	);
}

type HorizonNoteProps = {
	accounts: MailAccount[];
	/** Messages a bounded run knows about and has not fetched yet. */
	pending: number;
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
function HorizonNote({ accounts, pending, onPullEverything }: HorizonNoteProps) {
	const bounded = accounts.filter((account) => account.horizonDays < EVERYTHING_DAYS);
	if (bounded.length === 0) {
		return pending > 0 ? (
			<p className="px-4 py-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				<span className="tabular">{pending}</span> more messages are still coming in.
			</p>
		) : null;
	}
	const days = Math.min(...bounded.map((account) => account.horizonDays));

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
			<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Juno pulled the last <span className="tabular">{days}</span> days. Anything older is still on the
				server and is not on this machine yet.
				{pending > 0 ? (
					<>
						{" "}
						<span className="tabular">{pending}</span> more are still coming in.
					</>
				) : null}
			</p>
			<Button size="dense" onClick={() => onPullEverything(bounded.map((account) => account.id))}>
				Pull everything
			</Button>
		</div>
	);
}
