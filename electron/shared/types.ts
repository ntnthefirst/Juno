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

export interface SearchHit {
	kind: "client" | "project" | "contact";
	id: string;
	title: string;
	subtitle: string | null;
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
