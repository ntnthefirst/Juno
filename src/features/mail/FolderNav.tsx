import { useState } from "react";
import type { MailAccount, MailFolder, MailSpecialUse, MailSyncStatus } from "@shared/types";
import { Icon } from "../../components/Icon";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { THREAD_DRAG_TYPE } from "./drag";
import {
	buildFolderTree,
	SPECIAL_ICONS,
	SPECIAL_LABELS,
	specialFolders,
	type FolderNode,
} from "./folder-tree";
import { describeSync, formatSyncWhen, isSyncing } from "./format";

export type MailView = MailSpecialUse;
export type NavSelection = { accountId: string | null; folderId: string | null; view: MailView };

export type FolderAction = "new" | "newInside" | "rename" | "remove" | "toggleSync" | "markAllRead" | "empty";

type FolderNavProps = {
	accounts: MailAccount[];
	folders: Record<string, MailFolder[]>;
	sync: Record<string, MailSyncStatus>;
	selection: NavSelection | null;
	onSelect: (next: NavSelection) => void;
	onSyncAccount: (accountId: string) => void;
	/** A folder row was asked to do something to itself, or to make a sibling. */
	onFolderAction: (action: FolderAction, folder: MailFolder) => void;
	/** The "New folder" row at the end of an account. */
	onNewFolder: (accountId: string) => void;
	/** Threads were dropped on a folder. The ids come from the drag itself. */
	onDropThreads: (folderId: string, threadIds: string[]) => void;
};

/** Thread ids off a drag, or null when the drag is carrying something else. */
function draggedThreads(event: React.DragEvent): string[] | null {
	const raw = event.dataTransfer.getData(THREAD_DRAG_TYPE);
	if (!raw) return null;
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null;
	} catch {
		return null;
	}
}

/**
 * Where mail is: every account, with the six folders it has and the tree of
 * the ones somebody made. Anything not sent yet lives under that account's
 * own Drafts, not in a separate place.
 *
 * Two things this has to get right. A folder is a drop target, and it says so
 * while something is over it, because a drag with no visible target is a guess.
 * And every folder listed is one the account really has, with the count it
 * really carries, so a row is never a dead end.
 */
