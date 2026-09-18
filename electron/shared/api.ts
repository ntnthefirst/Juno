/**
 * The contract the preload bridge exposes on `window.bureau`.
 *
 * This is the single definition of what the renderer can ask for. The main
 * process implements it in `electron/main/ipc/`, the preload forwards it, and
 * the renderer consumes it. All three typecheck against this file.
 *
 * What is deliberately absent:
 * - Anything that returns a secret. The renderer can ask to unlock; it can never
 *   read what it is unlocking with.
 * - Any raw SQL. The renderer never sees the database.
 *
 * Every method is async because it crosses a process boundary, even where the
 * service behind it is synchronous.
 */
import type {
	AppInfo,
	AppSettings,
	DocumentRecord,
	DocumentSignature,
	DocumentTemplate,
	DocumentTemplateInput,
	DocumentTemplatePatch,
	GenerateDocumentInput,
	GenerateDocumentResult,
	IsoDate,
	AccountingTool,
	Reminder,
	ReminderCompletion,
	ReminderInput,
	ReminderListQuery,
	ReminderPatch,
	ReminderSuggestion,
	SignDocumentInput,
	BackupInfo,
	Client,
	ClientInput,
	ClientPatch,
	ClientSummary,
	Contact,
	ContactInput,
	ContactPatch,
	LockSettings,
	LockState,
	MailAccount,
	MailAccountInput,
	MailAccountPatch,
	MailConnectionTest,
	MailDraftInput,
	MailDraftPatch,
	MailFolder,
	MailMessage,
	MailMessageBody,
	MailOutboxCounts,
	MailOutboxListQuery,
	MailOutboxMessage,
	MailReplySeed,
	MailSecurity,
	MailSyncStatus,
	MailTemplate,
	MailTemplateInput,
	MailTemplatePatch,
	MailTemplateRender,
	MailThread,
	MailThreadListQuery,
	MailThreadSummary,
	Project,
	ProjectInput,
	ProjectPatch,
	ProjectSummary,
	ReferenceItem,
	ReferenceItemInput,
	ReferenceItemPatch,
	ReferenceSetKey,
	ReferenceSetWithItems,
	ReferenceUsage,
	ResetResult,
	ResetUserItems,
	SearchHit,
	ThemeSetting,
	OwnerProfile,
} from "./types";

export interface ListClientsQuery {
	search?: string;
	statusId?: string | null;
	includeDeleted?: boolean;
	limit?: number;
	offset?: number;
}

export interface BureauApi {
	app: {
		info(): Promise<AppInfo>;
	};

	clients: {
		list(query?: ListClientsQuery): Promise<ClientSummary[]>;
		get(id: string): Promise<Client | null>;
		create(input: ClientInput): Promise<Client>;
		update(id: string, patch: ClientPatch): Promise<Client>;
		/** Soft delete. Returns the row so the interface can offer an undo. */
		remove(id: string): Promise<Client>;
		restore(id: string): Promise<Client>;
	};

	contacts: {
		listForClient(clientId: string): Promise<Contact[]>;
		create(input: ContactInput): Promise<Contact>;
		update(id: string, patch: ContactPatch): Promise<Contact>;
		remove(id: string): Promise<Contact>;
		restore(id: string): Promise<Contact>;
		/** Clears the flag on every sibling, so exactly one can hold it. */
		setPrimary(id: string): Promise<Contact>;
	};

	projects: {
		list(query?: { clientId?: string; statusId?: string | null }): Promise<ProjectSummary[]>;
		get(id: string): Promise<Project | null>;
		create(input: ProjectInput): Promise<Project>;
		update(id: string, patch: ProjectPatch): Promise<Project>;
		remove(id: string): Promise<Project>;
		restore(id: string): Promise<Project>;
	};

