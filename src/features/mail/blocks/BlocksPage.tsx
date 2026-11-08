import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ComposeBlock, ComposeBlockKind, ComposeBlockRule } from "@shared/types";
import { Button } from "../../../components/Button";
import { Dialog } from "../../../components/Dialog";
import { Field } from "../../../components/Field";
import { Icon } from "../../../components/Icon";
import { Segmented } from "../../../components/Segmented";
import { usePublishBreadcrumb } from "../../../app/breadcrumb-context";
import { messageOf } from "../../../lib/errors";
import { useLoaded } from "../../../lib/use-loaded";
import type { ManageTarget } from "./BlockMenu";
import {
	KIND_LABEL,
	moveBefore,
	moveBy,
	RULE_CHOICES,
	RULE_DESCRIPTION,
} from "./block-text";

type BlocksPageProps = {
	/** What was asked for: a block, a new one of a kind, or just the list. */
	target: ManageTarget;
	/** Back to the mail screen. */
	onBack: () => void;
};

/** The block being edited: a saved one, or one that does not exist yet. */
type Selection = { id: string } | { newKind: ComposeBlockKind };

const KINDS: ComposeBlockKind[] = ["intro", "outro"];
const DRAG_TYPE = "application/x-juno-mail-block";

const OVERLINE = "mb-1.5 block text-overline text-[var(--ink-muted)] uppercase";

function selectionFor(target: ManageTarget): Selection | null {
	if (target && "blockId" in target) return { id: target.blockId };
	if (target && "newKind" in target) return { newKind: target.newKind };
	return null;
}

/**
 * The page for keeping intros and outros: the blocks on the left, grouped and in
 * the order that decides which one wins, and the one being edited on the right.
 * Dragging a row changes the order, and so does Alt with the arrow keys.
 */
