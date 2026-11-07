import { useState } from "react";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import type { NewRecordPrefill } from "@shared/types";
import { FieldRow } from "./FieldRow";
import { RecordWindow } from "./RecordWindow";
import { usePickLists } from "./use-pick-lists";

type NewProjectWindowProps = {
	prefill: NewRecordPrefill;
};

/** New project (frame 90:9368). */
export function NewProjectWindow({ prefill }: NewProjectWindowProps) {
	const lists = usePickLists();
	const [name, setName] = useState("");
	const [clientId, setClientId] = useState(prefill.clientId ?? "");
	const [dueOn, setDueOn] = useState(prefill.date ?? "");
	const [localPath, setLocalPath] = useState("");
	const [description, setDescription] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function pickFolder() {
		try {
			const chosen = await window.juno.projects.chooseLocalFolder();
			if (chosen) setLocalPath(chosen);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

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
			await window.juno.projects.create({
				name: trimmed,
				clientId: clientId || null,
				dueOn: dueOn || null,
				localPath: localPath.trim() || null,
				description: description.trim() || null,
			});
			await window.juno.window.closeNewRecord(true);
		} catch (cause: unknown) {
			setError(`Could not save this project. ${messageOf(cause)}`);
			setBusy(false);
		}
	}

	return (
		<RecordWindow
			title="New project"
			saveLabel="Save project"
			busy={busy}
			error={error ?? lists.error}
			onSubmit={() => void save()}
		>
			<Field label="Name" required value={name} onChange={setName} error={nameError} />
			<FieldRow columns="1fr 1fr">
				<Select
					label="Client"
					value={clientId}
					onChange={setClientId}
					placeholder="Your own work"
					options={lists.clients.map((client) => ({ value: client.id, label: client.name }))}
				/>
				<Field label="Due date" type="date" value={dueOn} onChange={setDueOn} tabular />
			</FieldRow>
			<div className="flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Field label="Folder" value={localPath} onChange={setLocalPath} />
				</div>
				<Button onClick={() => void pickFolder()}>
					<Icon name="folder-open" />
					Choose
				</Button>
			</div>
			<Field label="Description" multiline rows={2} value={description} onChange={setDescription} />
		</RecordWindow>
	);
}
