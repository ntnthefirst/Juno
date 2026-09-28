import {
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	MAIL_FRAME_ORIGIN,
	type MailMessage,
	type MailMessageBody,
	type MailReplyMode,
} from "@shared/types";
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

/**
 * An explicit override, in pixels, remembered per machine rather than per
 * message: it is a habit about how somebody reads mail, not a property of one
 * message. With no override the frame fills whatever room is left below the
 * header, down to the bottom of the window, which is the right size for most
 * mail. A longer message is the exception, and dragging the handle once sets
 * an explicit height that then applies everywhere, because there is no way to
 * know a message is long before its sandboxed frame has been dragged open: the
 * frame's own document is a different origin on purpose (decision 20), so this
 * page can never measure what is inside it.
 */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;
const HEIGHT_STEP = 40;
const HEIGHT_KEY = "juno.mail.readerHeight";

function clampHeight(value: number): number {
	return Math.min(Math.max(value, MIN_HEIGHT), MAX_HEIGHT);
}

function readStoredHeight(): number | null {
	try {
		const raw = localStorage.getItem(HEIGHT_KEY);
		const parsed = raw === null ? NaN : Number(raw);
		return Number.isFinite(parsed) ? clampHeight(parsed) : null;
	} catch {
		return null;
	}
}

function storeHeight(value: number | null): void {
	try {
		if (value === null) localStorage.removeItem(HEIGHT_KEY);
		else localStorage.setItem(HEIGHT_KEY, String(value));
	} catch {
		// A private window or blocked site data. The frame still resizes, it
		// just forgets the choice on the next launch.
	}
}

/**
 * One message: a header line, then the body once opened. No card, no border
 * around the whole thing. Messages in a thread are told apart by a hairline
 * rule, the way a document separates paragraphs rather than boxing each one.
 *
 * The body lives in a frame with an empty sandbox, loaded from its own origin
 * with its own policy: no scripts, no navigation, no network, no remote
 * images unless this message's button is pressed. Links are listed below the
 * frame with their real targets, because a click inside goes nowhere.
 */
export function MessageView({ message, open, onToggle, onNotice, onReply, onChanged }: MessageViewProps) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [body, setBody] = useState<MailMessageBody | null>(null);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [remoteImages, setRemoteImages] = useState(false);
	const [overrideHeight, setOverrideHeight] = useState<number | null>(readStoredHeight);
	const [resizing, setResizing] = useState(false);
	const frame = useRef<HTMLIFrameElement>(null);
	const drag = useRef<{ y: number; from: number } | null>(null);
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

	/** Sets and remembers an explicit height, from the keyboard or a double-click. */
	function commitHeight(next: number | null) {
		const clamped = next === null ? null : clampHeight(next);
		setOverrideHeight(clamped);
		storeHeight(clamped);
	}

	function currentHeight(): number {
		return overrideHeight ?? frame.current?.getBoundingClientRect().height ?? MIN_HEIGHT;
	}

	function startResize(event: ReactPointerEvent<HTMLDivElement>) {
		drag.current = { y: event.clientY, from: currentHeight() };
		setResizing(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
		const start = drag.current;
		if (!start) return;
		setOverrideHeight(clampHeight(start.from + (event.clientY - start.y)));
	}

	function endResize(event: ReactPointerEvent<HTMLDivElement>) {
		if (!drag.current) return;
		drag.current = null;
		setResizing(false);
		event.currentTarget.releasePointerCapture(event.pointerId);
		// The last `moveResize` already committed the clamped value to state;
		// this is the point to remember it, not every point along the drag.
		storeHeight(overrideHeight);
	}

	const from = message.from ? displayName(message.from) : "(unknown sender)";
	const visibleAttachments = message.attachments.filter((a) => !a.isInline);
	const frameSrc = `${MAIL_FRAME_ORIGIN}/message/${message.id}${remoteImages ? "?images=1" : ""}`;
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
			className={`border-t border-[var(--line)] px-8 first:border-t-0 ${open ? "flex flex-1 flex-col" : ""}`}
			onContextMenu={menu.open}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="flex w-full shrink-0 items-start gap-3 py-3 text-left hover:bg-[var(--hover)]"
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
				<div className="flex flex-1 flex-col">
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

					{!message.bodyFetched ? (
						<p className="shrink-0 border-t border-[var(--line)] py-6 text-[var(--ink-muted)]">
							{message.bodyError
								? `This message could not be fetched. ${message.bodyError}`
								: "The body has not been fetched yet. It arrives with the next sync."}
						</p>
					) : bodyError ? (
						<p data-selectable className="shrink-0 border-t border-[var(--line)] py-6 text-[var(--risk)]">
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
									<Button size="dense" onClick={() => setRemoteImages(true)}>
										Load images
									</Button>
								</div>
							) : null}
							<iframe
								ref={frame}
								title={`Message from ${from}`}
								src={frameSrc}
								sandbox=""
								referrerPolicy="no-referrer"
								className={`block w-full border-t border-[var(--line)] bg-[var(--surface)] ${overrideHeight === null ? "min-h-0 flex-1" : "shrink-0"} ${resizing ? "pointer-events-none" : ""}`}
								style={overrideHeight === null ? undefined : { height: overrideHeight }}
							/>
							{/*
								A sandboxed frame swallows pointer events, which is why the
								iframe above loses them for the length of the drag: without
								that, the pointer crossing into the frame would end the resize
								early. Pointer capture on this element keeps the drag going
								regardless.
							*/}
							<div
								role="separator"
								aria-orientation="horizontal"
								aria-valuenow={overrideHeight ?? undefined}
								aria-valuemin={MIN_HEIGHT}
								aria-valuemax={MAX_HEIGHT}
								aria-label="Resize message"
								tabIndex={0}
								onPointerDown={startResize}
								onPointerMove={moveResize}
								onPointerUp={endResize}
								onPointerCancel={endResize}
								onDoubleClick={() => commitHeight(null)}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown") commitHeight(currentHeight() + HEIGHT_STEP);
									else if (event.key === "ArrowUp") commitHeight(currentHeight() - HEIGHT_STEP);
									else if (event.key === "Home") commitHeight(MIN_HEIGHT);
									else if (event.key === "End") commitHeight(MAX_HEIGHT);
									else return;
									event.preventDefault();
								}}
								className="flex h-[12px] w-full shrink-0 cursor-row-resize items-center justify-center bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<span className="h-[3px] w-[48px] rounded-[var(--radius-sm)] bg-[var(--line-strong)]" />
							</div>

							{body && body.links.length > 0 ? (
								<div className="shrink-0 border-t border-[var(--line)] px-8 py-3">
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
					)}
				</div>
			) : null}

			{menu.at ? <ContextMenu at={menu.at} items={contextItems} onClose={menu.close} ariaLabel={ariaLabel} /> : null}
		</article>
	);
}
