import { useCallback, useEffect, useState } from "react";
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientNote,
	ClientNoteKind,
	ClientPhone,
	ClientSummary,
	Contact,
	Project,
} from "@shared/types";
import type { Crumb } from "../../app/breadcrumb-context";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { Button } from "../../components/Button";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { useContextMenu } from "../../lib/use-context-menu";
import { ClientAddressPanel } from "./ClientAddressPanel";
import { StatusBadge } from "../../components/StatusBadge";
import { ClientDetail } from "./ClientDetail";
import { ClientEmailPanel } from "./ClientEmailPanel";
import { ClientForm } from "./ClientForm";
import { ClientNotePanel } from "./ClientNotePanel";
import { ClientPhonePanel } from "./ClientPhonePanel";
import { ContactForm } from "./ContactForm";
import { ProjectForm } from "./ProjectForm";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: ClientSummary[] }
	| { status: "error"; message: string };

export function ClientsScreen() {
	const [search, setSearch] = useState("");
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Held alongside the id so the title bar has a name to show the moment a row
	// is clicked, with no fetch and no flash of a stale label. A save that
	// renames the client corrects it through `saved`, which is the only other
	// place the full row comes back from the main process.
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [detailVersion, setDetailVersion] = useState(0);
	const bumpDetail = () => setDetailVersion((current) => current + 1);
	const [form, setForm] = useState<{ client: Client | null } | null>(null);
	// Contacts and projects belong to the open client, and they are filled in on
	// a page of their own, so the state sits here rather than in the detail pane
	// that is too narrow to hold one.
	const [contactForm, setContactForm] = useState<{ contact: Contact | null } | null>(null);
	const [projectForm, setProjectForm] = useState<{ project: Project | null } | null>(null);
	// Unlike contacts and projects, these are small enough to edit in a side
	// panel next to the detail pane rather than taking over the screen.
	const [emailPanel, setEmailPanel] = useState<{ email: ClientEmail | null } | null>(null);
	const [phonePanel, setPhonePanel] = useState<{ phone: ClientPhone | null } | null>(null);
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
		setSelectedId(row.id);
		setSelectedName(row.name);
	}

	function backToList() {
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
			if (form || contactForm || projectForm) return;
			if (emailPanel || phonePanel || addressPanel || notePanel) return;
			if (document.querySelector("[role='dialog']")) return;
			backToList();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedId, form, contactForm, projectForm, emailPanel, phonePanel, addressPanel, notePanel]);

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

	if (projectForm && selectedId) {
		return (
			<ProjectForm
				clientId={selectedId}
				project={projectForm.project}
				onClose={() => setProjectForm(null)}
				onSaved={() => {
					setProjectForm(null);
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
							onEditEmail={(email) => setEmailPanel({ email })}
							onEditPhone={(phone) => setPhonePanel({ phone })}
							onEditAddress={(address) => setAddressPanel({ address })}
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
					<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
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
					<Button variant="primary" onClick={() => setForm({ client: null })}>
						New client
					</Button>
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
						rows={load.rows}
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
	rows: ClientSummary[];
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
function ClientTable({ rows, selectedId, onSelect, onEdit, onAddNote, onDelete }: ClientTableProps) {
	const heads = ["Name", "Status", "City", "Projects"];
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
						{heads.map((head) => (
							<th
								key={head}
								className={[
									"border-b border-[var(--line)] px-3 pb-2 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]",
									head === "Projects" ? "text-right" : "text-left",
								].join(" ")}
							>
								{head}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
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
									className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]"
									style={{ height: "var(--row-height)" }}
								>
									<button
										type="button"
										aria-current={selected ? "true" : undefined}
										onClick={() => onSelect(row)}
										className="block w-full truncate text-left"
									>
										{row.name}
									</button>
								</td>
								<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]">
									{row.status ? <StatusBadge label={row.status.label} tone={row.status.tone} /> : null}
								</td>
								<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									{row.city ?? ""}
								</td>
								<td className="tabular border-b border-[var(--line)] px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
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
