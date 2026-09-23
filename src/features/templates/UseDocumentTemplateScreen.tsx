import { useEffect, useState } from "react";
import type { ClientSummary, DocumentTemplate, ProjectSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { FormPage, type FormStep } from "../../components/FormPage";
import { Select } from "../../components/Select";
import { TemplateInputFields } from "../../components/TemplateInputFields";
import { messageOf } from "../../lib/errors";

type UseDocumentTemplateScreenProps = {
	templateId: string;
	onBack: () => void;
	/** Called once the document exists, so the caller can decide where to go. */
	onDone: () => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; template: DocumentTemplate; clients: ClientSummary[] }
	| { status: "error"; message: string };

type Preview =
	| { status: "idle" }
	| { status: "running" }
	| { status: "ready"; html: string; missing: string[] }
	| { status: "error"; message: string };

type StepKey = "fill" | "link" | "review";

/**
 * Filling in a template is a sequence, not a dialog (docs/editors.md section
 * 4): what the template asks for, who it is for, then a real preview before
 * anything is written. Nothing here sends or files anything on its own; a
 * generated document still needs a person to sign it.
 */
export function UseDocumentTemplateScreen({ templateId, onBack, onDone }: UseDocumentTemplateScreenProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [stepIndex, setStepIndex] = useState(0);
	const [values, setValues] = useState<Record<string, string>>({});
	const [attemptedFill, setAttemptedFill] = useState(false);
	const [clientId, setClientId] = useState("");
	// Keyed to the client it was fetched for: a client switch does not need an
	// effect to clear the stale list, the stale list just stops matching.
	const [projectsState, setProjectsState] = useState<{ clientId: string; rows: ProjectSummary[] } | null>(null);
	const [projectIdChoice, setProjectIdChoice] = useState("");
	const [linkError, setLinkError] = useState<string | null>(null);
	const [preview, setPreview] = useState<Preview>({ status: "idle" });
	const [created, setCreated] = useState<{
		title: string;
		isSpecimen: boolean;
		missing: string[];
		pdfError: string | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.templates.get(templateId), window.juno.clients.list()])
			.then(([template, clients]) => {
				if (cancelled) return;
				if (!template) {
					setLoad({ status: "error", message: "This template is no longer in your juno." });
					return;
				}
				setLoad({ status: "ready", template, clients });
				const defaults: Record<string, string> = {};
				for (const input of template.inputs) {
					if (input.defaultValue) defaults[input.key] = input.defaultValue;
				}
				setValues(defaults);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	useEffect(() => {
		if (clientId.length === 0) return;
		let cancelled = false;
		window.juno.projects
			.list({ clientId })
			.then((rows) => {
				if (!cancelled) setProjectsState({ clientId, rows });
			})
			.catch(() => {
				if (!cancelled) setProjectsState({ clientId, rows: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	const projects = clientId.length > 0 && projectsState?.clientId === clientId ? projectsState.rows : [];
	// The person's choice holds while a client is picked; clearing the client
	// clears it too, without an effect to do it.
	const projectId = clientId.length === 0 ? "" : projectIdChoice;

	if (load.status === "loading") return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] p-8 pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not open this template.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { template, clients } = load;
	const hasInputs = template.inputs.length > 0;
	const steps: StepKey[] = hasInputs ? ["fill", "link", "review"] : ["link", "review"];
	const step = steps[Math.min(stepIndex, steps.length - 1)]!;
	const formSteps: FormStep[] = steps.map((key) =>
		key === "fill"
			? { label: "Fill" }
			: key === "link"
				? { label: "Link", hint: "Who this document is for." }
				: { label: "Review", hint: "A real preview before anything is created." },
	);

	const missingRequired = template.inputs.filter((input) => input.required && (values[input.key] ?? "").trim().length === 0);

	function goNext() {
		if (step === "fill") {
			setAttemptedFill(true);
			if (missingRequired.length > 0) return;
		}
		if (step === "link") {
			if (clientId.length === 0) {
				setLinkError("Choose a client.");
				return;
			}
			setLinkError(null);
			void runPreview();
		}
		setStepIndex((index) => Math.min(index + 1, steps.length - 1));
	}

	function goBack() {
		if (stepIndex === 0) {
			onBack();
			return;
		}
		setStepIndex((index) => Math.max(index - 1, 0));
	}

	async function runPreview() {
		setPreview({ status: "running" });
		try {
			const result = await window.juno.templates.preview({
				bodyHtml: template.bodyHtml,
				clientId,
				projectId: projectId.length > 0 ? projectId : null,
				isSpecimen: template.reviewedAt === null,
			});
			setPreview({ status: "ready", html: result.html, missing: result.missing });
		} catch (cause: unknown) {
			setPreview({ status: "error", message: messageOf(cause) });
		}
	}

	async function create() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await window.juno.documents.generate({
				clientId,
				templateId: template.id,
				projectId: projectId.length > 0 ? projectId : null,
				extras: values,
			});
			setCreated({
				title: result.document.title,
				isSpecimen: result.document.isSpecimen,
				missing: result.missing,
				pdfError: result.pdfError,
			});
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	if (created) {
		return (
			<FormPage title={`Use: ${template.name}`} onBack={onDone} backLabel="Done" width="form">
				<p className="text-[length:var(--text-h3)] font-[var(--weight-semibold)]">Document created</p>
				<p className="mt-3 text-[length:var(--text-base)]">
					{created.pdfError === null
						? `${created.title} was written to disk as a PDF.`
						: `${created.title} was saved, but its PDF was not written.`}
					{created.isSpecimen ? " It is marked as a specimen, because the template has not been reviewed." : ""}
				</p>
				{created.pdfError !== null ? (
					<p className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						{created.pdfError} The document is in the list, so create its PDF from there.
					</p>
				) : null}
				{created.missing.length > 0 ? (
					<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						No value for: {created.missing.join(", ")}. The document shows a marked gap for each.
					</p>
				) : null}
				<div className="mt-6">
					<Button variant="primary" onClick={onDone}>
						Done
					</Button>
				</div>
			</FormPage>
		);
	}

	return (
		<FormPage
			title={`Use: ${template.name}`}
			onBack={goBack}
			backLabel={stepIndex === 0 ? "Back" : "Previous"}
			steps={formSteps}
			step={stepIndex}
			onStep={setStepIndex}
			width={step === "review" ? "wide" : "form"}
			actions={
				<>
					<Button onClick={goBack}>{stepIndex === 0 ? "Cancel" : "Previous"}</Button>
					{step === "review" ? (
						<Button variant="primary" disabled={busy} onClick={() => void create()}>
							{busy ? "Creating" : "Create document"}
						</Button>
					) : (
						<Button variant="primary" onClick={goNext}>
							Next
						</Button>
					)}
				</>
			}
		>
			{error ? (
				<p
					role="alert"
					data-selectable
					className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			{step === "fill" ? (
				<TemplateInputFields
					inputs={template.inputs}
					values={values}
					onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
					missing={attemptedFill ? missingRequired.map((input) => input.key) : []}
				/>
			) : null}

			{step === "link" ? (
				<div className="flex flex-col gap-4">
					<Select
						label="Client"
						required
						value={clientId}
						onChange={setClientId}
						placeholder="Choose a client"
						options={clients.map((row) => ({ value: row.id, label: row.name }))}
						error={linkError}
					/>
					<Select
						label="Project"
						value={projectId}
						onChange={setProjectIdChoice}
						placeholder={clientId.length === 0 ? "Choose a client first" : "No project"}
						disabled={clientId.length === 0}
						options={projects.map((row) => ({ value: row.id, label: row.name }))}
					/>
				</div>
			) : null}

			{step === "review" ? (
				<div>
					<p className="max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Creating writes a PDF to disk right away. A document from a template nobody has reviewed is
						marked as a specimen and cannot be signed.
					</p>

					{preview.status === "idle" || preview.status === "running" ? (
						<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">Rendering the preview.</p>
					) : preview.status === "error" ? (
						<p
							data-selectable
							className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
						>
							{preview.message}
						</p>
					) : (
						<>
							{preview.missing.length > 0 ? (
								<p className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
									No value for: {preview.missing.join(", ")}. Go back to fill these in, or continue and the
									document will show a marked gap for each.
								</p>
							) : null}
							<iframe
								title="Document preview"
								sandbox=""
								referrerPolicy="no-referrer"
								srcDoc={preview.html}
								className="mt-4 h-[520px] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
							/>
						</>
					)}
				</div>
			) : null}
		</FormPage>
	);
}
