import { Fragment, useMemo, useRef, useState } from "react";
import type { MailOutboxMessage, MailThreadSummary } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { IconAction } from "../../components/IconAction";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { groupByDay } from "../../lib/day-groups";
import { stagger } from "../../lib/motion";
import { useContextMenu } from "../../lib/use-context-menu";
import { startThreadDrag } from "./drag";
import { formatWhen, leadParticipant, participantsLine } from "./format";
import { OutboxRow } from "./OutboxRow";

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

/**
 * What Juno has not sent yet, listed among the threads. Given only for the
 * Drafts view, where these rows and the server's own drafts share one list.
 */
export type ThreadListOutbox = {
	/** `null` while the outbox is still loading. */
	messages: MailOutboxMessage[] | null;
	selectedId: string | null;
	onSelect: (id: string) => void;
};

type ThreadListProps = {
	threads: MailThreadSummary[] | null;
	outbox?: ThreadListOutbox;
	error: string | null;
	searching: boolean;
	/** The trash offers "delete forever" where every other folder offers "trash". */
	inTrash: boolean;
	selectedId: string | null;
	selectedIds: string[];
	onSelect: (id: string) => void;
	onToggleSelect: (id: string, extend: boolean) => void;
	/** One row, or the whole selection when `ids` is given. */
	onAction: (action: ThreadAction, ids: string[]) => void;
};

type Entry =
	| { kind: "thread"; id: string; at: string; thread: MailThreadSummary }
	| { kind: "outbox"; id: string; at: string; message: MailOutboxMessage };

/**
 * Newest first, and by id when two share an instant. A thread sorts by its
 * last message and an outbox row by when it was last saved, which is what the
 * outbox list itself is ordered by.
 */
function mergeEntries(threads: MailThreadSummary[], messages: MailOutboxMessage[] | null): Entry[] {
	const entries: Entry[] = threads.map((thread): Entry => ({ kind: "thread", id: thread.id, at: thread.lastMessageAt, thread }));
	// Without the outbox the threads keep the order they came in, which in a
	// search is by relevance and not by date.
	if (messages === null) return entries;
	entries.push(...messages.map((message): Entry => ({ kind: "outbox", id: message.id, at: message.updatedAt, message })));
	return entries.sort((x, y) => (x.at === y.at ? y.id.localeCompare(x.id) : y.at.localeCompare(x.at)));
}

/**
 * Two and a bit lines per thread: who and when, the subject, the snippet.
 * Unread is a weight change and a dot, not a colour, so it still reads in both
 * themes. The dot doubles as the row's selector: hovering it, focusing it with
 * the keyboard, or selecting anything else in the list turns it into a
 * checkbox, so the list stays free of checkboxes until somebody wants them.
 *
 * Everything a row can do is reachable three ways, because people reach for
 * different ones: the icons that appear on hover, the right-click menu, and the
 * toolbar above the list once something is selected. A row is also draggable
 * onto a folder in the sidebar, which is the fastest way to file one.
 *
 * Once anything is selected the rows stop opening and start ticking. Clicking
 * one anywhere adds or removes it, and the hover icons go away, because a list
 * where the same click sometimes files a row and sometimes opens it is a list
 * that loses somebody's selection.
 *
 * In Drafts the same list also holds Juno's own unsent messages (`outbox`),
 * merged by date. Those rows open on a click and take none of the thread
 * actions: they are not on the server, so there is nothing to file, and the
 * selection, the menu and the keyboard shortcuts all skip them.
 */
