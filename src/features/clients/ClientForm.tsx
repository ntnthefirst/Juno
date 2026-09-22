import { type FormEvent, useEffect, useId, useState } from "react";
import type { Client, ClientPatch, ReferenceItem } from "@shared/types";
import { Button } from "../../components/Button";
import { FormPage } from "../../components/FormPage";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type ClientFormProps = {
	/** Null creates, a client edits. */
	client: Client | null;
	onClose: () => void;
	onSaved: (client: Client) => void;
};

type Values = {
	name: string;
	statusId: string;
	vatNumber: string;
	website: string;
	notes: string;
};

function toValues(client: Client | null): Values {
	return {
		name: client?.name ?? "",
		statusId: client?.statusId ?? "",
		vatNumber: client?.vatNumber ?? "",
		website: client?.website ?? "",
		notes: client?.notes ?? "",
	};
}

function textOrNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function ClientForm({ client, onClose, onSaved }: ClientFormProps) {
	// The submit button lives in the page footer, outside the form element.
	const formId = useId();
	const [values, setValues] = useState<Values>(() => toValues(client));
	// Notes stay out of the way until there is something in them, or the user
	// asks for the field. Filling in a client should not open on a blank essay.
	const [notesOpen, setNotesOpen] = useState(() => (client?.notes ?? "").trim().length > 0);
	const [statuses, setStatuses] = useState<ReferenceItem[]>([]);
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.reference
			.getSet("client_status")
			.then((set) => {
				if (cancelled) return;
				setStatuses(set ? set.items.filter((item) => item.hiddenAt === null) : []);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(`Could not load the status list. ${messageOf(cause)}`);
			});
		return () => {
			cancelled = true;
		};
	}, []);

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

		const patch: ClientPatch = {
			name,
			statusId: values.statusId.length > 0 ? values.statusId : null,
			vatNumber: textOrNull(values.vatNumber),
			website: textOrNull(values.website),
			notes: notesOpen ? textOrNull(values.notes) : null,
		};

		try {
			const saved = client
				? await window.juno.clients.update(client.id, patch)
				: await window.juno.clients.create({ ...patch, name });
			onSaved(saved);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<FormPage
			title={client ? "Edit client" : "New client"}
			onBack={onClose}
			backLabel="Clients"
			description={
				client ? undefined : "Just the basics for now. Add emails, phone numbers, addresses and contacts once the client is saved."
			}
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" form={formId} variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate>
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

					<Select
						label="Status"
						value={values.statusId}
						onChange={(value) => set("statusId", value)}
						placeholder="No status"
						options={statuses.map((item) => ({ value: item.id, label: item.label }))}
					/>
					<Field
						label="VAT number"
						value={values.vatNumber}
						onChange={(value) => set("vatNumber", value)}
					/>

					<div className="col-span-2">
						<Field
							label="Website"
							type="url"
							value={values.website}
							onChange={(value) => set("website", value)}
						/>
					</div>
				</div>

				<div className="mt-6 border-t border-[var(--line)] pt-6">
					{notesOpen ? (
						<Field
							label="Notes"
							multiline
							rows={4}
							value={values.notes}
							onChange={(value) => set("notes", value)}
						/>
					) : (
						<Button onClick={() => setNotesOpen(true)}>Add notes</Button>
					)}
					{notesOpen ? (
						<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Markdown is supported: **bold**, _italic_, a [link](https://example.com), a list.
						</p>
					) : null}
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this client.
						</p>
						<p
							data-selectable
							className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
						>
							{error}
						</p>
					</div>
				) : null}
			</form>
		</FormPage>
	);
}
