import { IconButton } from "../../components/IconButton";
import { Tabs, type TabItem } from "../../components/Tabs";
import { ScheduleSection } from "../calendar/ScheduleSection";
import type { ScheduleForm } from "../calendar/schedule-form";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLIENT_LINK_KIND_LABELS, isClientLinkKind } from "@shared/client-links";
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
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { ActionMenu } from "../../components/ActionMenu";
import { Avatar } from "../../components/Avatar";
import { ClientMail } from "./ClientMail";
import { isOpenProjectStatus } from "@shared/project-status";
import { clientLanguageLabel } from "@shared/client-language";
import { AddButton } from "../../components/AddButton";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon, type IconName } from "../../components/Icon";
import { MarkdownNotes } from "../../components/MarkdownNotes";
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

type DetailKind = "contact" | "project" | "email" | "phone" | "address" | "link" | "note";
type Pending = { kind: DetailKind; id: string; name: string };

const REMOVE_TITLES: Record<DetailKind, string> = {
	contact: "Remove contact",
	project: "Remove project",
	email: "Remove email",
	phone: "Remove phone number",
	address: "Remove address",
	link: "Remove link",
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
			else if (pending.kind === "link") await window.juno.clientLinks.remove(pending.id);
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

	async function changeStatus(statusId: string | null) {
		try {
			await window.juno.clients.update(clientId, { statusId });
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
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
					<div className="flex flex-col gap-10">
						<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
							<section>
								<h3 className="mb-2 text-h3">Details</h3>
								<dl>
									{[
										{ label: "Email", value: primaryEmail?.email ?? null },
										{ label: "Phone", value: primaryPhone?.phone ?? null },
										{
											label: "Address",
											value: primaryAddress
												? [primaryAddress.addressLine1, [primaryAddress.postalCode, primaryAddress.city].filter(Boolean).join(" ")]
														.filter(Boolean)
														.join(", ")
												: null,
										},
										{ label: "Website", value: client.website, href: client.website ? websiteHref(client.website) : undefined },
										{ label: "VAT number", value: client.vatNumber },
										{ label: "Language", value: clientLanguageLabel(client.language) },
									].map((row) => (
										<div key={row.label} className="flex min-h-14 items-center gap-6 border-b border-[var(--line)]">
											<dt className="w-32 flex-none text-base text-[var(--ink-muted)]">{row.label}</dt>
											<dd data-selectable className="tabular min-w-0 flex-1 truncate text-base">
												{row.value && row.value.length > 0 ? (
													"href" in row && row.href ? (
														<a
															href={row.href}
															target="_blank"
															rel="noopener noreferrer"
															className="text-[var(--accent)] hover:text-[var(--accent-hover)]"
														>
															{row.value}
														</a>
													) : (
														row.value
													)
												) : (
													"Not set"
												)}
											</dd>
										</div>
									))}
								</dl>
							</section>
							<div className="flex flex-col gap-8">
								<section>
									<div className="mb-4 flex items-center justify-between gap-4">
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
													<Avatar name={project.name} size={24} shape="square" />
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
								<section>
									<div className="mb-4 flex items-center justify-between gap-4">
										<h3 className="text-h3">Notes</h3>
										<span data-opens-panel>
											<button
												type="button"
												onClick={() => onEditNote(null)}
												className="rounded-[var(--radius-sm)] text-base text-[var(--accent)] hover:text-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
											>
												New note
											</button>
										</span>
									</div>
									{client.notes && client.notes.trim().length > 0 ? (
										<div className="text-document">
											<MarkdownNotes text={client.notes} />
										</div>
									) : (
										<p className="text-base text-[var(--ink-muted)]">No notes yet.</p>
									)}
								</section>
							</div>
						</div>

						<ScheduleSection clientId={clientId} showProject onOpenForm={onSchedule} />

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

						<LinksSection
							links={links}
							onAdd={() => onEditLink(null)}
							onEdit={onEditLink}
							onRemove={(link) => setPending({ kind: "link", id: link.id, name: link.label ?? link.url })}
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
				<h3 className="text-h3 font-[var(--weight-medium)]">Emails</h3>
				<Button size="dense" data-opens-panel onClick={onAdd}>
					Add email
				</Button>
			</div>

			{emails.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
					No email addresses for this client yet.
				</p>
			) : (
				<ul>
					{emails.map((email) => (
						<li
							key={email.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-dense"
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
								<IconButton icon="edit" label="Edit" opensPanel onClick={() => onEdit(email)} />
								<IconButton icon="remove" label="Remove" danger onClick={() => onRemove(email)} />
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
				<h3 className="text-h3 font-[var(--weight-medium)]">Phone numbers</h3>
				<Button size="dense" data-opens-panel onClick={onAdd}>
					Add phone number
				</Button>
			</div>

			{phones.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
					No phone numbers for this client yet.
				</p>
			) : (
				<ul>
					{phones.map((phone) => (
						<li
							key={phone.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-dense"
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
								<IconButton icon="edit" label="Edit" opensPanel onClick={() => onEdit(phone)} />
								<IconButton icon="remove" label="Remove" danger onClick={() => onRemove(phone)} />
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type LinksSectionProps = {
	links: ClientLink[];
	onAdd: () => void;
	onEdit: (link: ClientLink) => void;
	onRemove: (link: ClientLink) => void;
};

function linkTitle(link: ClientLink): string {
	return link.label ?? (isClientLinkKind(link.kind) ? CLIENT_LINK_KIND_LABELS[link.kind] : link.url);
}

/** What to show under a link's title: the address without its scheme or trailing slash. */
function shortUrl(url: string): string {
	return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function LinksSection({ links, onAdd, onEdit, onRemove }: LinksSectionProps) {
	const [problem, setProblem] = useState<string | null>(null);

	async function open(id: string) {
		setProblem(null);
		try {
			await window.juno.clientLinks.open(id);
		} catch (cause: unknown) {
			setProblem(messageOf(cause));
		}
	}

	return (
		<section>
			<div className="mb-4 flex items-center justify-between gap-4">
				<h3 className="text-h3 font-[var(--weight-medium)]">Links</h3>
				<Button size="dense" data-opens-panel onClick={onAdd}>
					Add link
				</Button>
			</div>

			{links.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
					No website or profiles for this client yet.
				</p>
			) : (
				<ul>
					{links.map((link) => (
						<li
							key={link.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-dense"
						>
							<div className="flex min-w-0 items-start gap-3">
								<Icon
									name={link.kind === "website" ? "web" : "link"}
									className="mt-0.5 shrink-0 text-[var(--ink-muted)]"
								/>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="truncate font-[var(--weight-medium)]">{linkTitle(link)}</span>
										{link.label && isClientLinkKind(link.kind) ? (
											<span className="text-sm text-[var(--ink-muted)]">
												{CLIENT_LINK_KIND_LABELS[link.kind]}
											</span>
										) : null}
									</div>
									<div data-selectable className="mt-0.5 truncate text-[var(--ink-muted)]">
										{shortUrl(link.url)}
									</div>
								</div>
							</div>
							<span className="flex shrink-0 gap-1">
								<Button size="dense" onClick={() => void open(link.id)}>
									Open
								</Button>
								<IconButton icon="edit" label="Edit" opensPanel onClick={() => onEdit(link)} />
								<IconButton icon="remove" label="Remove" danger onClick={() => onRemove(link)} />
							</span>
						</li>
					))}
				</ul>
			)}
			{problem ? (
				<p role="alert" data-selectable className="mt-2 text-sm text-[var(--risk)]">
					{problem}
				</p>
			) : null}
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
				<h3 className="text-h3 font-[var(--weight-medium)]">Addresses</h3>
				<Button size="dense" data-opens-panel onClick={onAdd}>
					Add address
				</Button>
			</div>

			{addresses.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
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
								className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-dense"
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
									<IconButton icon="edit" label="Edit" opensPanel onClick={() => onEdit(address)} />
									<IconButton icon="remove" label="Remove" danger onClick={() => onRemove(address, line)} />
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
				<h3 className="text-h3 font-[var(--weight-medium)]">Contacts</h3>
				<Button size="dense" onClick={onAdd}>
					Add contact
				</Button>
			</div>

			{contacts.length === 0 ? (
				<p className="text-dense text-[var(--ink-muted)]">
					No contacts for this client yet.
				</p>
			) : (
				<ul>
					{contacts.map((contact) => (
						<li
							key={contact.id}
							className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-dense"
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
								<IconButton icon="edit" label="Edit" onClick={() => onEdit(contact)} />
								<IconButton icon="remove" label="Remove" danger onClick={() => onRemove(contact)} />
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
