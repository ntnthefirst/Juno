import type { MailAccount, MailFolder, MailOutboxCounts, MailSyncStatus } from "@shared/types";
import { describeSync, isSyncing } from "./format";

export type NavSelection = { accountId: string; folderId: string | null; outbox: boolean };

type FolderNavProps = {
	accounts: MailAccount[];
	folders: Record<string, MailFolder[]>;
	sync: Record<string, MailSyncStatus>;
	outbox: Record<string, MailOutboxCounts>;
	selection: NavSelection | null;
	onSelect: (next: NavSelection) => void;
	onSyncAccount: (accountId: string) => void;
};

/**
 * Accounts as headings, synced folders under each, unsynced ones dimmed. The
 * status line under an account says what the sync is doing or what failed,
 * in the same words the settings screen uses.
 */
export function FolderNav({ accounts, folders, sync, outbox, selection, onSelect, onSyncAccount }: FolderNavProps) {
	return (
		<div className="flex flex-col gap-6">
			{accounts.map((account) => {
				const status = sync[account.id] ?? null;
				const failed = status?.phase === "failed" || (!isSyncing(status) && account.lastSyncError);
				const line = failed
					? (status?.error ?? account.lastSyncError ?? "Sync failed.")
					: describeSync(status, account.lastSyncAt);
				const list = folders[account.id] ?? [];
				const counts = outbox[account.id] ?? null;
				const outboxActive = selection?.accountId === account.id && selection.outbox;
				const waiting = counts ? counts.pending + counts.queued + counts.failed : 0;
				return (
					<div key={account.id}>
						<button
							type="button"
							onClick={() => onSelect({ accountId: account.id, folderId: null, outbox: false })}
							className={[
								"flex w-full items-center rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-sm)] font-[var(--weight-medium)] uppercase tracking-[0.06em]",
								selection?.accountId === account.id && selection.folderId === null && !selection.outbox
									? "bg-[var(--accent-soft)] text-[var(--accent)]"
									: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
							].join(" ")}
							style={{ height: "var(--row-height)" }}
							title={account.email}
						>
							<span className="truncate">{account.label}</span>
						</button>

						{list.length === 0 ? (
							<p className="px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								No folders yet. Sync to list them.
							</p>
						) : (
							<div className="mt-px flex flex-col gap-px">
								{list.map((folder) => {
									const active =
										selection?.accountId === account.id && selection.folderId === folder.id && !selection.outbox;
									return (
										<button
											key={folder.id}
											type="button"
											onClick={() => onSelect({ accountId: account.id, folderId: folder.id, outbox: false })}
											aria-current={active ? "true" : undefined}
											style={{ height: "var(--row-height)" }}
											className={[
												"flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)]",
												active
													? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
													: folder.syncEnabled
														? "text-[var(--ink)] hover:bg-[var(--hover)]"
														: "text-[var(--ink-muted)] hover:bg-[var(--hover)]",
											].join(" ")}
											title={folder.syncEnabled ? folder.path : `${folder.path} (not synced)`}
										>
											<span className="min-w-0 flex-1 truncate">{folder.name}</span>
											{folder.unreadCount > 0 ? (
												<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">
													{folder.unreadCount}
												</span>
											) : null}
										</button>
									);
								})}
							</div>
						)}

						<button
							type="button"
							onClick={() => onSelect({ accountId: account.id, folderId: null, outbox: true })}
							aria-current={outboxActive ? "true" : undefined}
							style={{ height: "var(--row-height)" }}
							className={[
								"mt-px flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)]",
								outboxActive
									? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
									: "text-[var(--ink)] hover:bg-[var(--hover)]",
							].join(" ")}
							title={counts ? `${counts.pending} waiting for you, ${counts.queued} queued, ${counts.failed} failed, ${counts.drafts} drafts` : "Outbox"}
						>
							<span className="min-w-0 flex-1 truncate">Outbox</span>
							{counts && counts.pending > 0 ? (
								<span className="tabular rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-1.5 text-[length:var(--text-micro)] text-[var(--warn)]">
									{counts.pending}
								</span>
							) : waiting > 0 ? (
								<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">{waiting}</span>
							) : null}
						</button>

						<button
							type="button"
							onClick={() => onSyncAccount(account.id)}
							disabled={isSyncing(status)}
							className={[
								"mt-2 block w-full truncate px-3 text-left text-[length:var(--text-micro)] hover:underline disabled:no-underline",
								failed ? "text-[var(--risk)]" : "text-[var(--ink-muted)]",
							].join(" ")}
							title={failed ? line : "Sync this account now"}
						>
							{line}
						</button>
					</div>
				);
			})}
		</div>
	);
}
