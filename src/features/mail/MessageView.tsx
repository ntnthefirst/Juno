import { useEffect, useRef, useState, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { isOpenableAttachment } from "@shared/attachment-kind";
import { isHttpsLink } from "@shared/mail-link";
import {
	MAIL_FRAME_ORIGIN,
	type ClientSummary,
	type MessageSuggestion,
	type MailAttachment,
	type MailMessage,
	type MailMessageBody,
	type MailReplyMode,
} from "@shared/types";
import { Button } from "../../components/Button";
import { FindBar } from "../../components/FindBar";
import { Notice } from "../../components/Notice";
import { COMBOS, matchesCombo } from "../../lib/shortcuts";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";
import { messageOf } from "../../lib/errors";
import { describeOutcome, type ImportItem } from "../../lib/pdf-drop";
import { ImportFlow } from "../documents/ImportFlow";
import { AttachmentIcon } from "../../components/AttachmentIcon";
import { LinkPopover } from "./LinkPopover";
import { PersonChip } from "./PersonChip";
import { SuggestionBar } from "./SuggestionBar";
import { displayName, formatBytes, formatFull, formatWhen, participantsLine } from "./format";

type MessageViewProps = {
	message: MailMessage;
	/** Accordion: the thread shows one open message at a time. */
	open: boolean;
	onToggle: () => void;
	onNotice: (message: string) => void;
	onReply: (messageId: string, mode: MailReplyMode) => void;
	clientLinked: boolean;
	/** The project the conversation is filed under: an attachment can go into its files. */
	project: { id: string; name: string } | null;
	/** A file action on this message changed it (read, flagged): reload the thread. */
	onChanged: () => void;
};

/** Lets a plain mouse wheel move a row that only scrolls sideways. */
function scrollSideways(event: WheelEvent<HTMLElement>) {
	if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
	event.currentTarget.scrollLeft += event.deltaY;
}

function isPdf(attachment: MailAttachment): boolean {
	return attachment.mimeType === "application/pdf" || attachment.filename.toLowerCase().endsWith(".pdf");
}

const TRUSTED_EMAILS_KEY = "juno.mail.trustedEmails";
const TRUSTED_SENDERS_KEY = "juno.mail.trustedSenders";
const BLOCKED_SENDERS_KEY = "juno.mail.blockedSenders";

/** The button on each kind of suggestion, named for what it does. */
const ACTION_LABELS: Record<MessageSuggestion["kind"], string> = {
	event: "Add to calendar",
	project: "Link to project",
	reminder: "Add reminder",
};

function readTrust(key: string): string[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function addTrust(key: string, value: string): void {
	try {
		const values = new Set(readTrust(key));
		values.add(value);
		localStorage.setItem(key, JSON.stringify([...values]));
	} catch {
		// Trust still applies for this open message when site data is unavailable.
	}
}

function removeTrust(key: string, value: string): void {
	try {
		localStorage.setItem(key, JSON.stringify(readTrust(key).filter((item) => item !== value)));
	} catch {
		// The current decision still applies until the message is closed.
	}
}

export function MessageView({
	message,
	open,
	onToggle,
	onNotice,
	onReply,
	onChanged,
	clientLinked,
	project,
}: MessageViewProps) {
	const senderAddress = message.from?.address.toLowerCase() ?? null;
	const emailTrusted = readTrust(TRUSTED_EMAILS_KEY).includes(message.id);
	const senderTrusted = senderAddress !== null && readTrust(TRUSTED_SENDERS_KEY).includes(senderAddress);
	const senderBlocked = senderAddress !== null && readTrust(BLOCKED_SENDERS_KEY).includes(senderAddress);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [importItems, setImportItems] = useState<ImportItem[] | null>(null);
	const [body, setBody] = useState<MailMessageBody | null>(null);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [trustDecision, setTrustDecision] = useState<"unknown" | "trusted" | "blocked">(
		clientLinked || (!senderBlocked && (emailTrusted || senderTrusted))
			? "trusted"
			: senderBlocked
				? "blocked"
				: "unknown",
	);
	const trusted = clientLinked || trustDecision === "trusted";
	const [remoteImages, setRemoteImages] = useState(emailTrusted || senderTrusted);
	const [linksOpen, setLinksOpen] = useState(false);
	const [mine, setMine] = useState<ReadonlySet<string>>(() => new Set());
	const [measuredFrame, setMeasuredFrame] = useState<{ messageId: string; height: number } | null>(null);
	const [hoveredLink, setHoveredLink] = useState<{ messageId: string; href: string; x: number; y: number } | null>(null);
	const hideTimer = useRef<number | null>(null);	const noticeRef = useRef(onNotice);
	const [offers, setOffers] = useState<{ messageId: string; list: MessageSuggestion[] } | null>(null);
	const [offerBusy, setOfferBusy] = useState(false);
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [findResult, setFindResult] = useState({ count: 0, current: -1 });
	const frame = useRef<HTMLIFrameElement>(null);
	const menu = useContextMenu();

	useEffect(() => {
		if (!open || !message.bodyFetched || (!clientLinked && !trusted)) return;
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
	}, [open, message.id, message.bodyFetched, clientLinked, trusted]);

	useEffect(() => {
		noticeRef.current = onNotice;
	});

	function tellFrame(action: "search" | "next" | "previous" | "clear", query = "") {
		frame.current?.contentWindow?.postMessage({ type: "juno.mail.find", action, query }, "*");
	}

	function closeFind() {
		setFindOpen(false);
		setFindResult({ count: 0, current: -1 });
		tellFrame("clear");
	}

	// Ctrl F finds in the message that is open, and nowhere else. It listens on
	// the document, which hears the key before the title bar search does.
	useEffect(() => {
		if (!open) return;
		function onKey(event: KeyboardEvent) {
			if (!matchesCombo(event, COMBOS.find)) return;
			if (document.querySelector("[role='dialog']")) return;
			event.preventDefault();
			setFindOpen(true);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	// The match list is the frame's, so a new query, or a frame that has just
	// loaded again, asks it to search once more.
	useEffect(() => {
		if (!findOpen) return;
		if (findQuery === "") {
			frame.current?.contentWindow?.postMessage({ type: "juno.mail.find", action: "clear", query: "" }, "*");
			return;
		}
		frame.current?.contentWindow?.postMessage({ type: "juno.mail.find", action: "search", query: findQuery }, "*");
	}, [findOpen, findQuery, remoteImages, message.id]);

	useEffect(() => {
		function cancelHide() {
			if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}

		function revealInFrame(top: number) {
			const box = frame.current?.getBoundingClientRect();
			if (!box) return;
			// The frame is as tall as its message, so the reader around it is what scrolls.
			let holder: HTMLElement | null = frame.current?.parentElement ?? null;
			while (holder && !(holder.scrollHeight > holder.clientHeight && /(auto|scroll)/.test(getComputedStyle(holder).overflowY))) {
				holder = holder.parentElement;
			}
			if (!holder) return;
			const bounds = holder.getBoundingClientRect();
			const at = box.top + top;
			if (at < bounds.top + 80 || at > bounds.bottom - 40) {
				holder.scrollTo({ top: holder.scrollTop + (at - bounds.top) - bounds.height / 3 });
			}
		}

		function receiveHeight(event: MessageEvent<unknown>) {
			if (event.source !== frame.current?.contentWindow) return;
			if (!event.data || typeof event.data !== "object") return;
			const data = event.data as { type?: unknown; height?: unknown; href?: unknown; rect?: unknown };
			if (data.type === "juno.mail.link") {
				const rect = data.rect as { left?: unknown; bottom?: unknown } | undefined;
				if (typeof data.href === "string" && rect && typeof rect.left === "number" && typeof rect.bottom === "number") {
					const box = frame.current?.getBoundingClientRect();
					if (!box) return;
					cancelHide();
					setHoveredLink({ messageId: message.id, href: data.href, x: box.left + rect.left, y: box.top + rect.bottom + 2 });
				} else {
					// A moment's grace, so the pointer can travel from the link to the popover.
					cancelHide();
					hideTimer.current = window.setTimeout(() => setHoveredLink(null), 220);
				}
				return;
			}
			if (data.type === "juno.mail.findResult") {
				const found = data as { count?: unknown; current?: unknown; top?: unknown };
				if (typeof found.count === "number" && typeof found.current === "number") {
					setFindResult({ count: found.count, current: found.current });
				}
				if (typeof found.top === "number") revealInFrame(found.top);
				return;
			}
			if (data.type === "juno.mail.linkClick") {
				if (typeof data.href === "string" && isHttpsLink(data.href)) window.juno.mail.openLink(data.href).catch((cause: unknown) => noticeRef.current(messageOf(cause)));
				return;
			}
			if (data.type !== "juno.mail.height" || typeof data.height !== "number" || !Number.isFinite(data.height))
				return;
			setMeasuredFrame({ messageId: message.id, height: Math.max(1, Math.ceil(data.height)) });
		}

		window.addEventListener("message", receiveHeight);
		return () => {
			window.removeEventListener("message", receiveHeight);
			cancelHide();
		};
	}, [message.id]);

	// Offers under the header, worked out locally when the message is opened.
	useEffect(() => {
		if (!open || !message.bodyFetched) return;
		let cancelled = false;
		window.juno.suggestions
			.forMessage(message.id)
			.then((list) => {
				if (!cancelled) setOffers({ messageId: message.id, list });
			})
			.catch(() => {
				// No offer is the safe direction: the message reads the same without one.
			});
		return () => {
			cancelled = true;
		};
	}, [open, message.id, message.bodyFetched]);

	// The owner's addresses and the accounts', which are not someone to look up.
	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.settings.getOwner(), window.juno.mail.accounts.list()])
			.then(([owner, accounts]) => {
				if (cancelled) return;
				setMine(
					new Set([
						...owner.emails.map((entry) => entry.email.toLowerCase()),
						...accounts.map((account) => account.email.toLowerCase()),
					]),
				);
			})
			.catch(() => {
				// Without the list every address is offered, which is the safe direction.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function connected(client: ClientSummary, address: string) {
		try {
			// The sender's address now matches a client, so the conversation is filed
			// under it too, which is also what lifts the trust prompt.
			if (!clientLinked && address.toLowerCase() === senderAddress) {
				await window.juno.mail.threads.linkClient(message.threadId, client.id);
				onChanged();
			}
			onNotice(`Connected to ${client.name}.`);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	function trustEmail() {
		addTrust(TRUSTED_EMAILS_KEY, message.id);
		setTrustDecision("trusted");
		setRemoteImages(true);
	}

	function trustSender() {
		if (!senderAddress) return;
		removeTrust(BLOCKED_SENDERS_KEY, senderAddress);
		addTrust(TRUSTED_SENDERS_KEY, senderAddress);
		setTrustDecision("trusted");
		setRemoteImages(true);
	}

	function blockSender() {
		if (!senderAddress) return;
		removeTrust(TRUSTED_SENDERS_KEY, senderAddress);
		addTrust(BLOCKED_SENDERS_KEY, senderAddress);
		setTrustDecision("blocked");
		setRemoteImages(false);
	}

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

	async function openFile(id: string) {
		try {
			await window.juno.mail.attachments.open(id);
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

	/** Into the conversation's project, named as it arrived. Any kind: photos, drawings, a price sheet. */
	async function addToProject(id: string, filename: string) {
		if (!project) return;
		try {
			await window.juno.projects.assets.addFromMail(project.id, id);
			onNotice(`${filename} added to the files of ${project.name}.`);
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

	function scheduleHideLink() {
		if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
		hideTimer.current = window.setTimeout(() => setHoveredLink(null), 220);
	}

	async function copyLink(href: string) {
		try {
			await navigator.clipboard.writeText(href);
			onNotice("Link copied.");
		} catch {
			onNotice("Could not copy the link.");
		}
		setHoveredLink(null);
	}

	function without(suggestion: MessageSuggestion) {
		setOffers((current) =>
			current && current.messageId === suggestion.messageId
				? { ...current, list: current.list.filter((item) => item.kind !== suggestion.kind) }
				: current,
		);
	}

	async function acceptOffer(suggestion: MessageSuggestion) {
		if (offerBusy) return;
		setOfferBusy(true);
		try {
			const outcome = await window.juno.suggestions.accept(suggestion.messageId, suggestion.kind);
			without(suggestion);
			onNotice(
				outcome.kind === "event"
					? `Added "${outcome.event.title}" to the calendar.`
					: outcome.kind === "reminder"
						? `Added the reminder "${outcome.reminder.title}".`
						: `Linked this conversation to ${outcome.projectName}.`,
			);
			if (outcome.kind === "project") onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setOfferBusy(false);
		}
	}

	async function dismissOffer(suggestion: MessageSuggestion) {
		if (offerBusy) return;
		setOfferBusy(true);
		try {
			await window.juno.suggestions.dismiss(suggestion.messageId, suggestion.kind);
			without(suggestion);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setOfferBusy(false);
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

	// Trusted senders, and mail the person sent themselves. The main process
	// still refuses types outside its short list.
	const canOpenHere = trusted || (senderAddress !== null && mine.has(senderAddress));
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

	// What the reader is told about the body comes straight under the header, as
	// the design draws it, before anything offered about the message.
	const bodyShown = !(!message.bodyFetched && (clientLinked || trusted)) && !bodyError;
	const trustNotice = !bodyShown ? null : !clientLinked && !trusted ? (
		<Notice
			actions={
				<>
					<Button size="dense" onClick={trustEmail}>
						Trust this email
					</Button>
					{trustDecision === "unknown" ? (
						<Button size="dense" onClick={blockSender}>
							Don't trust sender
						</Button>
					) : null}
					<Button size="dense" onClick={trustSender} disabled={!senderAddress}>
						Trust sender
					</Button>
				</>
			}
		>
			{trustDecision === "blocked"
				? "This sender is not trusted. Content stays blocked."
				: "This email is not trusted. Content and links stay blocked."}
		</Notice>
	) : body?.suspicious ? (
		<Notice role="status">Weird content was removed before this email was shown.</Notice>
	) : null;

	return (
		<article
			className={`border-t border-[var(--line)] first:border-t-0 ${open ? "flex flex-1 flex-col" : ""}`}
			onContextMenu={menu.open}
		>
			{open ? (
				// Not a button while open: the sender is a control of its own, and a
				// button cannot hold another one.
				<div className="flex w-full shrink-0 items-center gap-3 bg-[var(--sunken)] px-6 pt-3 pb-2">
					<div className="flex min-w-0 flex-1 items-center gap-3">
						<span className="text-base text-[var(--ink-muted)]">From</span>
						{message.from ? (
							<span
								className={`min-w-0 text-lg ${message.isSeen ? "font-[var(--weight-medium)]" : "font-[var(--weight-semibold)]"}`}
							>
								<PersonChip
									person={message.from}
									label={from}
									mine={mine}
									trust={{
										trusted,
										viaClient: clientLinked,
										onChange: (next) => (next ? trustSender() : blockSender()),
									}}
									onNotice={onNotice}
									onConnected={(client) => void connected(client, message.from?.address ?? "")}
								/>
							</span>
						) : (
							<span className="text-lg font-[var(--weight-medium)]">{from}</span>
						)}
						{detailsOpen && message.from ? (
							<span data-selectable className="min-w-0 truncate text-sm text-[var(--ink-muted)]">
								{"<"}{message.from.address}{">"}
							</span>
						) : null}
					</div>
					<span
						className="tabular shrink-0 text-base text-[var(--ink-muted)]"
						title={formatFull(message.internalDate)}
					>
						{detailsOpen
							? formatFull(message.sentAt ?? message.internalDate)
							: formatWhen(message.sentAt ?? message.internalDate)}
					</span>
				</div>
			) : (
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
								<span className="min-w-0 truncate text-sm text-[var(--ink-muted)]">
									{message.from.address}
								</span>
							) : null}
						</div>
						<span className="mt-0.5 block truncate text-sm text-[var(--ink-muted)]">
							{message.snippet}
						</span>
					</div>
					<span
						className="tabular shrink-0 text-sm text-[var(--ink-muted)]"
						title={formatFull(message.internalDate)}
					>
						{formatWhen(message.sentAt ?? message.internalDate)}
					</span>
				</button>
			)}

			{open ? (
				<div className="flex flex-1 flex-col px-6">
					<div className="-mx-6 bg-[var(--sunken)] px-6">
						<div className="flex shrink-0 items-center gap-3 pb-3 text-base text-[var(--ink-muted)]">
								<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
									<span>To</span>
									{message.to.length === 0 ? <span>(nobody)</span> : null}
									{message.to.map((person) => (
										<PersonChip
											key={person.address}
											person={person}
											label={detailsOpen ? person.address : participantsLine([person])}
											mine={mine}
											onNotice={onNotice}
											onConnected={(client) => void connected(client, person.address)}
										/>
									))}
									{detailsOpen && message.cc.length > 0 ? <span className="ml-2">Cc</span> : null}
									{detailsOpen
										? message.cc.map((person) => (
												<PersonChip
													key={person.address}
													person={person}
													label={person.address}
													mine={mine}
													onNotice={onNotice}
													onConnected={(client) => void connected(client, person.address)}
												/>
											))
										: null}
								</span>
							<button
								type="button"
								onClick={() => setDetailsOpen((current) => !current)}
								className="shrink-0 hover:text-[var(--ink)] hover:underline"
							>
								{detailsOpen ? "Hide" : "Details"}
							</button>
						</div>

					</div>

					{trustNotice ? <div className="-mx-6 shrink-0">{trustNotice}</div> : null}

					{offers && offers.messageId === message.id && offers.list.length > 0 ? (
						<div className="-mx-2 flex shrink-0 flex-col gap-2 py-3">
							{offers.list.map((suggestion) => (
								<SuggestionBar
									key={suggestion.kind}
									suggestion={suggestion}
									actionLabel={ACTION_LABELS[suggestion.kind]}
									busy={offerBusy}
									onAccept={() => void acceptOffer(suggestion)}
									onDismiss={() => void dismissOffer(suggestion)}
								/>
							))}
						</div>
					) : null}

					{visibleAttachments.length > 0 ? (
						<div className="shrink-0 border-t border-[var(--line)] py-3">
							<h3 className="text-overline uppercase text-[var(--ink-muted)]">
								Attachments
							</h3>
							<ul
								className="mt-2 flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0"
								onWheel={scrollSideways}
							>
								{visibleAttachments.map((attachment) => {
									const canOpen = canOpenHere && isOpenableAttachment(attachment.filename);
									const items: MenuItem[] = [
										{
											id: "open",
											label: "Open",
											icon: "external",
											disabled: !canOpen,
											onSelect: () => void openFile(attachment.id),
										},
										{
											id: "reveal",
											label: "Show in folder",
											icon: "folder-open",
											onSelect: () => void reveal(attachment.id),
										},
										{
											id: "save",
											label: "Save as",
											icon: "export",
											onSelect: () => void save(attachment.id),
										},
										...(isPdf(attachment)
											? [
													{
														id: "import",
														label: "Add to documents",
														icon: "documents" as const,
														onSelect: () =>
															setImportItems([
																{
																	label: attachment.filename,
																	source: { kind: "attachment" as const, attachmentId: attachment.id },
																},
															]),
													},
												]
											: []),
										...(project
											? [
													{
														id: "project",
														label: `Add to ${project.name} files`,
														icon: "projects" as const,
														onSelect: () => void addToProject(attachment.id, attachment.filename),
													},
												]
											: []),
									];
									return (
										<li
											key={attachment.id}
											className="flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] pl-3 pr-1"
											style={{ height: 40 }}
										>
											<button
												type="button"
												disabled={!canOpen}
												onClick={() => void openFile(attachment.id)}
												title={canOpen ? `Open ${attachment.filename}` : attachment.mimeType}
												className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default"
											>
												<AttachmentIcon filename={attachment.filename} mimeType={attachment.mimeType} />
												<span className="flex min-w-0 max-w-[220px] flex-col">
													<span className="truncate text-dense leading-tight">
														{attachment.filename}
													</span>
													<span className="tabular text-micro text-[var(--ink-muted)]">
														{formatBytes(attachment.size)}
													</span>
												</span>
											</button>
											<MenuButton
												icon="chevron-down"
												ariaLabel={`Actions for ${attachment.filename}`}
												items={items}
											/>
										</li>
									);
								})}
							</ul>
							<p className="mt-1 text-micro text-[var(--ink-faint)]">
								{canOpenHere
									? "Documents, images and media open in your default app. Anything else is shown in its folder."
									: "Trust the sender to open attachments from here."}
							</p>
						</div>
					) : null}

					{!message.bodyFetched && (clientLinked || trusted) ? (
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
						<div className="-mx-6 flex flex-1 flex-col">
							{!clientLinked && !trusted ? null : (
								<>
									{body && body.remoteImages > 0 && !remoteImages ? (
										<div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--sunken)] px-6 py-2 text-sm">
											<span className="text-[var(--ink-muted)]">
												{body.remoteImages} remote{" "}
												{body.remoteImages === 1 ? "image" : "images"} not loaded. Loading them
												tells the sender you opened this.
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
										onLoad={() => {
											if (findOpen && findQuery !== "") tellFrame("search", findQuery);
										}}
										className="block min-h-full w-full shrink-0 overflow-x-auto overflow-y-hidden bg-[var(--surface)]"
										style={frameHeight === null ? undefined : { height: frameHeight }}
									/>

									{body && body.links.length > 0 ? (
										<div className="shrink-0 border-t border-[var(--line)] px-6 py-3">
											<button
												type="button"
												aria-expanded={linksOpen}
												onClick={() => setLinksOpen((current) => !current)}
												className="text-overline uppercase text-[var(--ink-muted)] hover:text-[var(--ink)]"
											>
												Links ({body.links.length})
											</button>
											{linksOpen ? (
												<ul className="mt-2 flex max-h-[180px] flex-col gap-1 overflow-y-auto">
													{body.links.slice(0, 40).map((link) => (
														<li
															key={link.href}
															className="flex min-w-0 items-baseline gap-2 text-sm"
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
																className="min-w-0 truncate font-mono text-micro text-[var(--ink-muted)]"
															>
																{link.href}
															</span>
														</li>
													))}
												</ul>
											) : null}
										</div>
									) : null}
								</>
							)}
						</div>
					)}
				</div>
			) : null}

			{open && findOpen
				? createPortal(
						<div className="fixed top-[calc(var(--titlebar-height)+8px)] right-6 z-40">
							<FindBar
								query={findQuery}
								onQueryChange={setFindQuery}
								count={findResult.count}
								current={findResult.current}
								onNext={() => tellFrame("next")}
								onPrevious={() => tellFrame("previous")}
								onClose={closeFind}
							/>
						</div>,
						document.body,
					)
				: null}
			{open && hoveredLink?.messageId === message.id ? (
				<LinkPopover
					href={hoveredLink.href}
					x={hoveredLink.x}
					y={hoveredLink.y}
					onOpen={(href) => {
						setHoveredLink(null);
						void openLink(href);
					}}
					onCopy={(href) => void copyLink(href)}
					onEnter={() => {
						if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
						hideTimer.current = null;
					}}
					onLeave={scheduleHideLink}
				/>
			) : null}
			{menu.at ? (
				<ContextMenu
					at={menu.at}
					items={contextItems}
					onClose={menu.close}
					ariaLabel={ariaLabel}
				/>
			) : null}
			{importItems ? (
				<ImportFlow
					items={importItems}
					{...(project ? { projectId: project.id } : {})}
					onDone={(outcome) => {
						setImportItems(null);
						const text = [describeOutcome(outcome), ...outcome.failures.map((entry) => entry.message)]
							.filter(Boolean)
							.join(" ");
						if (text) onNotice(text);
					}}
				/>
			) : null}
		</article>
	);
}
