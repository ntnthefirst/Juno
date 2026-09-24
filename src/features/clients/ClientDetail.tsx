import { useCallback, useEffect, useState } from "react";
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientNote,
	ClientNoteKind,
	ClientPhone,
	ClientTimelineEntry,
	ClientTimelineKind,
	Contact,
	Project,
	ProjectSummary,
	ReferenceItem,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon, type IconName } from "../../components/Icon";
import { MarkdownNotes } from "../../components/MarkdownNotes";
import { StatusBadge } from "../../components/StatusBadge";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { useContextMenu } from "../../lib/use-context-menu";

/** A non-breaking space, so an amount never wraps between its thousands. */
const NBSP = String.fromCharCode(0xa0);
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** Integer cents to a Belgian amount. No float arithmetic anywhere on the way. */
function formatEuros(cents: number): string {
	const absolute = Math.abs(cents);
	const whole = String(Math.trunc(absolute / 100)).replace(THOUSANDS, NBSP);
	const fraction = String(absolute % 100).padStart(2, "0");
	return `${cents < 0 ? "-" : ""}${whole},${fraction}`;
}

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

/** An instant, in the reader's own time zone: dd/mm/yyyy hh:mm. */
function formatInstant(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A timeline entry's own date, respecting the `on` rule: split, never parsed. */
function dateLabelOf(entry: ClientTimelineEntry): string {
	return entry.on ? formatDate(entry.on) : formatInstant(entry.at);
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/**
 * The calendar month an entry belongs to, read from `on` when it is set so a
 * deadline never drifts into the neighbouring month the way an instant would
 * for half the year (.claude/rules/data.md section 4).
 */
function monthKeyOf(entry: ClientTimelineEntry): string {
	if (entry.on) return entry.on.slice(0, 7);
	const at = new Date(entry.at);
	return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(key: string): string {
	const [year, month] = key.split("-");
	const index = Number(month) - 1;
	return `${MONTHS[index] ?? month} ${year}`;
}

/** The glyph for one line of the timeline. A note's own kind picks the glyph
 *  among note, call and meeting; every other source has one glyph. */
function iconForEntry(entry: ClientTimelineEntry): IconName {
	if (entry.kind === "note") {
		if (entry.variant === "call") return "phone";
		if (entry.variant === "meeting") return "calendar";
		return "note";
	}
	if (entry.kind === "mail") return "mail";
	if (entry.kind === "document") return "documents";
	if (entry.kind === "event") return "calendar";
	if (entry.kind === "reminder") return "reminders";
	return "projects";
}

/** First and last initial, for the card's monogram. Never a photo. */
function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/** A website is shown as typed but only ever opened over https, per the app's
 *  navigation policy in electron/main/windows/chrome.ts. */
function websiteHref(website: string): string {
	return /^https?:\/\//i.test(website) ? website.replace(/^http:\/\//i, "https://") : `https://${website}`;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

type Detail = {
	client: Client;
	status: ReferenceItem | null;
	emails: ClientEmail[];
	phones: ClientPhone[];
	addresses: ClientAddress[];
	contacts: Contact[];
	projects: ProjectSummary[];
	entries: ClientTimelineEntry[];
	entryCounts: Record<ClientTimelineKind, number>;
	hasMoreEntries: boolean;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; detail: Detail }
	| { status: "error"; message: string };

type DetailKind = "contact" | "project" | "email" | "phone" | "address" | "note";
type Pending = { kind: DetailKind; id: string; name: string };

const REMOVE_TITLES: Record<DetailKind, string> = {
	contact: "Remove contact",
	project: "Remove project",
	email: "Remove email",
	phone: "Remove phone number",
	address: "Remove address",
	note: "Remove note",
};

/** A bounded first page. `loadMoreEntries` asks for the next one on request. */
const TIMELINE_PAGE = 50;

type TabId = "overview" | "timeline" | "projects" | "documents" | "mail";

type ClientDetailProps = {
	clientId: string;
	onEdit: (client: Client) => void;
	onDelete: (client: Client) => void;
	/**
	 * Contacts and projects are filled in on a page of their own, which needs
	 * the whole screen rather than this pane, so the screen owns that state and
	 * this only asks for it. Null means a new one.
	 */
	onEditContact: (contact: Contact | null) => void;
	onEditProject: (project: Project | null) => void;
	/**
	 * An email, a phone number, an address or a note is a row of something
	 * still being browsed, so it opens in a side panel rather than taking the
	 * screen. Null means a new one.
	 */
	onEditEmail: (email: ClientEmail | null) => void;
	onEditPhone: (phone: ClientPhone | null) => void;
	onEditAddress: (address: ClientAddress | null) => void;
	/** `initialKind` only matters when `note` is null, for "Log a call". */
	onEditNote: (note: ClientNote | null, initialKind?: ClientNoteKind) => void;
};

export function ClientDetail({
	clientId,
	onEdit,
	onDelete,
	onEditContact,
	onEditProject,
	onEditEmail,
	onEditPhone,
	onEditAddress,
	onEditNote,
}: ClientDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [pending, setPending] = useState<Pending | null>(null);
	const [busy, setBusy] = useState(false);
	const [tab, setTab] = useState<TabId>("overview");
	const [loadingMore, setLoadingMore] = useState(false);

	const fetchDetail = useCallback(async (): Promise<Detail | null> => {
		const [client, emails, phones, addresses, contacts, projects, statusSet, entries, entryCounts] =
			await Promise.all([
				window.juno.clients.get(clientId),
				window.juno.clientEmails.listForClient(clientId),
				window.juno.clientPhones.listForClient(clientId),
				window.juno.clientAddresses.listForClient(clientId),
				window.juno.contacts.listForClient(clientId),
				window.juno.projects.list({ clientId }),
				window.juno.reference.getSet("client_status"),
				window.juno.clients.timeline({ clientId, limit: TIMELINE_PAGE }),
				window.juno.clients.timelineCounts(clientId),
			]);
		if (!client) return null;
		const status = client.statusId
			? (statusSet?.items.find((item) => item.id === client.statusId) ?? null)
			: null;
		return {
			client,
			status,
			emails,
			phones,
			addresses,
			contacts,
			projects,
			entries,
			entryCounts,
			hasMoreEntries: entries.length === TIMELINE_PAGE,
		};
	}, [clientId]);

	useEffect(() => {
		let cancelled = false;
		fetchDetail()
			.then((detail) => {
				if (cancelled) return;
				setLoad(
					detail
						? { status: "ready", detail }
						: { status: "error", message: "This client is no longer in your juno." },
				);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchDetail]);

	// Refreshing after a mutation replaces the value in place, so the pane does not
	// drop back to the loading state on every edit.
	const refresh = useCallback(() => {
		fetchDetail()
			.then((detail) => {
				if (detail) setLoad({ status: "ready", detail });
			})
			.catch((cause: unknown) => {
				setLoad({ status: "error", message: messageOf(cause) });
			});
	}, [fetchDetail]);

	async function confirmRemove() {
		if (!pending || busy) return;
		setBusy(true);
		try {
			if (pending.kind === "contact") await window.juno.contacts.remove(pending.id);
			else if (pending.kind === "project") await window.juno.projects.remove(pending.id);
			else if (pending.kind === "email") await window.juno.clientEmails.remove(pending.id);
			else if (pending.kind === "phone") await window.juno.clientPhones.remove(pending.id);
			else if (pending.kind === "address") await window.juno.clientAddresses.remove(pending.id);
			else await window.juno.clientNotes.remove(pending.id);
			setPending(null);
			refresh();
		} catch (cause: unknown) {
			setPending(null);
			setLoad({ status: "error", message: messageOf(cause) });
		} finally {
			setBusy(false);
		}
	}

	async function makeContactPrimary(id: string) {
		try {
			await window.juno.contacts.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makeEmailPrimary(id: string) {
		try {
			await window.juno.clientEmails.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makePhonePrimary(id: string) {
		try {
			await window.juno.clientPhones.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makeAddressPrimary(id: string) {
		try {
			await window.juno.clientAddresses.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function editProject(id: string) {
		try {
			const project = await window.juno.projects.get(id);
			if (project) onEditProject(project);
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function editNoteEntry(entry: ClientTimelineEntry) {
		try {
			const note = await window.juno.clientNotes.get(entry.entityId);
			if (note) onEditNote(note);
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function loadMoreEntries() {
		if (load.status !== "ready" || loadingMore) return;
		const oldest = load.detail.entries[load.detail.entries.length - 1];
		if (!oldest) return;
		setLoadingMore(true);
		try {
			const more = await window.juno.clients.timeline({
				clientId,
				limit: TIMELINE_PAGE,
				before: oldest.at,
			});
			setLoad((current) =>
				current.status === "ready"
					? {
							status: "ready",
							detail: {
								...current.detail,
								entries: [...current.detail.entries, ...more],
								hasMoreEntries: more.length === TIMELINE_PAGE,
							},
						}
					: current,
			);
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		} finally {
			setLoadingMore(false);
		}
	}

	if (load.status === "loading") return <p className="text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load this client.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const {
		client,
		status,
		emails,
		phones,
		addresses,
		contacts,
		projects,
		entries,
		entryCounts,
		hasMoreEntries,
	} = load.detail;

	const primaryEmail = emails.find((email) => email.isPrimary) ?? emails[0] ?? null;
	const primaryPhone = phones.find((phone) => phone.isPrimary) ?? phones[0] ?? null;
	const primaryAddress = addresses.find((address) => address.isPrimary) ?? null;

	const totalEntries = Object.values(entryCounts).reduce((sum, count) => sum + count, 0);
	const documentEntries = entries.filter((entry) => entry.kind === "document");
	const mailEntries = entries.filter((entry) => entry.kind === "mail");

	const tabs: { id: TabId; label: string; count: number | null }[] = [
		{ id: "overview", label: "Overview", count: null },
		{ id: "timeline", label: "Timeline", count: totalEntries },
		{ id: "projects", label: "Projects", count: entryCounts.project },
		{ id: "documents", label: "Documents", count: entryCounts.document },
		{ id: "mail", label: "Mail", count: entryCounts.mail },
	];

	const cardMenuItems: MenuItem[] = [
		{ id: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit(client) },
		{
			id: "delete",
			label: "Delete",
			icon: "remove",
			danger: true,
			separatorBefore: true,
			onSelect: () => onDelete(client),
		},
	];

	return (
		<div>
			<div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4">
				<div className="flex items-start gap-3">
					<span
						aria-hidden
						className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent-soft)] text-[length:var(--text-base)] font-[var(--weight-semibold)] text-[var(--accent)]"
					>
						{initialsOf(client.name)}
					</span>

					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<h2
									data-selectable
									className="truncate text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]"
								>
									{client.name}
								</h2>
								{status ? (
									<div className="mt-1.5">
										<StatusBadge label={status.label} tone={status.tone} />
									</div>
								) : null}
							</div>
							<MenuButton ariaLabel={`${client.name} actions`} items={cardMenuItems} />
						</div>

						<div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[length:var(--text-dense)] sm:grid-cols-2">
							{primaryEmail ? (
								<div className="flex min-w-0 items-center gap-2">
									<Icon name="mail" className="shrink-0 text-[var(--ink-muted)]" />
									<a
										data-selectable
										href={`mailto:${primaryEmail.email}`}
										target="_blank"
										rel="noopener noreferrer"
										className="min-w-0 truncate text-[var(--accent)] hover:text-[var(--accent-hover)]"
									>
										{primaryEmail.email}
									</a>
								</div>
							) : null}
							{primaryPhone ? (
								<div className="flex min-w-0 items-center gap-2">
									<Icon name="phone" className="shrink-0 text-[var(--ink-muted)]" />
									<span data-selectable className="tabular min-w-0 truncate">
										{primaryPhone.phone}
									</span>
								</div>
							) : null}
							{primaryAddress?.city ? (
								<div className="flex min-w-0 items-center gap-2">
									<Icon name="address" className="shrink-0 text-[var(--ink-muted)]" />
									<span data-selectable className="min-w-0 truncate">
										{primaryAddress.city}
									</span>
								</div>
							) : null}
							{client.website ? (
								<div className="flex min-w-0 items-center gap-2">
									<Icon name="external" className="shrink-0 text-[var(--ink-muted)]" />
									<a
										data-selectable
										href={websiteHref(client.website)}
										target="_blank"
										rel="noopener noreferrer"
										className="min-w-0 truncate text-[var(--accent)] hover:text-[var(--accent-hover)]"
									>
										{client.website}
									</a>
								</div>
							) : null}
							{client.vatNumber ? (
								<div className="flex min-w-0 items-center gap-2">
									<span className="shrink-0 text-[var(--ink-faint)]">VAT</span>
									<span data-selectable className="tabular min-w-0 truncate">
										{client.vatNumber}
									</span>
								</div>
							) : null}
						</div>
					</div>
				</div>
			</div>

			<div role="tablist" aria-label="Client" className="mt-8 flex items-center gap-px border-b border-[var(--line)]">
				{tabs.map((entry) => (
					<button
						key={entry.id}
						type="button"
						role="tab"
						aria-selected={tab === entry.id}
						onClick={() => setTab(entry.id)}
						className={`-mb-px flex h-[36px] items-center gap-2 border-b-2 px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
							tab === entry.id
								? "border-[var(--accent)] text-[var(--accent)]"
								: "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
						}`}
					>
						{entry.label}
						{entry.count !== null ? (
							<span className="tabular rounded-[var(--radius-full)] bg-[var(--sunken)] px-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
								{entry.count}
							</span>
						) : null}
					</button>
				))}
			</div>

			<div className="mt-6">
				{tab === "overview" ? (
					<div className="flex flex-col gap-10">
						{client.notes && client.notes.trim().length > 0 ? (
							<div className="text-[length:var(--text-dense)]">
								<MarkdownNotes text={client.notes} />
							</div>
						) : null}

						<EmailsSection
							emails={emails}
							onAdd={() => onEditEmail(null)}
							onEdit={onEditEmail}
							onMakePrimary={(id) => void makeEmailPrimary(id)}
							onRemove={(email) => setPending({ kind: "email", id: email.id, name: email.email })}
						/>

						<PhonesSection
							phones={phones}
							onAdd={() => onEditPhone(null)}
							onEdit={onEditPhone}
							onMakePrimary={(id) => void makePhonePrimary(id)}
							onRemove={(phone) => setPending({ kind: "phone", id: phone.id, name: phone.phone })}
						/>

						<AddressesSection
							addresses={addresses}
							onAdd={() => onEditAddress(null)}
							onEdit={onEditAddress}
							onMakePrimary={(id) => void makeAddressPrimary(id)}
							onRemove={(address, line) => setPending({ kind: "address", id: address.id, name: address.label ?? line })}
						/>

						<ContactsSection
							contacts={contacts}
							onAdd={() => onEditContact(null)}
							onEdit={onEditContact}
							onMakePrimary={(id) => void makeContactPrimary(id)}
							onRemove={(contact) => setPending({ kind: "contact", id: contact.id, name: contact.name })}
						/>
					</div>
				) : tab === "timeline" ? (
					<TimelineTab
						entries={entries}
						hasMore={hasMoreEntries}
						loadingMore={loadingMore}
						onLoadMore={() => void loadMoreEntries()}
						onLogCall={() => onEditNote(null, "call")}
						onAddNote={() => onEditNote(null)}
						onEditNote={(entry) => void editNoteEntry(entry)}
						onRemoveNote={(entry) => setPending({ kind: "note", id: entry.entityId, name: entry.title })}
					/>
				) : tab === "projects" ? (
					<ProjectsSection
						projects={projects}
						onAdd={() => onEditProject(null)}
						onEdit={(id) => void editProject(id)}
						onRemove={(project) => setPending({ kind: "project", id: project.id, name: project.name })}
					/>
				) : tab === "documents" ? (
					<EntryList title="Documents" entries={documentEntries} emptyText="No documents for this client yet." />
				) : (
					<EntryList title="Mail" entries={mailEntries} emptyText="No mail linked to this client yet." />
				)}
			</div>

			{pending ? (
				<Dialog
					title={REMOVE_TITLES[pending.kind]}
					width="narrow"
					onClose={() => setPending(null)}
				>
					<p className="mt-3 text-[var(--ink-muted)]">
						{pending.name} is removed from {client.name}.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setPending(null)}>Cancel</Button>
						<Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>
							{busy ? "Removing" : "Remove"}
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}

type EmailsSectionProps = {
	emails: ClientEmail[];
	onAdd: () => void;
	onEdit: (email: ClientEmail) => void;
	onMakePrimary: (id: string) => void;
	onRemove: (email: ClientEmail) => void;
};

function EmailsSection({ emails, onAdd, onEdit, onMakePrimary, onRemove }: EmailsSectionProps) {
	return (
		<section>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Emails</h3>
				<Button size="dense" onClick={onAdd}>
					Add email
				</Button>
			</div>

			{emails.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No email addresses for this client yet.
				</p>
			) : (
				<ul>
					{emails.map((email) => (
						<li
							key={email.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span data-selectable className="truncate">
										{email.email}
									</span>
									{email.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
								</div>
								{email.label ? (
									<div className="mt-0.5 truncate text-[var(--ink-muted)]">{email.label}</div>
								) : null}
							</div>
							<span className="flex shrink-0 gap-1">
								{email.isPrimary ? null : (
									<Button size="dense" onClick={() => onMakePrimary(email.id)}>
										Make primary
									</Button>
								)}
								<Button size="dense" onClick={() => onEdit(email)}>
									Edit
								</Button>
								<Button size="dense" variant="danger" onClick={() => onRemove(email)}>
									Remove
								</Button>
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type PhonesSectionProps = {
	phones: ClientPhone[];
	onAdd: () => void;
	onEdit: (phone: ClientPhone) => void;
	onMakePrimary: (id: string) => void;
	onRemove: (phone: ClientPhone) => void;
};

function PhonesSection({ phones, onAdd, onEdit, onMakePrimary, onRemove }: PhonesSectionProps) {
	return (
		<section>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Phone numbers</h3>
				<Button size="dense" onClick={onAdd}>
					Add phone number
				</Button>
			</div>

			{phones.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No phone numbers for this client yet.
				</p>
			) : (
				<ul>
					{phones.map((phone) => (
						<li
							key={phone.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span data-selectable className="tabular truncate">
										{phone.phone}
									</span>
									{phone.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
								</div>
								{phone.label ? (
									<div className="mt-0.5 truncate text-[var(--ink-muted)]">{phone.label}</div>
								) : null}
							</div>
							<span className="flex shrink-0 gap-1">
								{phone.isPrimary ? null : (
									<Button size="dense" onClick={() => onMakePrimary(phone.id)}>
										Make primary
									</Button>
								)}
								<Button size="dense" onClick={() => onEdit(phone)}>
									Edit
								</Button>
								<Button size="dense" variant="danger" onClick={() => onRemove(phone)}>
									Remove
								</Button>
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type AddressesSectionProps = {
	addresses: ClientAddress[];
	onAdd: () => void;
	onEdit: (address: ClientAddress) => void;
	onMakePrimary: (id: string) => void;
	onRemove: (address: ClientAddress, line: string) => void;
};

function AddressesSection({ addresses, onAdd, onEdit, onMakePrimary, onRemove }: AddressesSectionProps) {
	return (
		<section>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Addresses</h3>
				<Button size="dense" onClick={onAdd}>
					Add address
				</Button>
			</div>

			{addresses.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No addresses for this client yet.
				</p>
			) : (
				<ul>
					{addresses.map((address) => {
						const line = [address.addressLine1, address.postalCode, address.city]
							.filter(Boolean)
							.join(", ");
						return (
							<li
								key={address.id}
								className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span data-selectable className="truncate font-[var(--weight-medium)]">
											{address.label ?? line}
										</span>
										{address.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
									</div>
									{address.label ? (
										<div data-selectable className="mt-0.5 truncate text-[var(--ink-muted)]">
											{line}
										</div>
									) : null}
								</div>
								<span className="flex shrink-0 gap-1">
									{address.isPrimary ? null : (
										<Button size="dense" onClick={() => onMakePrimary(address.id)}>
											Make primary
										</Button>
									)}
									<Button size="dense" onClick={() => onEdit(address)}>
										Edit
									</Button>
									<Button size="dense" variant="danger" onClick={() => onRemove(address, line)}>
										Remove
									</Button>
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

type ContactsSectionProps = {
	contacts: Contact[];
	onAdd: () => void;
	onEdit: (contact: Contact) => void;
	onMakePrimary: (id: string) => void;
	onRemove: (contact: Contact) => void;
};

function ContactsSection({ contacts, onAdd, onEdit, onMakePrimary, onRemove }: ContactsSectionProps) {
	return (
		<section>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Contacts</h3>
				<Button size="dense" onClick={onAdd}>
					Add contact
				</Button>
			</div>

			{contacts.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No contacts for this client yet.
				</p>
			) : (
				<ul>
					{contacts.map((contact) => (
						<li
							key={contact.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
						>
							{/* Two lines rather than columns. Fixed-width columns reserved space
							    for fields most contacts do not have, which squeezed the name to
							    a few characters even in a wide pane. */}
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span data-selectable className="truncate font-[var(--weight-medium)]">
										{contact.name}
									</span>
									{contact.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
								</div>
								{[contact.role, contact.email, contact.phone].some(Boolean) ? (
									<div data-selectable className="mt-0.5 truncate text-[var(--ink-muted)]">
										{[contact.role, contact.email, contact.phone].filter(Boolean).join("  ·  ")}
									</div>
								) : null}
							</div>
							<span className="flex shrink-0 gap-1">
								{contact.isPrimary ? null : (
									<Button size="dense" onClick={() => onMakePrimary(contact.id)}>
										Make primary
									</Button>
								)}
								<Button size="dense" onClick={() => onEdit(contact)}>
									Edit
								</Button>
								<Button size="dense" variant="danger" onClick={() => onRemove(contact)}>
									Remove
								</Button>
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type ProjectsSectionProps = {
	projects: ProjectSummary[];
	onAdd: () => void;
	onEdit: (id: string) => void;
	onRemove: (project: ProjectSummary) => void;
};

function ProjectsSection({ projects, onAdd, onEdit, onRemove }: ProjectsSectionProps) {
	return (
		<section>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Projects</h3>
				<Button size="dense" onClick={onAdd}>
					Add project
				</Button>
			</div>

			{projects.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No projects for this client yet.
				</p>
			) : (
				<ul>
					{projects.map((project) => (
						<li
							key={project.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span data-selectable className="truncate font-[var(--weight-medium)]">
										{project.name}
									</span>
									{project.status ? (
										<StatusBadge label={project.status.label} tone={project.status.tone} />
									) : null}
								</div>
								<div className="tabular mt-0.5 text-[var(--ink-muted)]">
									{[
										project.dueOn ? `Due ${formatDate(project.dueOn)}` : null,
										project.agreedValueCents === null
											? null
											: `€ ${formatEuros(project.agreedValueCents)}`,
									]
										.filter(Boolean)
										.join("  ·  ")}
								</div>
							</div>
							<span className="flex shrink-0 gap-1">
								<Button size="dense" onClick={() => onEdit(project.id)}>
									Edit
								</Button>
								<Button size="dense" variant="danger" onClick={() => onRemove(project)}>
									Remove
								</Button>
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type TimelineTabProps = {
	entries: ClientTimelineEntry[];
	hasMore: boolean;
	loadingMore: boolean;
	onLoadMore: () => void;
	onLogCall: () => void;
	onAddNote: () => void;
	onEditNote: (entry: ClientTimelineEntry) => void;
	onRemoveNote: (entry: ClientTimelineEntry) => void;
};

/**
 * Everything Juno knows about this client, newest first, grouped by month.
 * Only a note's own row can be edited or removed here: everything else is
 * read back out of the table that already owns it, and that table's screen is
 * where it is changed.
 */
function TimelineTab({
	entries,
	hasMore,
	loadingMore,
	onLoadMore,
	onLogCall,
	onAddNote,
	onEditNote,
	onRemoveNote,
}: TimelineTabProps) {
	const { at, open, close } = useContextMenu();
	const [menuEntry, setMenuEntry] = useState<ClientTimelineEntry | null>(null);

	function itemsFor(entry: ClientTimelineEntry): MenuItem[] {
		return [
			{ id: "edit", label: "Edit", icon: "edit", onSelect: () => onEditNote(entry) },
			{
				id: "remove",
				label: "Remove",
				icon: "remove",
				danger: true,
				separatorBefore: true,
				onSelect: () => onRemoveNote(entry),
			},
		];
	}

	return (
		<div>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Timeline</h3>
				<span className="flex gap-2">
					<Button size="dense" onClick={onLogCall}>
						Log a call
					</Button>
					<Button size="dense" variant="primary" onClick={onAddNote}>
						Add note
					</Button>
				</span>
			</div>

			{entries.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					Nothing recorded for this client yet.
				</p>
			) : (
				<ul>
					{entries.map((entry, index) => {
						const month = monthKeyOf(entry);
						const previous = index > 0 ? entries[index - 1] : null;
						const showHeading = !previous || monthKeyOf(previous) !== month;
						return (
							<li key={entry.id}>
								{showHeading ? (
									<div className="sticky top-0 z-10 -mx-1 bg-[var(--paper)] px-1 py-1.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]">
										{monthLabelOf(month)}
									</div>
								) : null}
								<div
									className="flex items-start gap-3 border-b border-[var(--line)] py-3"
									onContextMenu={
										entry.kind === "note"
											? (event) => {
													setMenuEntry(entry);
													open(event);
												}
											: undefined
									}
								>
									<span
										aria-hidden
										className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--sunken)] text-[var(--ink-muted)]"
									>
										<Icon name={iconForEntry(entry)} size={14} />
									</span>
									<div className="min-w-0 flex-1">
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<span
													data-selectable
													className="block truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]"
												>
													{entry.title}
												</span>
												{entry.detail ? (
													<span
														data-selectable
														className="mt-0.5 block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]"
													>
														{entry.detail}
													</span>
												) : null}
											</div>
											<div className="flex flex-none items-center gap-1">
												<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-faint)]">
													{dateLabelOf(entry)}
												</span>
												{entry.kind === "note" ? (
													<MenuButton ariaLabel={`${entry.title} actions`} items={itemsFor(entry)} />
												) : null}
											</div>
										</div>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			{hasMore ? (
				<div className="mt-4">
					<Button size="dense" disabled={loadingMore} onClick={onLoadMore}>
						{loadingMore ? "Loading" : "Load older"}
					</Button>
				</div>
			) : null}

			{at && menuEntry ? (
				<ContextMenu at={at} items={itemsFor(menuEntry)} ariaLabel={`${menuEntry.title} actions`} onClose={close} />
			) : null}
		</div>
	);
}

type EntryListProps = {
	title: string;
	entries: ClientTimelineEntry[];
	emptyText: string;
};

/** A read-only view of one kind of timeline entry. Documents and mail are
 *  changed on their own screens; this is where they show up for this client. */
function EntryList({ title, entries, emptyText }: EntryListProps) {
	return (
		<section>
			<h3 className="mb-4 text-[length:var(--text-h3)] font-[var(--weight-medium)]">{title}</h3>
			{entries.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">{emptyText}</p>
			) : (
				<ul>
					{entries.map((entry) => (
						<li
							key={entry.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
						>
							<div className="flex min-w-0 items-start gap-3">
								<span
									aria-hidden
									className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--sunken)] text-[var(--ink-muted)]"
								>
									<Icon name={iconForEntry(entry)} size={14} />
								</span>
								<div className="min-w-0">
									<span data-selectable className="block truncate font-[var(--weight-medium)]">
										{entry.title}
									</span>
									{entry.detail ? (
										<span data-selectable className="mt-0.5 block truncate text-[var(--ink-muted)]">
											{entry.detail}
										</span>
									) : null}
								</div>
							</div>
							<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-faint)]">
								{dateLabelOf(entry)}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
