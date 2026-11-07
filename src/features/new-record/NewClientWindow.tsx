import { useState } from "react";
import { CLIENT_LANGUAGES, DEFAULT_CLIENT_LANGUAGE } from "@shared/client-language";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { FieldRow } from "./FieldRow";
import { RecordWindow } from "./RecordWindow";

/**
 * New client (frame 90:9301). A status is not asked for here, as the frame
 * does not draw one: it is set on the record, beside the name.
 */
export function NewClientWindow() {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [address, setAddress] = useState("");
	const [vatNumber, setVatNumber] = useState("");
	const [language, setLanguage] = useState<string>(DEFAULT_CLIENT_LANGUAGE);
	const [notes, setNotes] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

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
				language,
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
					label="Language"
					value={language}
					onChange={setLanguage}
					options={CLIENT_LANGUAGES.map((item) => ({ value: item.value, label: item.label }))}
				/>
			</FieldRow>
			<Field label="Notes" multiline rows={1} value={notes} onChange={setNotes} />
		</RecordWindow>
	);
}
