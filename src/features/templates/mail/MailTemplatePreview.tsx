import { useEffect, useState } from "react";
import type { MailTemplate } from "@shared/types";
import { Button } from "../../../components/Button";
import { FormPage } from "../../../components/FormPage";
import { messageOf } from "../../../lib/errors";

type MailTemplatePreviewProps = {
	template: MailTemplate;
	onBack: () => void;
	onEdit: () => void;
	onUse: () => void;
};

type Rendered = {
	subject: string;
	html: string;
	missing: string[];
};

// Keyed to the template it was rendered for, so a template switch does not
// need an effect to clear the old result: the old result just stops matching
// and render() below treats it as absent.
type RenderState =
	| { templateId: string; status: "ready"; rendered: Rendered }
	| { templateId: string; status: "error"; message: string };

/**
 * What a reader sees first: the template as it would go out, not the markup
 * behind it. Reading is the common case (docs/editors.md section 4), so this
 * is where clicking a row in the list lands, and editing is one press away.
 */
export function MailTemplatePreview({ template, onBack, onEdit, onUse }: MailTemplatePreviewProps) {
	const [renderState, setRenderState] = useState<RenderState | null>(null);

	useEffect(() => {
		let cancelled = false;
		// No client: this shows the template on its own, so every placeholder a
		// client or project would fill shows its [ontbreekt: ...] marker rather
		// than a blank.
		window.juno.mail.templates
			.render({ templateId: template.id, clientId: null })
			.then((result) => {
				if (cancelled) return;
				setRenderState({
					templateId: template.id,
					status: "ready",
					rendered: { subject: result.subject, html: result.bodyHtml, missing: result.missing },
				});
			})
			.catch((cause: unknown) => {
				if (!cancelled) setRenderState({ templateId: template.id, status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [template.id]);

	const current = renderState && renderState.templateId === template.id ? renderState : null;
	const rendered = current?.status === "ready" ? current.rendered : null;
	const error = current?.status === "error" ? current.message : null;

	const unreviewed = template.isSystem && template.customisedAt === null;

	return (
		<FormPage
			title={template.name}
			onBack={onBack}
			width="wide"
			actions={
				<>
					<Button onClick={onEdit}>Edit</Button>
					<Button variant="primary" onClick={onUse}>
						Use
					</Button>
				</>
			}
		>
			{unreviewed ? (
				<p className="mb-4 border-l-2 border-[var(--warn)] pl-3 text-[length:var(--text-sm)] text-[var(--warn)]">
					This text shipped with Juno and has not been edited yet. Read it before it is used.
				</p>
			) : null}

			{template.description ? <p className="mb-4 text-[var(--ink-muted)]">{template.description}</p> : null}

			{template.inputs.length > 0 ? (
				<div className="mb-6">
					<h2 className="mb-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
						Asks for
					</h2>
					<ul className="flex flex-wrap gap-2">
						{template.inputs.map((input) => (
							<li
								key={input.key}
								className="rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-1 text-[length:var(--text-dense)]"
							>
								{input.label || input.key}
								{input.required ? <span aria-hidden> *</span> : null}
							</li>
						))}
					</ul>
				</div>
			) : null}

			{error ? (
				<p
					role="alert"
					data-selectable
					className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			{rendered ? (
				<>
					<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Subject</p>
					<p className="font-[var(--weight-medium)]">{rendered.subject}</p>
					{rendered.missing.length > 0 ? (
						<p className="mt-2 text-[length:var(--text-sm)] text-[var(--risk)]">
							No value for: {rendered.missing.join(", ")}
						</p>
					) : null}
					<div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
						<iframe
							title="Template preview"
							srcDoc={rendered.html}
							sandbox=""
							referrerPolicy="no-referrer"
							className="block h-[520px] w-full bg-[var(--surface)]"
						/>
					</div>
				</>
			) : error ? null : (
				<p className="text-[var(--ink-muted)]">Rendering.</p>
			)}
		</FormPage>
	);
}
