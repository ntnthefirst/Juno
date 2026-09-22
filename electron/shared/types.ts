/**
 * The shapes that cross the preload bridge, shared by the main process and the
 * renderer. Both sides import from here so a change breaks the typecheck rather
 * than showing up at runtime.
 *
 * Rules that apply to everything in this file:
 * - Timestamps are UTC ISO-8601 strings. Never a Date object: a Date survives
 *   structured clone but not the JSON serialisation the MCP adapter uses, so the
 *   two callers would see different things (see .claude/rules/verify.md).
 * - Money is integer cents, never a float and never a decimal string.
 * - Calendar dates with no time are `YYYY-MM-DD`, not a UTC instant.
 * - Nothing here ever carries a credential.
 */

export type Iso = string;
export type IsoDate = string;
export type Cents = number;

/** Every row Bureau stores carries these. See decision 4. */
export interface Standard {
	id: string;
	ownerId: string;
	createdAt: Iso;
	updatedAt: Iso;
	deletedAt: Iso | null;
}

/* ------------------------------------------------------------------ clients */

export interface Client extends Standard {
	name: string;
	sortName: string;
	statusId: string | null;
	email: string | null;
	phone: string | null;
	website: string | null;
	vatNumber: string | null;
	addressLine1: string | null;
	addressLine2: string | null;
	postalCode: string | null;
	city: string | null;
	country: string | null;
	notes: string | null;
}

/** What a list row needs, resolved, so the renderer does not join by hand. */
export interface ClientSummary {
	id: string;
	name: string;
	status: ReferenceItem | null;
	city: string | null;
	email: string | null;
	projectCount: number;
	openProjectCount: number;
}

export type ClientInput = Partial<
	Omit<Client, keyof Standard | "sortName">
> & { name: string };

export type ClientPatch = Partial<Omit<Client, keyof Standard | "sortName">>;

/* ----------------------------------------------------------------- contacts */

export interface Contact extends Standard {
	clientId: string;
	name: string;
	role: string | null;
	email: string | null;
	phone: string | null;
	isPrimary: boolean;
	notes: string | null;
}

export type ContactInput = Partial<Omit<Contact, keyof Standard>> & {
	clientId: string;
	name: string;
};

export type ContactPatch = Partial<Omit<Contact, keyof Standard | "clientId">>;

/* ----------------------------------------------------------------- projects */

export interface Project extends Standard {
	clientId: string;
	name: string;
	statusId: string | null;
	description: string | null;
	startsOn: IsoDate | null;
	dueOn: IsoDate | null;
	agreedValueCents: Cents | null;
	notes: string | null;
}

export interface ProjectSummary {
	id: string;
	clientId: string;
	clientName: string;
	name: string;
	status: ReferenceItem | null;
	dueOn: IsoDate | null;
	agreedValueCents: Cents | null;
}

export type ProjectInput = Partial<Omit<Project, keyof Standard>> & {
	clientId: string;
	name: string;
};

export type ProjectPatch = Partial<Omit<Project, keyof Standard | "clientId">>;

/* ------------------------------------------------------- reference data (16) */

/** The sets that ship. A set key is stable; its items are editable. */
export type ReferenceSetKey =
	| "client_status"
	| "project_status"
	| "document_status"
	| "label";

export interface ReferenceSet extends Standard {
	key: ReferenceSetKey;
	label: string;
	description: string | null;
	allowsCustomItems: boolean;
}

export interface ReferenceItem extends Standard {
	setId: string;
	key: string;
	label: string;
	/** A token name from brand/tokens.css: ok, warn, risk, seal, accent. Never a hex. */
	tone: string | null;
	seedKey: string | null;
	isSystem: boolean;
	hiddenAt: Iso | null;
	customisedAt: Iso | null;
	sortOrder: number;
}

export interface ReferenceSetWithItems {
	set: ReferenceSet;
	items: ReferenceItem[];
}

export type ReferenceItemInput = {
	setId: string;
	label: string;
	key?: string;
	tone?: string | null;
	sortOrder?: number;
};

export type ReferenceItemPatch = Partial<Pick<ReferenceItem, "label" | "tone" | "sortOrder">>;

