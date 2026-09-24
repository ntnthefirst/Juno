import { useEffect, useMemo, useState } from "react";
import type { DocumentRecord, MailAccount, MailAddress, MailOutboxMessage, MailTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage } from "../../components/FormPage";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import MessageEditor from "./MessageEditor";
import { RecipientField } from "./RecipientField";

export type ComposeSeed = {
	accountId?: string;
	to?: MailAddress[];
	cc?: MailAddress[];
	subject?: string;
	bodyText?: string;
	replyToMessageId?: string | null;
	clientId?: string | null;
	projectId?: string | null;
	documentIds?: string[];
	templateKey?: string;
	draft?: MailOutboxMessage;
};

type ComposePageProps = {
	seed: ComposeSeed;
	onClose: () => void;
	onDone: (message: MailOutboxMessage, queued: boolean) => void;
};

export function ComposePage({ seed, onClose, onDone }: ComposePageProps) {
	const [accounts, setAccounts] = useState<MailAccount[]>([]);
	const [templates, setTemplates] = useState<MailTemplate[]>([]);
	const [documents, setDocuments] = useState<DocumentRecord[]>([]);
	const [accountId, setAccountId] = useState(seed.draft?.accountId ?? seed.accountId ?? "");
	const [to, setTo] = useState<MailAddress[]>(seed.draft?.to ?? seed.to ?? []);
	const [cc, setCc] = useState<MailAddress[]>(seed.draft?.cc ?? seed.cc ?? []);
	const [bcc, setBcc] = useState<MailAddress[]>(seed.draft?.bcc ?? []);
	const [showCopies, setShowCopies] = useState(
		(seed.draft?.cc ?? seed.cc ?? []).length > 0 || (seed.draft?.bcc ?? []).length > 0,
	);
	const [subject, setSubject] = useState(seed.draft?.subject ?? seed.subject ?? "");
	const [bodyText, setBodyText] = useState(seed.draft?.bodyText ?? seed.bodyText ?? "");
	const [bodyHtml, setBodyHtml] = useState<string | null>(seed.draft?.bodyHtml ?? null);
	const [templateId, setTemplateId] = useState(seed.draft?.templateId ?? "");
	const [clientId, setClientId] = useState(seed.draft?.clientId ?? seed.clientId ?? "");
	const [documentIds, setDocumentIds] = useState<string[]>(
		seed.draft?.attachments.map((attachment) => attachment.documentId) ?? seed.documentIds ?? [],
	);
	const [extras, setExtras] = useState<Record<string, string>>({});
	const [missing, setMissing] = useState<string[]>([]);
	const [showAttachments, setShowAttachments] = useState(documentIds.length > 0);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "send" | "render" | null>(null);
	const [templateApplied, setTemplateApplied] = useState(Boolean(seed.draft?.templateId));

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.mail.accounts.list(), window.juno.mail.templates.list()])
			.then(([accountRows, templateRows]) => {
				if (cancelled) return;
				setAccounts(accountRows);
				setTemplates(templateRows);
				setAccountId(
					(current) =>
						current || accountRows.find((account) => account.smtpHost)?.id || accountRows[0]?.id || "",
				);
				if (seed.templateKey && !seed.draft) {
					const found = templateRows.find((template) => template.key === seed.templateKey);
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

	const addressKey = [...to, ...cc, ...bcc].map((address) => address.address).join(",");
	useEffect(() => {
		const addresses = addressKey.split(",").filter(Boolean);
		if (addresses.length === 0) return;
		let cancelled = false;
		window.juno.mail.recipients.clientsFor(addresses).then((rows) => {
			if (!cancelled) setClientId((current) => current || rows[0]?.clientId || "");
		});
		return () => {
			cancelled = true;
		};
	}, [addressKey]);

	useEffect(() => {
		let cancelled = false;
		window.juno.documents.list(clientId ? { clientId } : undefined).then((rows) => {
			if (!cancelled) setDocuments(rows);
		});
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	const template = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templates, templateId]);
	const extraFields = useMemo(
		() =>
			(template?.placeholders ?? [])
				.filter((placeholder) => placeholder.startsWith("document.") && placeholder !== "document.issuedOn")
				.map((placeholder) => placeholder.slice("document.".length)),
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

	function editBody(text: string, html: string | null) {
		setBodyText(text);
		setBodyHtml(html);
		setTemplateApplied(false);
	}

	async function save(queue: boolean) {
		if (busy) return;
		setBusy(queue ? "send" : "save");
		setError(null);
		try {
			const input = {
				to,
				cc,
				bcc,
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

	const account = accounts.find((item) => item.id === accountId) ?? null;
	const canSend = account !== null && account.smtpHost !== null;

	return (
		<FormPage
			title={seed.draft ? "Edit message" : seed.replyToMessageId ? "Reply" : "New message"}
			onBack={onClose}
			backLabel="Cancel"
			width="wide"
			actions={
				<>
					<Button
						disabled={busy !== null || !accountId}
						onClick={() => void save(false)}
					>
						{busy === "save" ? "Saving" : "Save draft"}
					</Button>
					{/* TODO(mail): build the styled email screen for custom HTML and templates. */}
					<Button
						disabled
						title="Styled email is not available yet"
					>
						Send styled email
					</Button>
					<Button
						variant="primary"
						disabled={busy !== null || !canSend}
						onClick={() => void save(true)}
					>
						{busy === "send" ? "Sending" : "Send"}
					</Button>
				</>
			}
		>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Select
					label="From"
					value={accountId}
					onChange={setAccountId}
					options={accounts.map((item) => ({
						value: item.id,
						label: item.smtpHost ? item.email : `${item.email} (cannot send)`,
					}))}
					disabled={Boolean(seed.draft)}
				/>
				<div className="sm:col-span-2">
					<RecipientField
						label="To"
						value={to}
						onChange={setTo}
						required
						autoFocus={!seed.draft}
					/>
				</div>
				{showCopies ? (
					<>
						<div className="sm:col-span-2">
							<RecipientField
								label="Cc"
								value={cc}
								onChange={setCc}
							/>
						</div>
						<div className="sm:col-span-2">
							<RecipientField
								label="Bcc"
								value={bcc}
								onChange={setBcc}
								help="Nobody on the message sees these addresses."
							/>
						</div>
					</>
				) : (
					<div className="sm:col-span-2">
						<button
							type="button"
							onClick={() => setShowCopies(true)}
							className="text-[length:var(--text-sm)] text-[var(--accent)] hover:underline"
						>
							Add Cc or Bcc
						</button>
					</div>
				)}

				<div className="flex items-end gap-2 sm:col-span-2">
					<div className="min-w-0 flex-1">
						<Field
							label="Subject"
							value={subject}
							onChange={setSubject}
							required
						/>
					</div>
					<Button onClick={() => setShowAttachments((current) => !current)}>
						<Icon
							name="attachment"
							size={16}
						/>
						{showAttachments ? "Hide attachments" : "Add attachment"}
					</Button>
				</div>
				{showAttachments ? (
					<div className="sm:col-span-2">
						<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Attach documents
						</span>
						{documents.length === 0 ? (
							<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{clientId ? "This client has no documents." : "Pick a client to see its documents."}
							</p>
						) : (
							<ul className="max-h-[200px] overflow-y-auto">
								{documents.map((document) => (
									<li key={document.id}>
										<label
											className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-2 hover:bg-[var(--hover)]"
											style={{ height: "var(--row-height)" }}
										>
											<input
												type="checkbox"
												className="accent-[var(--accent)]"
												checked={documentIds.includes(document.id)}
												onChange={(event) =>
													setDocumentIds((current) =>
														event.target.checked
															? [...current, document.id]
															: current.filter((id) => id !== document.id),
													)
												}
											/>
											<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
												{document.title}
											</span>
											{document.isSpecimen ? (
												<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--risk)]">
													specimen
												</span>
											) : null}
										</label>
									</li>
								))}
							</ul>
						)}
					</div>
				) : null}

				<div className="flex items-end gap-2 sm:col-span-2">
					<div className="min-w-0 flex-1">
						<Select
							label="Template"
							value={templateId}
							onChange={(value) => {
								setTemplateId(value);
								setMissing([]);
							}}
							placeholder="None"
							options={templates.map((item) => ({ value: item.id, label: item.name }))}
						/>
					</div>
					<Button
						disabled={!template || busy !== null}
						onClick={() => void applyTemplate()}
					>
						{busy === "render" ? "Filling" : "Fill in"}
					</Button>
				</div>
				{template && extraFields.length > 0 ? (
					<div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
						{extraFields.map((field) => (
							<Field
								key={field}
								label={
									field === "title"
										? "Document title"
										: field === "dueOn"
											? "Due date"
											: field === "amount"
												? "Amount"
												: field
								}
								type={field === "dueOn" ? "date" : "text"}
								value={extras[field] ?? ""}
								onChange={(value) => setExtras((current) => ({ ...current, [field]: value }))}
								tabular={field === "amount" || field === "dueOn"}
							/>
						))}
					</div>
				) : null}
				<div className="sm:col-span-2">
					<MessageEditor
						text={bodyText}
						html={bodyHtml}
						onChange={editBody}
					/>
					{missing.length > 0 ? (
						<p className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
							No value for: {missing.join(", ")}. Fill the record or the fields above and fill in again.
						</p>
					) : null}
				</div>
			</div>
			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}
			{!canSend && account ? (
				<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{account.email} has no outgoing server, so this can be saved but not sent. Add one under Settings.
				</p>
			) : null}
		</FormPage>
	);
}
