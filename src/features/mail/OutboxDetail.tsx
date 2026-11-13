import { IconButton } from "../../components/IconButton";
import { useState } from "react";
import type { MailOutboxMessage } from "@shared/types";
import { tokensToLabels } from "@shared/mail-variables";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { framed } from "../../lib/framed-preview";
import { formatFull } from "./format";
import { STATE_LABELS, STATE_TONES } from "./outbox-format";

type OutboxDetailProps = {
	message: MailOutboxMessage;
	/** Opens the message in the editor, taking it back to a draft first when it is waiting or failed. */
	onEdit: (message: MailOutboxMessage) => void;
	/** Asks, in a dialog, whether to delete it. */
	onDelete: (message: MailOutboxMessage) => void;
	onChanged: () => void;
	onNotice: (message: string) => void;
};

/**
 * A composed message that is not a draft, and what can be done with it: where
 * it is in the queue, why it failed, and retrying, editing or deleting it. A draft opens
 * in the editor instead, so there is nothing to read first.
 */
export function OutboxDetail({ message, onEdit, onDelete, onChanged, onNotice }: OutboxDetailProps) {
	const [busy, setBusy] = useState(false);
	// The window fetches no picture or stylesheet from an address, so the frame
	// shows a box where each remote picture goes (lib/framed-preview.ts).
	const preview = message.bodyHtml ? framed(message.bodyHtml, "") : null;

	async function run(action: () => Promise<unknown>, done?: string) {
		setBusy(true);
		try {
			await action();
			if (done) onNotice(done);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	// Anything that has not gone out is edited or deleted (decision 78).
	const editable = message.state !== "sending" && message.state !== "sent";

	return (
		<div className="px-8 py-6">
			<div className="flex items-start justify-between gap-6">
				<h2 className="min-w-0 text-h2">
					{message.subject || "(no subject)"}
				</h2>
				<span className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-sm ${STATE_TONES[message.state]}`}>
					{STATE_LABELS[message.state]}
				</span>
			</div>

			{message.lastError ? (
				<p data-selectable className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					{message.lastError}
				</p>
			) : null}

			<dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-sm">
				<dt className="text-[var(--ink-muted)]">To</dt>
				<dd data-selectable>{message.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ") || "(nobody)"}</dd>
				{message.cc.length > 0 ? (
					<>
						<dt className="text-[var(--ink-muted)]">Cc</dt>
						<dd data-selectable>{message.cc.map((a) => a.address).join(", ")}</dd>
					</>
				) : null}
				{message.clientName ? (
					<>
						<dt className="text-[var(--ink-muted)]">Client</dt>
						<dd>{message.clientName}</dd>
					</>
				) : null}
				{message.attachments.length > 0 ? (
					<>
						<dt className="text-[var(--ink-muted)]">Attached</dt>
						<dd>{message.attachments.map((a) => a.filename).join(", ")}</dd>
					</>
				) : null}
				{message.sentAt ? (
					<>
						<dt className="text-[var(--ink-muted)]">Sent</dt>
						<dd className="tabular">
							{formatFull(message.sentAt)}
							{message.appendedToSentAt ? ", copied to Sent" : message.appendError ? `, not copied to Sent: ${message.appendError}` : ""}
						</dd>
					</>
				) : null}
				<dt className="text-[var(--ink-muted)]">Attempts</dt>
				<dd className="tabular">{message.attempts}</dd>
				<dt className="text-[var(--ink-muted)]">Message-ID</dt>
				<dd data-selectable className="truncate font-mono text-micro">{message.messageId}</dd>
			</dl>

			<div className="mt-6 flex flex-wrap gap-2">
				{message.state === "draft" ? (
					<Button variant="primary" disabled={busy} onClick={() => void run(() => window.juno.mail.outbox.send(message.id), "Message queued.")}>
						Send
					</Button>
				) : null}
				{message.state === "failed" ? (
					<Button variant="primary" disabled={busy} onClick={() => void run(() => window.juno.mail.outbox.retry(message.id), "Trying again.")}>
						Retry
					</Button>
				) : null}
				{editable ? <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => onEdit(message)} /> : null}
				{editable ? (
					<IconButton icon="remove" label="Delete" danger disabled={busy} onClick={() => onDelete(message)} />
				) : null}
			</div>

			{preview ? (
				<div className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
					<iframe
						title="Message as it will be sent"
						srcDoc={preview}
						sandbox=""
						referrerPolicy="no-referrer"
						className="block h-[560px] w-full bg-[var(--surface)]"
					/>
				</div>
			) : (
				<pre className="mt-6 whitespace-pre-wrap rounded-[var(--radius-lg)] border border-[var(--line)] p-4 text-base leading-[var(--leading-relaxed)]">
					{tokensToLabels(message.bodyText)}
				</pre>
			)}
		</div>
	);
}