/** What a reset does with rows the user created themselves. */
export type ResetUserItems = "keep" | "remove";

export interface ResetResult {
	restored: number;
	unhidden: number;
	userItemsKept: number;
	userItemsRemoved: number;
}

/** Why an item cannot be removed outright. Hiding is always allowed. */
export interface ReferenceUsage {
	itemId: string;
	inUseBy: number;
}

/* ----------------------------------------------------------------- settings */

export type ThemeSetting = "system" | "light" | "dark";

export interface OwnerProfile {
	businessName: string;
	contactName: string;
	email: string;
	phone: string;
	vatNumber: string;
	addressLine1: string;
	addressLine2: string;
	postalCode: string;
	city: string;
	country: string;
	iban: string;
}

export interface AppSettings {
	theme: ThemeSetting;
	lock: LockSettings;
	owner: OwnerProfile;
	seedVersion: number;
	/** The signature image stamped onto signed PDFs, or null when none is set. */
	signaturePath: string | null;
	/**
	 * Where invoicing actually happens. Bureau never raises an invoice; an invoice
	 * reminder links here instead. See decision 9.
	 */
	accountingTool: AccountingTool;
	/** The last day the daily summary was sent, so a restart does not repeat it. */
	lastNotifiedOn: IsoDate | null;
}

export interface AccountingTool {
	name: string;
	url: string;
}

/* --------------------------------------------------------------------- lock */

export type LockMethod = "none" | "passphrase" | "pin";

export interface LockSettings {
	method: LockMethod;
	/** Minutes of inactivity before locking. 0 disables the idle timer. */
	idleMinutes: number;
	lockOnSleep: boolean;
	lockOnMinimise: boolean;
}

export interface LockState {
	/** Whether a secret is configured at all. */
	configured: boolean;
	locked: boolean;
	method: LockMethod;
	/** Set while rate-limited after failed attempts. */
	lockedOutUntil: Iso | null;
	failedAttempts: number;
}

export interface UnlockResult {
	ok: boolean;
	/** Present when the attempt failed. */
	reason?: "wrong-secret" | "rate-limited" | "not-configured";
	lockedOutUntil?: Iso | null;
	remainingAttempts?: number;
}

/* ------------------------------------------------------------------- backup */

export interface BackupInfo {
	path: string;
	createdAt: Iso;
	sizeBytes: number;
}

/* -------------------------------------------------------------------- misc */

export type SearchKind = "client" | "project" | "contact" | "document" | "event" | "mail";

export interface SearchHit {
	kind: SearchKind;
	id: string;
	title: string;
	subtitle: string | null;
	/** `YYYY-MM-DD` for a hit that has a date, so a list can be read in order. */
	on?: IsoDate | null;
}

export interface SearchQuery {
	term: string;
	/** Which kinds to look in. Left out means all of them. */
	kinds?: SearchKind[];
	limit?: number;
}

export interface AppInfo {
	version: string;
	databasePath: string;
	isDev: boolean;
	platform: NodeJS.Platform;
}

/* ---------------------------------------------------------------- documents */

export interface DocumentTemplate extends Standard {
	key: string;
	name: string;
	description: string | null;
	language: string;
	bodyHtml: string;
	/**
	 * Null means nobody has checked the text is sound. Every template that ships
	 * starts null, because the shipped ones are invented. See docs/templates.md.
	 */
	reviewedAt: Iso | null;
	version: number;
	isSystem: boolean;
	customisedAt: Iso | null;
	/** Every path the body refers to, for showing what a template needs. */
	placeholders: string[];
}

export type DocumentTemplateInput = {
	name: string;
	bodyHtml: string;
	key?: string;
	description?: string | null;
	language?: string;
};

export type DocumentTemplatePatch = Partial<
	Pick<DocumentTemplateInput, "name" | "description" | "bodyHtml" | "language">
>;

export interface DocumentRecord extends Standard {
	clientId: string;
	clientName: string;
	projectId: string | null;
	templateId: string | null;
	templateVersion: number | null;
	title: string;
	statusId: string | null;
	/** The rendered body, frozen at generation. Never re-rendered. */
	bodyHtml: string;
	issuedOn: IsoDate | null;
	pdfPath: string | null;
	/** Generated from a template that had not been reviewed. */
	isSpecimen: boolean;
}

