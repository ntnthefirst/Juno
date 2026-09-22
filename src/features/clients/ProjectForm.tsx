import { type FormEvent, useEffect, useId, useState } from "react";
import type { Project, ProjectPatch, ReferenceItem } from "@shared/types";
import { Button } from "../../components/Button";
import { FormPage } from "../../components/FormPage";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";

type ProjectFormProps = {
	clientId: string;
	/** Null creates, a project edits. */
	project: Project | null;
	onClose: () => void;
	onSaved: () => void;
};

type Values = {
	name: string;
	statusId: string;
	description: string;
	startsOn: string;
	dueOn: string;
	agreedValue: string;
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

	const whole = Number.parseInt(match[2], 10);
	const fraction = Number.parseInt((match[3] ?? "").padEnd(2, "0"), 10);
	const cents = whole * 100 + fraction;
	return { ok: true, cents: match[1] === "-" ? -cents : cents };
}

function toValues(project: Project | null): Values {
	return {
		name: project?.name ?? "",
		statusId: project?.statusId ?? "",
		description: project?.description ?? "",
		startsOn: project?.startsOn ?? "",
		dueOn: project?.dueOn ?? "",
		agreedValue: centsToInput(project?.agreedValueCents ?? null),
	};
}

function textOrNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function ProjectForm({ clientId, project, onClose, onSaved }: ProjectFormProps) {
	// The submit button lives in the page footer, outside the form element.
	const formId = useId();
	const [values, setValues] = useState<Values>(() => toValues(project));
	const [statuses, setStatuses] = useState<ReferenceItem[]>([]);
	const [nameError, setNameError] = useState<string | null>(null);
	const [valueError, setValueError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.reference
			.getSet("project_status")
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
		const amount = parseAmount(values.agreedValue);

		setNameError(name.length === 0 ? "Enter a name." : null);
		setValueError(amount.ok ? null : "Use an amount like 1250,00.");
		if (name.length === 0 || !amount.ok) return;

		setError(null);
		setBusy(true);

		// startsOn and dueOn stay YYYY-MM-DD strings. A Date round trip shifts them
		// by a timezone offset, which moves a due date to the day before.
		const patch: ProjectPatch = {
			name,
			statusId: values.statusId.length > 0 ? values.statusId : null,
			description: textOrNull(values.description),
			startsOn: textOrNull(values.startsOn),
			dueOn: textOrNull(values.dueOn),
			agreedValueCents: amount.cents,
		};

		try {
			if (project) await window.juno.projects.update(project.id, patch);
			else await window.juno.projects.create({ ...patch, clientId, name });
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<FormPage
			title={project ? "Edit project" : "New project"}
			onBack={onClose}
			backLabel="Client"
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
						label="Agreed value"
						value={values.agreedValue}
						onChange={(value) => set("agreedValue", value)}
						error={valueError}
						inputMode="decimal"
						placeholder="1250,00"
						tabular
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

					<div className="col-span-2">
						<Field
							label="Description"
							multiline
							rows={3}
							value={values.description}
							onChange={(value) => set("description", value)}
						/>
					</div>
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this project.
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
