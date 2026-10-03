import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientLink,
	ClientNote,
	ClientNoteKind,
	ClientPhone,
	ClientSummary,
	Contact,
	DocumentRecord,
	Project,
} from "@shared/types";
import type { Crumb } from "../../app/breadcrumb-context";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { AddButton } from "../../components/AddButton";
import { Avatar } from "../../components/Avatar";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { clearPendingClient, peekPendingClient } from "../../lib/open-client";
import { useContextMenu } from "../../lib/use-context-menu";
import { ClientAddressPanel } from "./ClientAddressPanel";
import { StatusBadge } from "../../components/StatusBadge";
import { ScheduleFormPage } from "../calendar/ScheduleFormPage";
import { scheduleFormLabel, type ScheduleForm } from "../calendar/schedule-form";
import { ClientDetail, type TabId } from "./ClientDetail";
import {
	applyView,
	citiesOf,
	EMPTY_VIEW,
	filterActive,
	nextSort,
	NO_CITY,
	NO_STATUS,
	statusesOf,
	type ClientColumn,
	type ClientView,
} from "./client-view";
import { ColumnHeader } from "./ColumnHeader";
import { CheckList, RangeField } from "./ColumnFilters";
import { DocumentDetail } from "../documents/DocumentDetail";
import { GenerateDialog } from "../documents/GenerateDialog";
import { SignPage } from "../documents/SignPage";
import { ClientEmailPanel } from "./ClientEmailPanel";
import { ClientForm } from "./ClientForm";
import { ClientNotePanel } from "./ClientNotePanel";
import { ClientLinkPanel } from "./ClientLinkPanel";
import { ClientPhonePanel } from "./ClientPhonePanel";
import { ContactForm } from "./ContactForm";
import { ProjectForm } from "../projects/ProjectForm";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: ClientSummary[] }
	| { status: "error"; message: string };

