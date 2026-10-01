import type { MailThreadOutgoing } from "@shared/types";
import { Button } from "../../components/Button";
import { framed } from "../../lib/framed-preview";
import { displayName, formatFull, formatWhen, participantsLine } from "./format";
import { STATE_LABELS, STATE_TONES } from "./outbox-format";

type OutgoingMessageViewProps = {
	message: MailThreadOutgoing;
	/** One message of a thread is open at a time; the thread decides which. */
	open: boolean;
	onToggle: () => void;
	/** Opens a draft, a message waiting for approval or a failed send in the composer. */
	onEdit?: (id: string) => void;
};

/**
 * A reply Juno sent whose copy has not come back from the Sent folder yet. It
 * reads like the messages around it, minus what only a synced message has: no
 * reply row, no flag, no read state, because it is the outbox's row and not a
 * mail message. The frame is the outbox preview's, so a remote picture is a
 * box here as it is there (lib/framed-preview.ts).
 */
export function OutgoingMessageView({ message, open, onToggle, onEdit }: OutgoingMessageViewProps) {
	const from = displayName(message.from);
	const preview = message.bodyHtml ? framed(message.bodyHtml, "") : null;
	const editable = message.state === "draft" || message.state === "pending" || message.state === "failed";

	return (
		<article
			className={`border-t border-[var(--line)] first:border-t-0 ${open ? "flex flex-1 flex-col" : ""}`}
			data-outgoing
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className={`flex w-full shrink-0 items-start gap-3 px-8 py-3 text-left ${open ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"}`}
			>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate font-[var(--weight-medium)]">{from}</span>
						{message.state !== "sent" ? (
							<span
								className={`shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[length:var(--text-micro)] ${STATE_TONES[message.state]}`}
							>
								{STATE_LABELS[message.state]}
							</span>
						) : null}
						{message.from.name ? (
							<span className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{message.from.address}
							</span>
						) : null}
					</div>
					{!open ? (
						<span className="mt-0.5 block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{message.bodyText.replace(/\s+/g, " ").trim()}
						</span>
					) : null}
				</div>
				<span
					className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
					title={formatFull(message.date)}
				>
					{formatWhen(message.date)}
				</span>
			</button>

			{open ? (
				<div className="px-8">
					<p className="pb-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						<span data-selectable className="block truncate">
							To {participantsLine(message.to, "(nobody)")}
							{message.cc.length > 0 ? `, Cc ${participantsLine(message.cc)}` : ""}
						</span>
					</p>
					{preview ? (
						<iframe
							title={`Message from ${from}`}
							srcDoc={preview}
							sandbox=""
							referrerPolicy="no-referrer"
							className="block h-[360px] w-full border-t border-[var(--line)] bg-[var(--surface)]"
						/>
					) : (
						<pre
							data-selectable
							className="whitespace-pre-wrap border-t border-[var(--line)] py-4 text-[length:var(--text-base)] leading-[var(--leading-relaxed)]"
						>
							{message.bodyText}
						</pre>
					)}
					{message.attachments.length > 0 ? (
						<p className="border-t border-[var(--line)] py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Attached: {message.attachments.map((a) => a.filename).join(", ")}
						</p>
					) : null}
					<p className="border-t border-[var(--line)] py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{message.state === "sent"
							? "Sent from Juno. The copy in Sent takes its place after the next sync."
							: message.state === "draft"
								? "Not sent yet. It stays here until you send it."
								: message.state === "pending"
									? "Waiting for you. Open it to read the whole message and send or reject it."
									: message.state === "failed"
										? "This message could not be sent. Open it to try again."
										: message.state === "queued"
											? "Queued. It goes out in a moment."
											: "Sending"}
					</p>
					{editable && onEdit ? (
						<div className="border-t border-[var(--line)] py-3">
							<Button size="dense" onClick={() => onEdit(message.id)}>
								Open in the composer
							</Button>
						</div>
					) : null}
				</div>
			) : null}
		</article>
	);
}
