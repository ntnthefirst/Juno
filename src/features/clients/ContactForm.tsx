import { useState, type FormEvent } from "react";
import type { Contact, ContactPatch } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";

type ContactFormProps = {
	clientId: string;
	/** Null creates, a contact edits. */
	contact: Contact | null;
	onClose: () => void;
	onSaved: () => void;
};

type Values = {
	name: string;
	role: string;
	email: string;
	phone: string;
	notes: string;
};

function toValues(contact: Contact | null): Values {
	return {
		name: contact?.name ?? "",
		role: contact?.role ?? "",
		email: contact?.email ?? "",
		phone: contact?.phone ?? "",
		notes: contact?.notes ?? "",
	};
}

function textOrNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function ContactForm({ clientId, contact, onClose, onSaved }: ContactFormProps) {
	const [values, setValues] = useState<Values>(() => toValues(contact));
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	function set<K extends keyof Values>(key: K, value: Values[K]) {
		setValues((current) => ({ ...current, [key]: value }));
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const name = values.name.trim();
		if (name.length === 0) {
			setNameError("Enter a name.");
			return;
		}

		setNameError(null);
		setError(null);
		setBusy(true);

		const patch: ContactPatch = {
			name,
			role: textOrNull(values.role),
			email: textOrNull(values.email),
			phone: textOrNull(values.phone),
			notes: textOrNull(values.notes),
		};

		try {
			if (contact) await window.juno.contacts.update(contact.id, patch);
			else await window.juno.contacts.create({ ...patch, clientId, name });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<Dialog title={contact ? "Edit contact" : "New contact"} onClose={onClose}>
			<form onSubmit={submit} noValidate className="mt-5">
				<div className="grid grid-cols-2 gap-4">
					<div className="col-span-2">
						<Field
							label="Name"
							required
							value={values.name}
							onChange={(value) => set("name", value)}
							error={nameError}
						/>
					</div>

					<div className="col-span-2">
						<Field label="Role" value={values.role} onChange={(value) => set("role", value)} />
					</div>

					<Field
						label="Email"
						type="email"
						value={values.email}
						onChange={(value) => set("email", value)}
					/>
					<Field
						label="Phone"
						type="tel"
						value={values.phone}
						onChange={(value) => set("phone", value)}
					/>

					<div className="col-span-2">
						<Field
							label="Notes"
							multiline
							rows={3}
							value={values.notes}
							onChange={(value) => set("notes", value)}
						/>
					</div>
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this contact.
						</p>
						<p
							data-selectable
							className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
						>
							{error}
						</p>
					</div>
				) : null}

				<div className="mt-6 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
