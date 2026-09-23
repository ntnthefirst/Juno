import type { MailAccount, MailFolder, MailSpecialUse, MailSyncStatus } from "@shared/types";
import { describeSync, isSyncing } from "./format";

export type MailView = MailSpecialUse | "outbox";
export type NavSelection = { accountId: string | null; folderId: string | null; view: MailView };

type FolderNavProps = {
	accounts: MailAccount[];
	folders: Record<string, MailFolder[]>;
	sync: Record<string, MailSyncStatus>;
	selection: NavSelection | null;
	onSelect: (next: NavSelection) => void;
	onSyncAccount: (accountId: string) => void;
};

const SPECIAL_ORDER: MailSpecialUse[] = ["inbox", "drafts", "sent", "archive", "junk", "trash"];
const SPECIAL_LABELS: Record<MailSpecialUse, string> = {
	inbox: "Inbox",
	drafts: "Drafts",
	sent: "Sent",
	archive: "Archive",
	junk: "Junk",
	trash: "Trash",
};

/**
 * Every folder listed here is one the account actually has, with the count
 * that folder really carries. Picking a folder nobody has synced used to land
 * on a silent empty list; now that folder is not offered until a sync makes
 * it real, which is also why there is no unified "Inbox" spanning accounts
 * that have not all synced one.
 */
export function FolderNav({ accounts, folders, sync, selection, onSelect, onSyncAccount }: FolderNavProps) {
	return (
		<div className="flex flex-col gap-4">
			<button
				type="button"
				onClick={() => onSelect({ accountId: null, folderId: null, view: "outbox" })}
				aria-current={selection?.view === "outbox" ? "true" : undefined}
				style={{ height: "var(--row-height)" }}
				className={[
					"flex w-full items-center rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)]",
					selection?.view === "outbox"
						? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
						: "text-[var(--ink)] hover:bg-[var(--hover)]",
				].join(" ")}
			>
				Outbox
			</button>

			{accounts.map((account) => {
				const status = sync[account.id] ?? null;
				const failed = status?.phase === "failed" || (!isSyncing(status) && account.lastSyncError);
				const line = failed
					? (status?.error ?? account.lastSyncError ?? "Sync failed.")
					: describeSync(status, account.lastSyncAt);
				const list = folders[account.id] ?? [];
				const special = SPECIAL_ORDER.flatMap((use) => {
					const folder = list.find((f) => f.specialUse === use);
					return folder ? [{ folder, label: SPECIAL_LABELS[use] }] : [];
				});
				const custom = list.filter((folder) => folder.specialUse === null).map((folder) => ({ folder, label: folder.name }));

				function folderRow({ folder, label }: { folder: MailFolder; label: string }) {
					const active = selection?.accountId === account.id && selection.folderId === folder.id;
					return (
						<button
							key={folder.id}
							type="button"
							onClick={() =>
								onSelect({ accountId: account.id, folderId: folder.id, view: folder.specialUse ?? "inbox" })
							}
							aria-current={active ? "true" : undefined}
							style={{ height: "var(--row-height)" }}
							className={[
								"flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)]",
								active
									? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
									: folder.syncEnabled
										? "text-[var(--ink)] hover:bg-[var(--hover)]"
										: "text-[var(--ink-muted)] opacity-60 hover:bg-[var(--hover)] hover:opacity-100",
							].join(" ")}
							title={folder.syncEnabled ? folder.path : `${folder.path} (not synced)`}
						>
							<span className="min-w-0 flex-1 truncate">{label}</span>
							{folder.unreadCount > 0 ? (
								<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">
									{folder.unreadCount}
								</span>
							) : null}
						</button>
					);
				}

				return (
					<div key={account.id}>
						<p
							className="truncate px-3 text-[length:var(--text-sm)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]"
							style={{ height: "var(--row-height)", lineHeight: "var(--row-height)" }}
							title={account.email}
						>
							{account.label}
						</p>

						{list.length === 0 ? (
							<p className="px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								No folders yet. Sync to list them.
							</p>
						) : (
							<div className="flex flex-col gap-px">
								{special.map(folderRow)}
								{custom.map(folderRow)}
							</div>
						)}

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
