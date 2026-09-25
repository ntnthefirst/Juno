import { type FormEvent, useEffect, useId, useState } from "react";
import type { ClientSummary, Project, ProjectPatch, ReferenceItem } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { Icon } from "../../components/Icon";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type ProjectFormProps = {
	/** Null creates, a project edits. */
	project: Project | null;
	/**
	 * Set when the form was reached from a client, which fixes the client and
	 * hides the picker. A project opened from the projects screen may be moved
	 * between clients; one opened from a client is already answered.
	 */
	lockedClientId?: string;
	/** Where back goes, in words. "Projects" from the projects screen, "Client" from a client. */
	backLabel?: string;
	onClose: () => void;
	onSaved: (project: Project) => void;
};

type Values = {
	name: string;
	clientId: string;
	statusId: string;
	description: string;
	startsOn: string;
	dueOn: string;
	agreedValue: string;
	localPath: string;
};

/** Cents in, an editable amount out. The two halves stay integers throughout. */
function centsToInput(cents: number | null): string {
	if (cents === null) return "";
	const sign = cents < 0 ? "-" : "";
	const absolute = Math.abs(cents);
	const whole = Math.trunc(absolute / 100);
	const fraction = String(absolute % 100).padStart(2, "0");
	return `${sign}${whole},${fraction}`;
}

type ParsedAmount = { ok: true; cents: number | null } | { ok: false };

/**
 * Reads "1250", "1250,5", "1 250.50". The digit groups are parsed separately
 * because "10.49" * 100 is 1048.9999999999999, not 1049.
 */
function parseAmount(raw: string): ParsedAmount {
	const cleaned = raw.replace(/\s/g, "");
	if (cleaned.length === 0) return { ok: true, cents: null };

	const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
	if (!match) return { ok: false };

	const whole = Number.parseInt(match[2]!, 10);
	const fraction = Number.parseInt((match[3] ?? "").padEnd(2, "0"), 10);
	const cents = whole * 100 + fraction;
	return { ok: true, cents: match[1] === "-" ? -cents : cents };
}

function toValues(project: Project | null): Values {
	return {
		name: project?.name ?? "",
		clientId: project?.clientId ?? "",
		statusId: project?.statusId ?? "",
		description: project?.description ?? "",
		startsOn: project?.startsOn ?? "",
		dueOn: project?.dueOn ?? "",
		agreedValue: centsToInput(project?.agreedValueCents ?? null),
		localPath: project?.localPath ?? "",
	};
}

function textOrNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * The project's own fields. Where its files are kept is not here: moving them
 * copies gigabytes, so it belongs to a deliberate act on the record rather than
 * to a form that was really about a due date.
 */
export function ProjectForm({
	project,
	lockedClientId,
	backLabel = "Projects",
	onClose,
	onSaved,
}: ProjectFormProps) {
	// The submit button lives in the page footer, outside the form element.
	const formId = useId();
	const descriptionId = useId();
	const [values, setValues] = useState<Values>(() => {
		const initial = toValues(project);
		return lockedClientId ? { ...initial, clientId: lockedClientId } : initial;
	});
	const [statuses, setStatuses] = useState<ReferenceItem[]>([]);
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [nameError, setNameError] = useState<string | null>(null);
	const [valueError, setValueError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			window.juno.reference.getSet("project_status"),
			// Nothing to pick from when the client is already decided.
			lockedClientId ? Promise.resolve([]) : window.juno.clients.list(),
		])
			.then(([set, clientRows]) => {
				if (cancelled) return;
				setStatuses(set ? set.items.filter((item) => item.hiddenAt === null) : []);
				setClients(clientRows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(`Could not load the lists this form needs. ${messageOf(cause)}`);
			});
		return () => {
			cancelled = true;
		};
	}, [lockedClientId]);

	function set<K extends keyof Values>(key: K, value: Values[K]) {
		setValues((current) => ({ ...current, [key]: value }));
	}

	async function pickFolder() {
		try {
			const chosen = await window.juno.projects.chooseLocalFolder();
			if (chosen) set("localPath", chosen);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const name = values.name.trim();
		const amount = parseAmount(values.agreedValue);

		setNameError(name.length === 0 ? "Enter a name." : null);
		setValueError(amount.ok ? null : "Use an amount like 1250,00.");
		if (name.length === 0 || !amount.ok) return;

		setError(null);
		setBusy(true);

		// startsOn and dueOn stay YYYY-MM-DD strings. A Date round trip shifts
		// them by a timezone offset, which moves a due date to the day before.
		const patch: ProjectPatch = {
			name,
			clientId: textOrNull(values.clientId),
			statusId: textOrNull(values.statusId),
			description: textOrNull(values.description),
			startsOn: textOrNull(values.startsOn),
			dueOn: textOrNull(values.dueOn),
			agreedValueCents: amount.cents,
			localPath: textOrNull(values.localPath),
		};

		try {
			const saved = project
				? await window.juno.projects.update(project.id, patch)
				: await window.juno.projects.create({ ...patch, name });
			onSaved(saved);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<FormPage
			title={project ? "Edit project" : "New project"}
			onBack={onClose}
			backLabel={backLabel}
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

					{lockedClientId ? null : (
						<Select
							label="Client"
							value={values.clientId}
							onChange={(value) => set("clientId", value)}
							placeholder="Your own work"
							help="Leave this empty for work that is not for a client."
							options={clients.map((client) => ({ value: client.id, label: client.name }))}
						/>
					)}
					<Select
						label="Status"
						value={values.statusId}
						onChange={(value) => set("statusId", value)}
						placeholder="No status"
						options={statuses.map((item) => ({ value: item.id, label: item.label }))}
					/>

					<Field
						label="Starts on"
						type="date"
						value={values.startsOn}
						onChange={(value) => set("startsOn", value)}
						tabular
					/>
					<Field
						label="Due on"
						type="date"
						value={values.dueOn}
						onChange={(value) => set("dueOn", value)}
						tabular
					/>

					<Field
						label="Agreed value"
						value={values.agreedValue}
						onChange={(value) => set("agreedValue", value)}
						error={valueError}
						inputMode="decimal"
						placeholder="1250,00"
						tabular
					/>

					<div className="col-span-2">
						<div className="flex items-end gap-2">
							<div className="min-w-0 flex-1">
								<Field
									label="Folder on this machine"
									value={values.localPath}
									onChange={(value) => set("localPath", value)}
									placeholder="C:\\code\\the-project"
									help="The checkout a command runs in. Juno reads it and never writes to it."
								/>
							</div>
							<Button onClick={() => void pickFolder()}>
								<Icon name="folder-open" />
								Choose
							</Button>
						</div>
					</div>

					<div className="col-span-2">
						<label
							htmlFor={descriptionId}
							className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]"
						>
							Description
						</label>
						<MarkdownEditor
							id={descriptionId}
							value={values.description}
							onChange={(value) => set("description", value)}
							rows={3}
						/>
					</div>
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this project.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</FormPage>
	);
}
