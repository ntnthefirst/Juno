import { useCallback, useEffect, useState } from "react";
import type { Client, ClientSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Toast } from "../../components/Toast";
import { ClientDetail, StatusBadge } from "./ClientDetail";
import { ClientForm } from "./ClientForm";

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
	const [form, setForm] = useState<{ client: Client | null } | null>(null);
	const [deleted, setDeleted] = useState<Client | null>(null);

	const fetchRows = useCallback(
		() => window.bureau.clients.list({ search: search.trim() || undefined }),
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
			const removed = await window.bureau.clients.remove(client.id);
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
			await window.bureau.clients.restore(id);
			setSelectedId(id);
			setDetailVersion((version) => version + 1);
			refreshList();
		} catch (error: unknown) {
			setLoad({ status: "error", message: messageOf(error) });
		}
	}

	const split = selectedId !== null;

	return (
		<div className="flex h-full flex-col p-8">
			<div
				className={`mb-6 flex items-center justify-between gap-4 ${split ? "" : "max-w-[900px]"}`}
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
							: "max-w-[900px] flex-1 overflow-y-auto"
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
						/>
					</div>
				) : null}
			</div>

			{form ? (
				<ClientForm client={form.client} onClose={() => setForm(null)} onSaved={saved} />
			) : null}

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
