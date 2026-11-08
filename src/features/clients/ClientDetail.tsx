import { IconButton } from "../../components/IconButton";
import { Tabs, type TabItem } from "../../components/Tabs";
import { ScheduleSection } from "../calendar/ScheduleSection";
import type { ScheduleForm } from "../calendar/schedule-form";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientLink,
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
import { TitleBarAction } from "../../app/TitleBarAction";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { ActionMenu } from "../../components/ActionMenu";
import { Avatar } from "../../components/Avatar";
import { ClientDetails, type DetailRemoval } from "./ClientDetails";
import { ClientMail } from "./ClientMail";
import { isOpenProjectStatus } from "@shared/project-status";
import { AddButton } from "../../components/AddButton";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon, type IconName } from "../../components/Icon";
import { InlineNotes } from "../../components/InlineNotes";
import { StatusBadge } from "../../components/StatusBadge";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { openNewRecord } from "../../lib/new-record";
import { requestOpen } from "../../lib/open-entity";
import { statusTextClass } from "../../lib/status-tone";
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

type StatusNameProps = {
	name: { label: string; tone: string | null } | null;
};

/** A status name in a "Status changed from X to Y" line: its own colour, no
 *  tag, no box, no background. "No status" reads in the muted ink. */
function StatusName({ name }: StatusNameProps) {
	return <span className={statusTextClass(name?.tone ?? null)}>{name?.label ?? "No status"}</span>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

type Detail = {
	client: Client;
	status: ReferenceItem | null;
	/** Every status still offered in the picker, in the owner's own order. */
	statusOptions: ReferenceItem[];
	emails: ClientEmail[];
	phones: ClientPhone[];
	addresses: ClientAddress[];
	links: ClientLink[];
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

type DetailKind = "contact" | "project" | "note" | DetailRemoval["kind"];
type Pending = { kind: DetailKind; id: string; name: string };

const REMOVE_TITLES: Record<DetailKind, string> = {
	contact: "Remove contact",
	project: "Remove project",
	email: "Remove email",
	phone: "Remove phone number",
	address: "Remove address",
	link: "Remove link",
	website: "Remove website",
	note: "Remove note",
};

/** A bounded first page. `loadMoreEntries` asks for the next one on request. */
const TIMELINE_PAGE = 50;

export type TabId = "overview" | "timeline" | "projects" | "documents" | "mail";

type ClientDetailProps = {
	clientId: string;
	onEdit: (client: Client) => void;
	onDelete: (client: Client) => void;
	/** Opens the composer addressed to this client. */
	onSendMail: (client: Client) => void;
	/** The main process changed the client (archived it), so what is on screen is stale. */
	onChanged: (message: string | undefined) => void;
	/**
	 * Contacts and projects are filled in on a page of their own, which needs
	 * the whole screen rather than this pane, so the screen owns that state and
	 * this only asks for it. Null means a new one.
	 */
	onEditContact: (contact: Contact | null) => void;
	onEditProject: (project: Project) => void;
	/** A date or a reminder is a page of its own, so the screen owns it. */
	onSchedule: (form: ScheduleForm) => void;
	/**
	 * An email, a phone number, an address or a note is a row of something
	 * still being browsed, so it opens in a side panel rather than taking the
	 * screen. Null means a new one.
	 */
	onEditEmail: (email: ClientEmail | null) => void;
	onEditPhone: (phone: ClientPhone | null) => void;
	onEditAddress: (address: ClientAddress | null) => void;
	onEditLink: (link: ClientLink | null) => void;
	/** `initialKind` only matters when `note` is null, for "Log a call". */
	onEditNote: (note: ClientNote | null, initialKind?: ClientNoteKind) => void;
	/** A document from a template is a page of its own, so the screen owns it. */
	onGenerateDocument: () => void;
	onOpenDocument: (id: string, title: string) => void;
	/** The tab to open on, for coming back from a page that started from one. */
	initialTab?: TabId;
	/** Reported so the screen can hand the same tab back after a remount. */
	onTabChange?: (tab: TabId) => void;
};

export function ClientDetail({
	clientId,
	onEdit,
	onDelete,
	onSendMail,
	onChanged,
	onEditContact,
	onEditProject,
	onSchedule,
	onEditEmail,
	onEditPhone,
	onEditAddress,
	onEditLink,
	onEditNote,
	onGenerateDocument,
	onOpenDocument,
	initialTab = "overview",
	onTabChange,
}: ClientDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [pending, setPending] = useState<Pending | null>(null);
	const [busy, setBusy] = useState(false);
	const [tab, setTab] = useState<TabId>(initialTab);
	const [loadingMore, setLoadingMore] = useState(false);

	const fetchDetail = useCallback(async (): Promise<Detail | null> => {
		const [client, emails, phones, addresses, links, contacts, projects, statusSet, entries, entryCounts] =
			await Promise.all([
				window.juno.clients.get(clientId),
				window.juno.clientEmails.listForClient(clientId),
				window.juno.clientPhones.listForClient(clientId),
				window.juno.clientAddresses.listForClient(clientId),
				window.juno.clientLinks.listForClient(clientId),
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
			statusOptions: statusSet?.items.filter((item) => item.hiddenAt === null) ?? [],
			emails,
			phones,
			addresses,
			links,
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
	const refresh = useCallback(
		(): Promise<void> =>
			fetchDetail()
				.then((detail) => {
					if (detail) setLoad({ status: "ready", detail });
				})
				.catch((cause: unknown) => {
					setLoad({ status: "error", message: messageOf(cause) });
				}),
		[fetchDetail],
	);

	// The notes are written as they are typed, so the copy held here is brought
	// up to date without reading the record again: a reload would put the stored
	// text back under the cursor, and the tab coming back must show what was typed.
	const saveNotes = useCallback(
		async (notes: string | null) => {
			await window.juno.clients.update(clientId, { notes });
			setLoad((current) =>
				current.status === "ready"
					? { status: "ready", detail: { ...current.detail, client: { ...current.detail.client, notes } } }
					: current,
			);
		},
		[clientId],
	);

	async function confirmRemove() {
		if (!pending || busy) return;
		setBusy(true);
		try {
			if (pending.kind === "contact") await window.juno.contacts.remove(pending.id);
			else if (pending.kind === "project") await window.juno.projects.remove(pending.id);
			else if (pending.kind === "email") await window.juno.clientEmails.remove(pending.id);
			else if (pending.kind === "phone") await window.juno.clientPhones.remove(pending.id);
			else if (pending.kind === "address") await window.juno.clientAddresses.remove(pending.id);
			else if (pending.kind === "link") await window.juno.clientLinks.remove(pending.id);
			else if (pending.kind === "website") await window.juno.clients.update(clientId, { website: null });
			else await window.juno.clientNotes.remove(pending.id);
			setPending(null);
			void refresh();
		} catch (cause: unknown) {
			setPending(null);
			setLoad({ status: "error", message: messageOf(cause) });
		} finally {
			setBusy(false);
		}
	}

	async function changeStatus(statusId: string | null) {
		try {
			await window.juno.clients.update(clientId, { statusId });
			void refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makeContactPrimary(id: string) {
		try {
			await window.juno.contacts.setPrimary(id);
			void refresh();
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
				<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const {
		client,
		status,
		statusOptions,
		emails,
		phones,
		addresses,
		links,
		contacts,
		projects,
		entries,
		entryCounts,
		hasMoreEntries,
	} = load.detail;

	const primaryEmail = emails.find((email) => email.isPrimary) ?? emails[0] ?? null;
	const primaryPhone = phones.find((phone) => phone.isPrimary) ?? phones[0] ?? null;
	const primaryAddress = addresses.find((address) => address.isPrimary) ?? null;

	const openProjects = projects.filter((project) => isOpenProjectStatus(project.status?.key));
	const changeTab = (id: TabId) => {
		setTab(id);
		onTabChange?.(id);
	};

	const totalEntries = Object.values(entryCounts).reduce((sum, count) => sum + count, 0);

	const tabs: TabItem<TabId>[] = [
		{ id: "overview", label: "Overview", count: null },
		{ id: "timeline", label: "Timeline", count: totalEntries },
		{ id: "projects", label: "Projects", count: entryCounts.project },
		{ id: "documents", label: "Documents", count: entryCounts.document },
		{ id: "mail", label: "Mail", count: entryCounts.mail },
	];

	return (
		<div>
			<div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6">
				<div className="flex items-start gap-4">
					<Avatar name={client.name} size={59} />

					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-3">
							<div className="flex min-w-0 items-center gap-2">
								<h2
									data-selectable
									className="truncate text-h2"
								>
									{client.name}
								</h2>
								<StatusMenuButton
									clientName={client.name}
									status={status}
									options={statusOptions}
									onChange={(statusId) => void changeStatus(statusId)}
								/>
							</div>
							{/* The client's own ways to start something stand in for New (frame 170:12408). */}
							<TitleBarSlot side="right" replacesNew>
								<TitleBarAction icon="mail" label="Send mail" onClick={() => onSendMail(client)} />
								<TitleBarAction icon="phone" label="Log call" opensPanel onClick={() => onEditNote(null, "call")} />
								<TitleBarAction
									icon="projects"
									label="New project"
									onClick={() => openNewRecord("project", { clientId: client.id })}
								/>
							</TitleBarSlot>
							<TitleBarSlot side="overflow">
								<ActionMenu
									target={{ kind: "client", id: client.id, context: "detail" }}
									ariaLabel={`${client.name} actions`}
									size="dense"
									handlers={{
										edit: () => onEdit(client),
										"new-project": () => openNewRecord("project", { clientId: client.id }),
										"new-note": () => onEditNote(null),
										"send-mail": () => onSendMail(client),
										delete: () => onDelete(client),
										done: onChanged,
									}}
								/>
							</TitleBarSlot>
						</div>

						<div className="mt-3 flex flex-wrap items-center gap-x-12 gap-y-1.5 text-base">
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
						</div>
					</div>
				</div>
			</div>

			<div className="mt-6">
				<Tabs
					label="Client"
					tabs={tabs}
					value={tab}
					onChange={(id) => {
						setTab(id);
						onTabChange?.(id);
					}}
				/>
			</div>

			<div className="mt-6">
				{tab === "overview" ? (
					<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
						<div className="flex min-w-0 flex-col gap-8">
							<ClientDetails
								client={client}
								emails={emails}
								phones={phones}
								addresses={addresses}
								links={links}
								onChanged={refresh}
								onEditAddress={onEditAddress}
								onEditEmail={onEditEmail}
								onEditPhone={onEditPhone}
								onEditLink={onEditLink}
								onRemove={setPending}
							/>
							<ContactsSection
								contacts={contacts}
								onAdd={() => onEditContact(null)}
								onEdit={onEditContact}
								onMakePrimary={(id) => void makeContactPrimary(id)}
								onRemove={(contact) => setPending({ kind: "contact", id: contact.id, name: contact.name })}
							/>
						</div>
						<div className="flex min-w-0 flex-col gap-8">
							<InlineNotes
								key={clientId}
								title="Notes"
								notes={client.notes}
								save={saveNotes}
								toolbar
								rows={6}
								ariaLabel="Client notes"
								placeholder="Anything worth keeping about this client. Headings, lists and links work as you type."
							/>
							<section>
								<div className="mb-2 flex items-center justify-between gap-4">
									<h3 className="text-h3">Open work</h3>
									<button
										type="button"
										onClick={() => changeTab("projects")}
										className="rounded-[var(--radius-sm)] text-base text-[var(--accent)] hover:text-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
									>
										Projects
									</button>
								</div>
								{openProjects.length === 0 ? (
									<p className="text-base text-[var(--ink-muted)]">Nothing open for this client.</p>
								) : (
									<ul className="flex flex-col gap-3">
										{openProjects.map((project) => (
											<li key={project.id} className="flex items-center gap-3">
												<Avatar name={project.name} size={28} shape="square" />
												<button
													type="button"
													onClick={() => requestOpen({ kind: "project", id: project.id, name: project.name })}
													className="min-w-0 flex-1 text-left"
												>
													<span className="block truncate text-base font-[var(--weight-medium)]">{project.name}</span>
													{project.dueOn ? (
														<span className="tabular block text-sm text-[var(--ink-muted)]">Due {formatDate(project.dueOn)}</span>
													) : null}
												</button>
												{project.status ? <StatusBadge label={project.status.label} tone={project.status.tone} /> : null}
											</li>
										))}
									</ul>
								)}
							</section>
							<ScheduleSection clientId={clientId} showProject onOpenForm={onSchedule} />
						</div>
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
						onAdd={() => openNewRecord("project", { clientId })}
						onEdit={(id) => void editProject(id)}
						onRemove={(project) => setPending({ kind: "project", id: project.id, name: project.name })}
					/>
				) : tab === "documents" ? (
					<DocumentsPanel
						scope={{ clientId }}
						name={client.name}
						onGenerate={onGenerateDocument}
						onOpen={onOpenDocument}
						onChanged={refresh}
					/>
				) : (
					<ClientMail
						clientId={clientId}
						onNewMessage={() => onSendMail(client)}
					/>
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

type StatusMenuButtonProps = {
	clientName: string;
	status: ReferenceItem | null;
	/** The visible statuses, in the owner's own order. */
	options: ReferenceItem[];
	onChange: (statusId: string | null) => void;
};

/**
 * The status beside the client's name: a badge, or "No status" when there
 * isn't one, either way a button that opens a menu of every visible status
 * plus "No status" to clear it. There is always something to click.
 */
function StatusMenuButton({ clientName, status, options, onChange }: StatusMenuButtonProps) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [at, setAt] = useState<{ x: number; y: number } | null>(null);

	function open() {
		const box = trigger.current?.getBoundingClientRect();
		if (!box) return;
		setAt({ x: box.left, y: box.bottom + 4 });
	}

	const close = () => setAt(null);

	const items: MenuItem[] = [
		{
			id: "none",
			label: "No status",
			icon: status === null ? "check" : undefined,
			onSelect: () => onChange(null),
		},
		...options.map((item) => ({
			id: item.id,
			label: item.label,
			icon: status?.id === item.id ? ("check" as IconName) : undefined,
			separatorBefore: item === options[0],
			onSelect: () => onChange(item.id),
		})),
	];

	return (
		<>
			<button
				ref={trigger}
				type="button"
				aria-label={`Change status for ${clientName}`}
				aria-haspopup="menu"
				aria-expanded={at !== null}
				onClick={open}
				// Padded out to the 32px dense hit target without pushing the badge
				// away from the name: the margin gives the padding back.
				className="-mx-1.5 -my-1 flex h-[32px] shrink-0 items-center rounded-[var(--radius-sm)] px-1.5 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				{status ? (
					<StatusBadge label={status.label} tone={status.tone} />
				) : (
					<span className="inline-block text-sm text-[var(--ink-muted)]">
						No status
					</span>
				)}
			</button>
			{at ? (
				<ContextMenu
					at={at}
					items={items}
					ariaLabel={`Change status for ${clientName}`}
					onClose={close}
				/>
			) : null}
		</>
	);
}

type ContactsSectionProps = {
	contacts: Contact[];
	onAdd: () => void;
	onEdit: (contact: Contact) => void;
	onMakePrimary: (id: string) => void;
	onRemove: (contact: Contact) => void;
};

/**
 * The people at this client, under the details: a round avatar, the name, and
 * role, email and phone under it. A click opens the contact's form; hovering
 * offers Make primary and remove, as the values above do.
 */
function ContactsSection({ contacts, onAdd, onEdit, onMakePrimary, onRemove }: ContactsSectionProps) {
	return (
		<section>
			<div className="mb-2 flex items-center justify-between gap-4">
				<h3 className="text-h3">Contacts</h3>
				<button
					type="button"
					onClick={onAdd}
					className="rounded-[var(--radius-sm)] text-base text-[var(--accent)] hover:text-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					Add contact
				</button>
			</div>

			{contacts.length === 0 ? (
				<p className="text-base text-[var(--ink-muted)]">No contacts for this client yet.</p>
			) : (
				<ul>
					{contacts.map((contact) => {
						const meta = [contact.role, contact.email, contact.phone].filter(Boolean).join(" · ");
						return (
							<li key={contact.id} className="group flex items-center gap-2">
								<button
									type="button"
									onClick={() => onEdit(contact)}
									className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								>
									<Avatar name={contact.name} size={32} />
									<span className="min-w-0 flex-1">
										<span className="flex items-center gap-2">
											<span data-selectable className="truncate text-base font-[var(--weight-medium)]">
												{contact.name}
											</span>
											{/* Primary only says something once there is a second contact. */}
											{contact.isPrimary && contacts.length > 1 ? <StatusBadge label="Primary" tone="accent" /> : null}
										</span>
										{meta ? (
											<span data-selectable className="block truncate text-sm text-[var(--ink-muted)]">
												{meta}
											</span>
										) : null}
									</span>
								</button>
								<span className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] group-hover:opacity-100 focus-within:opacity-100">
									{contact.isPrimary ? null : (
										<Button size="dense" onClick={() => onMakePrimary(contact.id)}>
											Make primary
										</Button>
									)}
									<IconButton icon="remove" label={`Remove ${contact.name}`} danger onClick={() => onRemove(contact)} />
								</span>
							</li>
						);
					})}
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
			<div className="mt-6 mb-4 flex items-center justify-between gap-4">
				<h3 className="text-h3">Projects</h3>
				<button
					type="button"
					onClick={onAdd}
					className="rounded-[var(--radius-sm)] text-base text-[var(--accent)] hover:text-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					New project
				</button>
			</div>

			{projects.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
					No projects for this client yet.
				</p>
			) : (
				<ul>
					{projects.map((project) => (
						<li
							key={project.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-dense"
						>
							{/* The project's own page, the same way the palette opens it. */}
							<button
								type="button"
								onClick={() => requestOpen({ kind: "project", id: project.id, name: project.name })}
								title={`Open ${project.name}`}
								className="-mx-2 min-w-0 flex-1 rounded-[var(--radius-md)] px-2 py-1 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] focus-visible:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<div className="flex items-center gap-3">
									<Avatar name={project.name} size={24} shape="square" />
									<div className="min-w-0 flex-1">
										<span className="block truncate font-[var(--weight-medium)]">{project.name}</span>
									</div>
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
							</button>
							<span className="flex shrink-0 gap-1 pt-1">
								<IconButton icon="edit" label="Edit" onClick={() => onEdit(project.id)} />
								<IconButton icon="remove" label="Remove" danger onClick={() => onRemove(project)} />
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type TimelineRow = { type: "month"; key: string } | { type: "entry"; entry: ClientTimelineEntry };

/** The node on the line: iris for work, brass for what was due or signed, green for mail. */
const DOT_TONE: Record<ClientTimelineKind, string> = {
	project: "bg-[var(--accent)]",
	event: "bg-[var(--accent)]",
	reminder: "bg-[var(--seal)]",
	document: "bg-[var(--seal)]",
	mail: "bg-[var(--ok)]",
	status: "bg-[var(--ink-faint)]",
	note: "bg-[var(--ink-faint)]",
};

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

	// Month headings and entries in one run, so the line can be drawn through both.
	const rows: TimelineRow[] = [];
	entries.forEach((entry, index) => {
		const month = monthKeyOf(entry);
		const previous = index > 0 ? entries[index - 1] : null;
		if (!previous || monthKeyOf(previous) !== month) rows.push({ type: "month", key: month });
		rows.push({ type: "entry", entry });
	});

	return (
		<div>
			<div className="mt-6 mb-6 flex items-center justify-between gap-4">
				<h3 className="text-h3">Timeline</h3>
				<span data-opens-panel className="flex gap-2">
					<Button size="dense" onClick={onLogCall}>
						Log a call
					</Button>
					<AddButton label="Add note" onClick={onAddNote} />
				</span>
			</div>

			{entries.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
					Nothing recorded for this client yet.
				</p>
			) : (
				<ul>
					{rows.map((row, index) => {
						const first = index === 0;
						const last = index === rows.length - 1;
						// The line runs through every row, starting level with the first
						// node and stopping at the last one (Timeline graph, 83:7194).
						const line = (
							<span
								aria-hidden
								className={`absolute left-[11px] w-[2px] bg-[var(--line-strong)] ${first ? "top-5" : "top-0"} ${last ? "h-5" : "bottom-0"}`}
							/>
						);
						if (row.type === "month") {
							return (
								<li key={`month-${row.key}`} className="flex items-start gap-4">
									<div className="relative w-6 flex-none self-stretch">
										{line}
										<span
											aria-hidden
											className="absolute top-[13px] left-[5px] h-3.5 w-3.5 rounded-[var(--radius-full)] border-2 border-[var(--line-strong)] bg-[var(--surface)]"
										/>
									</div>
									<p className="min-w-0 flex-1 pt-2.5 pb-1.5 text-overline uppercase text-[var(--ink-muted)]">
										{monthLabelOf(row.key)}
									</p>
								</li>
							);
						}
						const entry = row.entry;
						return (
							<li
								key={entry.id}
								className="flex items-start gap-4"
								onContextMenu={
									entry.kind === "note"
										? (event) => {
												setMenuEntry(entry);
												open(event);
											}
										: undefined
								}
							>
								<div className="relative w-6 flex-none self-stretch">
									{line}
									<span
										aria-hidden
										className={`absolute top-3.5 left-1.5 h-3 w-3 rounded-[var(--radius-full)] ${DOT_TONE[entry.kind]}`}
									/>
								</div>
								<div className="min-w-0 flex-1 pt-2 pb-4">
									<span data-selectable className="block truncate text-lg">
										{entry.kind === "status" ? (
											<>
												Status changed from <StatusName name={entry.statusChange?.from ?? null} /> to{" "}
												<StatusName name={entry.statusChange?.to ?? null} />
											</>
										) : (
											entry.title
										)}
									</span>
									{entry.detail ? (
										<span data-selectable className="mt-0.5 block truncate text-base text-[var(--ink-muted)]">
											{entry.detail}
										</span>
									) : null}
								</div>
								<div className="flex flex-none items-start gap-1 pt-1.5">
									<span className="tabular text-base text-[var(--ink-muted)]">{dateLabelOf(entry)}</span>
									{entry.kind === "note" ? (
										<MenuButton ariaLabel={`${entry.title} actions`} items={itemsFor(entry)} />
									) : null}
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
