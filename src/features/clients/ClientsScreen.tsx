import { useEffect, useState } from "react";
import type { ClientSummary } from "@shared/types";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: ClientSummary[] }
	| { status: "error"; message: string };

export function ClientsScreen() {
	const [search, setSearch] = useState("");
	const [load, setLoad] = useState<Load>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		// Debounced so typing does not fire a query per keystroke.
		const id = setTimeout(() => {
			window.bureau.clients
				.list({ search: search.trim() || undefined })
				.then((rows) => {
					if (!cancelled) setLoad({ status: "ready", rows });
				})
				.catch((error: unknown) => {
					if (!cancelled) {
						setLoad({
							status: "error",
							message: error instanceof Error ? error.message : String(error),
						});
					}
				});
		}, 150);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [search]);

	return (
		<div className="p-8">
			<div className="mb-6 flex max-w-[900px] items-center justify-between gap-4">
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

				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search clients"
					aria-label="Search clients"
					className="w-[280px] rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none"
				/>
			</div>

			<div className="max-w-[900px]">
				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<ErrorNote message={load.message} />
				) : load.rows.length === 0 ? (
					<Empty searching={search.trim().length > 0} />
				) : (
					<ClientTable rows={load.rows} />
				)}
			</div>
		</div>
	);
}

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7.
 */
function ClientTable({ rows }: { rows: ClientSummary[] }) {
	return (
		<table className="w-full border-collapse">
			<thead>
				<tr>
					{["Name", "Status", "City", "Projects"].map((head, i) => (
						<th
							key={head}
							className={[
								"border-b border-[var(--line)] px-3 pb-2 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]",
								i === 3 ? "text-right" : "text-left",
							].join(" ")}
						>
							{head}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={row.id} className="transition-colors hover:bg-[var(--hover)]">
						<td
							data-selectable
							className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]"
							style={{ height: "var(--row-height)" }}
						>
							{row.name}
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
				))}
			</tbody>
		</table>
	);
}

/** Tone is a token name, never a hex. See brand/BRAND.md section 5. */
const TONES: Record<string, string> = {
	ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
	warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
	risk: "bg-[var(--risk-soft)] text-[var(--risk)]",
	seal: "bg-[var(--seal-soft)] text-[var(--seal)]",
	accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
};

function StatusBadge({ label, tone }: { label: string; tone: string | null }) {
	const classes = (tone && TONES[tone]) || "bg-[var(--sunken)] text-[var(--ink-muted)]";
	return (
		<span
			className={`inline-block rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${classes}`}
		>
			{label}
		</span>
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
