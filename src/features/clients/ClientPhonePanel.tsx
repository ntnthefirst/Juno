import { type FormEvent, useId, useState } from "react";
import type { ClientPhone, ClientPhonePatch } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";

type ClientPhonePanelProps = {
	clientId: string;
	/** Null creates, a phone number edits. */
	phone: ClientPhone | null;
	onClose: () => void;
	onSaved: () => void;
};

export function ClientPhonePanel({ clientId, phone, onClose, onSaved }: ClientPhonePanelProps) {
	const formId = useId();
	const [value, setValue] = useState(phone?.phone ?? "");
	const [label, setLabel] = useState(phone?.label ?? "");
	const [valueError, setValueError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const trimmed = value.trim();
		if (trimmed.length === 0) {
			setValueError("Enter a phone number.");
			return;
		}

		setValueError(null);
		setError(null);
		setBusy(true);

		try {
			const patch: ClientPhonePatch = { phone: trimmed, label: label.trim() || null };
			if (phone) await window.juno.clientPhones.update(phone.id, patch);
			else await window.juno.clientPhones.create({ ...patch, clientId, phone: trimmed });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={phone ? "Edit phone number" : "New phone number"}
			subtitle="Phone number"
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
					label="Phone"
					type="tel"
					required
					value={value}
					onChange={setValue}
					error={valueError}
				/>
				<Field
					label="Label"
					placeholder="Kantoor, gsm, ..."
					value={label}
					onChange={setLabel}
				/>

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this phone number.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</SidePanel>
	);
}
