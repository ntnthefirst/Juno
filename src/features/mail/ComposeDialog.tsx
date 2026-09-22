import { useEffect, useMemo, useState } from "react";
import type {
	ClientSummary,
	DocumentRecord,
	MailAccount,
	MailAddress,
	MailOutboxMessage,
	MailTemplate,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

export type ComposeSeed = {
	accountId?: string;
	to?: MailAddress[];
	cc?: MailAddress[];
	subject?: string;
	bodyText?: string;
	replyToMessageId?: string | null;
	clientId?: string | null;
	projectId?: string | null;
	/** Documents to attach from the start, for "send this document". */
	documentIds?: string[];
	/** A template to apply on open, by key. */
	templateKey?: string;
	/** An existing draft to continue. */
	draft?: MailOutboxMessage;
};

type ComposeDialogProps = {
	seed: ComposeSeed;
	onClose: () => void;
	/** The message was saved or queued. */
	onDone: (message: MailOutboxMessage, queued: boolean) => void;
};

function parseAddressLine(line: string): MailAddress[] {
	return line
		.split(/[,;]/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const match = /^(.*?)<([^<>]+)>$/.exec(part);
			if (match) {
				return { name: match[1]!.trim().replace(/^"|"$/g, "") || null, address: match[2]!.trim() };
			}
			return { name: null, address: part };
		});
}