export function BlocksPage({ target, onBack }: BlocksPageProps) {
	const load = useCallback(() => window.juno.mail.blocks.list(), []);
	const loaded = useLoaded(load);
	const blocks = useMemo(() => (loaded.status === "ready" ? loaded.value : []), [loaded]);
	const { reload } = loaded;

	const [chosen, setChosen] = useState<Selection | null>(() => selectionFor(target));
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);

	// Nothing asked for lands on the first block, without an effect to say so.
	const selection: Selection | null = chosen ?? (blocks[0] ? { id: blocks[0].id } : null);
	const current = selection && "id" in selection ? (blocks.find((block) => block.id === selection.id) ?? null) : null;

	async function reorder(blockKind: ComposeBlockKind, ids: string[]) {
		try {
			await window.juno.mail.blocks.reorder(blockKind, ids);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
		reload();
	}

	// The way back is in the title bar, as the design draws it, and Escape does
	// the same thing.
	usePublishBreadcrumb([{ label: "Mail", onSelect: onBack }, { label: "Intros and outros" }]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			onBack();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onBack]);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 pt-6 pb-6">
			<header className="mb-6 flex flex-none items-start justify-between gap-6">
				<div className="min-w-0">
					<h1 className="text-h2">Intros and outros</h1>
					<p className="mt-1 max-w-[90ch] text-base text-[var(--ink-muted)]">
						Lines added at the start and end of a mail. Each one has a rule for when it is added for you.
					</p>
				</div>
				<Button variant="primary" onClick={() => setChosen({ newKind: "intro" })}>
					New block
				</Button>
			</header>
			{loaded.status === "error" ? (
				<p role="alert" className="mb-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					{loaded.message}
				</p>
			) : null}
			{error ? (
				<p role="alert" data-selectable className="mb-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					{error}
				</p>
			) : null}

			<div className="grid min-h-[520px] flex-1 grid-cols-[minmax(240px,360px)_minmax(0,1fr)] gap-6">
				<nav
					aria-label="Intros and outros"
					className="flex min-h-0 flex-col rounded-[var(--radius-lg)] border border-[var(--line)] p-3"
				>
					{KINDS.map((group) => {
						const rows = blocks.filter((block) => block.kind === group);
						return (
							<section key={group} aria-label={KIND_LABEL[group]} className="mb-2">
								<h2 className="px-2 pt-2 pb-1 text-overline text-[var(--ink-muted)] uppercase">
									{KIND_LABEL[group]}
								</h2>
								{rows.length === 0 ? (
									<p className="px-2 py-1 text-sm text-[var(--ink-muted)]">No {group}s yet.</p>
								) : null}
								<ul>
									{rows.map((block) => (
										<BlockRow
											key={block.id}
											block={block}
											selected={current?.id === block.id}
											dragging={dragging === block.id}
											over={over === block.id && dragging !== null && dragging !== block.id}
											onSelect={() => setChosen({ id: block.id })}
											onDragStart={(event) => {
												event.dataTransfer.setData(DRAG_TYPE, block.id);
												event.dataTransfer.effectAllowed = "move";
												setDragging(block.id);
											}}
											onDragEnd={() => {
												setDragging(null);
												setOver(null);
											}}
											onDragOver={(event) => {
												const source = blocks.find((item) => item.id === dragging);
												if (!source || source.kind !== group) return;
												event.preventDefault();
												setOver(block.id);
											}}
											onDrop={(event) => {
												event.preventDefault();
												const source = event.dataTransfer.getData(DRAG_TYPE);
												setDragging(null);
												setOver(null);
												const ids = rows.map((row) => row.id);
												const next = moveBefore(ids, source, block.id);
												if (next.join() !== ids.join()) void reorder(group, next);
											}}
											onMove={(step) => {
												const ids = rows.map((row) => row.id);
												const next = moveBy(ids, block.id, step);
												if (next.join() !== ids.join()) void reorder(group, next);
											}}
										/>
									))}
								</ul>
							</section>
						);
					})}
				</nav>

				<section
					aria-label="Edit"
					className="flex min-h-0 flex-col rounded-[var(--radius-lg)] border border-[var(--line)] p-6"
				>
					{selection === null || (current === null && "id" in selection) ? (
						<p className="text-[var(--ink-muted)]">Pick a block to edit it, or add one with New block.</p>
					) : (
						<BlockEditor
							// A saved block is reloaded into the form when it is saved elsewhere, and
							// a different row starts from its own text.
							key={current ? `${current.id}:${current.updatedAt}` : `new:${"newKind" in selection ? selection.newKind : ""}`}
							block={current}
							newKind={"newKind" in selection ? selection.newKind : null}
							onSaved={(id) => {
								setChosen({ id });
								reload();
							}}
							onDeleted={() => {
								const next = blocks.find((block) => block.id !== current?.id);
								setChosen(next ? { id: next.id } : null);
								reload();
							}}
						/>
					)}
				</section>
			</div>
		</div>
	);
}

type BlockEditorProps = {
	/** The saved block, or null while writing a new one. */
	block: ComposeBlock | null;
	newKind: ComposeBlockKind | null;
	onSaved: (id: string) => void;
	onDeleted: () => void;
};

