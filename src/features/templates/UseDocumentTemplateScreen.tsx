import { useEffect, useState } from "react";
import type { DocumentTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { FormPage, type FormStep } from "../../components/FormPage";
import { TemplateInputFields } from "../../components/TemplateInputFields";
import { messageOf } from "../../lib/errors";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "../documents/DocumentOwnerFields";

type UseDocumentTemplateScreenProps = {
	templateId: string;
	onBack: () => void;
	/** Called once the document exists, so the caller can decide where to go. */
	onDone: () => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; template: DocumentTemplate }
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
	const [owner, setOwner] = useState<DocumentOwnerChoice>({ clientId: "", projectId: "" });
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
		window.juno.templates
			.get(templateId)
			.then((template) => {
				if (cancelled) return;
				if (!template) {
					setLoad({ status: "error", message: "This template is no longer in your juno." });
					return;
				}
				setLoad({ status: "ready", template });
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

	const clientId = owner.clientId;
	const projectId = owner.projectId;

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

	const { template } = load;
	const hasInputs = template.inputs.length > 0;
	const steps: StepKey[] = hasInputs ? ["fill", "link", "review"] : ["link", "review"];
	const step = steps[Math.min(stepIndex, steps.length - 1)]!;
	const formSteps: FormStep[] = steps.map((key) =>
		key === "fill"
			? { label: "Fill" }
			: key === "link"
				? {
						label: "Link",
						hint: "Who this document is for and where it is kept. Without a client, what the template reads from one is marked as missing.",
					}
				: { label: "Review", hint: "A real preview before anything is created." },
	);

	const missingRequired = template.inputs.filter((input) => input.required && (values[input.key] ?? "").trim().length === 0);

	function goNext() {
		if (step === "fill") {
			setAttemptedFill(true);
			if (missingRequired.length > 0) return;
		}
		if (step === "link") void runPreview();
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
				clientId: clientId || null,
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
				clientId: clientId || null,
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

			{step === "link" ? <DocumentOwnerFields value={owner} onChange={setOwner} /> : null}

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
