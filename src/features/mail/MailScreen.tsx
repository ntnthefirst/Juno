import { useCallback, useEffect, useState } from "react";
import type { MailAccount, MailFolder, MailOutboxMessage, MailSyncStatus, MailThreadSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { ComposeDialog, type ComposeSeed } from "./ComposeDialog";
import { FolderNav, type NavSelection } from "./FolderNav";
import { isSyncing } from "./format";
import { OutboxDetail } from "./OutboxDetail";
import { OutboxList } from "./OutboxList";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";

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

	async function syncNow(accountId?: string) {
		try {
			await window.juno.mail.sync.run(accountId);
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

	function bulkAction(action: "archive" | "delete") {
		if (selectedThreadIds.length === 0) return;
		const ids = [...selectedThreadIds];
		setSelectedThreadIds([]);
		setThreads((current) => (current ? current.filter((thread) => !ids.includes(thread.id)) : current));
		setSelectedThreadId((current) => (current && ids.includes(current) ? null : current));
		setNotice(
			action === "archive"
				? `${ids.length} ${ids.length === 1 ? "thread" : "threads"} moved to archive.`
				: `${ids.length} ${ids.length === 1 ? "thread" : "threads"} removed from this machine.`,
		);
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
									onSelectAll={() => {
										if (!threads) return;
										setSelectedThreadIds(threads.map((thread) => thread.id));
									}}
									onClearSelection={clearThreadSelection}
									onBulkAction={bulkAction}
								/>
							)}
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

			{notice ? (
				<Toast
					message={notice}
					onDismiss={() => setNotice(null)}
				/>
			) : null}
		</div>
	);
}
