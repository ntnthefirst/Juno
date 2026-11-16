import { useEffect, useRef, useState } from "react";
import type { Client, ClientSummary, MailAddress, MailMessageClient } from "@shared/types";
import { Icon } from "../../components/Icon";
import { RecordLink } from "../../components/RecordLink";
import { Segmented } from "../../components/Segmented";
import { messageOf } from "../../lib/errors";
import { requestOpenClient } from "../../lib/open-client";
import { requestOpen } from "../../lib/open-entity";
import { ConnectClientDialog } from "./ConnectClientDialog";
import { displayName } from "./format";
import { CardSkeleton } from "../../components/CardSkeleton";

type PersonChipProps = {
	person: MailAddress;
	/** Shown instead of the name, for the short "To" line. */
	label?: string;
	/** Lower-case addresses that are the owner's or an account's. Those are not clickable. */
	mine: ReadonlySet<string>;
	/** Present only for the sender: the trust switch and what it is currently set to. */
	trust?: {
		trusted: boolean;
		/** A linked client already makes the sender trusted, and that is not undone here. */
		viaClient: boolean;
		onChange: (trusted: boolean) => void;
	};
	onNotice: (message: string) => void;
	/** The address was just added to a client. */
	onConnected: (client: ClientSummary) => void;
};

/** A website as a client typed it, opened over https only (electron/main/windows/chrome.ts). */
function websiteHref(website: string): string {
	return /^https?:\/\//i.test(website) ? website.replace(/^http:\/\//i, "https://") : `https://${website}`;
}

type Lookup =
	| { status: "loading" }
	| { status: "ready"; match: MailMessageClient | null; client: Client | null }
	| { status: "error"; message: string };

/**
 * A name in the header that opens a small card: which client the address
 * belongs to, with a way to connect one, and for the sender the trust switch.
 * The owner's own addresses render as plain text, since there is nothing to
 * decide about them.
 */