export interface GenerateDocumentInput {
	clientId: string;
	templateId: string;
	projectId?: string | null;
	title?: string;
	issuedOn?: IsoDate;
	/** Values typed for this document, such as an addendum's change summary. */
	extras?: Record<string, string>;
}

export interface GenerateDocumentResult {
	document: DocumentRecord;
	/** Placeholders the template wanted and the records could not fill. */
	missing: string[];
}

export interface DocumentSignature extends Standard {
	documentId: string;
	signerName: string;
	signerRole: string | null;
	signedAt: Iso;
	signatureImagePath: string | null;
	/** SHA-256 of the unsigned PDF, so later tampering is detectable. */
	documentHash: string;
	signedPdfPath: string | null;
}

export interface SignDocumentInput {
	documentId: string;
	signerName: string;
	signerRole?: string | null;
	/** Leave out to sign without an image, which is still timestamped and hashed. */
	useSignatureImage?: boolean;
}

/* ---------------------------------------------------------------- reminders */

export type RecurrencePattern = "once" | "days" | "weeks" | "months" | "years" | "quarter_end";

export type ReminderCategory = "paperwork" | "invoice" | "payment" | "renewal" | "other";

/** Which pile a reminder is in today. Computed, never stored. */
export type ReminderBucket = "overdue" | "today" | "soon" | "later" | "snoozed" | "done";

export interface Reminder extends Standard {
	title: string;
	notes: string | null;
	dueOn: IsoDate;
	pattern: RecurrencePattern;
	interval: number;
	anchorDay: number | null;
	/** How many days before the due date it starts asking. */
	leadDays: number;
	category: ReminderCategory;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	documentId: string | null;
	snoozedUntil: IsoDate | null;
	completedAt: Iso | null;
	lastCompletedOn: IsoDate | null;
	/** Where to go to actually do it. Bureau never does it. See decision 9. */
	actionUrl: string | null;
	actionLabel: string | null;
	isSystem: boolean;
	bucket: ReminderBucket;
	recurrenceLabel: string;
}

export interface ReminderInput {
	title: string;
	dueOn: IsoDate;
	notes?: string | null;
	pattern?: RecurrencePattern;
	interval?: number;
	anchorDay?: number | null;
	leadDays?: number;
	category?: ReminderCategory;
	clientId?: string | null;
	projectId?: string | null;
	documentId?: string | null;
	actionUrl?: string | null;
	actionLabel?: string | null;
}

export type ReminderPatch = Partial<ReminderInput>;

export interface ReminderListQuery {
	actionableOnly?: boolean;
	includeDone?: boolean;
	clientId?: string;
	category?: ReminderCategory;
}

/**
 * Worked out from the records rather than stored, so it disappears when the
 * situation that produced it changes. Accepting one writes a real reminder.
 */
export interface ReminderSuggestion {
	key: string;
	title: string;
	notes: string;
	category: ReminderCategory;
	dueOn: IsoDate;
	clientId: string | null;
	projectId: string | null;
	actionUrl: string | null;
	actionLabel: string | null;
}

export interface ReminderCompletion {
	id: string;
	reminderId: string;
	/** The date the occurrence was due, not the date it was ticked. */
	dueOn: IsoDate;
	completedAt: Iso;
	note: string | null;
}

/* --------------------------------------------------------------------- mail */

export type MailSecurity = "tls" | "starttls";

/**
 * An account as the renderer sees it. There is no password field, and there
 * never will be: `hasCredential` is the whole of what the interface learns.
 */
export interface MailAccount extends Standard {
	label: string;
	email: string;
	imapHost: string;
	imapPort: number;
	imapSecurity: MailSecurity;
	username: string;
	horizonDays: number;
	syncIntervalMinutes: number;
	syncEnabled: boolean;
	lastSyncAt: Iso | null;
	lastSyncError: string | null;
	hasCredential: boolean;
	/** Null means the account cannot send. */
	smtpHost: string | null;
	smtpPort: number;
	smtpSecurity: MailSecurity;
	/** Overrides the login name for SMTP only. Null means the IMAP username. */
	smtpUsername: string | null;
	/** The display name on outgoing mail. Null means the owner's name. */
	fromName: string | null;
}

