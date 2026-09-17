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
