import { useState } from "react";
import type { MailThreadOutgoing } from "@shared/types";
import { framed } from "../../lib/framed-preview";
import { displayName, formatFull, formatWhen, participantsLine } from "./format";

type OutgoingMessageViewProps = {
	message: MailThreadOutgoing;
};

/**
 * A reply Juno sent whose copy has not come back from the Sent folder yet. It
 * reads like the messages around it, minus what only a synced message has: no
 * reply row, no flag, no read state, because it is the outbox's row and not a
 * mail message. The frame is the outbox preview's, so a remote picture is a
 * box here as it is there (lib/framed-preview.ts).
 */
export function OutgoingMessageView({ message }: OutgoingMessageViewProps) {
	const [open, setOpen] = useState(true);
	const from = displayName(message.from);
	const preview = message.bodyHtml ? framed(message.bodyHtml, "") : null;
	const sending = message.state !== "sent";

	return (
		<article className="border-t border-[var(--line)] first:border-t-0" data-outgoing>
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				className="flex w-full items-start gap-3 py-3 text-left hover:bg-[var(--hover)]"
			>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate font-[var(--weight-medium)]">{from}</span>
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
				<div>
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
						{sending
							? "Sending"
							: "Sent from Juno. The copy in Sent takes its place after the next sync."}
					</p>
				</div>
			) : null}
		</article>
	);
}
