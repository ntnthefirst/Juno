import { useCallback, useEffect, useState } from "react";
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientPhone,
	ClientSummary,
	Contact,
	Project,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Toast } from "../../components/Toast";
import { ClientAddressPanel } from "./ClientAddressPanel";
import { ClientDetail, StatusBadge } from "./ClientDetail";
import { ClientEmailPanel } from "./ClientEmailPanel";
import { ClientForm } from "./ClientForm";
import { ClientPhonePanel } from "./ClientPhonePanel";
import { ContactForm } from "./ContactForm";
import { ProjectForm } from "./ProjectForm";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: ClientSummary[] }
	| { status: "error"; message: string };

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function ClientsScreen() {
	const [search, setSearch] = useState("");
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [selectedId, setSelectedId] = useState<string | null>(null);
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

	function saved(client: Client) {
		setForm(null);
		setSelectedId(client.id);
		// Remounts the detail pane, which is how it picks up an edit made here.
		setDetailVersion((version) => version + 1);
		refreshList();
	}

	async function remove(client: Client) {
		try {
			const removed = await window.juno.clients.remove(client.id);
			setSelectedId(null);
			setDeleted(removed);
			refreshList();
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	async function restore() {
		if (!deleted) return;
		const id = deleted.id;
		setDeleted(null);
		try {
			await window.juno.clients.restore(id);
			setSelectedId(id);
			setDetailVersion((version) => version + 1);
			refreshList();
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	const split = selectedId !== null;

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

	return (
		<div className="flex h-full flex-col p-8">
			<div
				className={`mb-6 flex items-center justify-between gap-4 ${split ? "" : "mx-auto w-full max-w-[var(--content-width)]"}`}
			>
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

			<div className="flex min-h-0 flex-1">
				<div
					className={
						split
							? "w-[420px] shrink-0 overflow-y-auto border-r border-[var(--line)] pr-6"
							: "mx-auto w-full max-w-[var(--content-width)] flex-1 overflow-y-auto"
					}
				>
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
							compact={split}
							onSelect={setSelectedId}
						/>
					)}
				</div>

				{selectedId !== null ? (
					<div className="min-w-0 flex-1 overflow-y-auto pl-6">
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
						/>
					</div>
				) : null}

				{emailPanel && selectedId ? (
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

				{phonePanel && selectedId ? (
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

				{addressPanel && selectedId ? (
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
			</div>


			{deleted ? (
				<Toast
					message={`${deleted.name} deleted.`}
					actionLabel="Undo"
					onAction={() => void restore()}
					onDismiss={dismissUndo}
				/>
			) : null}
		</div>
	);
}

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7.
 */
function ClientTable({
	rows,
	selectedId,
	compact,
	onSelect,
}: {
	rows: ClientSummary[];
	selectedId: string | null;
	compact: boolean;
	onSelect: (id: string) => void;
}) {
	const heads = compact ? ["Name", "Status"] : ["Name", "Status", "City", "Projects"];

	return (
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
							onClick={() => onSelect(row.id)}
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
									onClick={() => onSelect(row.id)}
									className="block w-full truncate text-left"
								>
									{row.name}
								</button>
							</td>
							<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]">
								{row.status ? <StatusBadge label={row.status.label} tone={row.status.tone} /> : null}
							</td>
							{compact ? null : (
								<>
									<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
										{row.city ?? ""}
									</td>
									<td className="tabular border-b border-[var(--line)] px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
										{row.openProjectCount} / {row.projectCount}
									</td>
								</>
							)}
						</tr>
					);
				})}
			</tbody>
		</table>
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