	reference: {
		listSets(): Promise<ReferenceSetWithItems[]>;
		getSet(key: ReferenceSetKey): Promise<ReferenceSetWithItems | null>;
		createItem(input: ReferenceItemInput): Promise<ReferenceItem>;
		updateItem(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem>;
		/** Hide, never delete. Records already point at it. See decision 16. */
		hideItem(id: string): Promise<ReferenceItem>;
		unhideItem(id: string): Promise<ReferenceItem>;
		/** How many live records reference this item. Drives the warning in the UI. */
		usage(id: string): Promise<ReferenceUsage>;
		reorder(setId: string, orderedIds: string[]): Promise<ReferenceItem[]>;
		resetSet(key: ReferenceSetKey, userItems: ResetUserItems): Promise<ResetResult>;
		resetAll(userItems: ResetUserItems): Promise<ResetResult>;
	};

	settings: {
		get(): Promise<AppSettings>;
		/** Where the signature image lives, or null when none is set. */
		getSignaturePath(): Promise<string | null>;
		/**
		 * The image as a data URL, for display. Returned as data rather than a path
		 * because the renderer's CSP allows `data:` and not `file:`, and widening it
		 * would let a renderer bug read arbitrary local images.
		 */
		getSignatureImage(): Promise<string | null>;
		/** Opens a file picker in the main process and copies the image in. */
		chooseSignature(): Promise<string | null>;
		clearSignature(): Promise<void>;
		getTheme(): Promise<ThemeSetting>;
		/** Also sets nativeTheme.themeSource, or the title bar disagrees with the window. */
		setTheme(theme: ThemeSetting): Promise<ThemeSetting>;
		getOwner(): Promise<OwnerProfile>;
		setOwner(patch: Partial<OwnerProfile>): Promise<OwnerProfile>;
		/** Where invoicing happens. Invoice reminders link here; Bureau never bills. */
		getAccountingTool(): Promise<AccountingTool>;
		setAccountingTool(patch: Partial<AccountingTool>): Promise<AccountingTool>;
	};

	lock: {
		state(): Promise<LockState>;
		getSettings(): Promise<LockSettings>;
		setSettings(patch: Partial<LockSettings>): Promise<LockSettings>;
		/** Sets or replaces the secret. Requires the current one once configured. */
		configure(input: {
			method: "passphrase" | "pin";
			secret: string;
			currentSecret?: string;
		}): Promise<LockState>;
		disable(currentSecret: string): Promise<LockState>;
		lock(): Promise<LockState>;
		/** The only way in. There is no MCP equivalent, by design. */
		unlock(secret: string): Promise<import("./types").UnlockResult>;
		/** Fires when the main process locks on its own: idle, sleep, minimise. */
		onChange(listener: (state: LockState) => void): () => void;
	};

	backup: {
		create(): Promise<BackupInfo>;
		list(): Promise<BackupInfo[]>;
		/** Replaces the live database. The app restarts afterwards. */
		restore(path: string): Promise<void>;
		revealFolder(): Promise<void>;
	};

	search: {
		global(term: string, limit?: number): Promise<SearchHit[]>;
	};

	templates: {
		list(): Promise<DocumentTemplate[]>;
		get(id: string): Promise<DocumentTemplate | null>;
		create(input: DocumentTemplateInput): Promise<DocumentTemplate>;
		update(id: string, patch: DocumentTemplatePatch): Promise<DocumentTemplate>;
		/**
		 * Marks the text as checked. Separate from update on purpose: reviewing is
		 * a claim about the content and must never be a side effect of an edit.
		 */
		setReviewed(id: string, reviewed: boolean): Promise<DocumentTemplate>;
		remove(id: string): Promise<DocumentTemplate>;
		/** Renders against a client without storing anything, for the editor. */
		preview(input: {
			bodyHtml: string;
			clientId?: string | null;
			projectId?: string | null;
			isSpecimen: boolean;
		}): Promise<{ html: string; missing: string[] }>;
	};

	documents: {
		list(query?: { clientId?: string }): Promise<DocumentRecord[]>;
		get(id: string): Promise<DocumentRecord | null>;
		generate(input: GenerateDocumentInput): Promise<GenerateDocumentResult>;
		setStatus(id: string, statusId: string | null): Promise<DocumentRecord>;
		remove(id: string): Promise<DocumentRecord>;
		restore(id: string): Promise<DocumentRecord>;
		/** The full printable HTML, for showing in a sandboxed frame. */
		previewHtml(id: string): Promise<string>;
		/** Writes the PDF and returns the document with its path filled in. */
		renderPdf(id: string): Promise<DocumentRecord>;
		sign(input: SignDocumentInput): Promise<DocumentSignature>;
		signatures(documentId: string): Promise<DocumentSignature[]>;
		/** Opens the PDF in whatever the OS uses for one. */
		openPdf(id: string): Promise<void>;
		revealPdf(id: string): Promise<void>;
	};

	reminders: {
		list(query?: ReminderListQuery): Promise<Reminder[]>;
		get(id: string): Promise<Reminder | null>;
		create(input: ReminderInput): Promise<Reminder>;
		update(id: string, patch: ReminderPatch): Promise<Reminder>;
		/** A one-off finishes. A recurring one rolls forward to its next occurrence. */
		complete(id: string, note?: string | null): Promise<Reminder>;
		snooze(id: string, until: IsoDate): Promise<Reminder>;
		reopen(id: string): Promise<Reminder>;
		remove(id: string): Promise<Reminder>;
		restore(id: string): Promise<Reminder>;
		history(id: string): Promise<ReminderCompletion[]>;
		/** Computed from the records, never stored. */
		suggestions(): Promise<ReminderSuggestion[]>;
		/** Turns a suggestion into a real reminder. */
		accept(suggestion: ReminderSuggestion): Promise<Reminder>;
		/** Opens a reminder's action link in the real browser. */
		openAction(id: string): Promise<void>;
	};

	mail: {
		accounts: {
			list(): Promise<MailAccount[]>;
			get(id: string): Promise<MailAccount | null>;
			/** The password goes in here and is never readable again. */
			create(input: MailAccountInput): Promise<MailAccount>;
			update(id: string, patch: MailAccountPatch): Promise<MailAccount>;
			/** Also forgets the password. Messages stay until a purge. */
			remove(id: string): Promise<MailAccount>;
			/**
			 * Tries the settings without saving. Leave the password out to test an
			 * existing account with its stored one.
			 */
			test(input: {
				id?: string;
				imapHost?: string;
				imapPort?: number;
				imapSecurity?: MailSecurity;
				username?: string;
				password?: string;
			}): Promise<MailConnectionTest>;
			/** The outgoing side, the same way. Nothing is sent. */
			testSmtp(input: {
				id?: string;
				smtpHost?: string | null;
				smtpPort?: number;
				smtpSecurity?: MailSecurity;
				smtpUsername?: string | null;
				username?: string;
				password?: string;
			}): Promise<MailConnectionTest>;
		};
		folders: {
			list(accountId: string): Promise<MailFolder[]>;
			setSyncEnabled(id: string, enabled: boolean): Promise<MailFolder>;
		};
		sync: {
			/** One account, or every enabled one. Resolves when the run is over. */
			run(accountId?: string): Promise<MailSyncStatus[]>;
			status(): Promise<MailSyncStatus[]>;
			/** Progress, pushed by the main process while a sync runs. */
			onChange(listener: (status: MailSyncStatus) => void): () => void;
		};
		threads: {
			list(query?: MailThreadListQuery): Promise<MailThreadSummary[]>;
			get(id: string): Promise<MailThread | null>;
			linkClient(id: string, clientId: string): Promise<MailThreadSummary>;
			unlinkClient(id: string): Promise<MailThreadSummary>;
			countForClient(clientId: string): Promise<number>;
		};
		messages: {
			get(id: string): Promise<MailMessage | null>;
			/** Beside the frame: text, blocked-image count and links. See MAIL_FRAME_ORIGIN. */
			body(id: string): Promise<MailMessageBody | null>;
		};
		attachments: {
			/** Shows the file in the file manager. Never opens it. */
			reveal(id: string): Promise<void>;
			/** Copies it wherever the person chooses. Null when they cancel. */
			save(id: string): Promise<string | null>;
		};
		/** Opens a link from a message in the real browser, after a protocol check. */
		openLink(url: string): Promise<void>;
		templates: {
			list(): Promise<MailTemplate[]>;
			get(id: string): Promise<MailTemplate | null>;
			create(input: MailTemplateInput): Promise<MailTemplate>;
			update(id: string, patch: MailTemplatePatch): Promise<MailTemplate>;
			remove(id: string): Promise<MailTemplate>;
			/** Fills a template against a client and project. Stores nothing. */
			render(input: {
				templateId: string;
				clientId?: string | null;
				projectId?: string | null;
				extras?: Record<string, string>;
			}): Promise<MailTemplateRender>;
		};
		outbox: {
			list(query?: MailOutboxListQuery): Promise<MailOutboxMessage[]>;
			get(id: string): Promise<MailOutboxMessage | null>;
			counts(accountId?: string): Promise<MailOutboxCounts>;
			createDraft(input: MailDraftInput): Promise<MailOutboxMessage>;
			updateDraft(id: string, patch: MailDraftPatch): Promise<MailOutboxMessage>;
			/** The addresses, subject and quote a reply starts from. */
			replySeed(messageId: string, all: boolean): Promise<MailReplySeed>;
			/** The person's press. Queues the message; the sender picks it up at once. */
			send(id: string): Promise<MailOutboxMessage>;
			/** Approves what an agent prepared. Only a person can reach this. */
			approve(id: string): Promise<MailOutboxMessage>;
			cancel(id: string): Promise<MailOutboxMessage>;
			retry(id: string): Promise<MailOutboxMessage>;
			remove(id: string): Promise<MailOutboxMessage>;
			/** State changes, pushed by the sender as it works. */
			onChange(listener: (message: MailOutboxMessage) => void): () => void;
		};
	};
}

declare global {
	interface Window {
		bureau: BureauApi;
	}
}
