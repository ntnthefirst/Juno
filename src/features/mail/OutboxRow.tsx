import type { MailOutboxMessage } from "@shared/types";
import { Checkbox } from "../../components/Checkbox";
import { contextMenuFor } from "../../lib/native-menu";
import { formatWhen } from "./format";
import { STATE_LABELS, STATE_TONES } from "./outbox-format";

type OutboxRowProps = {
	message: MailOutboxMessage;
	active: boolean;
	onSelect: (id: string) => void;
	/** So the list around it can walk focus between rows with the arrow keys. */
	buttonRef: (element: HTMLButtonElement | null) => void;
	/** Sends a failed message again. */
	onRetry?: (id: string) => void;
	/** Opens the message in the editor, taking it back to a draft first when it is waiting or failed. */
	onEdit?: (id: string) => void;
	/** Asks to delete a message that has not gone out. */
	onDelete?: (id: string) => void;
	/** Held in the list's selection. */
	checked?: boolean;
	/** Something in the list is held, so a click picks rather than opens. */
	selecting?: boolean;
	/** Picks or lets go of the row; `extend` is a Shift click, which picks the run from the last one. */
	onToggleSelect?: (id: string, extend: boolean) => void;
};

/**
 * One message Juno has not sent yet, in Drafts or Outbox. It carries its state
 * as a badge. The space at its left is a box that picks it, shown on hover and
 * while anything is picked, the way a thread row's avatar turns into one, so
 * several drafts can be sent or deleted together.
 */
export function OutboxRow({
	message,
	active,
	onSelect,
	buttonRef,
	onRetry,
	onEdit,
	onDelete,
	checked = false,
	selecting = false,
	onToggleSelect,
}: OutboxRowProps) {
	// The platform's menu for an unsent message (decision 59).
	const onContextMenu = contextMenuFor(
		{ kind: "outbox", id: message.id },
		{
			open: () => onSelect(message.id),
			retry: () => onRetry?.(message.id),
			edit: () => onEdit?.(message.id),
			delete: () => onDelete?.(message.id),
		},
	);

	return (
		<li
			data-draft-kind="outbox"
			className={`group relative flex items-start border-b border-[var(--line)]/60 ${active || checked ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}
			onContextMenu={onContextMenu}
		>
			{onToggleSelect ? (
				<label
					className={[
						"absolute top-2 left-3 z-[1] flex h-5 w-5 cursor-pointer items-center justify-center",
						selecting || checked
							? "opacity-100"
							: "opacity-0 has-[:focus-visible]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
					].join(" ")}
				>
					<Checkbox
						checked={checked}
						onChange={(event) => onToggleSelect(message.id, (event.nativeEvent as MouseEvent).shiftKey)}
						aria-label={`Select ${message.subject || "(no subject)"}`}
					/>
				</label>
			) : null}
			<button
				type="button"
				ref={buttonRef}
				data-row-id={message.id}
				onClick={(event) => {
					if (selecting && onToggleSelect) onToggleSelect(message.id, event.shiftKey);
					else onSelect(message.id);
				}}
				aria-current={active && !selecting ? "true" : undefined}
				aria-pressed={selecting ? checked : undefined}
				className="flex w-full items-start gap-2 px-3 py-2 text-left"
			>
				{/* Room for the box, as wide as a thread row's unread dot, so both kinds line up. */}
				<span aria-hidden className="h-5 w-5 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate text-dense">
							{message.to.map((a) => a.name || a.address).join(", ") || "(nobody yet)"}
						</span>
						<span className="tabular shrink-0 text-micro text-[var(--ink-muted)]">
							{formatWhen(message.sentAt ?? message.updatedAt)}
						</span>
					</div>
					<div className="mt-0.5 flex items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate text-dense font-[var(--weight-medium)]">
							{message.subject || "(no subject)"}
						</span>
						<span className={`shrink-0 rounded-[var(--radius-sm)] px-1.5 text-micro ${STATE_TONES[message.state]}`}>
							{STATE_LABELS[message.state]}
						</span>
					</div>
					{message.lastError ? (
						<div className="mt-0.5 truncate text-sm text-[var(--risk)]">{message.lastError}</div>
					) : null}
				</div>
			</button>
		</li>
	);
}