function formatAddressLine(list: MailAddress[]): string {
	return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

/**
 * One dialog for a new message, a reply and a document cover. Plain text in;
 * the main process makes the HTML. A template fills subject and body and keeps
 * its layout until the text is edited, at which point the message is sent in
 * the plain layout instead, and the dialog says so.
 */
export function ComposeDialog({ seed, onClose, onDone }: ComposeDialogProps) {
	const [accounts, setAccounts] = useState<MailAccount[]>([]);
	const [templates, setTemplates] = useState<MailTemplate[]>([]);
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [documents, setDocuments] = useState<DocumentRecord[]>([]);

	const [accountId, setAccountId] = useState(seed.draft?.accountId ?? seed.accountId ?? "");
	const [to, setTo] = useState(formatAddressLine(seed.draft?.to ?? seed.to ?? []));
	const [cc, setCc] = useState(formatAddressLine(seed.draft?.cc ?? seed.cc ?? []));
	const [subject, setSubject] = useState(seed.draft?.subject ?? seed.subject ?? "");
	const [bodyText, setBodyText] = useState(seed.draft?.bodyText ?? seed.bodyText ?? "");
	const [bodyHtml, setBodyHtml] = useState<string | null>(seed.draft?.bodyHtml ?? null);
	const [templateId, setTemplateId] = useState(seed.draft?.templateId ?? "");
	const [clientId, setClientId] = useState(seed.draft?.clientId ?? seed.clientId ?? "");
	const [documentIds, setDocumentIds] = useState<string[]>(
		seed.draft?.attachments.map((a) => a.documentId) ?? seed.documentIds ?? [],
	);
	const [extras, setExtras] = useState<Record<string, string>>({});
	const [missing, setMissing] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "send" | "render" | null>(null);
	const [templateApplied, setTemplateApplied] = useState(Boolean(seed.draft?.templateId));

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			window.juno.mail.accounts.list(),
			window.juno.mail.templates.list(),
			window.juno.clients.list({ limit: 200 }),
		])
			.then(([accountRows, templateRows, clientRows]) => {
				if (cancelled) return;
				setAccounts(accountRows);
				setTemplates(templateRows);
				setClients(clientRows);
				setAccountId((current) => current || accountRows.find((a) => a.smtpHost)?.id || accountRows[0]?.id || "");
				if (seed.templateKey && !seed.draft) {
					const found = templateRows.find((t) => t.key === seed.templateKey);
					if (found) setTemplateId(found.id);
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [seed.templateKey, seed.draft]);

	useEffect(() => {
		let cancelled = false;
		window.juno.documents
			.list(clientId ? { clientId } : undefined)
			.then((rows) => {
				if (!cancelled) setDocuments(rows);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	const template = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);
	const extraFields = useMemo(
		() =>
			(template?.placeholders ?? [])
				.filter((p) => p.startsWith("document.") && p !== "document.issuedOn")
				.map((p) => p.slice("document.".length)),
		[template],
	);

	async function applyTemplate() {
		if (!template) return;
		setBusy("render");
		setError(null);
		try {
			const rendered = await window.juno.mail.templates.render({
				templateId: template.id,
				clientId: clientId || null,
				projectId: seed.projectId ?? null,
				extras,
			});
			setSubject(rendered.subject);
			setBodyText(rendered.bodyText);
			setBodyHtml(rendered.bodyHtml);
			setMissing(rendered.missing);
			setTemplateApplied(true);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	function editBody(value: string) {
		setBodyText(value);
		// The typed text is now the message. The template's layout is gone.
		if (bodyHtml !== null) {
			setBodyHtml(null);
			setTemplateApplied(false);
		}
	}

	async function save(queue: boolean) {
		if (busy) return;
		setBusy(queue ? "send" : "save");
		setError(null);
		try {
			const input = {
				to: parseAddressLine(to),
				cc: parseAddressLine(cc),
				subject,
				bodyText,
				bodyHtml,
				clientId: clientId || null,
				projectId: seed.projectId ?? null,
				templateId: templateApplied && template ? template.id : null,
				documentIds,
				replyToMessageId: seed.draft?.replyToMessageId ?? seed.replyToMessageId ?? null,
			};
			let message = seed.draft
				? await window.juno.mail.outbox.updateDraft(seed.draft.id, input)
				: await window.juno.mail.outbox.createDraft({ accountId, ...input });
			if (queue) message = await window.juno.mail.outbox.send(message.id);
			onDone(message, queue);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(null);
		}
	}

	const account = accounts.find((a) => a.id === accountId) ?? null;
	const canSend = account !== null && account.smtpHost !== null;

	return (
		<Dialog title={seed.draft ? "Edit message" : seed.replyToMessageId ? "Reply" : "New message"} onClose={onClose} width="wide">
			<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr]">
				<Select
					label="From"
					value={accountId}
					onChange={setAccountId}
					options={accounts.map((a) => ({ value: a.id, label: a.smtpHost ? a.email : `${a.email} (cannot send)` }))}
					disabled={Boolean(seed.draft)}
				/>
				<Select
					label="Client"
					value={clientId}
					onChange={setClientId}
					placeholder="None"
					options={clients.map((c) => ({ value: c.id, label: c.name }))}
				/>
				<div className="sm:col-span-2">
					<Field label="To" value={to} onChange={setTo} required placeholder="laura@obet.be, Tom <tom@obet.be>" />
				</div>
				<div className="sm:col-span-2">
					<Field label="Cc" value={cc} onChange={setCc} />
				</div>
				<div className="sm:col-span-2 flex items-end gap-2">
					<div className="min-w-0 flex-1">
						<Select
							label="Template"
							value={templateId}
							onChange={(value) => {
								setTemplateId(value);
								setMissing([]);
							}}
							placeholder="None"
							options={templates.map((t) => ({ value: t.id, label: t.name }))}
						/>
					</div>
					<Button disabled={!template || busy !== null} onClick={() => void applyTemplate()}>
						{busy === "render" ? "Filling" : "Fill in"}
					</Button>
				</div>
				{template && extraFields.length > 0 ? (
					<div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
						{extraFields.map((field) => (
							<Field
								key={field}
								label={field === "title" ? "Document title" : field === "dueOn" ? "Due date" : field === "amount" ? "Amount" : field}
								type={field === "dueOn" ? "date" : "text"}
								value={extras[field] ?? ""}
								onChange={(value) => setExtras((current) => ({ ...current, [field]: value }))}
								tabular={field === "amount" || field === "dueOn"}
							/>
						))}
					</div>
				) : null}
				<div className="sm:col-span-2">
					<Field label="Subject" value={subject} onChange={setSubject} required />
				</div>
				<div className="sm:col-span-2">
					<Field label="Message" value={bodyText} onChange={editBody} multiline rows={12} required />
					<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{templateApplied
							? "Sent with the template's layout. Editing the text switches to the plain layout."
							: "Sent as plain text with an HTML copy in the house style. Blank lines make paragraphs."}
					</p>
					{missing.length > 0 ? (
						<p className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
							No value for: {missing.join(", ")}. The message marks each one; fill the record or the fields above and fill in again.
						</p>
					) : null}
				</div>
				<div className="sm:col-span-2">
					<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Attach documents</span>
					{documents.length === 0 ? (
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{clientId ? "This client has no documents." : "Pick a client to see its documents."}
						</p>
					) : (
						<ul className="max-h-[160px] overflow-y-auto">
							{documents.map((document) => (
								<li key={document.id}>
									<label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-2 hover:bg-[var(--hover)]" style={{ height: "var(--row-height)" }}>
										<input
											type="checkbox"
											className="accent-[var(--accent)]"
											checked={documentIds.includes(document.id)}
											onChange={(event) =>
												setDocumentIds((current) =>
													event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id),
												)
											}
										/>
										<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">{document.title}</span>
										{document.isSpecimen ? (
											<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--risk)]">specimen</span>
										) : null}
									</label>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{error ? (
				<p role="alert" data-selectable className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
			{!canSend && account ? (
				<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{account.email} has no outgoing server, so this can be saved but not sent. Add one under Settings.
				</p>
			) : null}

			<div className="mt-6 flex items-center justify-between gap-3">
				<Button onClick={onClose}>Cancel</Button>
				<div className="flex gap-2">
					<Button disabled={busy !== null || !accountId} onClick={() => void save(false)}>
						{busy === "save" ? "Saving" : "Save draft"}
					</Button>
					<Button variant="primary" disabled={busy !== null || !canSend} onClick={() => void save(true)}>
						{busy === "send" ? "Sending" : "Send"}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
