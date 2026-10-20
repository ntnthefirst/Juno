import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	DocumentRecord,
	MailAccount,
	MailAddress,
	MailOutboxMessage,
	MailTemplate,
	ProjectAsset,
} from "@shared/types";
import { mimeTypeOf } from "@shared/mime";
import { AttachmentIcon } from "../../components/AttachmentIcon";
import { Button } from "../../components/Button";
import { DocumentSearchList } from "../../components/DocumentSearchList";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { IconAction } from "../../components/IconAction";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { useFileDrop } from "../../lib/use-file-drop";
import { formatBytes } from "./format";
import MessageEditor from "./MessageEditor";
import { RecipientField } from "./RecipientField";

export type ComposeSeed = {
	accountId?: string;
	to?: MailAddress[];
	cc?: MailAddress[];
	subject?: string;
	bodyText?: string;
	/** The same body as markup, for a reply that quotes the original in a blockquote. */
	bodyHtml?: string;
	replyToMessageId?: string | null;
	clientId?: string | null;
	projectId?: string | null;
	documentIds?: string[];
	draft?: MailOutboxMessage;
};

type ComposePageProps = {
	seed: ComposeSeed;
	onClose: () => void;
	onDeleted: () => void;
	onDone: (message: MailOutboxMessage, queued: boolean) => void;
};

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Fills the whole content area, edge to edge: no header bar, no maximum
 * width, nothing boxed around the body. A back arrow and a title read as a
 * form; this reads as a blank message the way a mail client's own compose
 * window does, on any size of screen.
 */