export interface MailAccountInput {
	label?: string;
	email: string;
	imapHost: string;
	imapPort?: number;
	imapSecurity?: MailSecurity;
	username?: string;
	/** Stored in the credential store on the way in. Never read back. */
	password: string;
	horizonDays?: number;
	syncIntervalMinutes?: number;
	syncEnabled?: boolean;
	smtpHost?: string | null;
	smtpPort?: number;
	smtpSecurity?: MailSecurity;
	smtpUsername?: string | null;
	fromName?: string | null;
}

export type MailAccountPatch = Partial<MailAccountInput>;

export interface MailConnectionTest {
	ok: boolean;
	/** What went wrong, for a person, when ok is false. */
	message: string | null;
	folderCount: number;
}

export type MailSpecialUse = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive";

export interface MailFolder extends Standard {
	accountId: string;
	path: string;
	name: string;
	delimiter: string | null;
	specialUse: MailSpecialUse | null;
	syncEnabled: boolean;
	messageCount: number;
	unreadCount: number;
	lastSyncAt: Iso | null;
}

export interface MailAddress {
	name: string | null;
	address: string;
}

export interface MailThreadSummary {
	id: string;
	accountId: string;
	subject: string;
	clientId: string | null;
	clientName: string | null;
	linkSource: "auto" | "manual" | null;
	firstMessageAt: Iso;
	lastMessageAt: Iso;
	messageCount: number;
	unreadCount: number;
	hasAttachments: boolean;
	/** The people on the thread other than the account itself, deduplicated. */
	participants: MailAddress[];
	/** The newest message's first line, or a search snippet when searching. */
	snippet: string;
}

export interface MailAttachment {
	id: string;
	messageId: string;
	filename: string;
	mimeType: string;
	size: number;
	isInline: boolean;
}

/** A message in a thread. Headers always; the body only once fetched. */
export interface MailMessage {
	id: string;
	accountId: string;
	folderId: string;
	threadId: string;
	uid: number;
	messageId: string | null;
	from: MailAddress | null;
	to: MailAddress[];
	cc: MailAddress[];
	replyTo: MailAddress[];
	subject: string;
	snippet: string;
	sentAt: Iso | null;
	internalDate: Iso;
	size: number | null;
	isSeen: boolean;
	isFlagged: boolean;
	isAnswered: boolean;
	hasAttachments: boolean;
	bodyFetched: boolean;
	bodyError: string | null;
	attachments: MailAttachment[];
}

/**
 * Where a message body is served from, as a document of its own with a CSP
 * that allows nothing but inline styles and data: images. The reader points a
 * fully sandboxed frame at `${MAIL_FRAME_ORIGIN}/message/<id>`, and adds
 * `?images=1` only when the person asked for the remote images of that one
 * message.
 */
export const MAIL_FRAME_ORIGIN = "app://mail";

/**
 * What the reader needs beside the frame: the plain text for a message with no
 * HTML, how many remote images were blocked so it can offer to load them, and
 * every link with its real target, since a click inside the frame goes nowhere.
 */
export interface MailMessageBody {
	messageId: string;
	text: string | null;
	hasHtml: boolean;
	remoteImages: number;
	links: { href: string; text: string }[];
}

export interface MailThread {
	summary: MailThreadSummary;
	messages: MailMessage[];
}

export interface MailThreadListQuery {
	accountId?: string;
	folderId?: string;
	clientId?: string;
	/** Full-text over subject, body and sender. */
	search?: string;
	unreadOnly?: boolean;
	limit?: number;
	/** The `lastMessageAt` of the last row seen, for the next page. */
	before?: Iso;
}

export type MailSyncPhase =
	| "idle"
	| "connecting"
	| "folders"
	| "headers"
	| "bodies"
	| "done"
	| "failed";

export interface MailSyncStatus {
	accountId: string;
	phase: MailSyncPhase;
	folderPath: string | null;
	/** Progress inside the current phase, when it is known. */
	done: number;
	total: number;
	startedAt: Iso | null;
	finishedAt: Iso | null;
	error: string | null;
	/** What the run produced so far. */
	newMessages: number;
	fetchedBodies: number;
}

