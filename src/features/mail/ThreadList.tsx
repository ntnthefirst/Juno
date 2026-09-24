import { useRef, useState } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { startThreadDrag } from "./drag";
import { formatWhen, participantsLine } from "./format";

export type ThreadAction =
	| "open"
	| "markRead"
	| "markUnread"
	| "flag"
	| "unflag"
	| "archive"
	| "junk"
	| "move"
	| "link"
	| "trash"
	| "deleteForever";

type ThreadListProps = {
	threads: MailThreadSummary[] | null;
	error: string | null;
	searching: boolean;
	/** The trash offers "delete forever" where every other folder offers "trash". */
	inTrash: boolean;
	selectedId: string | null;
	selectedIds: string[];
	onSelect: (id: string) => void;
	onToggleSelect: (id: string, extend: boolean) => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	/** One row, or the whole selection when `ids` is given. */
	onAction: (action: ThreadAction, ids: string[]) => void;
};

type RowButton = { action: ThreadAction; icon: IconName; label: string; danger?: boolean };

/**
 * Two and a bit lines per thread: who and when, the subject, the snippet.
 * Unread is a weight change and a dot, not a colour, so it still reads in both
 * themes. The dot doubles as the row's selector: hovering it, focusing it with
 * the keyboard, or selecting anything else in the list turns it into a
 * checkbox, so the list stays free of checkboxes until somebody wants them.
 *
 * Everything a row can do is reachable three ways, because people reach for
 * different ones: the icons that appear on hover, the right-click menu, and the
 * bar that appears once something is selected. A row is also draggable onto a
 * folder in the sidebar, which is the fastest way to file one.
 */
