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
import { openNewRecord, useRecordsChanged } from "../../lib/new-record";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { TitleSearch } from "../../app/TitleSearch";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { Dialog } from "../../components/Dialog";
import { SelectionBar } from "../../components/SelectionBar";
import { MenuButton } from "../../components/Menu";
import { EmptyState } from "../../components/EmptyState";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { clearPendingClient, peekPendingClient } from "../../lib/open-client";
import { blankMenuFor } from "../../lib/blank-menu";
import { contextMenuFor } from "../../lib/native-menu";
import { ComposePage, type ComposeSeed } from "../mail/ComposePage";
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
import { useRecentTouch } from "../../lib/use-recent-touch";
import { listAllClients } from "../../lib/list-all-clients";
import { useGradualCount } from "../../lib/use-gradual-count";
import { useRowSelection } from "../../lib/use-row-selection";

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
	useRecentTouch("client", selectedId);
	const [detailVersion, setDetailVersion] = useState(0);
	const bumpDetail = () => setDetailVersion((current) => current + 1);
	const [form, setForm] = useState<{ client: Client } | null>(null);
	// Contacts and projects belong to the open client, and they are filled in on
	// a page of their own, so the state sits here rather than in the detail pane
	// that is too narrow to hold one.
	const [contactForm, setContactForm] = useState<{ contact: Contact | null } | null>(null);
	const [projectForm, setProjectForm] = useState<{ project: Project } | null>(null);
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
	const [notice, setNotice] = useState<string | null>(null);
	const dismissNotice = useCallback(() => setNotice(null), []);
	// A mail to a client opens the composer here, addressed to their primary address.
	const [compose, setCompose] = useState<ComposeSeed | null>(null);
	const [view, setView] = useState<ClientView>(EMPTY_VIEW);

	const filtersOn = JSON.stringify({ ...view, sort: null }) !== JSON.stringify({ ...EMPTY_VIEW, sort: null });

	// The rows as the table draws them, which is what select all and a Shift run go by.
	const shownRows = useMemo(() => (load.status === "ready" ? applyView(load.rows, view) : []), [load, view]);
	const shownIds = useMemo(() => shownRows.map((row) => row.id), [shownRows]);
	const selection = useRowSelection(shownIds);
	// A delete of several asks first, and is undone as one.
	const [confirmingDelete, setConfirmingDelete] = useState<string[] | null>(null);
	const [deletedMany, setDeletedMany] = useState<Client[] | null>(null);

	const fetchRows = useCallback(
		() => listAllClients(search.trim() || undefined),
		[search],
	);

	useEffect(() => {
		let cancelled = false;
		// Debounced so typing does not fire a query per keystroke. Only while
		// something is typed: opening the screen, or clearing the search, asks at
		// once rather than showing an empty list for the length of the wait.
		const id = setTimeout(() => {
			fetchRows()
				.then((rows) => {
					if (!cancelled) setLoad({ status: "ready", rows });
				})
				.catch((error: unknown) => {
					if (!cancelled) setLoad({ status: "error", message: messageOf(error) });
				});
		}, search.trim() ? 150 : 0);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [fetchRows, search]);

	const refreshList = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((error: unknown) => setLoad({ status: "error", message: messageOf(error) }));
	}, [fetchRows]);

	// A new-record window saved something: the list and the open client read again.
	useRecordsChanged(() => {
		refreshList();
		bumpDetail();
	});

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

	async function startMail(clientId: string) {
		try {
			const emails = await window.juno.clientEmails.listForClient(clientId);
			const to = emails.find((email) => email.isPrimary) ?? emails[0];
			if (!to) {
				setNotice("This client has no email address yet.");
				return;
			}
			setCompose({ clientId, to: [{ name: null, address: to.email }] });
		} catch (error: unknown) {
			setNotice(messageOf(error));
		}
	}

	/**
	 * One message to the selected clients' primary addresses, all in Bcc so no
	 * client sees who else it went to. A client with no address is left off,
	 * and the toast says how many once the composer closes.
	 */
	function mailSelected(ids: string[]) {
		const picked = load.status === "ready" ? load.rows.filter((row) => ids.includes(row.id)) : [];
		const reachable = picked.filter((row) => row.email);
		if (reachable.length === 0) {
			setNotice(ids.length === 1 ? "This client has no email address yet." : "None of these clients has an email address yet.");
			return;
		}
		const missing = picked.length - reachable.length;
		if (missing > 0) {
			setNotice(`${missing} of ${picked.length} clients have no email address, so they are not on the message.`);
		}
		setCompose({
			clientId: reachable.length === 1 ? reachable[0]!.id : null,
			bcc: reachable.map((row) => ({ name: row.name, address: row.email! })),
		});
		selection.clear();
	}

	async function archiveSelected(ids: string[]) {
		try {
			const archived = await window.juno.clients.archiveMany(ids);
			setNotice(archived.length === 1 ? `${archived[0]!.name} archived.` : `${archived.length} clients archived.`);
			selection.clear();
			refreshList();
		} catch (error: unknown) {
			setNotice(messageOf(error));
		}
	}

	async function deleteSelected(ids: string[]) {
		setConfirmingDelete(null);
		try {
			const removed = await window.juno.clients.removeMany(ids);
			selection.clear();
			setDeleted(null);
			setDeletedMany(removed);
			refreshList();
		} catch (error: unknown) {
			setNotice(messageOf(error));
		}
	}

	async function restoreMany() {
		if (!deletedMany) return;
		const ids = deletedMany.map((client) => client.id);
		setDeletedMany(null);
		try {
			await window.juno.clients.restoreMany(ids);
			refreshList();
		} catch (error: unknown) {
			setNotice(messageOf(error));
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
		trail = [
			clientCrumb,
			{ label: selectedName ?? form.client.name, onSelect: () => setForm(null) },
			{ label: "Edit client" },
		];
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
			{ label: "Edit project" },
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

	if (compose) {
		return (
			<ComposePage
				seed={compose}
				onClose={() => setCompose(null)}
				onDeleted={() => {
					setCompose(null);
					setNotice("Draft deleted.");
				}}
				onDone={(_message, queued) => {
					setCompose(null);
					setNotice(queued ? "Message queued. Follow it in the mail outbox." : "Draft saved in the mail outbox.");
				}}
			/>
		);
	}

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
					<div className="w-full">
						<ClientDetail
							key={`${selectedId}:${detailVersion}`}
							clientId={selectedId}
							onEdit={(client) => setForm({ client })}
							onDelete={(client) => void remove(client)}
							onSendMail={(client) => void startMail(client.id)}
							onChanged={(message) => {
								if (message) setNotice(message);
								refreshList();
								bumpDetail();
							}}
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
			<TitleSearch value={search} onChange={setSearch} placeholder="Search clients" />
			<TitleBarSlot side="overflow">
				<MenuButton
					ariaLabel="How this list is shown"
					size="dense"
					items={[
						{
							id: "clear-filters",
							label: "Clear filters",
							icon: "close",
							disabled: !filtersOn,
							onSelect: () => setView({ ...EMPTY_VIEW, sort: view.sort }),
						},
						{
							id: "reset-sort",
							label: "Reset sorting",
							icon: "undo",
							disabled: view.sort === null,
							onSelect: () => setView({ ...view, sort: null }),
						},
					]}
				/>
			</TitleBarSlot>

			{selection.selectedIds.length > 0 && load.status === "ready" && load.rows.length > 0 ? (
				<div className="mb-6">
					<SelectionBar
						count={selection.selectedIds.length}
						allSelected={selection.allSelected}
						onSelectAll={selection.selectAll}
						onClear={selection.clear}
						actions={[
							{ id: "mail", icon: "mail", label: "Send mail", onSelect: () => mailSelected(selection.selectedIds) },
							{
								id: "archive",
								icon: "archive",
								label: "Archive",
								onSelect: () => void archiveSelected(selection.selectedIds),
							},
							{
								id: "delete",
								icon: "remove",
								label: "Delete",
								danger: true,
								onSelect: () => setConfirmingDelete(selection.selectedIds),
							},
						]}
					/>
				</div>
			) : null}

			<div className="w-full flex-1 overflow-y-auto" onContextMenu={blankMenuFor("clients")}>
				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<ErrorNote message={load.message} />
				) : load.rows.length === 0 ? (
					<Empty
						searching={search.trim().length > 0}
						onAdd={() => openNewRecord("client")}
						onClearSearch={() => setSearch("")}
					/>
				) : (
					<ClientTable
						allRows={load.rows}
						rows={shownRows}
						held={selection.held}
						onPick={selection.pick}
						view={view}
						onView={setView}
						selectedId={selectedId}
						onSelect={selectRow}
						onEdit={(row) => void editRow(row)}
						onAddNote={(row) => setNotePanel({ clientId: row.id, note: null })}
						onDelete={(row) => void deleteRow(row)}
						onNewProject={(row) => openNewRecord("project", { clientId: row.id })}
						onSendMail={(row) => void startMail(row.id)}
						onDone={(message) => {
							if (message) setNotice(message);
							refreshList();
						}}
						onFailed={setNotice}
					/>
				)}
			</div>

			{deleted === null && deletedMany === null && notice ? <Toast message={notice} onDismiss={dismissNotice} /> : null}
			{deleted ? (
				<Toast
					message={`${deleted.name} deleted.`}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={dismissUndo}
				/>
			) : null}
			{deletedMany ? (
				<Toast
					message={
						deletedMany.length === 1 ? `${deletedMany[0]!.name} deleted.` : `${deletedMany.length} clients deleted.`
					}
					actionLabel="Undo"
					onAction={() => void restoreMany()}
					onDismiss={() => setDeletedMany(null)}
				/>
			) : null}

			{confirmingDelete ? (
				<Dialog
					title={confirmingDelete.length === 1 ? "Delete 1 client?" : `Delete ${confirmingDelete.length} clients?`}
					width="narrow"
					onClose={() => setConfirmingDelete(null)}
				>
					<p className="mt-3 text-base">
						{confirmingDelete.length === 1 ? "The client is" : `${confirmingDelete.length} clients are`} removed
						from your list. You can undo this straight after.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingDelete(null)}>Cancel</Button>
						<Button variant="danger" onClick={() => void deleteSelected(confirmingDelete)}>
							Delete
						</Button>
					</div>
				</Dialog>
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
	/** Every client loaded, which the column filters offer their choices from. */
	allRows: ClientSummary[];
	/** The rows after the view's filters and sort, as drawn. */
	rows: ClientSummary[];
	/** The rows ticked. Once any is, a click ticks rather than opens. */
	held: ReadonlySet<string>;
	/** `extend` (Shift) ticks the run from the last row ticked. */
	onPick: (id: string, extend: boolean) => void;
	view: ClientView;
	onView: (view: ClientView) => void;
	selectedId: string | null;
	onSelect: (row: ClientSummary) => void;
	onEdit: (row: ClientSummary) => void;
	onAddNote: (row: ClientSummary) => void;
	onDelete: (row: ClientSummary) => void;
	onNewProject: (row: ClientSummary) => void;
	onSendMail: (row: ClientSummary) => void;
	/** The main process did what the menu asked, for example archiving. */
	onDone: (message: string | undefined) => void;
	onFailed: (message: string) => void;
};

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7.
 */
