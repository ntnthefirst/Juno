import { useEffect, useState } from "react";
import type { MailTemplate } from "@shared/types";
import { Button } from "../../../components/Button";
import { SidePanel } from "../../../components/SidePanel";
import { messageOf } from "../../../lib/errors";
import { framed } from "./canvas/framed-preview";
import { useCanvasFonts } from "./canvas/use-canvas-fonts";

type MailTemplatePanelProps = {
	template: MailTemplate;
	onClose: () => void;
	onEdit: () => void;
	onUse: () => void;
};

type Rendered = { subject: string; html: string; missing: string[] };

// Keyed to the template it was rendered for, so clicking another row does not
// need an effect to clear the old result: it simply stops matching.
type RenderState =
	| { templateId: string; status: "ready"; rendered: Rendered }
	| { templateId: string; status: "error"; message: string };

/**
 * One template, read while the list behind it stays usable.
 *
 * Reading is the common case and editing is the rare one (docs/editors.md
 * section 4), which is why this is a panel rather than a page: clicking down a
 * list of templates to find the right one should not be open, read, close,
 * open, read, close. Use is the big button because using a template is what
 * this screen is for; edit is the small one next to it.
 */
export function MailTemplatePanel({ template, onClose, onEdit, onUse }: MailTemplatePanelProps) {
	const [state, setState] = useState<RenderState | null>(null);
	// A template with linked fonts is shown in them, the same as in the editor.
	const fonts = useCanvasFonts(template.layout?.fonts ?? []);

	useEffect(() => {
		let cancelled = false;
		// No client: every placeholder a record would fill shows its
		// [ontbreekt: ...] marker rather than a blank, so what is missing is
		// visible before the template is used on somebody real.
		window.juno.mail.templates
			.render({ templateId: template.id, clientId: null })
			.then((result) => {
				if (cancelled) return;
				setState({
					templateId: template.id,
					status: "ready",
					rendered: { subject: result.subject, html: result.bodyHtml, missing: result.missing },
				});
			})
			.catch((cause: unknown) => {
				if (!cancelled) setState({ templateId: template.id, status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [template.id]);

	const current = state && state.templateId === template.id ? state : null;
	const rendered = current?.status === "ready" ? current.rendered : null;
	const error = current?.status === "error" ? current.message : null;
	const unreviewed = template.isSystem && template.customisedAt === null;

	return (
		<SidePanel
			title={template.name}
			subtitle={template.hiddenAt ? "Hidden from the pickers" : undefined}
			onClose={onClose}
			actions={
				<>
					<span className="mr-auto">
						<Button size="dense" onClick={onEdit}>
							Edit
						</Button>
					</span>
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

			{template.hiddenAt ? (
				<p className="mb-4 border-l-2 border-[var(--line-strong)] pl-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					This template is not offered when composing. Anything already using it still renders.
				</p>
			) : null}

			{template.description ? (
				<p className="mb-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">{template.description}</p>
			) : null}

			{template.inputs.length > 0 ? (
				<div className="mb-4">
					<h3 className="mb-2 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
						Asks for
					</h3>
					<ul className="flex flex-wrap gap-1.5">
						{template.inputs.map((input) => (
							<li
								key={input.key}
								className="rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-0.5 text-[length:var(--text-micro)]"
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
					<p className="text-[length:var(--text-dense)] font-[var(--weight-medium)]">{rendered.subject}</p>
					{rendered.missing.length > 0 ? (
						<p className="mt-2 text-[length:var(--text-sm)] text-[var(--risk)]">
							No value for: {rendered.missing.join(", ")}
						</p>
					) : null}
					<div className="mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)]">
						<iframe
							title="Template preview"
							srcDoc={framed(rendered.html, fonts.css)}
							sandbox=""
							referrerPolicy="no-referrer"
							className="block h-[420px] w-full bg-[var(--surface)]"
						/>
					</div>
				</>
			) : error ? null : (
				<p className="text-[var(--ink-muted)]">Rendering.</p>
			)}
		</SidePanel>
	);
}
