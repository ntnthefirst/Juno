import { useMemo, useState } from "react";
import type { DocumentTreeNode } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { holds, visibleRows } from "./explorer-tree";

type PlacePickerDialogProps = {
	title: string;
	/** "Move here", "Copy here". */
	confirmLabel: string;
	roots: DocumentTreeNode[];
	/** A node that cannot be picked, with everything below it: the folder being moved. */
	exclude?: string;
	/** Where the thing is now, picked to start with and not offered as the answer. */
	current: string | null;
	onClose: () => void;
	onPick: (node: DocumentTreeNode) => void;
};

/** Every key in the tree, so the picker shows it all open. */
function allKeys(nodes: readonly DocumentTreeNode[], into = new Set<string>()): Set<string> {
	for (const node of nodes) {
		into.add(node.key);
		allKeys(node.children, into);
	}
	return into;
}

/**
 * Where to copy or move something to: the tree, all of it open, with a filter
 * for a long one. It is a question with two answers, so it is a dialog; the
 * tree inside it is the only thing that needs room.
 */
export function PlacePickerDialog({ title, confirmLabel, roots, exclude, current, onClose, onPick }: PlacePickerDialogProps) {
	const [chosen, setChosen] = useState<string | null>(null);
	const [filter, setFilter] = useState("");

	const rows = useMemo(() => {
		const places = roots.filter((node) => node.place !== null);
		const all = visibleRows(places, allKeys(places), 0);
		const excluded = exclude ? all.find((row) => row.node.key === exclude)?.node : undefined;
		const needle = filter.trim().toLocaleLowerCase();
		return all.filter(
			(row) => !(excluded && holds(excluded, row.node.key)) && (!needle || row.node.name.toLocaleLowerCase().includes(needle)),
		);
	}, [roots, exclude, filter]);

	const picked = rows.find((row) => row.node.key === chosen)?.node ?? null;

	return (
		<Dialog title={title} onClose={onClose}>
			<label className="mt-3 flex h-[36px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 text-[var(--ink-muted)] focus-within:border-[var(--focus)]">
				<Icon name="search" size={14} />
				<input
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					placeholder="Find a client, project or folder"
					aria-label="Find a client, project or folder"
					className="min-w-0 flex-1 bg-transparent text-dense text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
				/>
			</label>
			<ul role="listbox" aria-label="Places" className="mt-3 h-[320px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line)] p-1">
				{rows.length === 0 ? (
					<li className="p-4 text-sm text-[var(--ink-muted)]">Nothing is called that.</li>
				) : (
					rows.map(({ node, depth }) => {
						const here = node.key === current;
						const selected = node.key === chosen;
						return (
							<li key={node.key}>
								<button
									type="button"
									role="option"
									aria-selected={selected}
									disabled={here}
									onClick={() => setChosen(node.key)}
									onDoubleClick={() => !here && onPick(node)}
									style={{ height: "var(--row-height)", paddingLeft: 8 + (filter.trim() ? 0 : depth * 16) }}
									className={`flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] pr-2 text-left text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)] disabled:opacity-50 ${
										selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
									}`}
								>
									{node.kind === "client" || node.kind === "project" ? (
										<Avatar name={node.name} size={18} shape="square" />
									) : (
										<span className="text-[var(--accent)]">
											<Icon name={node.kind === "unfiled" ? "inbox" : "folder"} size={16} />
										</span>
									)}
									<span className="min-w-0 flex-1 truncate">{node.name}</span>
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
