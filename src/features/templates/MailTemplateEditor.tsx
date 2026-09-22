import { useEffect, useState } from "react";
import type { ClientSummary, MailRegister, MailTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type MailTemplateEditorProps = {
	templateId: string;
	onSaved: () => void;
};

const REGISTER_OPTIONS: { value: MailRegister; label: string }[] = [
	{ value: "u", label: "u (formal)" },
	{ value: "je", label: "je (familiar)" },
];

/**
 * Subject, register and body, with a preview filled against a real client so
 * a missing value shows up as the marker rather than as a blank.
 */
export function MailTemplateEditor({ templateId, onSaved }: MailTemplateEditorProps) {
	const [template, setTemplate] = useState<MailTemplate | null>(null);
	const [name, setName] = useState("");
	const [subject, setSubject] = useState("");
	const [register, setRegister] = useState<MailRegister>("u");
	const [bodyHtml, setBodyHtml] = useState("");
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [clientId, setClientId] = useState("");
	const [preview, setPreview] = useState<{ subject: string; html: string; missing: string[] } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "preview" | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.mail.templates.get(templateId), window.juno.clients.list({ limit: 200 })])
			.then(([row, clientRows]) => {
				if (cancelled) return;
				if (!row) {
					setError("That template no longer exists.");
					return;
				}
				setTemplate(row);
				setName(row.name);
				setSubject(row.subject);
				setRegister(row.register);
				setBodyHtml(row.bodyHtml);
				setClients(clientRows);
				setClientId((current) => current || clientRows[0]?.id || "");
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	async function save() {
		if (busy) return;
		setBusy("save");
		setError(null);
		try {
			const updated = await window.juno.mail.templates.update(templateId, { name, subject, register, bodyHtml });
			setTemplate(updated);
			setSaved(true);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	async function showPreview() {
		if (busy) return;
		setBusy("preview");
		setError(null);
		try {
			// The preview uses the saved body, so unsaved edits are saved first.
			if (template && (bodyHtml !== template.bodyHtml || subject !== template.subject)) await save();
			const rendered = await window.juno.mail.templates.render({ templateId, clientId: clientId || null });
			setPreview({ subject: rendered.subject, html: rendered.bodyHtml, missing: rendered.missing });
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	if (!template) {
		return <p className="text-[var(--ink-muted)]">{error ?? "Loading."}</p>;
	}

	return (
		<div>
			<div className="flex items-baseline justify-between gap-4">
				<h2 className="text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">{template.name}</h2>
				<div className="flex items-center gap-2">
					{saved ? <span className="text-[length:var(--text-sm)] text-[var(--ok)]">Saved.</span> : null}
					<Button disabled={busy !== null} onClick={() => void showPreview()}>
						{busy === "preview" ? "Rendering" : "Preview"}
					</Button>
					<Button variant="primary" disabled={busy !== null} onClick={() => void save()}>
						{busy === "save" ? "Saving" : "Save"}
					</Button>
				</div>
			</div>
			<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Dutch, one register throughout. Placeholders use the same names as the document templates, plus
				document.title, document.dueOn and document.amount, which the composer asks for.
			</p>

			<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_200px]">
				<Field label="Name" value={name} onChange={(v) => { setName(v); setSaved(false); }} required />
				<Select label="Register" value={register} onChange={(v) => { setRegister(v as MailRegister); setSaved(false); }} options={REGISTER_OPTIONS} />
				<div className="sm:col-span-2">
					<Field label="Subject" value={subject} onChange={(v) => { setSubject(v); setSaved(false); }} required />
				</div>
				<div className="sm:col-span-2">
					<Field label="Body (HTML)" value={bodyHtml} onChange={(v) => { setBodyHtml(v); setSaved(false); }} multiline rows={14} required />
				</div>
			</div>

			{error ? (
				<p role="alert" data-selectable className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}

			<div className="mt-8 flex items-end gap-3">
				<div className="w-[260px]">
					<Select label="Preview against" value={clientId} onChange={setClientId} placeholder="No client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
				</div>
			</div>

			{preview ? (
				<div className="mt-4">
					<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Subject</p>
					<p className="font-[var(--weight-medium)]">{preview.subject}</p>
					{preview.missing.length > 0 ? (
						<p className="mt-2 text-[length:var(--text-sm)] text-[var(--risk)]">No value for: {preview.missing.join(", ")}</p>
					) : null}
					<div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
						<iframe title="Template preview" srcDoc={preview.html} sandbox="" referrerPolicy="no-referrer" className="block h-[520px] w-full bg-[var(--surface)]" />
					</div>
				</div>
			) : null}
		</div>
	);
}