export function PersonChip({ person, label, mine, trust, onNotice, onConnected }: PersonChipProps) {
	const address = person.address.toLowerCase();
	const text = label ?? displayName(person);
	const [open, setOpen] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [lookup, setLookup] = useState<Lookup>({ status: "loading" });
	const [version, setVersion] = useState(0);
	const root = useRef<HTMLSpanElement>(null);
	const isMine = mine.has(address);

	useEffect(() => {
		if (!open || isMine) return;
		let cancelled = false;
		window.juno.mail.recipients
			.clientsFor([person.address])
			.then(async (matches) => {
				const match = matches[0] ?? null;
				const client = match ? await window.juno.clients.get(match.clientId) : null;
				if (!cancelled) setLookup({ status: "ready", match, client });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLookup({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [open, isMine, person.address, version]);

	useEffect(() => {
		if (!open) return;
		function onPointerDown(event: PointerEvent) {
			if (connecting) return;
			if (event.target instanceof Node && root.current?.contains(event.target)) return;
			setOpen(false);
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && !connecting) setOpen(false);
		}
		function onBlur() {
			if (!connecting) setOpen(false);
		}
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		// A click inside the message frame never reaches this document, but it does
		// take focus away from the window.
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, connecting]);

	if (isMine) return <span className="text-[var(--ink)]">{text}</span>;

	function openClient(match: MailMessageClient | null) {
		if (match) requestOpenClient(match.clientId, match.clientName);
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(person.address);
			onNotice("Address copied.");
		} catch {
			onNotice("Could not copy the address.");
		}
	}

	return (
		<span ref={root} className="relative inline-block">
			<button
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => {
					setLookup({ status: "loading" });
					setOpen((current) => !current);
				}}
				className={`rounded-[var(--radius-sm)] px-1 text-[var(--ink)] hover:bg-[var(--sunken)] ${open ? "bg-[var(--sunken)]" : ""}`}
			>
				{text}
			</button>

			{open ? (
				<div
					role="dialog"
					aria-label={`About ${displayName(person)}`}
					className="absolute left-0 top-full z-20 mt-1 w-[380px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 text-dense text-[var(--ink)] shadow-[var(--shadow-popover)]"
				>
					<div className="flex items-start gap-2">
						<div className="min-w-0 flex-1">
							<p className="truncate font-[var(--weight-medium)]">{displayName(person)}</p>
							{person.name?.trim() ? (
								<p data-selectable className="truncate text-sm text-[var(--ink-muted)]">
									{person.address}
								</p>
							) : null}
						</div>
						<button
							type="button"
							aria-label={`Write to ${person.address}`}
							title="New message"
							onClick={() => {
								setOpen(false);
								requestOpen({
									kind: "compose",
									to: [person],
									clientId: lookup.status === "ready" ? (lookup.match?.clientId ?? null) : null,
								});
							}}
							className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						>
							<Icon name="mail" size={14} />
						</button>
						<button
							type="button"
							aria-label="Copy address"
							title="Copy address"
							onClick={() => void copy()}
							className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						>
							<Icon name="copy" size={14} />
						</button>
					</div>

					<div className="mt-2 border-t border-[var(--line)] pt-2">
						{lookup.status === "loading" ? (
							<CardSkeleton lines={2} framed={false} />
						) : lookup.status === "error" ? (
							<p role="alert" className="text-[var(--risk)]">
								{lookup.message}
							</p>
						) : lookup.match ? (
							<div className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<p className="text-overline uppercase text-[var(--ink-muted)]">
										Client
									</p>
									<p className="truncate font-[var(--weight-medium)]">
										<RecordLink onOpen={() => openClient(lookup.match)}>{lookup.match.clientName}</RecordLink>
									</p>
									{lookup.client?.vatNumber ? (
										<p className="tabular truncate text-sm text-[var(--ink-muted)]">
											{lookup.client.vatNumber}
										</p>
									) : null}
									{lookup.client?.website ? (
										<p className="truncate text-sm text-[var(--ink-muted)]">
											{/* Opened over https only, by the window's own external-link rule. */}
											<a
												href={websiteHref(lookup.client.website)}
												target="_blank"
												rel="noopener noreferrer"
												className="rounded-[var(--radius-sm)] hover:text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
											>
												{lookup.client.website}
											</a>
										</p>
									) : null}
								</div>
								<button
									type="button"
									aria-label={`Open ${lookup.match.clientName}`}
									title="Open client"
									onClick={() => openClient(lookup.match)}
									className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
								>
									<Icon name="external" size={14} />
								</button>
							</div>
						) : (
							<div className="flex items-center gap-2">
								<p className="min-w-0 flex-1 text-[var(--ink-muted)]">Not connected to a client.</p>
								<button
									type="button"
									aria-label="Connect to a client"
									title="Connect to a client"
									onClick={() => setConnecting(true)}
									className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
								>
									<Icon name="link" size={14} />
								</button>
							</div>
						)}
					</div>

					{trust ? (
						<div className="mt-2 border-t border-[var(--line)] pt-2">
							<div className="flex items-center gap-2">
								<span className="min-w-0 flex-1">
									<span className="block text-overline uppercase text-[var(--ink-muted)]">
										Sender
									</span>
									<span className="block font-[var(--weight-medium)]">{trust.trusted ? "Trusted" : "Not trusted"}</span>
								</span>
								<Segmented
									size="compact"
									label="Trust"
									value={trust.trusted ? "yes" : "no"}
									onChange={(id) => {
										if ((id === "yes") !== trust.trusted) trust.onChange(id === "yes");
									}}
									options={[
										{ id: "yes", label: "Trusted" },
										{ id: "no", label: "Not trusted", disabled: trust.viaClient },
									]}
								/>
							</div>
							{trust.viaClient ? (
								<p className="mt-1 text-sm text-[var(--ink-muted)]">
									Trusted because a client is linked.
								</p>
							) : null}
						</div>
					) : null}
				</div>
			) : null}

			{connecting ? (
				<ConnectClientDialog
					address={person.address}
					onClose={() => setConnecting(false)}
					onConnected={(client) => {
						setConnecting(false);
						setLookup({ status: "loading" });
						setVersion((current) => current + 1);
						onConnected(client);
					}}
				/>
			) : null}
		</span>
	);
}
