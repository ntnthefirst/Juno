import { useEffect, useState, type FormEvent } from "react";
import type {
	ClientSummary,
	DocumentTemplate,
	GenerateDocumentResult,
	ProjectSummary,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type GenerateDialogProps = {
	onClose: () => void;
	onGenerated: (result: GenerateDocumentResult) => void;
};

/** Paths the generator fills by itself, so asking for them would be wrong. */
const BUILT_IN = new Set(["document.title", "document.issuedOn", "document.issuedOnIso"]);

function extraPaths(template: DocumentTemplate | null): string[] {
	if (!template) return [];
	const wanted = template.placeholders.filter(
		(path) => path.startsWith("document.") && !BUILT_IN.has(path),
	);
	return Array.from(new Set(wanted)).sort();
}

/** "document.changeSummary" reads as a field label of "Change summary". */
function labelFor(path: string): string {
	const tail = path.slice("document.".length);
	const spaced = tail.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ");
	return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function GenerateDialog({ onClose, onGenerated }: GenerateDialogProps) {
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
	const [projects, setProjects] = useState<ProjectSummary[]>([]);

	const [clientId, setClientId] = useState("");
	const [templateId, setTemplateId] = useState("");
	const [projectId, setProjectId] = useState("");
	const [title, setTitle] = useState("");
	const [issuedOn, setIssuedOn] = useState("");
	const [extras, setExtras] = useState<Record<string, string>>({});

	const [clientError, setClientError] = useState<string | null>(null);
	const [templateError, setTemplateError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.bureau.clients.list(), window.bureau.templates.list()])
			.then(([clientRows, templateRows]) => {
				if (cancelled) return;
				setClients(clientRows);
				setTemplates(templateRows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Projects are re-read per client, so another client's project can never be
	// offered here, not even for the moment between the two selections.
	useEffect(() => {
		if (clientId.length === 0) return;
		let cancelled = false;
		window.bureau.projects
			.list({ clientId })
			.then((rows) => {
				if (!cancelled) setProjects(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	function chooseClient(value: string) {
		setClientId(value);
		// Cleared here rather than in the effect, so the previous client's projects
		// are never on offer while the new ones are still being read.
		setProjects([]);
		setProjectId("");
	}

	const template = templates.find((row) => row.id === templateId) ?? null;
	const paths = extraPaths(template);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		setClientError(clientId.length === 0 ? "Choose a client." : null);
		setTemplateError(templateId.length === 0 ? "Choose a template." : null);
		if (clientId.length === 0 || templateId.length === 0) return;

		const values: Record<string, string> = {};
		for (const path of paths) {
			const value = (extras[path] ?? "").trim();
			if (value.length > 0) values[path] = value;
		}

		setError(null);
		setBusy(true);
		try {
			// issuedOn stays a YYYY-MM-DD string. A Date round trip shifts it by the
			// timezone offset, which dates a contract to the day before.
			const result = await window.bureau.documents.generate({
				clientId,
				templateId,
				projectId: projectId.length > 0 ? projectId : null,
				title: title.trim() || undefined,
				issuedOn: issuedOn.length > 0 ? issuedOn : undefined,
				extras: Object.keys(values).length > 0 ? values : undefined,
			});
			onGenerated(result);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<Dialog title="New document" onClose={onClose}>
			<form onSubmit={submit} noValidate className="mt-5">
				<div className="flex flex-col gap-4">
					<Select
						label="Client"
						required
						value={clientId}
						onChange={chooseClient}
						placeholder="Choose a client"
						error={clientError}
						options={clients.map((row) => ({ value: row.id, label: row.name }))}
					/>

					<Select
						label="Template"
						required
						value={templateId}
						onChange={setTemplateId}
						placeholder="Choose a template"
						error={templateError}
						options={templates.map((row) => ({
							value: row.id,
							label: row.reviewedAt === null ? `${row.name} (specimen)` : row.name,
						}))}
					/>

					{template && template.reviewedAt === null ? (
						<div className="border-l-2 border-[var(--risk)] pl-3">
							<p className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--risk)]">
								This template has not been reviewed.
							</p>
							<p className="mt-1 max-w-[58ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Its wording is invented and legally worthless. The document you get is marked as a
								specimen, the PDF carries a red banner, and it cannot be signed.
							</p>
						</div>
					) : null}

					<Select
						label="Project"
						value={projectId}
						onChange={setProjectId}
						placeholder={clientId.length === 0 ? "Choose a client first" : "No project"}
						disabled={clientId.length === 0}
						options={projects.map((row) => ({ value: row.id, label: row.name }))}
					/>

					<div className="grid grid-cols-2 gap-4">
						<Field
							label="Title"
							value={title}
							onChange={setTitle}
							placeholder="Taken from the template"
						/>
						<Field
							label="Issued on"
							type="date"
							value={issuedOn}
							onChange={setIssuedOn}
							tabular
						/>
					</div>

					{paths.length > 0 ? (
						<div className="flex flex-col gap-4 border-t border-[var(--line)] pt-4">
							<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								This template asks for values that only you can supply.
							</p>
							{paths.map((path) => (
								<Field
									key={path}
									label={labelFor(path)}
									value={extras[path] ?? ""}
									onChange={(value) =>
										setExtras((current) => ({ ...current, [path]: value }))
									}
								/>
							))}
						</div>
					) : null}
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not generate this document.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}

				<div className="mt-6 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{busy ? "Generating" : "Generate"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
