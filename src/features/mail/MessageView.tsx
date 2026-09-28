import { useEffect, useRef, useState } from "react";
import { MAIL_FRAME_ORIGIN, type MailMessage, type MailMessageBody, type MailReplyMode } from "@shared/types";
import { Button } from "../../components/Button";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { messageOf } from "../../lib/errors";
import { displayName, formatBytes, formatFull, formatWhen, participantsLine } from "./format";

type MessageViewProps = {
	message: MailMessage;
	/** Accordion: the thread shows one open message at a time. */
	open: boolean;
	onToggle: () => void;
	onNotice: (message: string) => void;
	onReply: (messageId: string, mode: MailReplyMode) => void;
	/** A file action on this message changed it (read, flagged): reload the thread. */
	onChanged: () => void;
};

export function MessageView({ message, open, onToggle, onNotice, onReply, onChanged }: MessageViewProps) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [body, setBody] = useState<MailMessageBody | null>(null);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [remoteImages, setRemoteImages] = useState(false);
	const [measuredFrame, setMeasuredFrame] = useState<{ messageId: string; height: number } | null>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const menu = useContextMenu();

	useEffect(() => {
		if (!open || !message.bodyFetched) return;
		let cancelled = false;
		window.juno.mail.messages
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

	useEffect(() => {
		function receiveHeight(event: MessageEvent<unknown>) {
			if (event.source !== frame.current?.contentWindow) return;
			if (!event.data || typeof event.data !== "object") return;
			const data = event.data as { type?: unknown; height?: unknown };
			if (data.type !== "juno.mail.height" || typeof data.height !== "number" || !Number.isFinite(data.height))
				return;
			setMeasuredFrame({ messageId: message.id, height: Math.max(1, Math.ceil(data.height)) });
		}

		window.addEventListener("message", receiveHeight);
		return () => window.removeEventListener("message", receiveHeight);
	}, [message.id]);

	async function openLink(href: string) {
		try {
			await window.juno.mail.openLink(href);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function reveal(id: string) {
		try {
			await window.juno.mail.attachments.reveal(id);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function save(id: string) {
		try {
			const path = await window.juno.mail.attachments.save(id);
			if (path) onNotice(`Saved to ${path}`);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function markUnread() {
		try {
			await window.juno.mail.file.setSeen([message.id], false);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function copyAddress() {
		if (!message.from) return;
		try {
			await navigator.clipboard.writeText(message.from.address);
			onNotice("Address copied.");
		} catch {
			onNotice("Could not copy the address.");
		}
	}

	const from = message.from ? displayName(message.from) : "(unknown sender)";
	const visibleAttachments = message.attachments.filter((a) => !a.isInline);
	const frameSrc = `${MAIL_FRAME_ORIGIN}/message/${message.id}${remoteImages ? "?images=1" : ""}`;
	const frameHeight = measuredFrame?.messageId === message.id ? measuredFrame.height : null;
	const ariaLabel = `Actions for message from ${from}`;

	const contextItems: MenuItem[] = [
		{ id: "reply", label: "Reply", icon: "reply", onSelect: () => onReply(message.id, "reply") },
		{ id: "reply-all", label: "Reply all", icon: "reply", onSelect: () => onReply(message.id, "reply_all") },
		{ id: "forward", label: "Forward", icon: "forward", onSelect: () => onReply(message.id, "forward") },
		{ id: "mark-unread", label: "Mark unread", icon: "unread", onSelect: () => void markUnread() },
		{
			id: "copy-address",
			label: "Copy sender address",
			icon: "copy",
			disabled: !message.from,
			onSelect: () => void copyAddress(),
		},
	];

	return (
		<article
			className={`border-t border-[var(--line)] first:border-t-0 ${open ? "flex flex-1 flex-col" : ""}`}
			onContextMenu={menu.open}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="flex w-full shrink-0 items-start gap-3 px-8 py-3 text-left hover:bg-[var(--hover)]"
			>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span
							className={`truncate ${message.isSeen ? "font-[var(--weight-medium)]" : "font-[var(--weight-semibold)]"}`}
						>
							{from}
						</span>
						{message.from ? (
							<span className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{message.from.address}
							</span>
						) : null}
					</div>
					{!open ? (
						<span className="mt-0.5 block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{message.snippet}
						</span>
					) : null}
				</div>
				<span
					className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
					title={formatFull(message.internalDate)}
				>
					{formatWhen(message.sentAt ?? message.internalDate)}
				</span>
			</button>

			{open ? (
				<div className="flex flex-1 flex-col px-8">
					<div className="flex shrink-0 items-center gap-2 pb-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						<span className="min-w-0 flex-1 truncate">To {participantsLine(message.to, "(nobody)")}</span>
						<button
							type="button"
							onClick={() => setDetailsOpen((current) => !current)}
							className="shrink-0 hover:text-[var(--ink)] hover:underline"
						>
							{detailsOpen ? "Hide" : "Details"}
						</button>
					</div>

					{detailsOpen ? (
						<dl className="grid shrink-0 grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 pb-3 text-[length:var(--text-sm)]">
							<dt className="text-[var(--ink-muted)]">From</dt>
							<dd
								data-selectable
								className="truncate"
							>
								{message.from ? `${from} <${message.from.address}>` : "(unknown sender)"}
							</dd>
							{message.to.length > 0 ? (
								<>
									<dt className="text-[var(--ink-muted)]">To</dt>
									<dd
										data-selectable
										className="truncate"
									>
										{message.to.map((a) => a.address).join(", ")}
									</dd>
								</>
							) : null}
							{message.cc.length > 0 ? (
								<>
									<dt className="text-[var(--ink-muted)]">Cc</dt>
									<dd
										data-selectable
										className="truncate"
									>
										{message.cc.map((a) => a.address).join(", ")}
									</dd>
								</>
							) : null}
							<dt className="text-[var(--ink-muted)]">Date</dt>
							<dd className="tabular">{formatFull(message.sentAt ?? message.internalDate)}</dd>
						</dl>
					) : null}

					{visibleAttachments.length > 0 ? (
						<div className="shrink-0 border-t border-[var(--line)] py-3">
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
										<span
											className="min-w-0 flex-1 truncate"
											title={attachment.mimeType}
										>
											{attachment.filename}
										</span>
										<span className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{formatBytes(attachment.size)}
										</span>
										<Button
											size="dense"
											onClick={() => void reveal(attachment.id)}
										>
											Show in folder
										</Button>
										<Button
											size="dense"
											onClick={() => void save(attachment.id)}
										>
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

					{!message.bodyFetched ? (
						<p className="shrink-0 border-t border-[var(--line)] py-6 text-[var(--ink-muted)]">
							{message.bodyError
								? `This message could not be fetched. ${message.bodyError}`
								: "The body has not been fetched yet. It arrives with the next sync."}
						</p>
					) : bodyError ? (
						<p
							data-selectable
							className="shrink-0 border-t border-[var(--line)] py-6 text-[var(--risk)]"
						>
							{bodyError}
						</p>
					) : (
						<div className="-mx-8 flex flex-1 flex-col">
							{body && body.remoteImages > 0 && !remoteImages ? (
								<div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--sunken)] px-8 py-2 text-[length:var(--text-sm)]">
									<span className="text-[var(--ink-muted)]">
										{body.remoteImages} remote {body.remoteImages === 1 ? "image" : "images"} not
										loaded. Loading them tells the sender you opened this.
									</span>
									<Button
										size="dense"
										onClick={() => setRemoteImages(true)}
									>
										Load images
									</Button>
								</div>
							) : null}
							<iframe
								ref={frame}
								title={`Message from ${from}`}
								src={frameSrc}
								sandbox="allow-scripts"
								referrerPolicy="no-referrer"
								className="block min-h-full w-full shrink-0 overflow-x-auto overflow-y-hidden border-t border-[var(--line)] bg-[var(--surface)]"
								style={frameHeight === null ? undefined : { height: frameHeight }}
							/>

							{body && body.links.length > 0 ? (
								<div className="shrink-0 border-t border-[var(--line)] px-8 py-3">
									<h3 className="text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
										Links in this message
									</h3>
									<ul className="mt-2 flex flex-col gap-1">
										{body.links.slice(0, 40).map((link) => (
											<li
												key={link.href}
												className="flex min-w-0 items-baseline gap-2 text-[length:var(--text-sm)]"
											>
												<button
													type="button"
													onClick={() => void openLink(link.href)}
													className="shrink-0 text-[var(--accent)] hover:underline"
												>
													{link.text || "Open"}
												</button>
												<span
													data-selectable
													className="min-w-0 truncate font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)]"
												>
													{link.href}
												</span>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					)}
				</div>
			) : null}

			{menu.at ? (
				<ContextMenu
					at={menu.at}
					items={contextItems}
					onClose={menu.close}
					ariaLabel={ariaLabel}
				/>
			) : null}
		</article>
	);
}
