/**
 * The contract the preload bridge exposes on `window.juno`.
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
	AgentClientTarget,
	AgentInstallResult,
	AgentAction,
	AgentActionListQuery,
	AppInfo,
	AppSettings,
	AuditEvent,
	AuditListQuery,
	Automation,
	AutomationInput,
	AutomationPatch,
	AutomationRun,
	Briefing,
	McpServerStatus,
	SearchQuery,
	ToolSummary,
	CalendarEditTarget,
	CalendarEvent,
	CalendarEventInput,
	CalendarEventPatch,
	CalendarImportResult,
	CalendarItem,
	CalendarRangeQuery,
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
	AddressCandidate,
	BackupInfo,
	Client,
	ClientAddress,
	ClientAddressInput,
	ClientAddressPatch,
	ClientEmail,
	ClientEmailInput,
	ClientEmailPatch,
	ClientInput,
	ClientPatch,
	ClientPhone,
	ClientPhoneInput,
	ClientPhonePatch,
	ClientSummary,
	Contact,
	ContactInput,
	ContactPatch,
	LocationSuggestion,
	LockSettings,
	LockState,
	MailAccount,
	MailAccountInput,
	MailAutoconfig,
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

export interface JunoApi {
	app: {
		info(): Promise<AppInfo>;
	};

	/**
	 * Opening and closing windows. Settings is a modal child of the main window,
	 * so `openSettings` disables the application behind it until it is closed.
	 * There is no method to open a second main window: there is only ever one.
	 */
	window: {
		openSettings(): Promise<void>;
		closeSettings(): Promise<void>;
		isSettingsOpen(): Promise<boolean>;
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

	/**
	 * A client's email addresses. The one created first becomes primary on its
	 * own; after that, `isPrimary` only moves when asked.
	 */
	clientEmails: {
		listForClient(clientId: string): Promise<ClientEmail[]>;
		create(input: ClientEmailInput): Promise<ClientEmail>;
		update(id: string, patch: ClientEmailPatch): Promise<ClientEmail>;
		remove(id: string): Promise<ClientEmail>;
		restore(id: string): Promise<ClientEmail>;
		setPrimary(id: string): Promise<ClientEmail>;
	};

	clientPhones: {
		listForClient(clientId: string): Promise<ClientPhone[]>;
		create(input: ClientPhoneInput): Promise<ClientPhone>;
		update(id: string, patch: ClientPhonePatch): Promise<ClientPhone>;
		remove(id: string): Promise<ClientPhone>;
		restore(id: string): Promise<ClientPhone>;
		setPrimary(id: string): Promise<ClientPhone>;
	};

	clientAddresses: {
		listForClient(clientId: string): Promise<ClientAddress[]>;
		create(input: ClientAddressInput): Promise<ClientAddress>;
		update(id: string, patch: ClientAddressPatch): Promise<ClientAddress>;
		remove(id: string): Promise<ClientAddress>;
		restore(id: string): Promise<ClientAddress>;
		setPrimary(id: string): Promise<ClientAddress>;
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
		/** Fires in every window, so a change made in settings reaches the app. */
		onThemeChange(listener: (theme: ThemeSetting) => void): () => void;
		getOwner(): Promise<OwnerProfile>;
		setOwner(patch: Partial<OwnerProfile>): Promise<OwnerProfile>;
		/** Where invoicing happens. Invoice reminders link here; Juno never bills. */
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
		/** The same search, narrowed to some kinds of record. */
		query(input: SearchQuery): Promise<SearchHit[]>;
	};

	agent: {
		/** Whether an agent can reach Juno, and the config block to paste. */
		status(): Promise<McpServerStatus>;
		/**
		 * Writing Juno into the agent clients on this machine, rather than
		 * leaving a person to find five config files and merge JSON by hand.
		 */
		install: {
			targets(): Promise<AgentClientTarget[]>;
			/** Edits that one client's file. Backs it up and keeps every other server. */
			write(clientId: string): Promise<AgentInstallResult>;
		};
		/** Every tool, for the screen that lists the surface. No handlers cross. */
		tools(): Promise<ToolSummary[]>;
		revealConnectionFile(): Promise<void>;
		actions: {
			list(query?: AgentActionListQuery): Promise<AgentAction[]>;
			get(id: string): Promise<AgentAction | null>;
			pendingCount(): Promise<number>;
			/**
			 * Runs what an agent asked for. There is no MCP equivalent and there
			 * will not be: the thing being gated is what would call it.
			 */
			approve(id: string): Promise<AgentAction>;
			reject(id: string): Promise<AgentAction>;
			/** Clears an answered request from the list. The audit row stays. */
			remove(id: string): Promise<AgentAction>;
			/** Fires when a request appears or is answered. */
			onChange(listener: (action: AgentAction) => void): () => void;
		};
		audit: {
			list(query?: AuditListQuery): Promise<AuditEvent[]>;
		};
	};

	automations: {
		list(): Promise<Automation[]>;
		get(id: string): Promise<Automation | null>;
		create(input: AutomationInput): Promise<Automation>;
		update(id: string, patch: AutomationPatch): Promise<Automation>;
		remove(id: string): Promise<Automation>;
		/** Runs it now. A step needing approval stops the run and waits. */
		run(id: string): Promise<AutomationRun>;
		runs(automationId?: string, limit?: number): Promise<AutomationRun[]>;
		cancelRun(runId: string): Promise<AutomationRun>;
		onRunChange(listener: (run: AutomationRun) => void): () => void;
	};

	briefing: {
		today(): Promise<Briefing>;
		client(clientId: string): Promise<Briefing>;
		/** `YYYY-MM`. */
		month(month: string): Promise<Briefing>;
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

	calendar: {
		/** Every occurrence between two dates, with reminders and deadlines when asked. */
		list(query: CalendarRangeQuery): Promise<CalendarItem[]>;
		get(id: string): Promise<CalendarEvent | null>;
		create(input: CalendarEventInput): Promise<CalendarEvent>;
		/**
		 * A series needs a scope: this occurrence, this and following, or all.
		 * Returns the event that now holds the edited occurrences, which for
		 * "following" is a new series.
		 */
		update(id: string, patch: CalendarEventPatch, target?: CalendarEditTarget): Promise<CalendarEvent>;
		/** The same scopes. "all" soft-deletes; the others change the series. */
		remove(id: string, target?: CalendarEditTarget): Promise<CalendarEvent>;
		restore(id: string): Promise<CalendarEvent>;
		/** Asks where to save, writes the file. Null when the person cancels. */
		exportIcs(query: CalendarRangeQuery): Promise<string | null>;
		/** Asks for a file, reads it in. Null when the person cancels. */
		importIcs(): Promise<CalendarImportResult | null>;
	};

	geocoding: {
		/**
		 * Matches from Juno's own data: a client's stored address, or a location
		 * typed on a past event. No network, so this is safe to call on every
		 * keystroke.
		 */
		suggestLocal(query: string): Promise<LocationSuggestion[]>;
		/**
		 * One request to OpenStreetMap's address search, sent only when the person
		 * asks for it. Never called automatically.
		 */
		lookupAddress(query: string): Promise<AddressCandidate[]>;
	};

	mail: {
		accounts: {
			/**
			 * Server settings for an address, so adding an account is a password
			 * rather than six fields. Nothing is saved and nothing is fetched.
			 */
			guess(email: string): Promise<MailAutoconfig>;
			/**
			 * Asks DNS who handles mail for the domain, which names the provider
			 * when the domain does not. A network request, so it is a separate
			 * call a person asks for. Null means the host is not one Juno knows.
			 */
			lookUp(email: string): Promise<MailAutoconfig | null>;
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
		juno: JunoApi;
	}
}