/* ------------------------------------------------------------- mail: sending */

export type MailRegister = "u" | "je";

export interface MailTemplate extends Standard {
	key: string;
	name: string;
	description: string | null;
	language: string;
	register: MailRegister;
	subject: string;
	bodyHtml: string;
	isSystem: boolean;
	customisedAt: Iso | null;
	placeholders: string[];
}

export interface MailTemplateInput {
	name: string;
	subject: string;
	bodyHtml: string;
	key?: string;
	description?: string | null;
	register?: MailRegister;
}

export type MailTemplatePatch = Partial<
	Pick<MailTemplateInput, "name" | "subject" | "bodyHtml" | "description" | "register">
>;

/** A template filled against a client and project, ready to put in a draft. */
export interface MailTemplateRender {
	subject: string;
	bodyHtml: string;
	bodyText: string;
	missing: string[];
}

export type MailOutboxState =
	| "draft"
	| "pending"
	| "queued"
	| "sending"
	| "sent"
	| "failed"
	| "cancelled";

export interface MailOutboxAttachment {
	id: string;
	documentId: string;
	filename: string;
}

export interface MailOutboxMessage extends Standard {
	accountId: string;
	state: MailOutboxState;
	to: MailAddress[];
	cc: MailAddress[];
	bcc: MailAddress[];
	subject: string;
	bodyText: string;
	bodyHtml: string | null;
	messageId: string;
	inReplyTo: string | null;
	replyToMessageId: string | null;
	threadId: string | null;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	templateId: string | null;
	requestedBy: "user" | "agent";
	approvedAt: Iso | null;
	queuedAt: Iso | null;
	attempts: number;
	lastError: string | null;
	sentAt: Iso | null;
	appendedToSentAt: Iso | null;
	appendError: string | null;
	attachments: MailOutboxAttachment[];
}

export interface MailDraftInput {
	accountId: string;
	to: MailAddress[];
	cc?: MailAddress[];
	bcc?: MailAddress[];
	subject: string;
	/** Plain text. The HTML version is made from it unless bodyHtml is given. */
	bodyText: string;
	/** Already rendered HTML, from a template. Left out for a plain message. */
	bodyHtml?: string | null;
	/** The local message this answers. Sets the threading headers. */
	replyToMessageId?: string | null;
	clientId?: string | null;
	projectId?: string | null;
	templateId?: string | null;
	/** Documents to attach. Their PDF is rendered at send time if needed. */
	documentIds?: string[];
}

export type MailDraftPatch = Partial<Omit<MailDraftInput, "accountId">>;

/** What a reply starts from: the addresses and subject, worked out from the original. */
export interface MailReplySeed {
	accountId: string;
	to: MailAddress[];
	cc: MailAddress[];
	subject: string;
	/** The original, quoted, for under the reply. */
	quotedText: string;
	replyToMessageId: string;
	clientId: string | null;
}

export interface MailOutboxListQuery {
	accountId?: string;
	states?: MailOutboxState[];
	limit?: number;
}

export interface MailOutboxCounts {
	pending: number;
	queued: number;
	failed: number;
	drafts: number;
}


/* ----------------------------------------------------------------- calendar */

/**
 * A wall-clock reading with no zone: `YYYY-MM-DDTHH:MM:SS` for a timed event,
 * `YYYY-MM-DD` for an all-day one. The zone is carried beside it.
 */
export type LocalDateTime = string;

/** Which occurrences an edit or a removal of a recurring event reaches. */
export type CalendarScope = "this" | "following" | "all";

export interface CalendarException {
	id: string;
	eventId: string;
	/** The start the rule produced, in the master's zone. RECURRENCE-ID in a file. */
	occurrenceStartLocal: LocalDateTime;
	cancelled: boolean;
	title: string | null;
	notes: string | null;
	location: string | null;
	startLocal: LocalDateTime | null;
	endLocal: LocalDateTime | null;
}

