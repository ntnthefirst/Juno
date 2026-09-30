import type { MailOutboxMessage } from "@shared/types";
import { formatWhen } from "./format";
import { STATE_LABELS, STATE_TONES } from "./outbox-format";

type OutboxRowProps = {
	message: MailOutboxMessage;
	active: boolean;
	onSelect: (id: string) => void;
	/** So the list around it can walk focus between rows with the arrow keys. */
	buttonRef: (element: HTMLButtonElement | null) => void;
};

/**
 * One message Juno has not sent yet, in the list of Drafts. It carries its
 * state as a badge, because a draft, a request waiting for you and a failed
 * send all live in the same place.
 */
export function OutboxRow({ message, active, onSelect, buttonRef }: OutboxRowProps) {
	return (
		<li data-draft-kind="outbox" className="border-b border-[var(--line)]/60">
			<button
				type="button"
				ref={buttonRef}
				onClick={() => onSelect(message.id)}
				aria-current={active ? "true" : undefined}
				className={`flex w-full items-start gap-2 px-3 py-2 text-left ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}
			>
				{/* As wide as a thread row's unread dot, so both kinds line up in one list. */}
				<span aria-hidden className="h-4 w-4 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
							{message.to.map((a) => a.name || a.address).join(", ") || "(nobody yet)"}
						</span>
						<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
							{formatWhen(message.sentAt ?? message.updatedAt)}
						</span>
					</div>
					<div className="mt-0.5 flex items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
							{message.subject || "(no subject)"}
						</span>
						<span className={`shrink-0 rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-micro)] ${STATE_TONES[message.state]}`}>
							{STATE_LABELS[message.state]}
						</span>
					</div>
					{message.lastError ? (
						<div className="mt-0.5 truncate text-[length:var(--text-sm)] text-[var(--risk)]">{message.lastError}</div>
					) : null}
				</div>
			</button>
		</li>
	);
}
