import { useState } from "react";
import type { DragEvent } from "react";
import type { MailFolder, MailRule } from "@shared/types";
import { summariseRule } from "@shared/mail-rules";
import { Button } from "../../../components/Button";
import { Dialog } from "../../../components/Dialog";
import { IconButton } from "../../../components/IconButton";
import { Toggle } from "../../../components/Toggle";
import { messageOf } from "../../../lib/errors";
import { moveBefore, moveBy } from "../../mail/blocks/block-text";
import { SectionError } from "../Section";

type AccountRulesProps = {
	accountId: string;
	rules: MailRule[] | null;
	folders: MailFolder[];
	onEdit: (rule: MailRule) => void;
	/** After anything changed, so the page reads the rules and the history again. */
	onChanged: () => void;
};

const DRAG_TYPE = "application/x-juno-mail-rule";

/**
 * The rules of one mailbox in the order they are checked. A row's switch applies
 * at once. Dragging a row changes the order, and so does Alt with the arrow keys,
 * as it does for intros and outros.
 */
export function AccountRules({ accountId, rules, folders, onEdit, onChanged }: AccountRulesProps) {
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const [removing, setRemoving] = useState<MailRule | null>(null);

	const folderName = (id: string) => folders.find((folder) => folder.id === id)?.name ?? null;

	async function run(work: () => Promise<unknown>) {
		try {
			await work();
			setError(null);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
		onChanged();
	}

	const reorder = (ids: string[]) => run(() => window.juno.mail.rules.reorder(accountId, ids));

	if (rules === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	return (
		<>
			{rules.length === 0 ? (
				<p className="max-w-[62ch] text-[var(--ink-muted)]">
					No rules yet. A rule can move a newsletter to a folder, trash mail from one address, or mark what you
					never need to read as read.
				</p>
			) : (
				<ol aria-label="Rules in the order they are checked" className="flex flex-col">
					{rules.map((rule, index) => {
						const ids = rules.map((entry) => entry.id);
						return (
							<li
								key={rule.id}
								draggable
								onDragStart={(event: DragEvent) => {
									event.dataTransfer.setData(DRAG_TYPE, rule.id);
									event.dataTransfer.effectAllowed = "move";
									setDragging(rule.id);
								}}
								onDragEnd={() => {
									setDragging(null);
									setOver(null);
								}}
								onDragOver={(event) => {
									if (!dragging) return;
									event.preventDefault();
									setOver(rule.id);
								}}
								onDrop={(event) => {
									event.preventDefault();
									const source = event.dataTransfer.getData(DRAG_TYPE);
									setDragging(null);
									setOver(null);
									const next = moveBefore(ids, source, rule.id);
									if (next.join() !== ids.join()) void reorder(next);
								}}
								onKeyDown={(event) => {
									if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
									event.preventDefault();
									const next = moveBy(ids, rule.id, event.key === "ArrowUp" ? -1 : 1);
									if (next.join() !== ids.join()) void reorder(next);
								}}
								className={`relative flex items-center gap-2 border-b border-[var(--line)]/60 py-1.5 last:border-b-0 ${dragging === rule.id ? "opacity-50" : ""}`}
							>
								{over === rule.id && dragging !== rule.id ? (
									<span aria-hidden className="absolute -top-px right-2 left-2 h-0.5 rounded-full bg-[var(--accent)]" />
								) : null}
								<span aria-hidden className="tabular w-5 flex-none cursor-grab text-center text-sm text-[var(--ink-muted)]">
									{index + 1}
								</span>
								<div className="min-w-0 flex-1">
									<Toggle
										label={rule.name}
										description={summariseRule(rule, folderName)}
										checked={rule.enabled}
										onChange={(enabled) => void run(() => window.juno.mail.rules.update(rule.id, { enabled }))}
									/>
								</div>
								<IconButton icon="edit" label={`Edit ${rule.name}`} onClick={() => onEdit(rule)} />
								<IconButton icon="remove" label={`Remove ${rule.name}`} danger onClick={() => setRemoving(rule)} />
							</li>
						);
					})}
				</ol>
			)}
			<SectionError message={error} />

			{removing ? (
				<Dialog title="Remove rule" onClose={() => setRemoving(null)} width="narrow">
					<p className="mt-4 text-[var(--ink-muted)]">
						Remove {removing.name}? What it already did stays in the history, and mail it moved stays where it went.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setRemoving(null)}>Cancel</Button>
						<Button
							variant="danger"
							onClick={() => {
								const target = removing;
								setRemoving(null);
								void run(() => window.juno.mail.rules.remove(target.id));
							}}
						>
							Remove
						</Button>
					</div>
				</Dialog>
			) : null}
		</>
	);
}
