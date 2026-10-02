import { useCallback, useEffect, useState } from "react";
import type {
	ReferenceItem,
	ReferenceSetKey,
	ReferenceSetWithItems,
	ResetUserItems,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { IconAction } from "../../components/IconAction";
import { StatusBadge } from "../../components/StatusBadge";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

type Pending =
	| { kind: "hide"; item: ReferenceItem; inUse: number }
	| { kind: "reset"; setKey: ReferenceSetKey | null; label: string }
	| { kind: "rename"; item: ReferenceItem }
	| { kind: "add"; setId: string; label: string };

export function ReferenceSection() {
	const [sets, setSets] = useState<ReferenceSetWithItems[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	// One set at a time. Four lists under each other was the whole page.
	const [selected, setSelected] = useState<ReferenceSetKey | null>(null);

	const refresh = useCallback(async () => {
		try {
			setSets(await window.juno.reference.listSets());
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.reference
			.listSets()
			.then((value) => {
				if (!cancelled) setSets(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function run(action: () => Promise<unknown>) {
		setError(null);
		try {
			await action();
			await refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	async function askToHide(item: ReferenceItem) {
		setError(null);
		try {
			const usage = await window.juno.reference.usage(item.id);
			setPending({ kind: "hide", item, inUse: usage.inUseBy });
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const current = sets?.find((entry) => entry.set.key === selected) ?? sets?.[0] ?? null;

	return (
		<Section
			title="Statuses and labels"
			anchor="reference"
			action={
				<Button
					size="dense"
					variant="danger"
					onClick={() => setPending({ kind: "reset", setKey: null, label: "everything" })}
				>
					Reset all
				</Button>
			}
			description="Removing a value hides it, so records that use it keep it."
		>
			{sets === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<div>
					<SetPicker sets={sets} selected={current?.set.key ?? null} onSelect={setSelected} />
					{current ? (
						<SetEditor
							key={current.set.id}
							entry={current}
							onHide={(item) => void askToHide(item)}
							onUnhide={(item) => void run(() => window.juno.reference.unhideItem(item.id))}
							onRename={(item) => setPending({ kind: "rename", item })}
							onAdd={() => setPending({ kind: "add", setId: current.set.id, label: current.set.label })}
							onReorder={(ordered) => void run(() => window.juno.reference.reorder(current.set.id, ordered))}
							onReset={() => setPending({ kind: "reset", setKey: current.set.key, label: current.set.label })}
						/>
					) : null}
				</div>
			)}

			<SectionError message={error} />

			{pending?.kind === "hide" ? (
				<HideDialog
					pending={pending}
					onClose={() => setPending(null)}
					onConfirm={() => {
						const id = pending.item.id;
						setPending(null);
						void run(() => window.juno.reference.hideItem(id));
					}}
				/>
			) : null}

			{pending?.kind === "reset" ? (
				<ResetDialog
					label={pending.label}
					onClose={() => setPending(null)}
					onConfirm={(userItems) => {
						const key = pending.setKey;
						setPending(null);
						void run(() =>
							key === null
								? window.juno.reference.resetAll(userItems)
								: window.juno.reference.resetSet(key, userItems),
						);
					}}
				/>
			) : null}

			{pending?.kind === "rename" ? (
				<NameDialog
					title="Rename"
					initial={pending.item.label}
					onClose={() => setPending(null)}
					onSubmit={(label) => {
						const id = pending.item.id;
						setPending(null);
						void run(() => window.juno.reference.updateItem(id, { label }));
					}}
				/>
			) : null}

			{pending?.kind === "add" ? (
				<NameDialog
					title={`Add to ${pending.label.toLowerCase()}`}
					initial=""
					onClose={() => setPending(null)}
					onSubmit={(label) => {
						const setId = pending.setId;
						setPending(null);
						void run(() => window.juno.reference.createItem({ setId, label }));
					}}
				/>
			) : null}
		</Section>
	);
}

type SetPickerProps = {
	sets: ReferenceSetWithItems[];
	selected: ReferenceSetKey | null;
	onSelect: (key: ReferenceSetKey) => void;
};

/** The lists as one row of tabs, each with how many values it shows. */
function SetPicker({ sets, selected, onSelect }: SetPickerProps) {
	return (
		<div
			role="tablist"
			aria-label="Which list"
			className="flex gap-0.5 rounded-[var(--radius-md)] bg-[var(--sunken)] p-0.5"
		>
			{sets.map((entry) => {
				const active = entry.set.key === selected;
				const shown = entry.items.filter((item) => item.hiddenAt === null).length;
				return (
					<button
						key={entry.set.id}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onSelect(entry.set.key)}
						className={[
							"flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 text-[length:var(--text-dense)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]",
							active
								? "bg-[var(--surface)] font-[var(--weight-medium)] text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]"
								: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						<span className="truncate">{entry.set.label}</span>
						<span className="tabular text-[length:var(--text-micro)] text-[var(--ink-muted)]">{shown}</span>
					</button>
				);
			})}
		</div>
	);
}

function SetEditor({
	entry,
	onHide,
	onUnhide,
	onRename,
	onAdd,
	onReorder,
	onReset,
}: {
	entry: ReferenceSetWithItems;
	onHide: (item: ReferenceItem) => void;
	onUnhide: (item: ReferenceItem) => void;
	onRename: (item: ReferenceItem) => void;
	onAdd: () => void;
	onReorder: (orderedIds: string[]) => void;
	onReset: () => void;
}) {
	const items = entry.items;
	const hiddenCount = items.filter((item) => item.hiddenAt !== null).length;

	function move(index: number, delta: number) {
		const next = [...items];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		const [moved] = next.splice(index, 1);
		next.splice(target, 0, moved!);
		onReorder(next.map((item) => item.id));
	}

	return (
		<div className="mt-5">
			<div className="flex items-center justify-between gap-4">
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{entry.set.description ?? `${items.length - hiddenCount} shown.`}
					{hiddenCount > 0 ? ` ${hiddenCount} hidden.` : ""}
				</p>
				<div className="flex flex-none gap-1">
					{entry.set.allowsCustomItems ? (
						<Button size="dense" onClick={onAdd}>
							<Icon name="add" size={14} />
							Add
						</Button>
					) : null}
					<Button size="dense" onClick={onReset}>
						Reset to default
					</Button>
				</div>
			</div>

			<ul className="mt-3 border-t border-[var(--line)]">
				{items.map((item, index) => {
					const hidden = item.hiddenAt !== null;
					return (
						<li
							key={item.id}
							style={{ minHeight: "var(--row-height)" }}
							className={`flex items-center justify-between gap-3 border-b text-[length:var(--text-dense)] hover:bg-[var(--hover)] ${
								hidden ? "border-dashed border-[var(--line)] opacity-70" : "border-[var(--line)]"
							}`}
						>
							<span className="flex min-w-0 items-center gap-2 pl-1">
								<StatusBadge label={item.label} tone={item.tone} />
								{hidden ? (
									<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										Hidden. Records that use it still show it.
									</span>
								) : null}
								{item.isSystem ? null : (
									<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">Yours</span>
								)}
							</span>

							<span className="flex shrink-0 items-center">
								<IconAction
									icon="move-up"
									label={`Move ${item.label} up`}
									disabled={index === 0}
									onClick={() => move(index, -1)}
								/>
								<IconAction
									icon="move-down"
									label={`Move ${item.label} down`}
									disabled={index === items.length - 1}
									onClick={() => move(index, 1)}
								/>
								<IconAction icon="edit" label={`Rename ${item.label}`} onClick={() => onRename(item)} />
								{hidden ? (
									<Button size="dense" onClick={() => onUnhide(item)}>
										Bring back
									</Button>
								) : (
									<IconAction icon="remove" danger label={`Remove ${item.label}`} onClick={() => onHide(item)} />
								)}
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function HideDialog({
	pending,
	onClose,
	onConfirm,
}: {
	pending: { item: ReferenceItem; inUse: number };
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { item, inUse } = pending;
	return (
		<Dialog title={`Remove ${item.label}`} onClose={onClose} width="narrow">
			<p className="text-[length:var(--text-base)]">
				{inUse > 0
					? `${inUse} record${inUse === 1 ? "" : "s"} still use this. Those records keep it and
						carry on showing it. It just stops being offered for new ones.`
					: "It stops being offered for new records. Nothing else changes."}
			</p>
			<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				You can bring it back here at any time.
			</p>
			<div className="mt-5 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="danger" onClick={onConfirm}>
					Remove
				</Button>
			</div>
		</Dialog>
	);
}

function ResetDialog({
	label,
	onClose,
	onConfirm,
}: {
	label: string;
	onClose: () => void;
	onConfirm: (userItems: ResetUserItems) => void;
}) {
	const [userItems, setUserItems] = useState<ResetUserItems>("keep");
	return (
		<Dialog title={`Reset ${label}`} onClose={onClose} width="narrow">
			<p className="text-[length:var(--text-base)]">
				Values that ship with Juno go back to their original names and order, and any you
				removed come back.
			</p>

			<fieldset className="mt-4">
				<legend className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Values you added yourself
				</legend>
				<div className="mt-2 flex flex-col gap-2">
					{(
						[
							["keep", "Keep them", "They stay exactly as they are."],
							["remove", "Remove them", "They are deleted. Records using one keep it."],
						] as const
					).map(([value, title, hint]) => (
						<label key={value} className="flex cursor-default items-start gap-3">
							<input
								type="radio"
								name="userItems"
								checked={userItems === value}
								onChange={() => setUserItems(value)}
								className="mt-1 accent-[var(--accent)]"
							/>
							<span>
								<span className="block">{title}</span>
								<span className="block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{hint}
								</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>

			<div className="mt-5 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="danger" onClick={() => onConfirm(userItems)}>
					Reset
				</Button>
			</div>
		</Dialog>
	);
}

function NameDialog({
	title,
	initial,
	onClose,
	onSubmit,
}: {
	title: string;
	initial: string;
	onClose: () => void;
	onSubmit: (label: string) => void;
}) {
	const [label, setLabel] = useState(initial);
	const trimmed = label.trim();

	return (
		<Dialog title={title} onClose={onClose} width="narrow">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (trimmed) onSubmit(trimmed);
				}}
			>
				<Field label="Name" value={label} onChange={setLabel} required />
				<div className="mt-5 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={trimmed.length === 0}>
						Save
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