export function ThreadList({
	threads,
	error,
	searching,
	inTrash,
	selectedId,
	selectedIds,
	onSelect,
	onToggleSelect,
	onSelectAll,
	onClearSelection,
	onAction,
}: ThreadListProps) {
	const menu = useContextMenu();
	const [target, setTarget] = useState<MailThreadSummary | null>(null);
	// The row buttons, so the arrow keys can move focus between them. A list you
	// cannot walk with the keyboard is a list you have to aim at.
	const rows = useRef(new Map<string, HTMLButtonElement>());

	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load mail.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (threads === null) {
		return <p className="px-4 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (threads.length === 0) {
		return <p className="px-4 text-[var(--ink-muted)]">{searching ? "Nothing matches." : "Nothing here yet."}</p>;
	}

	const hasSelection = selectedIds.length > 0;
	const removeAction: ThreadAction = inTrash ? "deleteForever" : "trash";

	function menuItems(thread: MailThreadSummary): MenuItem[] {
		const unread = thread.unreadCount > 0;
		return [
			{ id: "open", label: "Open", icon: "mail", onSelect: () => onAction("open", [thread.id]) },
			unread
				? {
						id: "read",
						label: "Mark read",
						icon: "read",
						separatorBefore: true,
						onSelect: () => onAction("markRead", [thread.id]),
					}
				: {
						id: "unread",
						label: "Mark unread",
						icon: "unread",
						separatorBefore: true,
						onSelect: () => onAction("markUnread", [thread.id]),
					},
			{
				id: "flag",
				label: thread.isFlagged ? "Clear flag" : "Flag",
				icon: "flag",
				onSelect: () => onAction(thread.isFlagged ? "unflag" : "flag", [thread.id]),
			},
			{
				id: "archive",
				label: "Archive",
				icon: "archive",
				separatorBefore: true,
				onSelect: () => onAction("archive", [thread.id]),
			},
			{ id: "move", label: "Move to folder", icon: "projects", onSelect: () => onAction("move", [thread.id]) },
			{ id: "junk", label: "Junk", icon: "junk", onSelect: () => onAction("junk", [thread.id]) },
			{
				id: "link",
				label: thread.clientId ? "Change client link" : "Link to client",
				icon: "link",
				separatorBefore: true,
				onSelect: () => onAction("link", [thread.id]),
			},
			inTrash
				? {
						id: "delete",
						label: "Delete forever",
						icon: "remove",
						danger: true,
						separatorBefore: true,
						onSelect: () => onAction("deleteForever", [thread.id]),
					}
				: {
						id: "trash",
						label: "Move to trash",
						icon: "remove",
						danger: true,
						separatorBefore: true,
						onSelect: () => onAction("trash", [thread.id]),
					},
		];
	}

	/**
	 * The shortcuts a mail client is expected to have. They act on the row that
	 * has focus, so they never fire while somebody is typing in search: that input
	 * is in a different subtree and keeps its own keystrokes.
	 */
	function onListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const list = threads ?? [];
		const focused = list.find((thread) => rows.current.get(thread.id) === document.activeElement);
		const step = (delta: number) => {
			const from = focused ? list.indexOf(focused) : -1;
			const next = list[Math.min(Math.max(from + delta, 0), list.length - 1)];
			if (next) rows.current.get(next.id)?.focus();
		};

		if (event.key === "ArrowDown" || event.key === "j") {
			event.preventDefault();
			step(1);
			return;
		}
		if (event.key === "ArrowUp" || event.key === "k") {
			event.preventDefault();
			step(-1);
			return;
		}
		if (!focused) return;
		const shortcuts: Record<string, ThreadAction> = {
			e: "archive",
			a: "archive",
			s: focused.isFlagged ? "unflag" : "flag",
			u: focused.unreadCount > 0 ? "markRead" : "markUnread",
			m: "move",
			Delete: removeAction,
			Backspace: removeAction,
		};
		const action = shortcuts[event.key];
		if (!action) return;
		event.preventDefault();
		// A filing action takes the row away, so the next one gets the focus.
		const index = list.indexOf(focused);
		onAction(action, [focused.id]);
		if (action !== "flag" && action !== "unflag" && action !== "markRead" && action !== "markUnread") {
			const next = list[index + 1] ?? list[index - 1];
			if (next) requestAnimationFrame(() => rows.current.get(next.id)?.focus());
		}
	}

	const bulkButtons: RowButton[] = [
		{ action: "archive", icon: "archive", label: "Archive" },
		{ action: "move", icon: "projects", label: "Move to folder" },
		{ action: "markRead", icon: "read", label: "Mark read" },
		{ action: "flag", icon: "flag", label: "Flag" },
		{ action: "junk", icon: "junk", label: "Junk" },
		{
			action: removeAction,
			icon: "remove",
			label: inTrash ? "Delete forever" : "Move to trash",
			danger: true,
		},
	];

	return (
		<div className="flex flex-col">
			{hasSelection ? (
				<div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper)] px-3 py-1">
					<span className="tabular text-[length:var(--text-sm)] font-[var(--weight-medium)]">
						{selectedIds.length} selected
					</span>
					<div className="flex items-center gap-1">
						{bulkButtons.map((button) => (
							<IconAction
								key={button.action}
								icon={button.icon}
								label={button.label}
								danger={button.danger}
								onClick={() => onAction(button.action, selectedIds)}
							/>
						))}
						<IconAction icon="check" label="Select all" onClick={onSelectAll} />
						<IconAction icon="close" label="Clear selection" onClick={onClearSelection} />
					</div>
				</div>
			) : null}

			{/*
				One handler for the list rather than one per row: the keys act on
				whichever row has focus, and a row is a button that already takes it.
			*/}
			<ul className="flex flex-col" onKeyDown={onListKeyDown}>
				{threads.map((thread) => {
					const active = thread.id === selectedId;
					const checked = selectedIds.includes(thread.id);
					const unread = thread.unreadCount > 0;
					// A drag that starts on a row inside the selection carries the
					// selection. Starting one outside it carries that row alone, which
					// is what every file manager does.
					const dragIds = checked ? selectedIds : [thread.id];
					return (
						<li
							key={thread.id}
							draggable
							onDragStart={(event) => startThreadDrag(event, dragIds, thread.subject || "1 thread")}
							className="group relative border-b border-[var(--line)]/60"
							onContextMenu={(event) => {
								setTarget(thread);
								menu.open(event);
							}}
						>
							<div
								className={[
									"flex items-start gap-2 px-3 py-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
									active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
								].join(" ")}
							>
								<span className="relative mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center">
									<span
										aria-hidden
										className={[
											"absolute h-1.5 w-1.5 rounded-full",
											unread ? "bg-[var(--accent)]" : "bg-transparent",
											hasSelection ? "hidden" : "group-hover:opacity-0 group-focus-within:opacity-0",
										].join(" ")}
									/>
									<input
										type="checkbox"
										checked={checked}
										onChange={(event) =>
											onToggleSelect(thread.id, (event.nativeEvent as MouseEvent).shiftKey)
										}
										onClick={(event) => event.stopPropagation()}
										aria-label={`Select ${participantsLine(thread.participants, "Me")}`}
										className={[
											"absolute h-3.5 w-3.5 rounded-[3px] border-[var(--line-strong)] accent-[var(--accent)]",
											hasSelection
												? "opacity-100"
												: "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
										].join(" ")}
									/>
								</span>
								<button
									type="button"
									ref={(element) => {
										if (element) rows.current.set(thread.id, element);
										else rows.current.delete(thread.id);
									}}
									onClick={() => onSelect(thread.id)}
									aria-current={active ? "true" : undefined}
									className="min-w-0 flex-1 text-left"
								>
									<div className="flex items-baseline gap-2">
										<span
											className={`min-w-0 flex-1 truncate text-[length:var(--text-dense)] ${
												unread ? "font-[var(--weight-semibold)] text-[var(--ink)]" : "text-[var(--ink)]"
											}`}
										>
											{participantsLine(thread.participants, "Me")}
										</span>
										{thread.messageCount > 1 ? (
											<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">
												{thread.messageCount}
											</span>
										) : null}
										{/* The date gives way to the row's actions on hover. */}
										<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)] group-hover:invisible">
											{formatWhen(thread.lastMessageAt)}
										</span>
									</div>
									<div className="mt-0.5 flex items-baseline gap-2">
										{thread.isFlagged ? (
											<span className="shrink-0 text-[var(--seal)]" title="Flagged">
												<Icon name="flag" size={12} />
											</span>
										) : null}
										<span
											className={`min-w-0 flex-1 truncate text-[length:var(--text-dense)] ${
												unread ? "font-[var(--weight-medium)]" : ""
											}`}
										>
											{thread.subject}
										</span>
										{thread.hasAttachments ? (
											<span className="shrink-0 text-[var(--ink-muted)]" title="Has attachments">
												<Icon name="attachment" size={12} />
											</span>
										) : null}
									</div>
									<div className="mt-0.5 flex items-baseline gap-2">
										<span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{thread.snippet}
										</span>
										{thread.clientName ? (
											<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
												{thread.clientName}
											</span>
										) : null}
									</div>
								</button>
							</div>

							{/*
								Hover actions, in the row's top-right corner where the date is.
								Hidden until the row is hovered or something in it has focus, so
								the list is a list rather than a grid of buttons, and reachable
								from the keyboard because focus counts as hover here.
							*/}
							<div className="pointer-events-none absolute top-1 right-2 flex gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
								<IconAction
									icon={unread ? "read" : "unread"}
									label={unread ? "Mark read" : "Mark unread"}
									onClick={() => onAction(unread ? "markRead" : "markUnread", [thread.id])}
								/>
								<IconAction
									icon="flag"
									label={thread.isFlagged ? "Clear flag" : "Flag"}
									onClick={() => onAction(thread.isFlagged ? "unflag" : "flag", [thread.id])}
								/>
								<IconAction
									icon="archive"
									label="Archive"
									onClick={() => onAction("archive", [thread.id])}
								/>
								<IconAction
									icon="remove"
									label={inTrash ? "Delete forever" : "Move to trash"}
									danger
									onClick={() => onAction(removeAction, [thread.id])}
								/>
							</div>
						</li>
					);
				})}
			</ul>

			{menu.at && target ? (
				<ContextMenu
					at={menu.at}
					items={menuItems(target)}
					onClose={menu.close}
					ariaLabel={`Actions for ${participantsLine(target.participants, "Me")}`}
				/>
			) : null}
		</div>
	);
}

type IconActionProps = {
	icon: IconName;
	label: string;
	danger?: boolean;
	onClick: () => void;
};

/** A 32px icon button for a dense row. The label is the only wording it needs. */
function IconAction({ icon, label, danger = false, onClick }: IconActionProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
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
