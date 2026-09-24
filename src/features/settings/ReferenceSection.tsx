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

	return (
		<Section
			title="Statuses and labels"
			action={
				<Button
					size="dense"
					variant="danger"
					onClick={() => setPending({ kind: "reset", setKey: null, label: "everything" })}
				>
					Reset all
				</Button>
			}
			description="Juno ships with sensible defaults so it works before it is configured. Removing a value that ships hides it rather than deleting it, because records already point at it. Hidden values stay listed here so you can bring them back."
		>
			{sets === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<div className="flex flex-col gap-10">
					{sets.map((entry) => (
						<SetEditor
							key={entry.set.id}
							entry={entry}
							onHide={(item) => void askToHide(item)}
							onUnhide={(item) => void run(() => window.juno.reference.unhideItem(item.id))}
							onRename={(item) => setPending({ kind: "rename", item })}
							onAdd={() =>
								setPending({ kind: "add", setId: entry.set.id, label: entry.set.label })
							}
							onReorder={(ordered) =>
								void run(() => window.juno.reference.reorder(entry.set.id, ordered))
							}
							onReset={() =>
								setPending({ kind: "reset", setKey: entry.set.key, label: entry.set.label })
							}
						/>
					))}
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

	function move(index: number, delta: number) {
		const next = [...items];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		const [moved] = next.splice(index, 1);
		next.splice(target, 0, moved!);
		onReorder(next.map((item) => item.id));
	}

	return (
		<div>
			<div className="flex items-baseline justify-between gap-4">
				<h3 className="font-[var(--weight-medium)]">{entry.set.label}</h3>
				<div className="flex gap-1">
					{entry.set.allowsCustomItems ? (
						<Button size="dense" onClick={onAdd}>
							Add
						</Button>
					) : null}
					<Button size="dense" onClick={onReset}>
						Reset to default
					</Button>
				</div>
			</div>

			<ul className="mt-2">
				{items.map((item, index) => {
					const hidden = item.hiddenAt !== null;
					return (
						<li
							key={item.id}
							className={`flex items-center justify-between gap-3 border-b py-2 text-[length:var(--text-dense)] ${
								hidden ? "border-dashed border-[var(--line)]" : "border-[var(--line)]"
							}`}
						>
							<span className="flex min-w-0 items-center gap-2">
								<StatusBadge label={item.label} tone={item.tone} />
								{hidden ? (
									<span className="text-[length:var(--text-micro)] text-[var(--ink-faint)]">
										Hidden, still shown on records that use it
									</span>
								) : null}
								{item.isSystem ? null : (
									<span className="text-[length:var(--text-micro)] text-[var(--ink-faint)]">
										Yours
									</span>
								)}
							</span>

							<span className="flex shrink-0 gap-1">
								<Button
									size="dense"
									disabled={index === 0}
									aria-label={`Move ${item.label} up`}
									onClick={() => move(index, -1)}
								>
									Up
								</Button>
								<Button
									size="dense"
									disabled={index === items.length - 1}
									aria-label={`Move ${item.label} down`}
									onClick={() => move(index, 1)}
								>
									Down
								</Button>
								<Button size="dense" onClick={() => onRename(item)}>
									Rename
								</Button>
								{hidden ? (
									<Button size="dense" onClick={() => onUnhide(item)}>
										Bring back
									</Button>
								) : (
									<Button size="dense" variant="danger" onClick={() => onHide(item)}>
										Remove
									</Button>
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
				This hides the value rather than deleting it. You can bring it back here at any time.
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