function ClientTable({
	allRows,
	rows,
	held,
	onPick,
	view,
	onView,
	selectedId,
	onSelect,
	onEdit,
	onAddNote,
	onDelete,
	onNewProject,
	onSendMail,
	onDone,
	onFailed,
}: ClientTableProps) {
	const visible = useGradualCount(rows.length);
	const hasSelection = held.size > 0;
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
	const menuFor = (row: ClientSummary) =>
		contextMenuFor(
			{ kind: "client", id: row.id },
			{
				open: () => onSelect(row),
				edit: () => onEdit(row),
				"new-note": () => onAddNote(row),
				"new-project": () => onNewProject(row),
				"send-mail": () => onSendMail(row),
				delete: () => onDelete(row),
				done: onDone,
				failed: onFailed,
			},
		);

	return (
		<>
			{/* Separate borders, so the header keeps its rule while it is stuck to the top. */}
			<table className="w-full border-separate border-spacing-0">
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
					{rows.slice(0, visible).map((row) => {
						const selected = row.id === selectedId;
						const checked = held.has(row.id);
						// Once anything is ticked, a click anywhere on a row ticks it
						// instead of opening it, the way the mail list does.
						const activate = (extend: boolean) => (hasSelection ? onPick(row.id, extend) : onSelect(row));
						return (
							<tr
								key={row.id}
								onClick={(event) => activate(event.shiftKey)}
								onContextMenu={menuFor(row)}
								className={`group transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
									selected || checked ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
								}`}
							>
								<td
									className="border-b border-[var(--line)]/60 px-3 text-dense"
									style={{ height: "var(--row-height-roomy)" }}
								>
									<div className="flex min-w-0 items-center gap-3">
										{/*
											The tick takes the avatar's place: under the pointer, on
											keyboard focus, and on every row once anything is ticked.
										*/}
										<span className="relative flex size-7 flex-none items-center justify-center">
											<span className={hasSelection ? "invisible" : "group-hover:invisible group-focus-within:invisible"}>
												<Avatar name={row.name} size={28} shape="square" />
											</span>
											<label
												onClick={(event) => event.stopPropagation()}
												className={[
													"absolute inset-0 flex cursor-pointer items-center justify-center",
													hasSelection ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
												].join(" ")}
											>
												<Checkbox
													checked={checked}
													onChange={(event) => onPick(row.id, (event.nativeEvent as MouseEvent).shiftKey)}
													aria-label={`Select ${row.name}`}
												/>
											</label>
										</span>
										<button
											type="button"
											aria-current={selected && !hasSelection ? "true" : undefined}
											aria-pressed={hasSelection ? checked : undefined}
											onClick={(event) => {
												// The row takes the same click; without this a tick would be
												// made and undone by one press.
												event.stopPropagation();
												activate(event.shiftKey);
											}}
											className="flex min-w-0 flex-1 items-center text-left"
										>
											<span className="truncate">{row.name}</span>
										</button>
									</div>
								</td>
								<td className="border-b border-[var(--line)]/60 px-3 text-dense">
									{row.status ? <StatusBadge label={row.status.label} tone={row.status.tone} /> : null}
								</td>
								<td className="border-b border-[var(--line)]/60 px-3 text-dense text-[var(--ink-muted)]">
									{row.city ?? ""}
								</td>
								<td className="tabular border-b border-[var(--line)]/60 px-3 text-right text-dense text-[var(--ink-muted)]">
									{row.openProjectCount} / {row.projectCount}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

		</>
	);
}

function Empty({
	searching,
	onAdd,
	onClearSearch,
}: {
	searching: boolean;
	onAdd: () => void;
	onClearSearch: () => void;
}) {
	if (searching) {
		return (
			<EmptyState
				title="No client matches that"
				description="Check the spelling or clear the search to see all of them."
				secondaryAction={{ label: "Clear search", onClick: onClearSearch }}
			/>
		);
	}

	return (
		<EmptyState
			icon="clients"
			title="No clients yet"
			description="Add your first client to start a record, a project or a document."
			action={{
				label: "Add client",
				icon: "add",
				onClick: onAdd,
			}}
		/>
	);
}

function ErrorNote({ message }: { message: string }) {
	return (
		<div className="border-l-2 border-[var(--risk)] pl-4">
			<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load clients.</p>
			<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
				{message}
			</p>
		</div>
	);
}