/** A single event, or the master of a series, with its exceptions. */
export interface CalendarEvent extends Standard {
	title: string;
	notes: string | null;
	location: string | null;
	allDay: boolean;
	startLocal: LocalDateTime;
	/** Exclusive. A one-day all-day event ends on the next date. */
	endLocal: LocalDateTime;
	/** IANA zone name. */
	timezone: string;
	/** RFC 5545 rule without the RRULE: prefix, null for a single event. */
	rrule: string | null;
	recurrenceLabel: string;
	startUtc: Iso;
	endUtc: Iso;
	/** When the last occurrence ends, or null for a series with no end. */
	seriesEndUtc: Iso | null;
	icalUid: string;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	exceptions: CalendarException[];
}

export interface CalendarEventInput {
	title: string;
	startLocal: LocalDateTime;
	/** Left out: an hour after the start, or one day for an all-day event. */
	endLocal?: LocalDateTime;
	allDay?: boolean;
	/** Left out: the machine's zone. */
	timezone?: string;
	rrule?: string | null;
	notes?: string | null;
	location?: string | null;
	clientId?: string | null;
	projectId?: string | null;
}

export type CalendarEventPatch = Partial<CalendarEventInput>;

/** Where an edit or a removal of a recurring event applies. */
export interface CalendarEditTarget {
	scope: CalendarScope;
	/** Required for this and following: the occurrence the person is looking at. */
	occurrenceStartLocal?: LocalDateTime;
}

/** One occurrence of an event, as a range query returns it. */
export interface CalendarOccurrence {
	kind: "event";
	eventId: string;
	/** The key of this occurrence within its series. Equal to startLocal for a single event. */
	occurrenceStartLocal: LocalDateTime;
	title: string;
	notes: string | null;
	location: string | null;
	allDay: boolean;
	timezone: string;
	startLocal: LocalDateTime;
	endLocal: LocalDateTime;
	startUtc: Iso;
	endUtc: Iso;
	isRecurring: boolean;
	/** True when this occurrence was moved or edited on its own. */
	isException: boolean;
	rrule: string | null;
	recurrenceLabel: string;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
}

/** A reminder shown on the grid. Read-only here; it is managed on the Reminders screen. */
export interface CalendarReminderItem {
	kind: "reminder";
	reminderId: string;
	title: string;
	dueOn: IsoDate;
	bucket: ReminderBucket;
	category: ReminderCategory;
	clientName: string | null;
}

/** A project deadline shown on the grid. Read-only here; it is managed on the client. */
export interface CalendarDeadlineItem {
	kind: "deadline";
	projectId: string;
	projectName: string;
	clientId: string;
	clientName: string;
	dueOn: IsoDate;
}

export type CalendarItem = CalendarOccurrence | CalendarReminderItem | CalendarDeadlineItem;

export interface CalendarRangeQuery {
	/** First calendar date of the range, inclusive. */
	from: IsoDate;
	/** Last calendar date of the range, inclusive. */
	to: IsoDate;
	/** The zone the dates are read in. Left out: the machine's zone. */
	timezone?: string;
	includeReminders?: boolean;
	includeDeadlines?: boolean;
	clientId?: string;
	projectId?: string;
}

export interface CalendarImportResult {
	created: number;
	updated: number;
	skipped: number;
	warnings: string[];
}

/* -------------------------------------------------------------------- agent */

/**
 * The confirmation gate, as the renderer sees it.
 *
 * A side-effectful tool call from an agent does not run. It parks as a pending
 * action carrying the arguments it would use, and a person approves or rejects
 * it in the app. See .claude/rules/mcp.md section 4.
 */
export type AgentActionState = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";

/** Where the request came from. Never "user": a person's own click is not a request. */
export type AgentActionSource = "mcp" | "assistant" | "automation";

export interface AgentAction extends Standard {
	toolName: string;
	/** The arguments as given. Shown in full before anybody approves. */
	args: Record<string, unknown>;
	/** One line describing what will happen, built when the action was made. */
	summary: string;
	state: AgentActionState;
	source: AgentActionSource;
	automationRunId: string | null;
	expiresAt: Iso;
	decidedAt: Iso | null;
	executedAt: Iso | null;
	/** What the service returned once it ran, JSON. */
	result: unknown;
	error: string | null;
}

export interface AgentActionListQuery {
	states?: AgentActionState[];
	limit?: number;
}

