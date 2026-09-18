import { useCallback, useEffect, useState } from "react";
import type { MailAccount, MailFolder, MailSyncStatus, MailThreadSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { FolderNav } from "./FolderNav";
import { isSyncing } from "./format";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";

type Selection = { accountId: string; folderId: string | null };

/**
 * Three panes: where (accounts and folders), what (threads), and the thread
 * itself. Search replaces the folder with a ranked list across the account.
 */
export function MailScreen() {
	const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
	const [folders, setFolders] = useState<Record<string, MailFolder[]>>({});
	const [selection, setSelection] = useState<Selection | null>(null);
	const [search, setSearch] = useState("");
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [threads, setThreads] = useState<MailThreadSummary[] | null>(null);
	const [threadError, setThreadError] = useState<string | null>(null);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
	const [sync, setSync] = useState<Record<string, MailSyncStatus>>({});
	const [notice, setNotice] = useState<string | null>(null);
	const [accountsVersion, setAccountsVersion] = useState(0);

	const loadAccounts = useCallback(async () => {
		const list = await window.bureau.mail.accounts.list();
		const byAccount: Record<string, MailFolder[]> = {};
		for (const account of list) {
			byAccount[account.id] = await window.bureau.mail.folders.list(account.id);
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
					const first = list[0];
					if (!first) return null;
					const inbox = byAccount[first.id]?.find((f) => f.specialUse === "inbox");
					return { accountId: first.id, folderId: inbox?.id ?? null };
				});
			})
			.catch((cause: unknown) => {
				if (!cancelled) setNotice(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [loadAccounts, accountsVersion]);

	useEffect(() => {
		let cancelled = false;
		window.bureau.mail.sync
			.status()
			.then((list) => {
				if (cancelled) return;
				setSync(Object.fromEntries(list.map((s) => [s.accountId, s])));
			})
			.catch(() => undefined);
		const off = window.bureau.mail.sync.onChange((status) => {
			setSync((current) => ({ ...current, [status.accountId]: status }));
			// A finished run means new rows: refresh the counts and the list.
			if (status.phase === "done" || status.phase === "failed") {
				setAccountsVersion((v) => v + 1);
			}
		});
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	const term = search.trim();

	const fetchThreads = useCallback(() => {
		if (!selection) return Promise.resolve<MailThreadSummary[]>([]);
		return window.bureau.mail.threads.list({
			accountId: selection.accountId,
			...(term ? { search: term } : selection.folderId ? { folderId: selection.folderId } : {}),
			unreadOnly,
			limit: 100,
		});
	}, [selection, term, unreadOnly]);

	useEffect(() => {
		let cancelled = false;
		const id = setTimeout(
			() => {
				fetchThreads()
					.then((rows) => {
						if (cancelled) return;
						setThreads(rows);
						setThreadError(null);
					})
					.catch((cause: unknown) => {
						if (!cancelled) setThreadError(messageOf(cause));
					});
			},
			term ? 200 : 0,
		);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [fetchThreads, term, accountsVersion]);

	async function syncNow(accountId?: string) {
		try {
			await window.bureau.mail.sync.run(accountId);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
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
				<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
					Mail
				</h1>
				<div className="mt-12 max-w-[52ch]">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">No accounts yet</h2>
					<p className="mt-2 text-[var(--ink-muted)]">
						Add an IMAP account under Settings, then come back here. Bureau pulls mail onto this
						machine and never writes anything back to the server.
					</p>
				</div>
			</div>
		);
	}

	const anySyncing = Object.values(sync).some(isSyncing);

	return (
		<div className="flex h-full min-h-0">
			<div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--line)]">
				<div className="flex items-center justify-between px-5 pt-6 pb-3">
					<h1 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
						Mail
					</h1>
					<Button size="dense" disabled={anySyncing} onClick={() => void syncNow()}>
						{anySyncing ? "Syncing" : "Sync now"}
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
						}}
						onSyncAccount={(id) => void syncNow(id)}
					/>
				</div>
			</div>

			<div className="flex w-[400px] shrink-0 flex-col border-r border-[var(--line)]">
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
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ThreadList
						threads={threads}
						error={threadError}
						searching={term.length > 0}
						selectedId={selectedThreadId}
						onSelect={setSelectedThreadId}
					/>
				</div>
			</div>

			<div className="min-w-0 flex-1 overflow-y-auto">
				{selectedThreadId ? (
					<ThreadView
						key={selectedThreadId}
						threadId={selectedThreadId}
						onChanged={() => setAccountsVersion((v) => v + 1)}
						onNotice={setNotice}
					/>
				) : (
					<div className="flex h-full items-center justify-center">
						<p className="text-[var(--ink-faint)]">Select a thread to read it</p>
					</div>
				)}
			</div>

			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</div>
	);
}
