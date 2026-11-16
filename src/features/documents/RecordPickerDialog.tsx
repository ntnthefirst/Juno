import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { RowsSkeleton } from "../../components/RowsSkeleton";
import { messageOf } from "../../lib/errors";
import { listAllClients } from "../../lib/list-all-clients";
import { placeOptions, type PlaceOption } from "./place-options";

type RecordPickerDialogProps = {
	title: string;
	/** "Move here", "Copy here". */
	confirmLabel: string;
	/** Where the thing is now, by its option key (`files`, `client:<id>`, `project:<id>`), offered but not as the answer. */
	current: string | null;
	onClose: () => void;
	onPick: (place: PlaceOption) => void;
};

type Load = { status: "loading" } | { status: "ready"; options: PlaceOption[] } | { status: "error"; message: string };

/**
 * Where to copy or move a document to: Files, every client with its projects
 * under it, then the projects of your own, with a filter for a long list. It is a
 * question with two answers, so it is a dialog; the list inside it is the only
 * thing that needs room.
 */
export function RecordPickerDialog({ title, confirmLabel, current, onClose, onPick }: RecordPickerDialogProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [chosen, setChosen] = useState<string | null>(null);
	const [filter, setFilter] = useState("");

	useEffect(() => {
		let cancelled = false;
		Promise.all([listAllClients(), window.juno.projects.list()])
			.then(([clients, projects]) => {
				if (!cancelled) setLoad({ status: "ready", options: placeOptions(clients, projects) });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const rows = useMemo(() => {
		const all = load.status === "ready" ? load.options : [];
		const needle = filter.trim().toLocaleLowerCase();
		return needle ? all.filter((option) => `${option.name} ${option.clientName ?? ""}`.toLocaleLowerCase().includes(needle)) : all;
	}, [load, filter]);

	const picked = rows.find((option) => option.key === chosen) ?? null;

	return (
		<Dialog title={title} onClose={onClose}>
			<label className="mt-3 flex h-[36px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 text-[var(--ink-muted)] focus-within:border-[var(--focus)]">
				<Icon name="search" size={14} />
				<input
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					placeholder="Find a client or project"
					aria-label="Find a client or project"
					className="min-w-0 flex-1 bg-transparent text-dense text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
				/>
			</label>
			<ul role="listbox" aria-label="Clients and projects" className="mt-3 h-[320px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line)] p-1">
				{load.status === "loading" ? (
					<li>
						<RowsSkeleton rows={6} avatar divided={false} trailing={false} label="Loading the clients and projects" />
					</li>
				) : load.status === "error" ? (
					<li role="alert" className="p-4 text-sm text-[var(--risk)]">
						{load.message}
					</li>
				) : rows.length === 0 ? (
					<li className="p-4 text-sm text-[var(--ink-muted)]">
						{filter.trim() ? "Nothing is called that." : "There are no clients or projects yet. Make one first."}
					</li>
				) : (
					rows.map((option) => {
						const here = option.key === current;
						const selected = option.key === chosen;
						return (
							<li key={option.key}>
								<button
									type="button"
									role="option"
									aria-selected={selected}
									disabled={here}
									onClick={() => setChosen(option.key)}
									onDoubleClick={() => !here && onPick(option)}
									style={{ height: "var(--row-height)", paddingLeft: 8 + (filter.trim() ? 0 : option.depth * 16) }}
									className={`flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] pr-2 text-left text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)] disabled:opacity-50 ${
										selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
									}`}
								>
									{option.kind === "files" ? (
										<span className="flex w-[18px] flex-none justify-center text-[var(--accent)]">
											<Icon name="documents" size={16} />
										</span>
									) : (
										<Avatar name={option.name} size={18} shape="square" />
									)}
									<span className="min-w-0 flex-1 truncate">{option.name}</span>
									{filter.trim() && option.clientName ? (
										<span className="min-w-0 flex-none truncate text-micro text-[var(--ink-muted)]">{option.clientName}</span>
									) : null}
									{here ? <span className="flex-none text-micro text-[var(--ink-muted)]">Here now</span> : null}
								</button>
							</li>
						);
					})
				)}
			</ul>
			<div className="mt-6 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="primary" disabled={!picked} onClick={() => picked && onPick(picked)}>
					{confirmLabel}
				</Button>
			</div>
		</Dialog>
	);
}
