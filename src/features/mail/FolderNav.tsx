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
	SPECIAL_ORDER,
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

/** What a right click landed on. One menu serves the whole nav. */
type MenuTarget =
	| { kind: "folder"; folder: MailFolder }
	| { kind: "account"; account: MailAccount }
	| { kind: "view"; use: MailSpecialUse }
	| { kind: "all" };

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

const HEADER_TEXT =
	"min-w-0 truncate text-[length:var(--text-sm)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]";

/**
 * Where mail is: every account, with the six folders it has and the tree of
 * the ones somebody made. Anything not sent yet lives under that account's
 * own Drafts, not in a separate place.
 *
 * Three things this has to get right. A folder is a drop target, and it says
 * so while something is over it, because a drag with no visible target is a
 * guess. Every folder listed is one the account really has, with the count it
 * really carries, so a row is never a dead end. And every heading opens and
 * closes from its name as well as its chevron, and everything here answers a
 * right click, the way a mail client's sidebar does.
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
	const [target, setTarget] = useState<MenuTarget | null>(null);
	const [dropOn, setDropOn] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	// Per account, keyed by account id. Folder ids and account ids never collide.
	const [accountsClosed, setAccountsClosed] = useState<Record<string, boolean>>({});
	const [allClosed, setAllClosed] = useState(false);

	function openMenu(next: MenuTarget, event: React.MouseEvent) {
		setTarget(next);
		menu.open(event);
	}

	function toggleAccount(accountId: string) {
		setAccountsClosed((current) => ({ ...current, [accountId]: !current[accountId] }));
	}

	function toggleFolder(folderId: string) {
		setCollapsed((current) => ({ ...current, [folderId]: !current[folderId] }));
	}

	function syncAll() {
		for (const account of accounts) onSyncAccount(account.id);
	}

	function folderItems(folder: MailFolder): MenuItem[] {
		return [
			{
				id: "open",
				label: "Open",
				icon: "folder-open",
				onSelect: () =>
					onSelect({ accountId: folder.accountId, folderId: folder.id, view: folder.specialUse ?? "inbox" }),
			},
			{
				id: "sync-now",
				label: "Sync now",
				icon: "sync",
				disabled: !folder.syncEnabled || isSyncing(sync[folder.accountId] ?? null),
				onSelect: () => onSyncAccount(folder.accountId),
			},
			{
				id: "mark-read",
				label: "Mark all read",
				icon: "read",
				separatorBefore: true,
				disabled: folder.unreadCount === 0,
				hint: folder.unreadCount > 0 ? String(folder.unreadCount) : undefined,
				onSelect: () => onFolderAction("markAllRead", folder),
			},
			{
				id: "empty",
				label: `Empty ${folder.name}`,
				icon: "remove",
				danger: true,
				disabled: folder.messageCount === 0,
				onSelect: () => onFolderAction("empty", folder),
			},
			{
				id: "new",
				label: "New folder",
				icon: "add",
				separatorBefore: true,
				onSelect: () => onFolderAction("new", folder),
			},
			{
				id: "new-inside",
				label: `New folder in ${folder.name}`,
				icon: "projects",
				onSelect: () => onFolderAction("newInside", folder),
			},
			{
				id: "rename",
				label: "Rename",
				icon: "edit",
				separatorBefore: true,
				disabled: folder.specialUse !== null,
				onSelect: () => onFolderAction("rename", folder),
			},
			{
				id: "sync",
				label: folder.syncEnabled ? "Stop syncing this folder" : "Sync this folder",
				icon: "sync",
				onSelect: () => onFolderAction("toggleSync", folder),
			},
			{
				id: "remove",
				label: "Delete folder",
				icon: "remove",
				danger: true,
				separatorBefore: true,
				disabled: folder.specialUse !== null,
				onSelect: () => onFolderAction("remove", folder),
			},
		];
	}

	function accountItems(account: MailAccount): MenuItem[] {
		const inbox = (folders[account.id] ?? []).find((folder) => folder.specialUse === "inbox") ?? null;
		const open = !accountsClosed[account.id];
		return [
			{
				id: "sync",
				label: "Sync now",
				icon: "sync",
				disabled: isSyncing(sync[account.id] ?? null),
				onSelect: () => onSyncAccount(account.id),
			},
			{
				id: "read",
				label: "Mark inbox read",
				icon: "read",
				disabled: !inbox || inbox.unreadCount === 0,
				hint: inbox && inbox.unreadCount > 0 ? String(inbox.unreadCount) : undefined,
				onSelect: () => {
					if (inbox) onFolderAction("markAllRead", inbox);
				},
			},
			{ id: "new", label: "New folder", icon: "add", separatorBefore: true, onSelect: () => onNewFolder(account.id) },
			{
				id: "toggle",
				label: open ? "Collapse" : "Expand",
				icon: open ? "chevron-down" : "chevron-right",
				onSelect: () => toggleAccount(account.id),
			},
			{
				id: "settings",
				label: "Account settings",
				icon: "settings",
				separatorBefore: true,
				onSelect: () => void window.juno.window.openSettings("mail"),
			},
		];
	}

	function viewItems(use: MailSpecialUse): MenuItem[] {
		return [
			{
				id: "open",
				label: `Open ${SPECIAL_LABELS[use]}`,
				icon: SPECIAL_ICONS[use],
				onSelect: () => onSelect({ accountId: null, folderId: null, view: use }),
			},
			{ id: "sync", label: "Sync all accounts", icon: "sync", separatorBefore: true, onSelect: syncAll },
		];
	}

	function allItems(): MenuItem[] {
		return [
			{ id: "sync", label: "Sync all accounts", icon: "sync", onSelect: syncAll },
			{
				id: "toggle",
				label: allClosed ? "Expand" : "Collapse",
				icon: allClosed ? "chevron-right" : "chevron-down",
				onSelect: () => setAllClosed((value) => !value),
			},
			{
				id: "settings",
				label: "Account settings",
				icon: "settings",
				separatorBefore: true,
				onSelect: () => void window.juno.window.openSettings("mail"),
			},
		];
	}

	const items: MenuItem[] = !target
		? []
		: target.kind === "folder"
			? folderItems(target.folder)
			: target.kind === "account"
				? accountItems(target.account)
				: target.kind === "view"
					? viewItems(target.use)
					: allItems();
	const menuLabel = !target
		? ""
		: target.kind === "folder"
			? `Actions for ${target.folder.name}`
			: target.kind === "account"
				? `Actions for ${target.account.label}`
				: target.kind === "view"
					? `Actions for ${SPECIAL_LABELS[target.use]}`
					: "Actions for all accounts";

	function row(options: {
		key: string;
		folder: MailFolder | null;
		label: string;
		icon: Parameters<typeof Icon>[0]["name"];
		depth: number;
		active: boolean;
		badge?: number;
		onClick: () => void;
		onMenu: (event: React.MouseEvent) => void;
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
				onContextMenu={options.onMenu}
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
						aria-expanded={options.expanded}
						onClick={options.onToggleExpand}
						className="absolute left-0 z-10 flex h-[32px] w-[16px] items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink)]"
						style={{ marginLeft: `calc(var(--space-2) * ${depth})` }}
					>
						<Icon name={options.expanded ? "chevron-down" : "chevron-right"} size={12} />
					</button>
				) : null}
				<button
					type="button"
					onClick={options.onClick}
					// A folder with children opens and closes on a double click too,
					// the way a tree does everywhere else.
					onDoubleClick={options.expandable ? options.onToggleExpand : undefined}
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
						<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">{badge}</span>
					) : null}
				</button>
			</div>
		);
	}

	function nodeRows(nodes: FolderNode[], accountId: string, depth: number): React.ReactNode[] {
		return nodes.flatMap((node) => {
			const expanded = !collapsed[node.folder.id];
			const active = selection?.folderId === node.folder.id;
			const hasChildren = node.children.length > 0;
			const mine = row({
				key: node.folder.id,
				folder: node.folder,
				label: node.label,
				icon: "projects",
				depth,
				active,
				badge: node.folder.unreadCount,
				onClick: () => {
					// The first press opens the folder. A press on the folder already
					// open opens or closes its children, the way a tree does.
					if (active && hasChildren) toggleFolder(node.folder.id);
					else {
						if (hasChildren && !expanded) toggleFolder(node.folder.id);
						onSelect({ accountId, folderId: node.folder.id, view: "inbox" });
					}
				},
				onMenu: (event) => openMenu({ kind: "folder", folder: node.folder }, event),
				expandable: hasChildren,
				expanded,
				onToggleExpand: () => toggleFolder(node.folder.id),
			});
			return expanded ? [mine, ...nodeRows(node.children, accountId, depth + 1)] : [mine];
		});
	}

	return (
		<div className="flex flex-col gap-4">
			{accounts.length > 1 ? (
				<div>
					<button
						type="button"
						onClick={() => setAllClosed((value) => !value)}
						onContextMenu={(event) => openMenu({ kind: "all" }, event)}
						aria-expanded={!allClosed}
						className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left hover:bg-[var(--hover)]"
						style={{ height: "var(--row-height)" }}
					>
						<span className={`${HEADER_TEXT} flex-1`}>All accounts</span>
						<Icon
							name={allClosed ? "chevron-right" : "chevron-down"}
							size={12}
							className="flex-none text-[var(--ink-faint)]"
						/>
					</button>
					{allClosed ? null : (
						<div className="flex flex-col gap-px">
							{SPECIAL_ORDER.filter((use) =>
								accounts.some((a) => (folders[a.id] ?? []).some((f) => f.specialUse === use)),
							).map((use) =>
								row({
									key: `all:${use}`,
									folder: null,
									label: SPECIAL_LABELS[use],
									icon: SPECIAL_ICONS[use],
									depth: 0,
									active: selection?.accountId === null && selection.folderId === null && selection.view === use,
									badge: accounts.reduce(
										(total, a) =>
											total +
											(folders[a.id] ?? [])
												.filter((f) => f.specialUse === use)
												.reduce((sum, f) => sum + f.unreadCount, 0),
										0,
									),
									onClick: () => onSelect({ accountId: null, folderId: null, view: use }),
									onMenu: (event) => openMenu({ kind: "view", use }, event),
								}),
							)}
						</div>
					)}
				</div>
			) : null}
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
				const open = !accountsClosed[account.id];

				return (
					<div key={account.id}>
						{/*
							The account name opens and closes its folders, as the chevron
							does, and when it last heard from the server sits beside it.
						*/}
						<div
							className="group/account flex items-center gap-1 rounded-[var(--radius-md)] pr-1 hover:bg-[var(--hover)]"
							style={{ height: "var(--row-height)" }}
							onContextMenu={(event) => openMenu({ kind: "account", account }, event)}
						>
							<button
								type="button"
								onClick={() => toggleAccount(account.id)}
								aria-expanded={open}
								aria-label={open ? `Collapse ${account.label}` : `Expand ${account.label}`}
								title={account.email}
								className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 text-left"
							>
								<span className={HEADER_TEXT}>{account.label}</span>
								<Icon
									name={open ? "chevron-down" : "chevron-right"}
									size={12}
									className="flex-none text-[var(--ink-faint)]"
								/>
							</button>
							<button
								type="button"
								onClick={() => onSyncAccount(account.id)}
								disabled={syncing}
								title={failed ? line : `${line}. Sync this account now`}
								className={[
									"flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[length:var(--text-micro)]",
									"hover:bg-[var(--hover)] disabled:hover:bg-transparent",
									failed ? "text-[var(--risk)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
								].join(" ")}
							>
								<Icon name="sync" size={12} className={syncing ? "animate-spin" : undefined} />
								<span className="tabular">{stamp}</span>
							</button>
						</div>

						{!open ? null : list.length === 0 ? (
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
										onMenu: (event) => openMenu({ kind: "folder", folder }, event),
									}),
								)}
								{nodeRows(buildFolderTree(list), account.id, 0)}
							</div>
						)}

						{open ? (
							<button
								type="button"
								onClick={() => onNewFolder(account.id)}
								onContextMenu={(event) => openMenu({ kind: "account", account }, event)}
								style={{ height: "var(--row-height)" }}
								className="mt-px flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-[length:var(--text-dense)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
							>
								<Icon name="add" size={14} />
								<span>New folder</span>
							</button>
						) : null}
					</div>
				);
			})}

			{menu.at && target ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={menuLabel} />
			) : null}
		</div>
	);
}
