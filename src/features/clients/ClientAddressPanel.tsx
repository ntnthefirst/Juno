import { type FormEvent, useId, useState } from "react";
import type { ClientAddress, ClientAddressPatch } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";

type ClientAddressPanelProps = {
	clientId: string;
	/** Null creates, an address edits. */
	address: ClientAddress | null;
	onClose: () => void;
	onSaved: () => void;
};

type Values = {
	label: string;
	addressLine1: string;
	addressLine2: string;
	postalCode: string;
	city: string;
	country: string;
};

function toValues(address: ClientAddress | null): Values {
	return {
		label: address?.label ?? "",
		addressLine1: address?.addressLine1 ?? "",
		addressLine2: address?.addressLine2 ?? "",
		postalCode: address?.postalCode ?? "",
		city: address?.city ?? "",
		country: address?.country ?? "",
	};
}

function textOrNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function ClientAddressPanel({ clientId, address, onClose, onSaved }: ClientAddressPanelProps) {
	const formId = useId();
	const [values, setValues] = useState<Values>(() => toValues(address));
	const [line1Error, setLine1Error] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	function set<K extends keyof Values>(key: K, value: Values[K]) {
		setValues((current) => ({ ...current, [key]: value }));
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const addressLine1 = values.addressLine1.trim();
		if (addressLine1.length === 0) {
			setLine1Error("Enter a street and number.");
			return;
		}

		setLine1Error(null);
		setError(null);
		setBusy(true);

		const patch: ClientAddressPatch = {
			label: textOrNull(values.label),
			addressLine1,
			addressLine2: textOrNull(values.addressLine2),
			postalCode: textOrNull(values.postalCode),
			city: textOrNull(values.city),
			country: textOrNull(values.country),
		};

		try {
			if (address) await window.juno.clientAddresses.update(address.id, patch);
			else await window.juno.clientAddresses.create({ ...patch, clientId, addressLine1 });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={address ? "Edit address" : "New address"}
			subtitle="Address"
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
					label="Label"
					placeholder="Kantoor Leuven, magazijn, ..."
					value={values.label}
					onChange={(value) => set("label", value)}
				/>
				<Field
					label="Street and number"
					required
					value={values.addressLine1}
					onChange={(value) => set("addressLine1", value)}
					error={line1Error}
				/>
				<Field
					label="Address line 2"
					value={values.addressLine2}
					onChange={(value) => set("addressLine2", value)}
				/>
				<div className="grid grid-cols-2 gap-4">
					<Field
						label="Postal code"
						value={values.postalCode}
						onChange={(value) => set("postalCode", value)}
						tabular
					/>
					<Field label="City" value={values.city} onChange={(value) => set("city", value)} />
				</div>
				<Field
					label="Country"
					value={values.country}
					onChange={(value) => set("country", value)}
				/>

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this address.
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
