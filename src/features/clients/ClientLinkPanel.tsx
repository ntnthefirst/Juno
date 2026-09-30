import { type FormEvent, useId, useState } from "react";
import type { ClientLink } from "@shared/types";
import {
	CLIENT_LINK_KINDS,
	CLIENT_LINK_KIND_LABELS,
	guessClientLinkKind,
	isClientLinkKind,
	type ClientLinkKind,
} from "@shared/client-links";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";

type ClientLinkPanelProps = {
	clientId: string;
	/** Null creates, a link edits. */
	link: ClientLink | null;
	onClose: () => void;
	onSaved: () => void;
};

export function ClientLinkPanel({ clientId, link, onClose, onSaved }: ClientLinkPanelProps) {
	const formId = useId();
	const [url, setUrl] = useState(link?.url ?? "");
	const [kind, setKind] = useState<ClientLinkKind>(
		link && isClientLinkKind(link.kind) ? link.kind : "website",
	);
	// A kind chosen by hand is left alone; until then it follows the address.
	const [kindChosen, setKindChosen] = useState(link !== null);
	const [label, setLabel] = useState(link?.label ?? "");
	const [urlError, setUrlError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	function changeUrl(value: string) {
		setUrl(value);
		if (!kindChosen && value.includes(".")) {
			setKind(guessClientLinkKind(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`));
		}
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const trimmed = url.trim();
		if (trimmed.length === 0) {
			setUrlError("Enter an address.");
			return;
		}

		setUrlError(null);
		setError(null);
		setBusy(true);

		try {
			const patch = { url: trimmed, kind, label: label.trim() || null };
			if (link) await window.juno.clientLinks.update(link.id, patch);
			else await window.juno.clientLinks.create({ ...patch, clientId });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={link ? "Edit link" : "New link"}
			subtitle="Website or profile"
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
				<Field
					label="Address"
					type="url"
					required
					placeholder="https://www.linkedin.com/company/..."
					value={url}
					onChange={changeUrl}
					error={urlError}
				/>
				<Select
					label="Kind"
					value={kind}
					onChange={(value) => {
						if (isClientLinkKind(value)) {
							setKind(value);
							setKindChosen(true);
						}
					}}
					options={CLIENT_LINK_KINDS.map((entry) => ({ value: entry, label: CLIENT_LINK_KIND_LABELS[entry] }))}
				/>
				<Field label="Label" placeholder="Company page, founder, ..." value={label} onChange={setLabel} />

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
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