function BlockEditor({ block, newKind, onSaved, onDeleted }: BlockEditorProps) {
	const [kind, setKind] = useState<ComposeBlockKind>(block?.kind ?? newKind ?? "intro");
	const [name, setName] = useState(block?.name ?? "");
	const [body, setBody] = useState(block?.body ?? "");
	const [rule, setRule] = useState<ComposeBlockRule>(block?.rule ?? "manual");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const textId = useId();

	const dirty = block
		? name !== block.name || body !== block.body || rule !== block.rule
		: name.trim() !== "" || body.trim() !== "";
	const canSave = name.trim() !== "" && body.trim() !== "" && (block === null || dirty) && !busy;

	async function save() {
		if (!canSave) return;
		setBusy(true);
		setError(null);
		try {
			const saved = block
				? await window.juno.mail.blocks.update(block.id, { name, body, rule })
				: await window.juno.mail.blocks.create({ kind, name, body, rule });
			onSaved(saved.id);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (!block) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.mail.blocks.remove(block.id);
			onDeleted();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setConfirmDelete(false);
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<div className="flex flex-col gap-5">
				{block === null ? (
					<div>
						<span className={OVERLINE}>Kind</span>
						<Segmented
							label="Kind"
							value={kind}
							onChange={setKind}
							options={[
								{ id: "intro", label: "Intro" },
								{ id: "outro", label: "Outro" },
							]}
						/>
					</div>
				) : null}

				<Field label="Name" value={name} onChange={setName} />

				<div>
					<label htmlFor={textId} className={OVERLINE}>
						Text
					</label>
					{/* Plain text, as the client reads it. An older block may still hold a
					    {{name}} token from when blocks had variables; it is filled in as before. */}
					<textarea
						id={textId}
						value={body}
						rows={1}
						onChange={(event) => setBody(event.target.value)}
						className="min-h-10 w-full resize-none rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] [field-sizing:content] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]"
					/>
				</div>

				<div>
					<span className={OVERLINE}>When to add it</span>
					<div role="radiogroup" aria-label="When to add it" className="flex flex-col">
						{RULE_CHOICES.map((choice) => (
							<button
								key={choice.rule}
								type="button"
								role="radio"
								aria-checked={rule === choice.rule}
								onClick={() => setRule(choice.rule)}
								className="flex h-9 items-center gap-3 rounded-[var(--radius-md)] text-left text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<span
									aria-hidden
									className={[
										"flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)] border-[1.5px] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
										rule === choice.rule
											? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
											: "border-[var(--line-strong)] bg-[var(--surface)] text-transparent",
									].join(" ")}
								>
									<Icon name="check" size={16} strokeWidth={2.5} />
								</span>
								{choice.label}
							</button>
						))}
					</div>
					<p className="mt-2 max-w-[62ch] text-sm text-[var(--ink-muted)]">
						You can still change or remove it in the mail. An intro or outro never sends anything by itself.
					</p>
				</div>

				{error ? (
					<p role="alert" data-selectable className="border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
						{error}
					</p>
				) : null}
			</div>

			<div className="mt-auto flex items-center justify-between pt-6">
				{block ? (
					<Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
						Delete
					</Button>
				) : (
					<span />
				)}
				<Button variant="primary" disabled={!canSave} onClick={() => void save()}>
					{busy ? "Saving" : "Save"}
				</Button>
			</div>

			{confirmDelete && block ? (
				<Dialog title={`Delete ${block.name}?`} onClose={() => setConfirmDelete(false)} width="narrow">
					<p className="text-[var(--ink)]">
						This removes the {block.kind} from the list. Mails that already contain its text keep it.
					</p>
					<div className="mt-4 flex justify-end gap-2">
						<Button disabled={busy} onClick={() => setConfirmDelete(false)}>
							Cancel
						</Button>
						<Button variant="danger" disabled={busy} onClick={() => void remove()}>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</>
	);
}

type BlockRowProps = {
	block: ComposeBlock;
	selected: boolean;
	dragging: boolean;
	over: boolean;
	onSelect: () => void;
	onDragStart: (event: React.DragEvent) => void;
	onDragEnd: () => void;
	onDragOver: (event: React.DragEvent) => void;
	onDrop: (event: React.DragEvent) => void;
	onMove: (step: -1 | 1) => void;
};

function BlockRow({
	block,
	selected,
	dragging,
	over,
	onSelect,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
	onMove,
}: BlockRowProps) {
	return (
		<li
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragOver={onDragOver}
			onDrop={onDrop}
			className={`relative ${dragging ? "opacity-50" : ""}`}
		>
			{over ? <span aria-hidden className="absolute -top-px right-2 left-2 h-0.5 rounded-[var(--radius-full)] bg-[var(--accent)]" /> : null}
			<button
				type="button"
				aria-current={selected ? "true" : undefined}
				onClick={onSelect}
				onKeyDown={(event) => {
					if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
					event.preventDefault();
					onMove(event.key === "ArrowUp" ? -1 : 1);
				}}
				className={[
					"flex w-full cursor-grab flex-col items-start rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
					selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
				].join(" ")}
			>
				<span className="text-base font-[var(--weight-medium)]">{block.name}</span>
				<span className="text-sm text-[var(--ink-muted)]">{RULE_DESCRIPTION[block.rule]}</span>
			</button>
		</li>
	);
}