export function FolderNav({
	accounts,
	folders,
	sync,
	selection,
	onSelect,
	onSyncAccount,
	onFolderAction,
	onNewFolder,
	onDropThreads,
}: FolderNavProps) {
	const menu = useContextMenu();
	// One menu for the whole nav rather than one per row, so thirty folders do
	// not each carry a portal that sits closed.
	const [target, setTarget] = useState<MailFolder | null>(null);
	const [dropOn, setDropOn] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

	const items: MenuItem[] = target
		? [
				{
					id: "mark-read",
					label: "Mark all read",
					icon: "read",
					disabled: target.unreadCount === 0,
					hint: target.unreadCount > 0 ? String(target.unreadCount) : undefined,
					onSelect: () => onFolderAction("markAllRead", target),
				},
				{
					id: "empty",
					label: `Empty ${target.name}`,
					icon: "remove",
					danger: true,
					disabled: target.messageCount === 0,
					onSelect: () => onFolderAction("empty", target),
				},
				{
					id: "new",
					label: "New folder",
					icon: "add",
					separatorBefore: true,
					onSelect: () => onFolderAction("new", target),
				},
				{
					id: "new-inside",
					label: `New folder in ${target.name}`,
					icon: "projects",
					onSelect: () => onFolderAction("newInside", target),
				},
				{
					id: "rename",
					label: "Rename",
					icon: "edit",
					separatorBefore: true,
					disabled: target.specialUse !== null,
					onSelect: () => onFolderAction("rename", target),
				},
				{
					id: "sync",
					label: target.syncEnabled ? "Stop syncing this folder" : "Sync this folder",
					icon: "sync",
					onSelect: () => onFolderAction("toggleSync", target),
				},
				{
					id: "remove",
					label: "Delete folder",
					icon: "remove",
					danger: true,
					separatorBefore: true,
					disabled: target.specialUse !== null,
					onSelect: () => onFolderAction("remove", target),
				},
			]
		: [];

	function row(options: {
		key: string;
		folder: MailFolder | null;
		label: string;
		icon: Parameters<typeof Icon>[0]["name"];
		depth: number;
		active: boolean;
		badge?: number;
		onClick: () => void;
		expandable?: boolean;
		expanded?: boolean;
		onToggleExpand?: () => void;
	}) {
		const { folder, label, icon, depth, active, badge } = options;
		const droppable = folder !== null;
		const isDropTarget = droppable && dropOn === folder.id;
		return (
			<div
				key={options.key}
				className="relative flex items-center"
				style={{ paddingLeft: `calc(var(--space-2) * ${depth})` }}
				onContextMenu={
					folder
						? (event) => {
								setTarget(folder);
								menu.open(event);
							}
						: undefined
				}
				onDragOver={
					droppable
						? (event) => {
								if (!event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								setDropOn(folder.id);
							}
						: undefined
				}
				onDragLeave={droppable ? () => setDropOn((current) => (current === folder.id ? null : current)) : undefined}
				onDrop={
					droppable
						? (event) => {
								const ids = draggedThreads(event);
								setDropOn(null);
								if (!ids || ids.length === 0) return;
								event.preventDefault();
								onDropThreads(folder.id, ids);
							}
						: undefined
				}
			>
				{options.expandable ? (
					<button
						type="button"
						aria-label={options.expanded ? `Collapse ${label}` : `Expand ${label}`}
						onClick={options.onToggleExpand}
						className="absolute left-0 flex h-[32px] w-[16px] items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink)]"
						style={{ marginLeft: `calc(var(--space-2) * ${depth})` }}
					>
						<Icon name={options.expanded ? "chevron-down" : "chevron-right"} size={12} />
					</button>
				) : null}
				<button
					type="button"
					onClick={options.onClick}
					aria-current={active ? "true" : undefined}
					style={{ height: "var(--row-height)" }}
					className={[
						"flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] pr-2 pl-5 text-left text-[length:var(--text-dense)]",
						"transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
						isDropTarget
							? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)] ring-inset"
							: active
								? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
								: folder && !folder.syncEnabled
									? "text-[var(--ink-muted)] hover:bg-[var(--hover)]"
									: "text-[var(--ink)] hover:bg-[var(--hover)]",
					].join(" ")}
					title={folder ? (folder.syncEnabled ? folder.path : `${folder.path} (not synced)`) : label}
				>
					<Icon name={icon} size={14} />
					<span className="min-w-0 flex-1 truncate">{label}</span>
					{badge && badge > 0 ? (
						<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
							{badge}
						</span>
					) : null}
				</button>
			</div>
		);
	}

	function nodeRows(nodes: FolderNode[], accountId: string, depth: number): React.ReactNode[] {
		return nodes.flatMap((node) => {
			const expanded = !collapsed[node.folder.id];
			const mine = row({
				key: node.folder.id,
				folder: node.folder,
				label: node.label,
				icon: "projects",
				depth,
				active: selection?.folderId === node.folder.id,
				badge: node.folder.unreadCount,
				onClick: () => onSelect({ accountId, folderId: node.folder.id, view: "inbox" }),
				expandable: node.children.length > 0,
				expanded,
				onToggleExpand: () =>
					setCollapsed((current) => ({ ...current, [node.folder.id]: !current[node.folder.id] })),
			});
			return expanded ? [mine, ...nodeRows(node.children, accountId, depth + 1)] : [mine];
		});
	}

	return (
		<div className="flex flex-col gap-4">
			{accounts.map((account) => {
				const status = sync[account.id] ?? null;
				const failed = status?.phase === "failed" || (!isSyncing(status) && account.lastSyncError);
				const syncing = isSyncing(status);
				const line = failed
					? (status?.error ?? account.lastSyncError ?? "Sync failed.")
					: describeSync(status, account.lastSyncAt);
				// The button has room for a word, so the detail stays in the tooltip.
				const stamp = syncing
					? "Syncing"
					: failed
						? "Failed"
						: account.lastSyncAt
							? formatSyncWhen(account.lastSyncAt)
							: "Never";
				const list = folders[account.id] ?? [];

				return (
					<div key={account.id}>
						{/*
							The account name and when it last heard from the server, side by
							side. The stamp used to sit at the bottom of the folder list,
							which is a long way from the thing it is about.
						*/}
						<div
							className="flex items-center gap-2 px-3"
							style={{ height: "var(--row-height)" }}
						>
							<p
								className="min-w-0 truncate text-[length:var(--text-sm)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]"
								title={account.email}
							>
								{account.label}
							</p>
							<button
								type="button"
								onClick={() => onSyncAccount(account.id)}
								disabled={syncing}
								title={failed ? line : `${line}. Sync this account now`}
								className={[
									"flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[length:var(--text-micro)]",
									"hover:bg-[var(--hover)] disabled:hover:bg-transparent",
									failed ? "text-[var(--risk)]" : "text-[var(--ink-faint)] hover:text-[var(--ink-muted)]",
								].join(" ")}
							>
								<Icon name="sync" size={12} />
								<span className="tabular">{stamp}</span>
							</button>
						</div>

						{list.length === 0 ? (
							<p className="px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								No folders yet. Sync to list them.
							</p>
						) : (
							<div className="flex flex-col gap-px">
								{specialFolders(list).map(({ folder, use }) =>
									row({
										key: folder.id,
										folder,
										label: SPECIAL_LABELS[use],
										icon: SPECIAL_ICONS[use],
										depth: 0,
										active: selection?.folderId === folder.id,
										badge: folder.unreadCount,
										onClick: () => onSelect({ accountId: account.id, folderId: folder.id, view: use }),
									}),
								)}
								{nodeRows(buildFolderTree(list), account.id, 0)}
							</div>
						)}

						<button
							type="button"
							onClick={() => onNewFolder(account.id)}
							style={{ height: "var(--row-height)" }}
							className="mt-px flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						>
							<Icon name="add" size={14} />
							<span>New folder</span>
						</button>

					</div>
				);
			})}

			{menu.at && target ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={`Actions for ${target.name}`} />
			) : null}
		</div>
	);
}