export function ThreadList({
	threads,
	outbox,
	error,
	searching,
	inTrash,
	selectedId,
	selectedIds,
	onSelect,
	onToggleSelect,
	onAction,
}: ThreadListProps) {
	const menu = useContextMenu();
	const [target, setTarget] = useState<MailThreadSummary | null>(null);
	// The row buttons, so the arrow keys can move focus between them. A list you
	// cannot walk with the keyboard is a list you have to aim at.
	const rows = useRef(new Map<string, HTMLButtonElement>());
	const merged = useMemo(
		() => (threads === null ? [] : mergeEntries(threads, outbox ? outbox.messages : null)),
		[threads, outbox],
	);
	// A search is ordered by how well a row matches, not by when it arrived, so
	// splitting it by day would put the days out of order.
	const sections = useMemo(
		() =>
			searching
				? [{ key: "results", label: null as string | null, items: merged }]
				: groupByDay(merged, (entry) => entry.at).map((group) => ({ ...group, label: group.label as string | null })),
		[merged, searching],
	);

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
	if (threads === null || (outbox && outbox.messages === null)) {
		return <p className="px-4 text-[var(--ink-muted)]">Loading.</p>;
	}
	const entries = merged;
	if (entries.length === 0) {
		return (
			<p className="px-4 text-[var(--ink-muted)]">
				{outbox ? "Nothing composed yet." : searching ? "Nothing matches." : "Nothing here yet."}
			</p>
		);
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
		const focusedEntry = entries.find((entry) => rows.current.get(entry.id) === document.activeElement);
		const step = (delta: number) => {
			const from = focusedEntry ? entries.indexOf(focusedEntry) : -1;
			const next = entries[Math.min(Math.max(from + delta, 0), entries.length - 1)];
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
		// The rest are thread actions, and an unsent message has none.
		if (focusedEntry?.kind !== "thread") return;
		const focused = focusedEntry.thread;
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
		const index = entries.indexOf(focusedEntry);
		onAction(action, [focused.id]);
		if (action !== "flag" && action !== "unflag" && action !== "markRead" && action !== "markUnread") {
			const next = entries[index + 1] ?? entries[index - 1];
			if (next) requestAnimationFrame(() => rows.current.get(next.id)?.focus());
		}
	}

	return (
		<div className="flex flex-col">
			{/*
				One handler for the list rather than one per row: the keys act on
				whichever row has focus, and a row is a button that already takes it.
			*/}
			<ul className="flex flex-col px-2" onKeyDown={onListKeyDown}>
				{sections.map((section) => (
					<Fragment key={section.key}>
						{section.label ? (
							<li
								aria-hidden
								className="px-3 pt-4 pb-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)] first:pt-2"
							>
								{section.label}
							</li>
						) : null}
						{section.items.map((entry) => {
							if (entry.kind === "outbox") {
								return (
									<OutboxRow
										key={entry.id}
										message={entry.message}
										active={entry.id === outbox?.selectedId}
										onSelect={(id) => outbox?.onSelect(id)}
										buttonRef={(element) => {
											if (element) rows.current.set(entry.id, element);
											else rows.current.delete(entry.id);
										}}
									/>
								);
							}
							const thread = entry.thread;
							const active = thread.id === selectedId;
							const checked = selectedIds.includes(thread.id);
							const unread = thread.unreadCount > 0;
							const lead = leadParticipant(thread.participants);
							// A drag that starts on a row inside the selection carries the
							// selection. Starting one outside it carries that row alone, which
							// is what every file manager does.
							const dragIds = checked ? selectedIds : [thread.id];
							return (
								<li
									key={thread.id}
									data-draft-kind={outbox ? "thread" : undefined}
									draggable
									onDragStart={(event) => startThreadDrag(event, dragIds, thread.subject || "1 thread")}
									className="animate-rise group relative"
									style={stagger(entries.indexOf(entry))}
									onContextMenu={(event) => {
										setTarget(thread);
										menu.open(event);
									}}
								>
									<div
										className={[
											"flex items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
											active || checked ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
										].join(" ")}
									>
										{/* An unread row has a dot in the margin, so the avatar can stay a picture. */}
										{unread ? (
											<span
												aria-hidden
												className="absolute top-1/2 left-0.5 h-1.5 w-1.5 -translate-y-1/2 rounded-[var(--radius-full)] bg-[var(--accent)]"
											/>
										) : null}
										{/*
											The avatar doubles as the row's selector: hovering it, focusing
											it with the keyboard, or selecting anything else in the list turns
											it into a checkbox, so the list stays free of checkboxes until
											somebody wants them.
										*/}
										<span className="relative flex h-8 w-8 flex-none items-center justify-center">
											<span
												className={
													hasSelection ? "invisible" : "group-hover:invisible group-focus-within:invisible"
												}
											>
												<Avatar name={lead} size={32} />
											</span>
											<input
												type="checkbox"
												checked={checked}
												onChange={(event) =>
													onToggleSelect(thread.id, (event.nativeEvent as MouseEvent).shiftKey)
												}
												onClick={(event) => event.stopPropagation()}
												aria-label={`Select ${participantsLine(thread.participants, "Me")}`}
												className={[
													"absolute h-4 w-4 rounded-[3px] border-[var(--line-strong)] accent-[var(--accent)]",
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
											onClick={(event) => {
												if (hasSelection) onToggleSelect(thread.id, event.shiftKey);
												else onSelect(thread.id);
											}}
											aria-current={active && !hasSelection ? "true" : undefined}
											aria-pressed={hasSelection ? checked : undefined}
											className="min-w-0 flex-1 text-left"
										>
											<div className="flex items-baseline gap-2">
												<span
													className={`min-w-0 flex-1 truncate text-[length:var(--text-base)] ${
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
												{thread.isFlagged ? (
													<span className="shrink-0 text-[var(--seal)]" title="Flagged">
														<Icon name="flag" size={12} />
													</span>
												) : null}
												{thread.hasAttachments ? (
													<span className="shrink-0 text-[var(--ink-muted)]" title="Has attachments">
														<Icon name="attachment" size={12} />
													</span>
												) : null}
												{/* The date gives way to the row's actions on hover. */}
												<span
													className={`tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)] ${
														hasSelection ? "" : "group-hover:invisible"
													}`}
												>
													{formatWhen(thread.lastMessageAt)}
												</span>
											</div>
											<div className="mt-0.5 flex items-baseline gap-2">
												<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
													<span className={unread ? "font-[var(--weight-medium)] text-[var(--ink)]" : "text-[var(--ink)]"}>
														{thread.subject}
													</span>
													{thread.snippet ? ` ${thread.snippet}` : ""}
												</span>
												{/* Beside Juno's own unsent messages, the server's are told apart. */}
												{outbox ? (
													<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
														On the server
													</span>
												) : null}
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
										from the keyboard because focus counts as hover here. They stay
										away entirely while something is selected: a row is then a thing
										to tick, and an archive button that files one row out of six is
										not what anybody was aiming at.
									*/}
									{hasSelection ? null : (
										<div className="pointer-events-none absolute top-1 right-3 flex gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
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
									)}
								</li>
							);
						})}
					</Fragment>
				))}
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
