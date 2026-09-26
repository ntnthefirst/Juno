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
	ImportDocumentInput,
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
	ClientNote,
	ClientNoteInput,
	ClientNotePatch,
	ClientTimelineEntry,
	ClientTimelineKind,
	ClientTimelineQuery,
	MailFileResult,
	MailAccountInput,
	MailAutoconfig,
	MailAccountPatch,
	MailConnectionTest,
	MailDraftInput,
	MailDraftPatch,
	MailFolder,
	MailMessage,
	MailMessageBody,
	MailMessageClient,
	MailOutboxCounts,
	MailOutboxListQuery,
	MailOutboxMessage,
	MailRecipientSuggestion,
	MailReplyMode,
	MailReplySeed,
	MailSecurity,
	MailSyncStatus,
	MailTemplate,
	MailLayout,
	GoogleFontLoad,
	GoogleFontRequest,
	MailBlockConversion,
	MailTemplateDraft,
	MailTemplateInput,
	MailTemplatePatch,
	MailTemplateRender,
	MailThread,
	MailThreadListQuery,
	MailThreadSummary,
	Project,
	ProjectInput,
	ProjectPatch,
	ProjectAsset,
	ProjectAssetPatch,
	ProjectAssetStorage,
	ProjectCommand,
	ProjectCommandInput,
	ProjectCommandPatch,
	ProjectLink,
	ProjectLinkInput,
	ProjectLinkPatch,
	ProjectRun,
	ProjectsView,
	ProjectStorageChoice,
	ProjectStorageInfo,
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
	OwnerEmailInput,
	OwnerEmailPatch,
	OwnerPhoneInput,
	OwnerPhonePatch,
	OwnerProfile,
	OwnerProfilePatch,
	OnboardingPatch,
	OnboardingState,
	SettingsSection,
	UpdateStatus,
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

		/**
		 * The clipboard commands, run against whatever has focus in this window.
		 *
		 * Electron draws no context menu of its own, so cut, copy and paste have
		 * to come from somewhere for the app's own menu to offer them. They are
		 * routed through the main process rather than the renderer reading the
		 * clipboard itself, which means no clipboard content ever crosses the
		 * bridge: the renderer asks for the edit, the main process performs it on
		 * the focused element, and nothing comes back.
		 */
		edit: {
			cut(): Promise<void>;
			copy(): Promise<void>;
			paste(): Promise<void>;
			selectAll(): Promise<void>;
		};
	};

	/**
	 * Opening and closing windows. Settings is a modal child of the main window,
	 * so `openSettings` disables the application behind it until it is closed.
	 * There is no method to open a second main window: there is only ever one.
	 */
	window: {
		/** A section opens that tab, which is how a screen sends you where it needs you. */
		openSettings(section?: SettingsSection): Promise<void>;
		closeSettings(): Promise<void>;
		isSettingsOpen(): Promise<boolean>;
		/**
		 * Fires in the settings window when it is already open and something asks
		 * for a different tab. The tab cannot ride in the URL at that point, and
		 * reloading would throw away whatever was half-typed.
		 */
		onShowSection(listener: (section: SettingsSection) => void): () => void;
		/**
		 * Fires in the main window when either modal child closes. Neither child
		 * has a channel back, so this is how a setting changed in one of them, and
		 * setup finishing, reach the application behind it.
		 */
		onChildClosed(listener: () => void): () => void;
		/** The first-run window. It is asked for by the main window, and by settings. */
		openSetup(): Promise<void>;
		closeSetup(): Promise<void>;
		isSetupOpen(): Promise<boolean>;
	};

	clients: {
		list(query?: ListClientsQuery): Promise<ClientSummary[]>;
		get(id: string): Promise<Client | null>;
		create(input: ClientInput): Promise<Client>;
		update(id: string, patch: ClientPatch): Promise<Client>;
		/** Soft delete. Returns the row so the interface can offer an undo. */
		remove(id: string): Promise<Client>;
		restore(id: string): Promise<Client>;
		/**
		 * What has happened with this client, assembled from the records that
		 * already hold it. Newest first.
		 */
		timeline(query: ClientTimelineQuery): Promise<ClientTimelineEntry[]>;
		timelineCounts(clientId: string): Promise<Record<ClientTimelineKind, number>>;
	};

	/** Calls, meetings and anything else that leaves no other trace. */
	clientNotes: {
		listForClient(clientId: string): Promise<ClientNote[]>;
		get(id: string): Promise<ClientNote | null>;
		create(input: ClientNoteInput): Promise<ClientNote>;
		update(id: string, patch: ClientNotePatch): Promise<ClientNote>;
		remove(id: string): Promise<ClientNote>;
		restore(id: string): Promise<ClientNote>;
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
		list(query?: {
			clientId?: string;
			statusId?: string | null;
			unassigned?: boolean;
		}): Promise<ProjectSummary[]>;
		get(id: string): Promise<Project | null>;
		create(input: ProjectInput): Promise<Project>;
		update(id: string, patch: ProjectPatch): Promise<Project>;
		remove(id: string): Promise<Project>;
		restore(id: string): Promise<Project>;

		/** Which folder this project's own files are in, and how much is in it. */
		storage(id: string): Promise<ProjectStorageInfo>;
		setStorage(id: string, choice: ProjectStorageChoice): Promise<Project>;
		/**
		 * Opens a folder picker in the main process and moves the files there.
		 * Null when the picker was cancelled, which writes nothing.
		 */
		chooseStorageFolder(id: string, move: boolean): Promise<ProjectStorageInfo | null>;
		useAppStorage(id: string, move: boolean): Promise<ProjectStorageInfo>;
		openStorageFolder(id: string): Promise<void>;
		/** A directory picker. Returns the path so a form can show it before saving. */
		chooseLocalFolder(): Promise<string | null>;
		openLocalFolder(id: string): Promise<void>;
		setCover(id: string, assetId: string | null): Promise<Project>;

		links: {
			list(projectId: string): Promise<ProjectLink[]>;
			create(input: ProjectLinkInput): Promise<ProjectLink>;
			update(id: string, patch: ProjectLinkPatch): Promise<ProjectLink>;
			remove(id: string): Promise<ProjectLink>;
			reorder(projectId: string, orderedIds: string[]): Promise<ProjectLink[]>;
			/** The main process decides browser or file manager, from the target. */
			open(id: string): Promise<void>;
		};

		assets: {
			list(projectId: string): Promise<ProjectAsset[]>;
			/**
			 * A file picker. managed copies the files into the project's folder,
			 * linked points at them where they are. There is no method that takes a
			 * path from here: the renderer never names a file on disk.
			 */
			choose(projectId: string, storage: ProjectAssetStorage): Promise<ProjectAsset[]>;
			update(id: string, patch: ProjectAssetPatch): Promise<ProjectAsset>;
			remove(id: string): Promise<ProjectAsset>;
			restore(id: string): Promise<ProjectAsset>;
			reorder(projectId: string, orderedIds: string[]): Promise<ProjectAsset[]>;
			open(id: string): Promise<void>;
			reveal(id: string): Promise<void>;
		};

		/**
		 * Commands have no MCP counterpart and are not going to get one. One runs
		 * in a real shell with the owner's privileges, so writing one and running
		 * one together are a remote shell. Decision 35.
		 */
		commands: {
			list(projectId: string): Promise<ProjectCommand[]>;
			create(input: ProjectCommandInput): Promise<ProjectCommand>;
			update(id: string, patch: ProjectCommandPatch): Promise<ProjectCommand>;
			remove(id: string): Promise<ProjectCommand>;
			reorder(projectId: string, orderedIds: string[]): Promise<ProjectCommand[]>;
		};

		runs: {
			list(projectId?: string): Promise<ProjectRun[]>;
			start(commandId: string): Promise<ProjectRun>;
			stop(commandId: string): Promise<ProjectRun | null>;
			clear(commandId: string): Promise<void>;
			/** Output arrives as it is printed. Returns an unsubscribe. */
			onChange(listener: (run: ProjectRun) => void): () => void;
		};
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
		/** Whether the main sidebar goes back to the rail on its own. */
		getSidebarAutoCollapse(): Promise<boolean>;
		setSidebarAutoCollapse(value: boolean): Promise<boolean>;
		/** How the projects screen is drawn. A preference, not a record. */
		getProjectsView(): Promise<ProjectsView>;
		setProjectsView(patch: Partial<ProjectsView>): Promise<ProjectsView>;
		getOwner(): Promise<OwnerProfile>;
		/**
		 * The scalar fields only. The two contact lists are edited one entry at a
		 * time, below, so a stale form cannot drop an address added elsewhere.
		 */
		setOwner(patch: OwnerProfilePatch): Promise<OwnerProfile>;
		/** Each of these returns the whole profile, because a primary moves. */
		addOwnerEmail(input: OwnerEmailInput): Promise<OwnerProfile>;
		updateOwnerEmail(id: string, patch: OwnerEmailPatch): Promise<OwnerProfile>;
		removeOwnerEmail(id: string): Promise<OwnerProfile>;
		addOwnerPhone(input: OwnerPhoneInput): Promise<OwnerProfile>;
		updateOwnerPhone(id: string, patch: OwnerPhonePatch): Promise<OwnerProfile>;
		removeOwnerPhone(id: string): Promise<OwnerProfile>;
		/** Where invoicing happens. Invoice reminders link here; Juno never bills. */
		getAccountingTool(): Promise<AccountingTool>;
		setAccountingTool(patch: Partial<AccountingTool>): Promise<AccountingTool>;
		getOnboarding(): Promise<OnboardingState>;
		setOnboarding(patch: OnboardingPatch): Promise<OnboardingState>;
		/** True on a genuinely first launch, and after a step is added an install has not seen. */
		needsOnboarding(): Promise<boolean>;
	};

	/**
	 * Updates, against the public GitHub releases. There is no method that
	 * installs without asking and none that reads the feed URL: the renderer
	 * says check, install or auto-install, and is told what happened.
	 */
	updates: {
		status(): Promise<UpdateStatus>;
		/**
		 * A person pressed the button. Rate-limited to three a minute in the
		 * service, and it throws with how long to wait when that is exceeded.
		 */
		check(): Promise<UpdateStatus>;
		/** Downloads if needed, then restarts into the new version. */
		install(): Promise<UpdateStatus>;
		setAutoInstall(value: boolean): Promise<UpdateStatus>;
		/** Fires while a download runs, which is the only slow part of this. */
		onChange(listener: (status: UpdateStatus) => void): () => void;
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
		/** Copies an existing PDF in and records it as an imported document. */
		import(input: ImportDocumentInput): Promise<DocumentRecord>;
		/** Opens a file picker filtered to PDF and imports the choice for a client. Null when cancelled. */
		chooseImport(clientId: string): Promise<DocumentRecord | null>;
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
			/** Makes the folder on the server, then lists it here. */
			create(input: { accountId: string; name: string; parentId?: string | null }): Promise<MailFolder>;
			rename(id: string, name: string): Promise<MailFolder>;
			/** Removes it from the server with everything in it. Confirmed first. */
			remove(id: string): Promise<MailFolder>;
		};
		/** Who a message can go to, and which clients an address belongs to. */
		recipients: {
			suggest(term: string, limit?: number): Promise<MailRecipientSuggestion[]>;
			clientsFor(addresses: string[]): Promise<MailMessageClient[]>;
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
		/**
		 * Filing mail. Each of these changes the mailbox on the server first and
		 * the local rows second, so nothing here is undone by the next sync.
		 * Deleting for good is exactly that, on the server too, and the window
		 * confirms it with a count before calling.
		 */
		file: {
			archive(threadIds: string[]): Promise<MailFileResult>;
			trash(threadIds: string[]): Promise<MailFileResult>;
			junk(threadIds: string[]): Promise<MailFileResult>;
			moveToFolder(threadIds: string[], folderId: string): Promise<MailFileResult>;
			deleteForever(threadIds: string[]): Promise<number>;
			setSeen(messageIds: string[], seen: boolean): Promise<number>;
			setThreadsSeen(threadIds: string[], seen: boolean): Promise<number>;
			setFlagged(messageIds: string[], flagged: boolean): Promise<number>;
			/** A whole folder read, or unread. Returns how many messages changed. */
			setFolderSeen(folderId: string, seen: boolean): Promise<number>;
			/** Everything in a folder, expunged on the server too. Confirmed first. */
			emptyFolder(folderId: string): Promise<number>;
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
			/** What a picker offers: hidden templates are left out. */
			list(): Promise<MailTemplate[]>;
			/** Every template, hidden ones included. What the management screen shows. */
			listAll(): Promise<MailTemplate[]>;
			get(id: string): Promise<MailTemplate | null>;
			create(input: MailTemplateInput): Promise<MailTemplate>;
			update(id: string, patch: MailTemplatePatch): Promise<MailTemplate>;
			/** Hides a shipped template, soft-deletes one of your own. */
			remove(id: string): Promise<MailTemplate>;
			hide(id: string): Promise<MailTemplate>;
			unhide(id: string): Promise<MailTemplate>;
			duplicate(id: string): Promise<MailTemplate>;
			/** Reads hand-edited HTML back into a canvas. Stores nothing. */
			parseBody(html: string): Promise<MailLayout>;
			/**
			 * A Google font by name, with its files inline, so the canvas can show
			 * it. Juno builds the address itself and never fetches one it is given.
			 */
			loadGoogleFont(request: GoogleFontRequest): Promise<GoogleFontLoad>;
			/** One block as its HTML and CSS. Answers with the changed canvas; stores nothing. */
			convertBlock(input: MailBlockConversion): Promise<MailLayout>;
			/** Renders values in hand. Writes nothing, so a preview cannot mark a
			 * template as edited. */
			preview(draft: MailTemplateDraft): Promise<MailTemplateRender>;
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
			/** The addresses, subject and quote an answer starts from. */
			replySeed(messageId: string, mode: MailReplyMode): Promise<MailReplySeed>;
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
