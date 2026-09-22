import { type FormEvent, useId, useState } from "react";
import type { ClientEmail, ClientEmailPatch } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";

type ClientEmailPanelProps = {
	clientId: string;
	/** Null creates, an email edits. */
	email: ClientEmail | null;
	onClose: () => void;
	onSaved: () => void;
};

export function ClientEmailPanel({ clientId, email, onClose, onSaved }: ClientEmailPanelProps) {
	const formId = useId();
	const [value, setValue] = useState(email?.email ?? "");
	const [label, setLabel] = useState(email?.label ?? "");
	const [valueError, setValueError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const trimmed = value.trim();
		if (trimmed.length === 0) {
			setValueError("Enter an email address.");
			return;
		}

		setValueError(null);
		setError(null);
		setBusy(true);

		try {
			const patch: ClientEmailPatch = { email: trimmed, label: label.trim() || null };
			if (email) await window.juno.clientEmails.update(email.id, patch);
			else await window.juno.clientEmails.create({ ...patch, clientId, email: trimmed });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={email ? "Edit email" : "New email"}
			subtitle="Email address"
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
					label="Email"
					type="email"
					required
					value={value}
					onChange={setValue}
					error={valueError}
				/>
				<Field
					label="Label"
					placeholder="Facturatie, algemeen, ..."
					value={label}
					onChange={setLabel}
				/>

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not save this email.</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</SidePanel>
	);
}