export function ComposePage({ seed, onClose, onDeleted, onDone }: ComposePageProps) {
	const [accounts, setAccounts] = useState<MailAccount[]>([]);
	const [templates, setTemplates] = useState<MailTemplate[]>([]);
	const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
	const [documentSearch, setDocumentSearch] = useState("");
	const [attaching, setAttaching] = useState(false);
	const [projectFiles, setProjectFiles] = useState<{ name: string; assets: ProjectAsset[] } | null>(null);
	// The job the message is about: the one it was started from, or the one a
	// reopened draft was saved with. It decides where a kept file goes.
	const projectId = seed.draft?.projectId ?? seed.projectId ?? null;
	const [accountId, setAccountId] = useState(seed.draft?.accountId ?? seed.accountId ?? "");
	const [to, setTo] = useState<MailAddress[]>(seed.draft?.to ?? seed.to ?? []);
	const [cc, setCc] = useState<MailAddress[]>(seed.draft?.cc ?? seed.cc ?? []);
	const [bcc, setBcc] = useState<MailAddress[]>(seed.draft?.bcc ?? []);
	const [showCopies, setShowCopies] = useState(
		(seed.draft?.cc ?? seed.cc ?? []).length > 0 || (seed.draft?.bcc ?? []).length > 0,
	);
	const [subject, setSubject] = useState(seed.draft?.subject ?? seed.subject ?? "");
	const [bodyText, setBodyText] = useState(seed.draft?.bodyText ?? seed.bodyText ?? "");
	const [bodyHtml, setBodyHtml] = useState<string | null>(seed.draft?.bodyHtml ?? seed.bodyHtml ?? null);
	const [clientId, setClientId] = useState(seed.draft?.clientId ?? seed.clientId ?? "");
	const [documentIds, setDocumentIds] = useState<string[]>(
		seed.draft?.attachments.map((attachment) => attachment.documentId) ?? seed.documentIds ?? [],
	);
	const [attachmentsOpen, setAttachmentsOpen] = useState(false);
	const [extras, setExtras] = useState<Record<string, string>>({});
	const [missing, setMissing] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"send" | "render" | "delete" | null>(null);
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

	// Every document, not only the client's: a contract is often kept under a
	// project, or under nothing yet. The client's own are listed first.
	// Read again when the list opens, so a document made meanwhile is in it.
	useEffect(() => {
		let cancelled = false;
		window.juno.documents
			.list()
			.then((rows) => {
				if (!cancelled) setDocuments(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [attachmentsOpen]);

	useEffect(() => {
		if (!attachmentsOpen) return;
		function onPointerDown(event: MouseEvent) {
			if (attachmentsRef.current?.contains(event.target as Node)) return;
			setAttachmentsOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [attachmentsOpen]);

	// A draft that already carries a template id, an older cover-letter draft
	// or one an agent made through mail.draft from a template, still resolves
	// it here so reopening renders the same way it did when it was made.
	// Composing fresh never starts from a template, so nothing here shows a
	// template picker.
	const template = useMemo(() => {
		if (seed.draft?.templateId) return templates.find((item) => item.id === seed.draft!.templateId) ?? null;
		return null;
	}, [templates, seed.draft]);
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
			const rendered = await window.juno.mail.templates.render({ templateId: template.id, extras });
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
	}, [template, extras]);

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

	// Files from this computer live on the saved draft, so they are read from it.
	const files = savedMessage?.files ?? [];

	const isEmpty =
		to.length === 0 &&
		cc.length === 0 &&
		bcc.length === 0 &&
		!subject.trim() &&
		!bodyText.trim() &&
		documentIds.length === 0 &&
		files.length === 0;

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
					projectId,
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
			projectId,
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

	/**
	 * A file from this computer is copied onto the draft, so the draft has to
	 * exist first. Saved now even when nothing else has been typed.
	 */
	async function ensureDraft(): Promise<MailOutboxMessage | null> {
		if (savedMessageRef.current) return savedMessageRef.current;
		if (!accountId) {
			setError("Add a mail account under Settings before attaching files.");
			return null;
		}
		return persist(true);
	}

	async function attachFromComputer() {
		if (attaching) return;
		setAttachmentsOpen(false);
		setAttaching(true);
		setError(null);
		try {
			const draft = await ensureDraft();
			if (!draft) return;
			const message = await window.juno.mail.outbox.files.choose(draft.id);
			if (message) setSavedMessage(message);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setAttaching(false);
		}
	}

	async function attachDropped(dropped: File[]) {
		if (attaching) return;
		setAttaching(true);
		setError(null);
		try {
			const draft = await ensureDraft();
			if (!draft) return;
			for (const file of dropped) {
				// No date is the moment of attaching, which the service fills in.
				const message = await window.juno.mail.outbox.files.add(draft.id, {
					fileName: file.name,
					data: new Uint8Array(await file.arrayBuffer()),
					...(file.lastModified ? { fileDate: new Date(file.lastModified).toISOString() } : {}),
				});
				setSavedMessage(message);
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setAttaching(false);
		}
	}

	// The project's own files, offered beside the documents when the message has
	// a project: the drawing, the photos, the price sheet.
	useEffect(() => {
		if (!projectId || !attachmentsOpen) return;
		let cancelled = false;
		Promise.all([window.juno.projects.get(projectId), window.juno.projects.assets.list(projectId)])
			.then(([project, assets]) => {
				if (!cancelled && project) setProjectFiles({ name: project.name, assets: assets.filter((asset) => asset.exists) });
			})
			.catch(() => {
				// The documents and this computer still work; the project's files are an extra.
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, attachmentsOpen]);

	async function attachProjectFile(assetId: string) {
		if (attaching) return;
		setAttaching(true);
		setError(null);
		try {
			const draft = await ensureDraft();
			if (!draft) return;
			setSavedMessage(await window.juno.mail.outbox.files.addFromProject(draft.id, assetId));
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setAttaching(false);
		}
	}

	async function fileAction(work: () => Promise<MailOutboxMessage>) {
		setError(null);
		try {
			setSavedMessage(await work());
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const drop = useFileDrop((dropped) => void attachDropped(dropped));

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

	async function handleDelete() {
		const existing = savedMessageRef.current;
		if (busy) return;
		if (!existing) {
			onDeleted();
			return;
		}
		setBusy("delete");
		setError(null);
		try {
			await window.juno.mail.outbox.remove(existing.id);
			onDeleted();
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

	const nearbyLabel = clientId
		? (documents?.find((record) => record.clientId === clientId)?.clientName ?? "This client")
		: projectId
			? (documents?.find((record) => record.projectId === projectId)?.projectName ?? "This project")
			: undefined;
	const attachedDocuments = documentIds.map((id) => {
		const record = documents?.find((item) => item.id === id);
		const kept = savedMessage?.attachments.find((item) => item.documentId === id);
		return {
			id,
			name: record ? `${record.title}.pdf` : (kept?.filename ?? "Document"),
			isSpecimen: record?.isSpecimen ?? false,
		};
	});
	const attachmentCount = documentIds.length + files.length;

	return (
		<div {...drop.bind} className="relative flex h-full min-h-0 flex-col">
			{drop.dragging ? (
				<div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)]">
					<p className="font-[var(--weight-medium)] text-[var(--accent)]">Drop to attach. Nothing is kept unless you ask.</p>
				</div>
			) : null}
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
							<div className="flex gap-2">
								<Button variant="danger" disabled={busy !== null} onClick={() => void handleDelete()}>
									Delete
								</Button>
								<Button
									variant="primary"
									disabled={busy !== null || !canSend}
									onClick={() => void handleSend()}
								>
									{busy === "send" ? "Sending" : "Send"}
								</Button>
							</div>
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
								aria-label="Attach"
								aria-expanded={attachmentsOpen}
								title="Attach a document or a file"
								className={`flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-sm)] bg-[var(--sunken)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
									attachmentCount > 0 ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
								}`}
							>
								<Icon name="attachment" size={18} />
								{attachmentCount > 0 ? (
									<span className="tabular absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[length:var(--text-micro)] text-[var(--accent-ink)]">
										{attachmentCount}
									</span>
								) : null}
							</button>
							{attachmentsOpen ? (
								<div
									className="animate-scale absolute top-[calc(100%+4px)] right-0 z-20 flex w-[380px] flex-col rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-2"
									style={{ boxShadow: "var(--shadow-popover)" }}
								>
									<input
										type="search"
										value={documentSearch}
										onChange={(event) => setDocumentSearch(event.target.value)}
										placeholder="Search documents"
										aria-label="Search documents"
										autoFocus
										className="w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
									/>
									<div className="mt-1 max-h-[280px] overflow-y-auto">
										<DocumentSearchList
											documents={documents}
											search={documentSearch}
											{...(nearbyLabel
												? {
														nearby: (record: DocumentRecord) =>
															clientId ? record.clientId === clientId : record.projectId === projectId,
														nearbyLabel,
													}
												: {})}
											checked={documentIds}
											onPick={(record) =>
												setDocumentIds((current) =>
													current.includes(record.id)
														? current.filter((id) => id !== record.id)
														: [...current, record.id],
												)
											}
											emptyText="There are no documents yet."
										/>
										{projectFiles && projectFiles.assets.length > 0 ? (
											<div>
												<p className="px-2 pt-2 pb-1 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
													Files of {projectFiles.name}
												</p>
												<ul>
													{projectFiles.assets.map((asset) => {
														const attached = files.some((file) => file.sourceAssetId === asset.id);
														return (
															<li key={asset.id}>
																<button
																	type="button"
																	disabled={attached || attaching}
																	onClick={() => void attachProjectFile(asset.id)}
																	className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:bg-transparent"
																	style={{ height: "var(--row-height)" }}
																>
																	<AttachmentIcon filename={asset.fileName} mimeType={asset.mimeType ?? mimeTypeOf(asset.fileName)} />
																	<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">{asset.fileName}</span>
																	{attached ? (
																		<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">Attached</span>
																	) : null}
																</button>
															</li>
														);
													})}
												</ul>
											</div>
										) : null}
									</div>
									<div className="mt-2 border-t border-[var(--line)] pt-2">
										<button
											type="button"
											onClick={() => void attachFromComputer()}
											disabled={attaching}
											className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left text-[length:var(--text-dense)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
											style={{ height: "var(--row-height)" }}
										>
											<Icon name="folder-open" size={16} />
											<span className="flex-1">From this computer</span>
										</button>
										<p className="px-2 pt-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											Sent and not kept. You can also drop files on the message.
										</p>
									</div>
								</div>
							) : null}
						</div>
					</div>

					{attachedDocuments.length > 0 || files.length > 0 ? (
						<ul aria-label="Attachments" className="flex flex-col">
							{attachedDocuments.map((attached) => (
								<li
									key={attached.id}
									className="flex items-center gap-3 border-b border-[var(--line)] px-2"
									style={{ height: "var(--row-height)" }}
								>
									<AttachmentIcon filename={attached.name} mimeType={mimeTypeOf(attached.name)} />
									<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">{attached.name}</span>
									{attached.isSpecimen ? (
										<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--risk)]">specimen</span>
									) : null}
									<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">From documents</span>
									<IconAction
										icon="close"
										label={`Remove ${attached.name}`}
										onClick={() => setDocumentIds((current) => current.filter((id) => id !== attached.id))}
									/>
								</li>
							))}
							{files.map((file) => (
								<li
									key={file.id}
									className="flex items-center gap-3 border-b border-[var(--line)] px-2"
									style={{ height: "var(--row-height)" }}
								>
									<AttachmentIcon filename={file.fileName} mimeType={file.mimeType} />
									<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">{file.fileName}</span>
									<span className="tabular shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										{formatBytes(file.byteSize)}
									</span>
									{file.sourceAssetId ? (
										<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">From project files</span>
									) : file.keepsAs ? (
										<label className="flex shrink-0 cursor-pointer items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											<input
												type="checkbox"
												className="accent-[var(--accent)]"
												checked={file.keep}
												onChange={(event) =>
													void fileAction(() =>
														window.juno.mail.outbox.files.setKeep(file.id, event.target.checked),
													)
												}
											/>
											{file.keepsAs === "document" ? "Add to documents when sent" : "Add to project files when sent"}
										</label>
									) : (
										<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">Sent only</span>
									)}
									<IconAction
										icon="close"
										label={`Remove ${file.fileName}`}
										onClick={() => void fileAction(() => window.juno.mail.outbox.files.remove(file.id))}
									/>
								</li>
							))}
						</ul>
					) : null}
					{attaching ? (
						<p role="status" className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Attaching.
						</p>
					) : null}

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