export function ClientsScreen() {
	const [search, setSearch] = useState("");
	const [load, setLoad] = useState<Load>({ status: "loading" });
	// A client opened from another screen (the mail reader) arrives as a pending
	// request, and is cleared once this screen has taken it.
	const [selectedId, setSelectedId] = useState<string | null>(() => peekPendingClient()?.id ?? null);
	// Held alongside the id so the title bar has a name to show the moment a row
	// is clicked, with no fetch and no flash of a stale label. A save that
	// renames the client corrects it through `saved`, which is the only other
	// place the full row comes back from the main process.
	const [selectedName, setSelectedName] = useState<string | null>(() => peekPendingClient()?.name ?? null);
	useEffect(() => clearPendingClient, []);
	const [detailVersion, setDetailVersion] = useState(0);
	const bumpDetail = () => setDetailVersion((current) => current + 1);
	const [form, setForm] = useState<{ client: Client | null } | null>(null);
	// Contacts and projects belong to the open client, and they are filled in on
	// a page of their own, so the state sits here rather than in the detail pane
	// that is too narrow to hold one.
	const [contactForm, setContactForm] = useState<{ contact: Contact | null } | null>(null);
	const [projectForm, setProjectForm] = useState<{ project: Project | null } | null>(null);
	const [scheduleForm, setScheduleForm] = useState<ScheduleForm | null>(null);
	// A document from a template is a page too. Coming back from it lands on the
	// Documents tab, where it was started from.
	const [documentForm, setDocumentForm] = useState(false);
	// A document opens in the same viewer the Documents screen uses, inside this
	// client, so the trail and Escape lead back to the Documents tab.
	const [openDocument, setOpenDocument] = useState<{ id: string; title: string } | null>(null);
	const [signingRecord, setSigningRecord] = useState<DocumentRecord | null>(null);
	const [documentVersion, setDocumentVersion] = useState(0);
	const [detailTab, setDetailTab] = useState<TabId>("overview");
	// Unlike contacts and projects, these are small enough to edit in a side
	// panel next to the detail pane rather than taking over the screen.
	const [emailPanel, setEmailPanel] = useState<{ email: ClientEmail | null } | null>(null);
	const [phonePanel, setPhonePanel] = useState<{ phone: ClientPhone | null } | null>(null);
	const [linkPanel, setLinkPanel] = useState<{ link: ClientLink | null } | null>(null);
	const [addressPanel, setAddressPanel] = useState<{ address: ClientAddress | null } | null>(null);
	// A note belongs to whichever client it was opened from, which is not
	// always the open one: the list's own context menu offers "Add note"
	// without opening the client first.
	const [notePanel, setNotePanel] = useState<{
		clientId: string;
		note: ClientNote | null;
		initialKind?: ClientNoteKind;
	} | null>(null);
	const [deleted, setDeleted] = useState<Client | null>(null);
	const [view, setView] = useState<ClientView>(EMPTY_VIEW);

	const fetchRows = useCallback(
		() => window.juno.clients.list({ search: search.trim() || undefined }),
		[search],
	);

	useEffect(() => {
		let cancelled = false;
		// Debounced so typing does not fire a query per keystroke.
		const id = setTimeout(() => {
			fetchRows()
				.then((rows) => {
					if (!cancelled) setLoad({ status: "ready", rows });
				})
				.catch((error: unknown) => {
					if (!cancelled) setLoad({ status: "error", message: messageOf(error) });
				});
		}, 150);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [fetchRows]);

	const refreshList = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((error: unknown) => setLoad({ status: "error", message: messageOf(error) }));
	}, [fetchRows]);

	const dismissUndo = useCallback(() => setDeleted(null), []);

	function selectRow(row: ClientSummary) {
		setDetailTab("overview");
		setSelectedId(row.id);
		setSelectedName(row.name);
	}

	function closeDocument() {
		setOpenDocument(null);
		setSigningRecord(null);
		setDetailTab("documents");
	}

	function backToList() {
		setOpenDocument(null);
		setSigningRecord(null);
		setDetailTab("overview");
		setSelectedId(null);
		setSelectedName(null);
	}

	function saved(client: Client) {
		setForm(null);
		setSelectedId(client.id);
		// A save is the other place a name can change, so the title bar picks up
		// a rename here rather than waiting on the detail pane to report one.
		setSelectedName(client.name);
		// Remounts the detail pane, which is how it picks up an edit made here.
		setDetailVersion((version) => version + 1);
		refreshList();
	}

	async function remove(client: Client) {
		try {
			const removed = await window.juno.clients.remove(client.id);
			backToList();
			setDeleted(removed);
			refreshList();
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	// The list's own context menu offers Edit and Delete straight off a row,
	// without opening the client first, so both fetch the full record on demand:
	// a ClientSummary row has none of the fields the form or the toast need.
	async function editRow(row: ClientSummary) {
		try {
			const client = await window.juno.clients.get(row.id);
			if (client) setForm({ client });
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	async function deleteRow(row: ClientSummary) {
		try {
			const client = await window.juno.clients.get(row.id);
			if (client) await remove(client);
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		const name = deleted.name;
		setDeleted(null);
		try {
			await window.juno.clients.restore(id);
			setSelectedId(id);
			setSelectedName(name);
			setDetailVersion((version) => version + 1);
			refreshList();
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	const clientCrumb: Crumb = { label: "Clients", onSelect: backToList };

	let trail: Crumb[] = [];
	if (form) {
		trail = form.client
			? [
					clientCrumb,
					{ label: selectedName ?? form.client.name, onSelect: () => setForm(null) },
					{ label: "Edit client" },
				]
			: [clientCrumb, { label: "New client" }];
	} else if (contactForm && selectedId) {
		trail = [
			clientCrumb,
			{ label: selectedName ?? "Client", onSelect: () => setContactForm(null) },
			{ label: contactForm.contact ? "Edit contact" : "New contact" },
		];
	} else if (projectForm && selectedId) {
		trail = [
			clientCrumb,
			{ label: selectedName ?? "Client", onSelect: () => setProjectForm(null) },
			{ label: projectForm.project ? "Edit project" : "New project" },
		];
	} else if (scheduleForm && selectedId) {
		trail = [
			clientCrumb,
			{ label: selectedName ?? "Client", onSelect: () => setScheduleForm(null) },
			{ label: scheduleFormLabel(scheduleForm) },
		];
	} else if (openDocument && selectedId) {
		trail = [
			clientCrumb,
			{ label: selectedName ?? "Client", onSelect: closeDocument },
			{ label: openDocument.title },
		];
	} else if (documentForm && selectedId) {
		trail = [
			clientCrumb,
			{ label: selectedName ?? "Client", onSelect: () => setDocumentForm(false) },
			{ label: "New document" },
		];
	} else if (selectedId !== null) {
		trail = [clientCrumb, { label: selectedName ?? "Client" }];
	}
	usePublishBreadcrumb(trail);

	// Escape steps back to the list, but only when it is the topmost thing open.
	// A side panel and ClientDetail's own remove confirmation both own Escape
	// first, so this defers to a side panel by state and to a dialog by the same
	// `[role='dialog']` guard FormPage uses, since that confirmation is state
	// this screen does not hold.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			if (selectedId === null) return;
			if (form || contactForm || projectForm || scheduleForm || documentForm || signingRecord) return;
			if (openDocument) {
				if (!document.querySelector("[role='dialog']")) closeDocument();
				return;
			}
			if (emailPanel || phonePanel || linkPanel || addressPanel || notePanel) return;
			if (document.querySelector("[role='dialog']")) return;
			backToList();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedId, form, contactForm, projectForm, scheduleForm, documentForm, openDocument, signingRecord, emailPanel, phonePanel, linkPanel, addressPanel, notePanel]);

	// The form takes the screen rather than covering it. Nothing in the list
	// behind it is worth reading while a client is being filled in.
	if (form) {
		return <ClientForm client={form.client} onClose={() => setForm(null)} onSaved={saved} />;
	}

	if (contactForm && selectedId) {
		return (
			<ContactForm
				clientId={selectedId}
				contact={contactForm.contact}
				onClose={() => setContactForm(null)}
				onSaved={() => {
					setContactForm(null);
					bumpDetail();
				}}
			/>
		);
	}

	if (scheduleForm && selectedId) {
		return (
			<ScheduleFormPage
				form={scheduleForm}
				backLabel="Client"
				onClose={() => setScheduleForm(null)}
				onSaved={() => {
					setScheduleForm(null);
					bumpDetail();
				}}
			/>
		);
	}

	if (projectForm && selectedId) {
		return (
			<ProjectForm
				lockedClientId={selectedId}
				backLabel="Client"
				project={projectForm.project}
				onClose={() => setProjectForm(null)}
				onSaved={() => {
					setProjectForm(null);
					bumpDetail();
				}}
			/>
		);
	}

	if (signingRecord && selectedId) {
		return (
			<SignPage
				record={signingRecord}
				onClose={() => setSigningRecord(null)}
				onSigned={() => {
					setSigningRecord(null);
					setDocumentVersion((version) => version + 1);
					bumpDetail();
				}}
			/>
		);
	}

	if (openDocument && selectedId) {
		return (
			<div className="h-full min-h-0 w-full">
				<DocumentDetail
					key={`${openDocument.id}:${documentVersion}`}
					documentId={openDocument.id}
					onDeleted={() => {
						closeDocument();
						bumpDetail();
					}}
					onChanged={bumpDetail}
					onSign={setSigningRecord}
					onTitleChange={(title) => setOpenDocument((current) => (current ? { ...current, title } : current))}
				/>
			</div>
		);
	}

	if (documentForm && selectedId) {
		return (
			<GenerateDialog
				lockedClientId={selectedId}
				backLabel="Client"
				onClose={() => setDocumentForm(false)}
				onGenerated={() => {
					setDocumentForm(false);
					setDetailTab("documents");
					bumpDetail();
				}}
			/>
		);
	}

	// A client replaces the list rather than shrinking it into a column: it gets
	// the whole working area, and the title bar trail is what says where you are
	// and how to get back.
	if (selectedId !== null) {
		return (
			<div className="relative flex h-full min-h-0">
				<div className="min-h-0 flex-1 overflow-y-auto p-8">
					<div className="mx-auto w-full max-w-[var(--content-width)]">
						<ClientDetail
							key={`${selectedId}:${detailVersion}`}
							clientId={selectedId}
							onEdit={(client) => setForm({ client })}
							onDelete={(client) => void remove(client)}
							onEditContact={(contact) => setContactForm({ contact })}
							onEditProject={(project) => setProjectForm({ project })}
							onSchedule={setScheduleForm}
							onEditEmail={(email) => setEmailPanel({ email })}
							onEditPhone={(phone) => setPhonePanel({ phone })}
							onEditLink={(link) => setLinkPanel({ link })}
							onEditAddress={(address) => setAddressPanel({ address })}
							onGenerateDocument={() => setDocumentForm(true)}
							onOpenDocument={(id, title) => setOpenDocument({ id, title })}
							initialTab={detailTab}
							onTabChange={setDetailTab}
							onEditNote={(note, initialKind) => setNotePanel({ clientId: selectedId, note, initialKind })}
						/>
					</div>
				</div>

				{emailPanel ? (
					<ClientEmailPanel
						clientId={selectedId}
						email={emailPanel.email}
						onClose={() => setEmailPanel(null)}
						onSaved={() => {
							setEmailPanel(null);
							bumpDetail();
						}}
					/>
				) : null}

				{linkPanel ? (
					<ClientLinkPanel
						clientId={selectedId}
						link={linkPanel.link}
						onClose={() => setLinkPanel(null)}
						onSaved={() => {
							setLinkPanel(null);
							bumpDetail();
						}}
					/>
				) : null}

				{phonePanel ? (
					<ClientPhonePanel
						clientId={selectedId}
						phone={phonePanel.phone}
						onClose={() => setPhonePanel(null)}
						onSaved={() => {
							setPhonePanel(null);
							bumpDetail();
						}}
					/>
				) : null}

				{addressPanel ? (
					<ClientAddressPanel
						clientId={selectedId}
						address={addressPanel.address}
						onClose={() => setAddressPanel(null)}
						onSaved={() => {
							setAddressPanel(null);
							bumpDetail();
						}}
					/>
				) : null}

				{notePanel ? (
					<ClientNotePanel
						clientId={notePanel.clientId}
						note={notePanel.note}
						initialKind={notePanel.initialKind}
						onClose={() => setNotePanel(null)}
						onSaved={() => {
							setNotePanel(null);
							bumpDetail();
						}}
					/>
				) : null}
			</div>
		);
	}

	return (
		<div className="relative flex h-full flex-col p-8">
			<div className="mx-auto mb-6 flex w-full max-w-[var(--content-width)] items-center justify-between gap-4">
				<div className="flex items-baseline gap-3">
					<h1 className="text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.02em]">
						Clients
					</h1>
					{load.status === "ready" ? (
						<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{load.rows.length} {load.rows.length === 1 ? "client" : "clients"}
						</span>
					) : null}
				</div>

				<div className="flex items-center gap-3">
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search clients"
						aria-label="Search clients"
						className="w-[280px] rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
					/>
					<AddButton label="New client" onClick={() => setForm({ client: null })} />
				</div>
			</div>

			<div className="mx-auto w-full max-w-[var(--content-width)] flex-1 overflow-y-auto">
				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<ErrorNote message={load.message} />
				) : load.rows.length === 0 ? (
					<Empty searching={search.trim().length > 0} />
				) : (
					<ClientTable
						allRows={load.rows}
						view={view}
						onView={setView}
						selectedId={selectedId}
						onSelect={selectRow}
						onEdit={(row) => void editRow(row)}
						onAddNote={(row) => setNotePanel({ clientId: row.id, note: null })}
						onDelete={(row) => void deleteRow(row)}
					/>
				)}
			</div>

			{deleted ? (
				<Toast
					message={`${deleted.name} deleted.`}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={dismissUndo}
				/>
			) : null}

			{notePanel ? (
				// Reached only from a row's own menu, so the client it is for is
				// never the open one: nothing on this list changes because of a note.
				<ClientNotePanel
					clientId={notePanel.clientId}
					note={notePanel.note}
					initialKind={notePanel.initialKind}
					onClose={() => setNotePanel(null)}
					onSaved={() => setNotePanel(null)}
				/>
			) : null}
		</div>
	);
}

type ClientTableProps = {
	allRows: ClientSummary[];
	view: ClientView;
	onView: (view: ClientView) => void;
	selectedId: string | null;
	onSelect: (row: ClientSummary) => void;
	onEdit: (row: ClientSummary) => void;
	onAddNote: (row: ClientSummary) => void;
	onDelete: (row: ClientSummary) => void;
};

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7.
 */
function ClientTable({ allRows, view, onView, selectedId, onSelect, onEdit, onAddNote, onDelete }: ClientTableProps) {
	const rows = useMemo(() => applyView(allRows, view), [allRows, view]);
	const statusOptions = useMemo(
		() => [
			...statusesOf(allRows).map((status) => ({ value: status.id, label: status.label })),
			{ value: NO_STATUS, label: "No status" },
		],
		[allRows],
	);
	const cityOptions = useMemo(
		() => [...citiesOf(allRows).map((city) => ({ value: city, label: city })), { value: NO_CITY, label: "No city" }],
		[allRows],
	);

	const headerProps = (column: ClientColumn, label: string) => ({
		label,
		direction: view.sort?.column === column ? view.sort.direction : null,
		filtered: filterActive(view, column),
		onCycleSort: () => onView({ ...view, sort: nextSort(view, column) }),
		onSort: (direction: "asc" | "desc" | null) =>
			onView({ ...view, sort: direction ? { column, direction } : null }),
	});
	const { at, open, close } = useContextMenu();
	const [menuRow, setMenuRow] = useState<ClientSummary | null>(null);

	function itemsFor(row: ClientSummary): MenuItem[] {
		return [
			{ id: "open", label: "Open", icon: "chevron-right", onSelect: () => onSelect(row) },
			{ id: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit(row) },
			{ id: "add-note", label: "Add note", icon: "note", onSelect: () => onAddNote(row) },
			{
				id: "delete",
				label: "Delete",
				icon: "remove",
				danger: true,
				separatorBefore: true,
				onSelect: () => onDelete(row),
			},
		];
	}

	return (
		<>
			<table className="w-full border-collapse">
				<thead>
					<tr>
					<ColumnHeader {...headerProps("name", "Name")} />
					<ColumnHeader
						{...headerProps("status", "Status")}
						onClearFilter={() => onView({ ...view, statuses: [] })}
					>
						<CheckList
							options={statusOptions}
							selected={view.statuses}
							onChange={(statuses) => onView({ ...view, statuses })}
							emptyText="No statuses yet."
						/>
					</ColumnHeader>
					<ColumnHeader
						{...headerProps("city", "City")}
						onClearFilter={() => onView({ ...view, cities: [] })}
					>
						<CheckList
							options={cityOptions}
							selected={view.cities}
							onChange={(cities) => onView({ ...view, cities })}
							emptyText="No cities yet."
						/>
					</ColumnHeader>
					<ColumnHeader
						{...headerProps("projects", "Projects")}
						align="right"
						onClearFilter={() =>
							onView({
								...view,
								openProjects: EMPTY_VIEW.openProjects,
								totalProjects: EMPTY_VIEW.totalProjects,
							})
						}
					>
						<RangeField
							label="Open projects"
							value={view.openProjects}
							onChange={(openProjects) => onView({ ...view, openProjects })}
						/>
						<RangeField
							label="All projects"
							value={view.totalProjects}
							onChange={(totalProjects) => onView({ ...view, totalProjects })}
						/>
					</ColumnHeader>
					</tr>
				</thead>
				<tbody>
					{rows.length === 0 ? (
						<tr>
							<td colSpan={4} className="px-3 py-4 text-[var(--ink-muted)]">
								No client matches these filters.
							</td>
						</tr>
					) : null}
					{rows.map((row) => {
						const selected = row.id === selectedId;
						return (
							<tr
								key={row.id}
								onClick={() => onSelect(row)}
								onContextMenu={(event) => {
									setMenuRow(row);
									open(event);
								}}
								className={`transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
									selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
								}`}
							>
								<td
									className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)]"
									style={{ height: "var(--row-height-roomy)" }}
								>
									<button
										type="button"
										aria-current={selected ? "true" : undefined}
										onClick={() => onSelect(row)}
										className="flex w-full min-w-0 items-center gap-3 text-left"
									>
										<Avatar name={row.name} size={28} shape="square" />
										<span className="truncate">{row.name}</span>
									</button>
								</td>
								<td className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)]">
									{row.status ? <StatusBadge label={row.status.label} tone={row.status.tone} /> : null}
								</td>
								<td className="border-b border-[var(--line)]/60 px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									{row.city ?? ""}
								</td>
								<td className="tabular border-b border-[var(--line)]/60 px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									{row.openProjectCount} / {row.projectCount}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

			{at && menuRow ? (
				<ContextMenu at={at} items={itemsFor(menuRow)} ariaLabel={`${menuRow.name} actions`} onClose={close} />
			) : null}
		</>
	);
}

function Empty({ searching }: { searching: boolean }) {
	return (
		<p className="text-[var(--ink-muted)]">
			{searching ? "No client matches that." : "No clients yet."}
		</p>
	);
}

function ErrorNote({ message }: { message: string }) {
	return (
		<div className="border-l-2 border-[var(--risk)] pl-4">
			<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load clients.</p>
			<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{message}
			</p>
		</div>
	);
}
