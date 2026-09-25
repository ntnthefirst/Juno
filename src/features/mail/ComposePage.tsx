import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentRecord, MailAccount, MailAddress, MailOutboxMessage, MailTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
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

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Fills the whole content area, edge to edge: no header bar, no maximum
 * width, nothing boxed around the body. A back arrow and a title read as a
 * form; this reads as a blank message the way a mail client's own compose
 * window does, on any size of screen.
 */
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
	const [clientId, setClientId] = useState(seed.draft?.clientId ?? seed.clientId ?? "");
	const [documentIds, setDocumentIds] = useState<string[]>(
		seed.draft?.attachments.map((attachment) => attachment.documentId) ?? seed.documentIds ?? [],
	);
	const [attachmentsOpen, setAttachmentsOpen] = useState(false);
	const [extras, setExtras] = useState<Record<string, string>>({});
	const [missing, setMissing] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"send" | "render" | null>(null);
	const [templateApplied, setTemplateApplied] = useState(Boolean(seed.draft?.templateId));
	const [savedMessage, setSavedMessage] = useState<MailOutboxMessage | null>(seed.draft ?? null);
	const [saveState, setSaveState] = useState<SaveState>("idle");

	const attachmentsRef = useRef<HTMLDivElement>(null);

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
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

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

	useEffect(() => {
		if (!attachmentsOpen) return;
		function onPointerDown(event: MouseEvent) {
			if (attachmentsRef.current?.contains(event.target as Node)) return;
			setAttachmentsOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [attachmentsOpen]);

	// Resolved by key for a fresh message opened from elsewhere (a document's
	// "send" action), or by id for a draft reopened later that already carries
	// one. Either way, nothing here shows a template picker: this is the one
	// cover-letter case that still needs rendered text, not the regular way of
	// sending a message.
	const template = useMemo(() => {
		if (seed.templateKey) return templates.find((item) => item.key === seed.templateKey) ?? null;
		if (seed.draft?.templateId) return templates.find((item) => item.id === seed.draft!.templateId) ?? null;
		return null;
	}, [templates, seed.templateKey, seed.draft]);
	const extraFields = useMemo(
		() =>
			(template?.placeholders ?? [])
				.filter((placeholder) => placeholder.startsWith("document.") && placeholder !== "document.issuedOn")
				.map((placeholder) => placeholder.slice("document.".length)),
		[template],
	);

	const applyTemplate = useCallback(async () => {
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
	}, [template, clientId, seed.projectId, extras]);

	// Read through a ref rather than depended on directly: applyTemplate's own
	// success flips templateApplied to true, and listing it here would retrigger
	// this same effect for one redundant extra render right after the first.
	const templateAppliedRef = useRef(templateApplied);
	useEffect(() => {
		templateAppliedRef.current = templateApplied;
	}, [templateApplied]);

	const templateHydratedRef = useRef(false);
	useEffect(() => {
		if (!template) return;
		if (!templateHydratedRef.current) {
			templateHydratedRef.current = true;
			// A draft reopened for editing already has its rendered text; applying
			// again here with blank extras would wipe it. Only a fresh message
			// (no draft yet) gets the immediate fill. Deferred rather than called
			// straight away: applyTemplate's first line sets state, and an effect
			// is not supposed to set state synchronously within its own body.
			if (seed.draft) return;
			const timer = window.setTimeout(() => void applyTemplate(), 0);
			return () => window.clearTimeout(timer);
		}
		if (!templateAppliedRef.current) return;
		const timer = window.setTimeout(() => void applyTemplate(), 500);
		return () => window.clearTimeout(timer);
	}, [template, seed.draft, extras, clientId, applyTemplate]);

	function editBody(text: string, html: string | null) {
		setBodyText(text);
		setBodyHtml(html);
		setTemplateApplied(false);
	}

	const isEmpty =
		to.length === 0 && cc.length === 0 && bcc.length === 0 && !subject.trim() && !bodyText.trim() && documentIds.length === 0;

	// Read through a ref rather than depended on directly: persist's own
	// success calls setSavedMessage, and depending on that state would give
	// persist a new identity after every save, which would retrigger the
	// autosave effect below on its own and never let the status settle on
	// "Saved to drafts".
	const savedMessageRef = useRef(savedMessage);
	useEffect(() => {
		savedMessageRef.current = savedMessage;
	}, [savedMessage]);

	const persist = useCallback(
		async (evenIfEmpty: boolean): Promise<MailOutboxMessage | null> => {
			if (isEmpty && !evenIfEmpty) return savedMessageRef.current;
			if (!accountId) return savedMessageRef.current;
			setSaveState("saving");
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
				const existing = savedMessageRef.current;
				const message = existing
					? await window.juno.mail.outbox.updateDraft(existing.id, input)
					: await window.juno.mail.outbox.createDraft({ accountId, ...input });
				setSavedMessage(message);
				setSaveState("saved");
				return message;
			} catch (cause: unknown) {
				setSaveState("error");
				setError(messageOf(cause));
				return null;
			}
		},
		[
			isEmpty,
			accountId,
			to,
			cc,
			bcc,
			subject,
			bodyText,
			bodyHtml,
			clientId,
			documentIds,
			templateApplied,
			template,
			seed.projectId,
			seed.draft,
			seed.replyToMessageId,
		],
	);

	// Anything typed or added, once there is at least one of it, is worth
	// keeping: this fires on the next pause in typing rather than waiting for a
	// deliberate "save draft" click that a mail client's own compose window
	// does not ask for either.
	const firstRunRef = useRef(true);
	useEffect(() => {
		if (firstRunRef.current) {
			firstRunRef.current = false;
			return;
		}
		if (busy) return;
		if (isEmpty) {
			const timer = window.setTimeout(() => setSaveState("idle"), 0);
			return () => window.clearTimeout(timer);
		}
		const pendingTimer = window.setTimeout(() => setSaveState("pending"), 0);
		const saveTimer = window.setTimeout(() => void persist(false), 900);
		return () => {
			window.clearTimeout(pendingTimer);
			window.clearTimeout(saveTimer);
		};
	}, [to, cc, bcc, subject, bodyText, bodyHtml, documentIds, isEmpty, busy, persist]);

	async function handleSend() {
		if (busy) return;
		setBusy("send");
		setError(null);
		try {
			const message = await persist(true);
			if (!message) {
				setBusy(null);
				return;
			}
			const sent = await window.juno.mail.outbox.send(message.id);
			onDone(sent, true);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(null);
		}
	}

	const handleClose = useCallback(async () => {
		if (busy) return;
		if (saveState === "pending") await persist(false);
		onClose();
	}, [busy, saveState, persist, onClose]);

	// The close button is gone; Escape is the way out, the same as it is on
	// every other full-screen form in the app.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			if (document.querySelector("[role='dialog']")) return;
			void handleClose();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [handleClose]);

	const account = accounts.find((item) => item.id === accountId) ?? null;
	const canSend = account !== null && account.smtpHost !== null;

	const statusLabel =
		busy === "send"
			? "Sending"
			: saveState === "saving"
				? "Saving"
				: saveState === "pending"
					? "Unsaved changes"
					: saveState === "saved"
						? "Saved to drafts"
						: saveState === "error"
							? "Could not save"
							: seed.draft
								? "Draft"
								: "";

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex min-h-full flex-col gap-3 px-6 pt-4 pb-6">
					{accounts.length > 1 ? (
						<div className="max-w-[420px]">
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
						</div>
					) : null}

					<div className="flex items-end gap-[max(200px,20vw)]">
						<div className="min-w-0 flex-1">
							<RecipientField
								label="To"
								value={to}
								onChange={setTo}
								required
								autoFocus={!seed.draft}
								actions={
									!showCopies ? (
										<button
											type="button"
											onClick={() => setShowCopies(true)}
											className="shrink-0 text-[length:var(--text-sm)] text-[var(--accent)] hover:underline"
										>
											Add Cc or Bcc
										</button>
									) : undefined
								}
							/>
						</div>
						<div className="flex-none">
							<div className="mb-1 flex items-baseline justify-end">
								<span
									aria-live="polite"
									className={`text-[length:var(--text-sm)] ${saveState === "error" ? "text-[var(--risk)]" : "text-[var(--ink-muted)]"}`}
								>
									{statusLabel}
								</span>
							</div>
							<Button
								variant="primary"
								disabled={busy !== null || !canSend}
								onClick={() => void handleSend()}
							>
								{busy === "send" ? "Sending" : "Send"}
							</Button>
						</div>
					</div>
					{showCopies ? (
						<>
							<RecipientField
								label="Cc"
								value={cc}
								onChange={setCc}
							/>
							<RecipientField
								label="Bcc"
								value={bcc}
								onChange={setBcc}
								help="Nobody on the message sees these addresses."
							/>
						</>
					) : null}

					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<Field
								label="Subject"
								value={subject}
								onChange={setSubject}
								required
							/>
						</div>
						<div ref={attachmentsRef} className="relative">
							<button
								type="button"
								onClick={() => setAttachmentsOpen((current) => !current)}
								aria-label="Attach a document"
								title="Attach a document"
								className={`flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-sm)] bg-[var(--sunken)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
									documentIds.length > 0 ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
								}`}
							>
								<Icon name="attachment" size={18} />
								{documentIds.length > 0 ? (
									<span className="tabular absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[length:var(--text-micro)] text-[var(--accent-ink)]">
										{documentIds.length}
									</span>
								) : null}
							</button>
							{attachmentsOpen ? (
								<div
									className="absolute top-[calc(100%+4px)] right-0 z-20 w-[320px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-2"
									style={{ boxShadow: "var(--shadow-popover)" }}
								>
									<p className="px-2 pb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Attach documents</p>
									{documents.length === 0 ? (
										<p className="px-2 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{clientId ? "This client has no documents." : "Pick a client to see its documents."}
										</p>
									) : (
										<ul className="max-h-[240px] overflow-y-auto">
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
						</div>
					</div>

					{template && extraFields.length > 0 ? (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
					{missing.length > 0 ? (
						<p className="text-[length:var(--text-sm)] text-[var(--risk)]">
							No value for: {missing.join(", ")}. Fill the field above and it fills in again.
						</p>
					) : null}

					{error ? (
						<p
							role="alert"
							data-selectable
							className="border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
						>
							{error}
						</p>
					) : null}
					{!canSend && account ? (
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{account.email} has no outgoing server, so this can be saved but not sent. Add one under Settings.
						</p>
					) : null}

					<div className="min-h-[240px] flex-1">
						<MessageEditor
							text={bodyText}
							html={bodyHtml}
							onChange={editBody}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
