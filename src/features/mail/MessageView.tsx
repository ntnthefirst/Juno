import { useEffect, useState } from "react";
import { MAIL_FRAME_ORIGIN, type MailMessage, type MailMessageBody } from "@shared/types";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { displayName, formatBytes, formatFull, formatWhen } from "./format";

type MessageViewProps = {
	message: MailMessage;
	initiallyOpen: boolean;
	onNotice: (message: string) => void;
	onReply: (messageId: string, all: boolean) => void;
};

/**
 * One message. The body lives in a frame with an empty sandbox, loaded from
 * its own origin with its own policy: no scripts, no navigation, no network,
 * no remote images unless this message's button is pressed. Links are listed
 * below the frame with their real targets, because a click inside goes nowhere.
 */
export function MessageView({ message, initiallyOpen, onNotice, onReply }: MessageViewProps) {
	const [open, setOpen] = useState(initiallyOpen);
	const [body, setBody] = useState<MailMessageBody | null>(null);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [remoteImages, setRemoteImages] = useState(false);
	const [tall, setTall] = useState(false);

	useEffect(() => {
		if (!open || !message.bodyFetched) return;
		let cancelled = false;
		window.bureau.mail.messages
			.body(message.id)
			.then((value) => {
				if (!cancelled) setBody(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setBodyError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [open, message.id, message.bodyFetched]);

	async function openLink(href: string) {
		try {
			await window.bureau.mail.openLink(href);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function reveal(id: string) {
		try {
			await window.bureau.mail.attachments.reveal(id);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function save(id: string) {
		try {
			const path = await window.bureau.mail.attachments.save(id);
			if (path) onNotice(`Saved to ${path}`);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	const from = message.from ? displayName(message.from) : "(unknown sender)";
	const visibleAttachments = message.attachments.filter((a) => !a.isInline);
	const frameSrc = `${MAIL_FRAME_ORIGIN}/message/${message.id}${remoteImages ? "?images=1" : ""}`;

	return (
		<article className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				className="flex w-full items-baseline gap-3 px-4 py-3 text-left hover:bg-[var(--hover)]"
			>
				<span
					className={`min-w-0 flex-1 truncate ${message.isSeen ? "" : "font-[var(--weight-semibold)]"}`}
					title={message.from?.address}
				>
					{from}
				</span>
				{!open ? (
					<span className="min-w-0 flex-[2] truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{message.snippet}
					</span>
				) : null}
				<span
					className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
					title={formatFull(message.internalDate)}
				>
					{formatWhen(message.sentAt ?? message.internalDate)}
				</span>
			</button>

			{open ? (
				<div className="border-t border-[var(--line)]">
					<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 px-4 py-3 text-[length:var(--text-sm)]">
						<dt className="text-[var(--ink-muted)]">From</dt>
						<dd data-selectable className="truncate">
							{message.from ? `${from} <${message.from.address}>` : "(unknown sender)"}
						</dd>
						{message.to.length > 0 ? (
							<>
								<dt className="text-[var(--ink-muted)]">To</dt>
								<dd data-selectable className="truncate">
									{message.to.map((a) => a.address).join(", ")}
								</dd>
							</>
						) : null}
						{message.cc.length > 0 ? (
							<>
								<dt className="text-[var(--ink-muted)]">Cc</dt>
								<dd data-selectable className="truncate">
									{message.cc.map((a) => a.address).join(", ")}
								</dd>
							</>
						) : null}
						<dt className="text-[var(--ink-muted)]">Date</dt>
						<dd className="tabular">{formatFull(message.sentAt ?? message.internalDate)}</dd>
					</dl>

					{!message.bodyFetched ? (
						<p className="border-t border-[var(--line)] px-4 py-6 text-[var(--ink-muted)]">
							{message.bodyError
								? `This message could not be fetched. ${message.bodyError}`
								: "The body has not been fetched yet. It arrives with the next sync."}
						</p>
					) : bodyError ? (
						<p data-selectable className="border-t border-[var(--line)] px-4 py-6 text-[var(--risk)]">
							{bodyError}
						</p>
					) : (
						<>
							{body && body.remoteImages > 0 && !remoteImages ? (
								<div className="flex items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--sunken)] px-4 py-2 text-[length:var(--text-sm)]">
									<span className="text-[var(--ink-muted)]">
										{body.remoteImages} remote {body.remoteImages === 1 ? "image" : "images"} not
										loaded. Loading them tells the sender you opened this.
									</span>
									<Button size="dense" onClick={() => setRemoteImages(true)}>
										Load images
									</Button>
								</div>
							) : null}
							<iframe
								title={`Message from ${from}`}
								src={frameSrc}
								sandbox=""
								referrerPolicy="no-referrer"
								className="block w-full border-t border-[var(--line)] bg-[var(--surface)]"
								style={{ height: tall ? 1600 : 520 }}
							/>
							<div className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-4 py-2">
								<div className="flex gap-2">
									<Button size="dense" onClick={() => onReply(message.id, false)}>
										Reply
									</Button>
									<Button size="dense" onClick={() => onReply(message.id, true)}>
										Reply all
									</Button>
								</div>
								<Button size="dense" onClick={() => setTall((current) => !current)}>
									{tall ? "Shorter" : "Taller"}
								</Button>
							</div>
						</>
					)}

					{visibleAttachments.length > 0 ? (
						<div className="border-t border-[var(--line)] px-4 py-3">
							<h3 className="text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
								Attachments
							</h3>
							<ul className="mt-2 flex flex-col">
								{visibleAttachments.map((attachment) => (
									<li
										key={attachment.id}
										className="flex items-center gap-3 text-[length:var(--text-dense)]"
										style={{ height: "var(--row-height)" }}
									>
										<span className="min-w-0 flex-1 truncate" title={attachment.mimeType}>
											{attachment.filename}
										</span>
										<span className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{formatBytes(attachment.size)}
										</span>
										<Button size="dense" onClick={() => void reveal(attachment.id)}>
											Show in folder
										</Button>
										<Button size="dense" onClick={() => void save(attachment.id)}>
											Save as
										</Button>
									</li>
								))}
							</ul>
							<p className="mt-1 text-[length:var(--text-micro)] text-[var(--ink-faint)]">
								Attachments are never opened from here.
							</p>
						</div>
					) : null}

					{body && body.links.length > 0 ? (
						<div className="border-t border-[var(--line)] px-4 py-3">
							<h3 className="text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
								Links in this message
							</h3>
							<ul className="mt-2 flex flex-col gap-1">
								{body.links.slice(0, 40).map((link) => (
									<li key={link.href} className="flex min-w-0 items-baseline gap-2 text-[length:var(--text-sm)]">
										<button
											type="button"
											onClick={() => void openLink(link.href)}
											className="shrink-0 text-[var(--accent)] hover:underline"
										>
											{link.text || "Open"}
										</button>
										<span data-selectable className="min-w-0 truncate font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{link.href}
										</span>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			) : null}
		</article>
	);
}