export type AuditActor = "user" | "agent" | "automation";
export type AuditResult = "ok" | "failed" | "pending" | "rejected" | "expired";

export interface AuditEvent extends Standard {
	actor: AuditActor;
	toolName: string;
	/** SHA-256 of the canonical arguments, shortened. No argument value is copied. */
	argsDigest: string;
	summary: string;
	result: AuditResult;
	entityType: string | null;
	entityId: string | null;
	actionId: string | null;
	error: string | null;
}

export interface AuditListQuery {
	actor?: AuditActor;
	toolName?: string;
	/** Only events at or after this instant. */
	since?: Iso;
	limit?: number;
}

/** What a tool is, for the screen that lists the surface an agent can drive. */
export interface ToolSummary {
	name: string;
	title: string;
	description: string;
	readOnly: boolean;
	/** True when a person has to approve each call before it runs. */
	requiresConfirmation: boolean;
	/**
	 * True when the service behind it holds its own gate, so the generic one
	 * would ask twice. `mail.send` is the only one (decision 22).
	 */
	gatedInService: boolean;
}

/* -------------------------------------------------------------- automations */

export type AutomationTrigger =
	| { kind: "manual" }
	| { kind: "daily"; time: string }
	/** `weekday` is 1 for Monday through 7 for Sunday, as ISO-8601 numbers them. */
	| { kind: "weekly"; weekday: number; time: string };

export interface AutomationStep {
	tool: string;
	args: Record<string, unknown>;
}

export interface Automation extends Standard {
	name: string;
	description: string | null;
	trigger: AutomationTrigger;
	steps: AutomationStep[];
	enabled: boolean;
	lastRunAt: Iso | null;
	lastRunOn: IsoDate | null;
	/** Filled by the service: how the last run ended. */
	lastStatus: AutomationRunStatus | null;
}

export interface AutomationInput {
	name: string;
	description?: string | null;
	trigger?: AutomationTrigger;
	steps: AutomationStep[];
	enabled?: boolean;
}

export type AutomationPatch = Partial<AutomationInput>;

export type AutomationRunStatus = "running" | "done" | "waiting" | "failed" | "cancelled";

export interface AutomationRunLogEntry {
	step: number;
	tool: string;
	/** ran, waiting, failed or skipped. */
	outcome: "ran" | "waiting" | "failed" | "skipped";
	at: Iso;
	/** The pending action this step is waiting on. */
	actionId?: string;
	/** Short, readable. The whole result is not copied into the log. */
	detail?: string;
}

export interface AutomationRun extends Standard {
	automationId: string;
	automationName: string;
	startedBy: "manual" | "schedule" | "agent";
	startedAt: Iso;
	finishedAt: Iso | null;
	status: AutomationRunStatus;
	log: AutomationRunLogEntry[];
	stoppedAtStep: number | null;
	error: string | null;
}

/* ---------------------------------------------------------------- briefings */

/** One thing worth knowing, with enough to click through to it. */
export interface BriefingItem {
	kind: "reminder" | "event" | "deadline" | "mail" | "document" | "outbox" | "action";
	id: string;
	title: string;
	detail: string | null;
	/** `YYYY-MM-DD` for anything with a date, null for a count or a state. */
	on: IsoDate | null;
	/** Set when this wants attention rather than simply being true. */
	urgent: boolean;
}

export interface BriefingSection {
	key: string;
	title: string;
	items: BriefingItem[];
	/** Shown when the section is empty, so an empty day still reads as an answer. */
	emptyText: string;
}

export interface Briefing {
	/** The day or range the briefing is about. */
	title: string;
	from: IsoDate;
	to: IsoDate;
	/** One sentence a person or an agent can read on its own. */
	headline: string;
	sections: BriefingSection[];
}

/* ----------------------------------------------------------- the MCP server */

export interface McpServerStatus {
	/** False when the server could not start. Everything else is still true. */
	running: boolean;
	/** The named pipe or socket the bridge connects to. */
	address: string;
	/** How many agents are connected right now. */
	connections: number;
	/** The command an agent should be configured with. */
	command: string;
	args: string[];
	/** The whole config block, ready to paste. */
	configJson: string;
	/** Why it is not running, when it is not. */
	error: string | null;
	toolCount: number;
}
