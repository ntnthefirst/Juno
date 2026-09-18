import { useCallback, useEffect, useId, useState } from "react";
import type { ClientSummary, DocumentTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type Loaded = {
	template: DocumentTemplate;
	clients: ClientSummary[];
};

type Load =
	| { status: "loading" }
	| { status: "ready"; loaded: Loaded }
	| { status: "error"; message: string };

type Preview =
	| { status: "idle" }
	| { status: "running" }
	| { status: "ready"; html: string; missing: string[] }
	| { status: "error"; message: string };

type TemplateEditorProps = {
	templateId: string;
	onSaved: () => void;
};

export function TemplateEditor({ templateId, onSaved }: TemplateEditorProps) {
	const bodyId = useId();
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [bodyHtml, setBodyHtml] = useState("");
	const [previewClientId, setPreviewClientId] = useState("");
	const [preview, setPreview] = useState<Preview>({ status: "idle" });
	const [nameError, setNameError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmingEdit, setConfirmingEdit] = useState(false);

	const fetchAll = useCallback(async (): Promise<Loaded | null> => {
		const [template, clients] = await Promise.all([
			window.bureau.templates.get(templateId),
			window.bureau.clients.list(),
		]);
		return template ? { template, clients } : null;
	}, [templateId]);

	useEffect(() => {
		let cancelled = false;
		fetchAll()
			.then((loaded) => {
				if (cancelled) return;
				if (!loaded) {
					setLoad({ status: "error", message: "This template is no longer in your bureau." });
					return;
				}
				setLoad({ status: "ready", loaded });
				setName(loaded.template.name);
				setDescription(loaded.template.description ?? "");
				setBodyHtml(loaded.template.bodyHtml);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchAll]);

	const template = load.status === "ready" ? load.loaded.template : null;
	const bodyChanged = template !== null && bodyHtml !== template.bodyHtml;
	const reviewed = template !== null && template.reviewedAt !== null;

	async function save() {
		if (!template || busy) return;
		const trimmed = name.trim();
		setNameError(trimmed.length === 0 ? "Enter a name." : null);
		if (trimmed.length === 0) return;

		setConfirmingEdit(false);
		setError(null);
		setBusy(true);
		try {
			const saved = await window.bureau.templates.update(template.id, {
				name: trimmed,
				description: description.trim() || null,
				bodyHtml,
			});
			setLoad((current) =>
				current.status === "ready"
					? { status: "ready", loaded: { ...current.loaded, template: saved } }
					: current,
			);
			setName(saved.name);
			setDescription(saved.description ?? "");
			setBodyHtml(saved.bodyHtml);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	function requestSave() {
		// Editing the body clears the review flag server-side, so the claim being
		// withdrawn is stated before it happens rather than reported after.
		if (reviewed && bodyChanged) setConfirmingEdit(true);
		else void save();
	}

	async function toggleReviewed() {
		if (!template || busy) return;
		setError(null);
		setBusy(true);
		try {
			const saved = await window.bureau.templates.setReviewed(template.id, !reviewed);
			setLoad((current) =>
				current.status === "ready"
					? { status: "ready", loaded: { ...current.loaded, template: saved } }
					: current,
			);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function runPreview() {
		if (!template) return;
		setPreview({ status: "running" });
		try {
			const result = await window.bureau.templates.preview({
				bodyHtml,
				clientId: previewClientId.length > 0 ? previewClientId : null,
				isSpecimen: !reviewed,
			});
			setPreview({ status: "ready", html: result.html, missing: result.missing });
		} catch (cause: unknown) {
			setPreview({ status: "error", message: messageOf(cause) });
		}
	}

	if (load.status === "loading") return <p className="text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">
					Could not load this template.
				</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { clients } = load.loaded;
	const current = load.loaded.template;

	return (
		<div>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2
						data-selectable
						className="truncate text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]"
					>
						{current.name}
					</h2>
					<p className="tabular mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Version {current.version}
						{"  ·  "}
						{reviewed ? "Reviewed" : "Not reviewed"}
					</p>
				</div>
				<Button variant="primary" disabled={busy} onClick={requestSave}>
					{busy ? "Saving" : "Save"}
				</Button>
			</div>

			{reviewed ? null : (
				<p className="mt-4 max-w-[62ch] border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					Nobody has checked this text. Every document generated from it is marked as a specimen and
					cannot be signed.
				</p>
			)}

			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			<div className="mt-8 grid max-w-[720px] grid-cols-2 gap-4">
				<Field label="Name" required value={name} onChange={setName} error={nameError} />
				<Field label="Description" value={description} onChange={setDescription} />
			</div>

			<section className="mt-10">
				<label
					htmlFor={bodyId}
					className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]"
				>
					Body
				</label>
				<textarea
					id={bodyId}
					value={bodyHtml}
					onChange={(event) => setBodyHtml(event.target.value)}
					spellCheck={false}
					className="h-[420px] w-full resize-y rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] p-3 text-[length:var(--text-dense)] leading-[var(--leading-relaxed)] text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
					style={{ fontFamily: "var(--font-mono)" }}
				/>
			</section>

			<section className="mt-10">
				<h3 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
					Placeholders
				</h3>
				{current.placeholders.length === 0 ? (
					<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						This template refers to no values.
					</p>
				) : (
					<ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
						{current.placeholders.map((path) => (
							<li
								key={path}
								data-selectable
								className="text-[length:var(--text-dense)] text-[var(--ink-muted)]"
								style={{ fontFamily: "var(--font-mono)" }}
							>
								{path}
							</li>
						))}
					</ul>
				)}
				<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					A value that is missing when a document is generated prints a marked gap rather than a
					blank space.
				</p>
			</section>

			<section className="mt-10">
				<div className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-2">
					<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Preview</h3>
					<div className="flex items-end gap-2">
						<div className="w-[220px]">
							<Select
								label="Against client"
								value={previewClientId}
								onChange={setPreviewClientId}
								placeholder="No client"
								options={clients.map((row) => ({ value: row.id, label: row.name }))}
							/>
						</div>
						<Button
							disabled={preview.status === "running"}
							onClick={() => void runPreview()}
						>
							{preview.status === "running" ? "Rendering" : "Refresh preview"}
						</Button>
					</div>
				</div>

				{preview.status === "idle" ? (
					<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						Refresh the preview to render the body as it stands.
					</p>
				) : preview.status === "running" ? (
					<p className="mt-4 text-[length:var(--text-dense)] text-[var(--ink-muted)]">Rendering.</p>
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
							<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Missing here: {preview.missing.join(", ")}
							</p>
						) : null}
						{/* The body is your own text, but it quotes client data, so the frame
						    gets no privileges at all: no scripts, no navigation. */}
						<iframe
							title="Template preview"
							sandbox=""
							srcDoc={preview.html}
							className="mt-4 h-[520px] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
						/>
					</>
				)}
			</section>

			<section className="mt-10 border-t border-[var(--line)] pt-4">
				<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Review</h3>
				<p className="mt-2 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Marking this template as reviewed says the wording has been checked and is fit to send.
					That is a claim about the content, not an edit, so it is made here and nowhere else.
				</p>
				<div className="mt-4">
					<Button disabled={busy} onClick={() => void toggleReviewed()}>
						{reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
					</Button>
				</div>
			</section>

			{confirmingEdit ? (
				<Dialog title="Save this edit" width="narrow" onClose={() => setConfirmingEdit(false)}>
					<p className="mt-3 text-[length:var(--text-base)]">
						Saving a change to the body clears the reviewed mark and moves this template to version{" "}
						{current.version + 1}. Documents generated after that are marked as specimens until you
						review it again.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirmingEdit(false)}>Cancel</Button>
						<Button variant="primary" onClick={() => void save()}>
							Save anyway
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
