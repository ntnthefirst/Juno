import { type FormEvent, useEffect, useId, useState } from "react";
import type { Client, ClientPatch, ReferenceItem } from "@shared/types";
import { Button } from "../../components/Button";
import { FormPage } from "../../components/FormPage";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";

type ClientFormProps = {
	/** Null creates, a client edits. */
	client: Client | null;
	onClose: () => void;
	onSaved: (client: Client) => void;
};

type Values = {
	name: string;
	statusId: string;
	email: string;
	phone: string;
	website: string;
	vatNumber: string;
	addressLine1: string;
	addressLine2: string;
	postalCode: string;
	city: string;
	country: string;
	notes: string;
};

function toValues(client: Client | null): Values {
	return {
		name: client?.name ?? "",
		statusId: client?.statusId ?? "",
		email: client?.email ?? "",
		phone: client?.phone ?? "",
		website: client?.website ?? "",
		vatNumber: client?.vatNumber ?? "",
		addressLine1: client?.addressLine1 ?? "",
		addressLine2: client?.addressLine2 ?? "",
		postalCode: client?.postalCode ?? "",
		city: client?.city ?? "",
		country: client?.country ?? "",
		notes: client?.notes ?? "",
	};
}

function textOrNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function ClientForm({ client, onClose, onSaved }: ClientFormProps) {
	// The submit button lives in the page footer, outside the form element.
	const formId = useId();
	const [values, setValues] = useState<Values>(() => toValues(client));
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
			email: textOrNull(values.email),
			phone: textOrNull(values.phone),
			website: textOrNull(values.website),
			vatNumber: textOrNull(values.vatNumber),
			addressLine1: textOrNull(values.addressLine1),
			addressLine2: textOrNull(values.addressLine2),
			postalCode: textOrNull(values.postalCode),
			city: textOrNull(values.city),
			country: textOrNull(values.country),
			notes: textOrNull(values.notes),
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
							label="Website"
							type="url"
							value={values.website}
							onChange={(value) => set("website", value)}
						/>
					</div>

					<div className="col-span-2">
						<Field
							label="Address"
							value={values.addressLine1}
							onChange={(value) => set("addressLine1", value)}
						/>
					</div>
					<div className="col-span-2">
						<Field
							label="Address line 2"
							value={values.addressLine2}
							onChange={(value) => set("addressLine2", value)}
						/>
					</div>

					<Field
						label="Postal code"
						value={values.postalCode}
						onChange={(value) => set("postalCode", value)}
						tabular
					/>
					<Field label="City" value={values.city} onChange={(value) => set("city", value)} />

					<div className="col-span-2">
						<Field
							label="Country"
							value={values.country}
							onChange={(value) => set("country", value)}
						/>
					</div>

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
