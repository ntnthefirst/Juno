import { useEffect, useState } from "react";
import type { ReferenceItem } from "@shared/types";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { FieldRow } from "./FieldRow";
import { RecordWindow } from "./RecordWindow";

/**
 * New client (frame 90:9301). The status stands where the frame draws the
 * language: a client has no language of its own yet, and a status is what the
 * list and the timeline already read.
 */
export function NewClientWindow() {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [address, setAddress] = useState("");
	const [vatNumber, setVatNumber] = useState("");
	const [statusId, setStatusId] = useState("");
	const [notes, setNotes] = useState("");
	const [statuses, setStatuses] = useState<ReferenceItem[]>([]);
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.reference
			.getSet("client_status")
			.then((set) => {
				if (!cancelled) setStatuses(set ? set.items.filter((item) => item.hiddenAt === null) : []);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(`Could not load the status list. ${messageOf(cause)}`);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save() {
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			setNameError("Enter a name.");
			return;
		}
		setNameError(null);
		setError(null);
		setBusy(true);
		try {
			await window.juno.clients.create({
				name: trimmed,
				statusId: statusId.length > 0 ? statusId : null,
				vatNumber: vatNumber.trim() || null,
				notes: notes.trim() || null,
				email,
				phone,
				address,
			});
			await window.juno.window.closeNewRecord(true);
		} catch (cause: unknown) {
			setError(`Could not save this client. ${messageOf(cause)}`);
			setBusy(false);
		}
	}

	return (
		<RecordWindow title="New client" saveLabel="Save client" busy={busy} error={error} onSubmit={() => void save()}>
			<Field label="Name" required value={name} onChange={setName} error={nameError} />
			<FieldRow columns="1fr 1fr">
				<Field label="Email" type="email" value={email} onChange={setEmail} />
				<Field label="Phone" type="tel" value={phone} onChange={setPhone} />
			</FieldRow>
			<Field label="Address" value={address} onChange={setAddress} />
			<FieldRow columns="1fr 1fr">
				<Field label="VAT number" value={vatNumber} onChange={setVatNumber} />
				<Select
					label="Status"
					value={statusId}
					onChange={setStatusId}
					placeholder="No status"
					options={statuses.map((item) => ({ value: item.id, label: item.label }))}
				/>
			</FieldRow>
			<Field label="Notes" multiline rows={2} value={notes} onChange={setNotes} />
		</RecordWindow>
	);
}
