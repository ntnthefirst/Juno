import type { MailOutboxMessage } from "@shared/types";
import { formatWhen } from "./format";
import { STATE_LABELS, STATE_TONES } from "./outbox-format";

type OutboxListProps = {
	messages: MailOutboxMessage[] | null;
	error: string | null;
	selectedId: string | null;
	onSelect: (id: string) => void;
};

export function OutboxList({ messages, error, selectedId, onSelect }: OutboxListProps) {
	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the outbox.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (messages === null) return <p className="px-4 text-[var(--ink-muted)]">Loading.</p>;
	if (messages.length === 0) return <p className="px-4 text-[var(--ink-muted)]">Nothing composed yet.</p>;

	return (
		<ul className="flex flex-col">
			{messages.map((message) => {
				const active = message.id === selectedId;
				return (
					<li key={message.id} className="border-b border-[var(--line)]/60">
						<button
							type="button"
							onClick={() => onSelect(message.id)}
							aria-current={active ? "true" : undefined}
							className={`block w-full px-4 py-2 text-left ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}
						>
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
						</button>
					</li>
				);
			})}
		</ul>
	);
}
