import { type FormEvent, useId, useState } from "react";
import type { ProjectLink, ProjectLinkKind } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";
import { LINK_LABELS } from "./format";

type LinkPanelProps = {
	projectId: string;
	/** Null adds, a link edits. */
	link: ProjectLink | null;
	onClose: () => void;
	onSaved: () => void;
};

const KINDS: ProjectLinkKind[] = ["github", "figma", "website", "design", "docs", "folder", "other"];

/**
 * A side panel rather than a page: a link is three fields, and the list it
 * belongs to is the context that makes "is this one already here" answerable.
 * The list behind stays readable, which a modal would take away.
 */
export function LinkPanel({ projectId, link, onClose, onSaved }: LinkPanelProps) {
	const formId = useId();
	const [label, setLabel] = useState(link?.label ?? "");
	const [target, setTarget] = useState(link?.target ?? "");
	// Empty means "work it out from the target", which is right almost always.
	const [kind, setKind] = useState<string>(link?.kind ?? "");
	const [notes, setNotes] = useState(link?.notes ?? "");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);

		try {
			if (link) {
				await window.juno.projects.links.update(link.id, {
					label,
					target,
					kind: kind ? (kind as ProjectLinkKind) : undefined,
					notes: notes.trim() || null,
				});
			} else {
				await window.juno.projects.links.create({
					projectId,
					label,
					target,
					kind: kind ? (kind as ProjectLinkKind) : undefined,
					notes: notes.trim() || null,
				});
			}
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={link ? "Edit link" : "Add a link"}
			subtitle="Where this project lives"
			onClose={onClose}
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" form={formId} variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
				<Field label="Name" required value={label} onChange={setLabel} placeholder="Repository" />
				<Field
					label="Address or folder"
					required
					value={target}
					onChange={setTarget}
					placeholder="https://github.com/you/the-project"
					help="An https address, or the full path to a folder on this machine."
				/>
				<Select
					label="Kind"
					value={kind}
					onChange={setKind}
					placeholder="Work it out from the address"
					options={KINDS.map((one) => ({ value: one, label: LINK_LABELS[one] }))}
				/>
				<Field label="Notes" value={notes} onChange={setNotes} multiline rows={3} />

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-3">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not save this link.</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</SidePanel>
	);
}
