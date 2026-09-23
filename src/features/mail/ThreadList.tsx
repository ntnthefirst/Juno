import { useState } from "react";
import type { MailThreadSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { formatWhen, participantsLine } from "./format";

export type ThreadBulkAction = "archive" | "markRead" | "move" | "delete";
export type ThreadRowAction = "markRead" | "markUnread" | "archive" | "junk" | "move" | "link" | "delete";

type ThreadListProps = {
	threads: MailThreadSummary[] | null;
	error: string | null;
	searching: boolean;
	selectedId: string | null;
	selectedIds: string[];
	onSelect: (id: string) => void;
	onToggleSelect: (id: string) => void;
	onClearSelection: () => void;
	onBulkAction: (action: ThreadBulkAction) => void;
	onRowAction: (action: ThreadRowAction, thread: MailThreadSummary) => void;
};

/**
 * Two and a bit lines per thread: who and when, the subject, the snippet.
 * Unread is a weight change and a dot, not a colour, so it still reads in
 * both themes. The dot doubles as the row's selector: hovering it, focusing
 * it with the keyboard, or selecting anything else in the list turns it into
 * a checkbox, so the list stays free of checkboxes until someone wants them.
 */
export function ThreadList({
	threads,
	error,
	searching,
	selectedId,
	selectedIds,
	onSelect,
	onToggleSelect,
	onClearSelection,
	onBulkAction,
	onRowAction,
}: ThreadListProps) {
	const menu = useContextMenu();
	// One context menu for the whole list rather than one per row, so sixty
	// rows do not each carry a portal that sits closed.
	const [target, setTarget] = useState<MailThreadSummary | null>(null);

	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load mail.</p>
				<p
					data-selectable
					className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
				>
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

	const items: MenuItem[] = target
		? [
				{ id: "open", label: "Open", icon: "mail", onSelect: () => onSelect(target.id) },
				target.unreadCount > 0
					? {
							id: "mark-read",
							label: "Mark read",
							icon: "read",
							separatorBefore: true,
							onSelect: () => onRowAction("markRead", target),
						}
					: {
							id: "mark-unread",
							label: "Mark unread",
							icon: "unread",
							separatorBefore: true,
							onSelect: () => onRowAction("markUnread", target),
						},
				{ id: "archive", label: "Archive", icon: "archive", onSelect: () => onRowAction("archive", target) },
				{ id: "move", label: "Move to folder", icon: "projects", onSelect: () => onRowAction("move", target) },
				{ id: "junk", label: "Junk", icon: "junk", onSelect: () => onRowAction("junk", target) },
				{
					id: "link",
					label: target.clientId ? "Change client link" : "Link to client",
					icon: "link",
					separatorBefore: true,
					onSelect: () => onRowAction("link", target),
				},
				{
					id: "delete",
					label: "Delete",
					icon: "remove",
					danger: true,
					separatorBefore: true,
					onSelect: () => onRowAction("delete", target),
				},
			]
		: [];

	return (
		<div className="flex flex-col">
			{hasSelection ? (
				<div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper)] px-3 py-2">
					<span className="tabular text-[length:var(--text-sm)] font-[var(--weight-medium)]">
						{selectedIds.length} selected
					</span>
					<div className="flex items-center gap-1">
						<Button size="dense" onClick={() => onBulkAction("archive")}>
							Archive
						</Button>
						<Button size="dense" onClick={() => onBulkAction("move")}>
							Move to
						</Button>
						<Button size="dense" onClick={() => onBulkAction("markRead")}>
							Mark read
						</Button>
						<Button size="dense" variant="danger" onClick={() => onBulkAction("delete")}>
							Delete
						</Button>
						<Button size="dense" onClick={onClearSelection}>
							Clear
						</Button>
					</div>
				</div>
			) : null}

			<ul className="flex flex-col">
				{threads.map((thread) => {
					const active = thread.id === selectedId;
					const checked = selectedIds.includes(thread.id);
					const unread = thread.unreadCount > 0;
					return (
						<li
							key={thread.id}
							className="group border-b border-[var(--line)]/60"
							onContextMenu={(event) => {
								setTarget(thread);
								menu.open(event);
							}}
						>
							<div
								className={[
									"flex items-start gap-2 px-3 py-2",
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
										onChange={() => onToggleSelect(thread.id)}
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
									onClick={() => onSelect(thread.id)}
									aria-current={active ? "true" : undefined}
									className="min-w-0 flex-1 text-left"
								>
									<div className="flex items-baseline gap-2">
										<span
											className={`min-w-0 flex-1 truncate text-[length:var(--text-dense)] ${
												unread
													? "font-[var(--weight-semibold)] text-[var(--ink)]"
													: "text-[var(--ink)]"
											}`}
										>
											{participantsLine(thread.participants, "Me")}
										</span>
										{thread.messageCount > 1 ? (
											<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">
												{thread.messageCount}
											</span>
										) : null}
										<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{formatWhen(thread.lastMessageAt)}
										</span>
									</div>
									<div className="mt-0.5 flex items-baseline gap-2">
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
						</li>
					);
				})}
			</ul>

			{menu.at && target ? (
				<ContextMenu
					at={menu.at}
					items={items}
					onClose={menu.close}
					ariaLabel={`Actions for ${participantsLine(target.participants, "Me")}`}
				/>
			) : null}
		</div>
	);
}
