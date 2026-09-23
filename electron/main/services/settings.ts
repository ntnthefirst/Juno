/**
 * Application settings: a single JSON file next to the database.
 *
 * Not a database table, on purpose (decision 14). Theme, the lock preferences
 * and the owner profile belong to the installation rather than to the business
 * data, so they must stay readable when the database is being restored or
 * replaced, and they must not travel with a sync of the records.
 *
 * Three properties this file has to keep:
 * - **Every field has a default.** A missing or corrupt file degrades to the
 *   defaults rather than throwing, because a settings file is the last thing
 *   that should stop the app from opening.
 * - **Writes are atomic.** A temp file and a rename, so a crash mid-write cannot
 *   leave a truncated file behind.
 * - **No secrets.** The lock method and its timings live here; the secret itself
 *   lives in vault.ts, wrapped by safeStorage, and never touches this file.
 *
 * This module does not import `electron`. The directory is configurable and only
 * falls back to db/paths.ts when nothing set one, so a plain Node test can point
 * it at a temp folder.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	AccountingTool,
	AppSettings,
	LockSettings,
	OnboardingPatch,
	OnboardingState,
	OwnerEmail,
	OwnerEmailInput,
	OwnerEmailPatch,
	OwnerPhone,
	OwnerPhoneInput,
	OwnerPhonePatch,
	OwnerProfile,
	OwnerProfilePatch,
	ThemeSetting,
} from "../../shared/types";

const DEFAULT_LOCK: LockSettings = {
	method: "none",
	idleMinutes: 15,
	lockOnSleep: true,
	lockOnMinimise: false,
};

const DEFAULT_OWNER: OwnerProfile = {
	businessName: "",
	firstName: "",
	lastName: "",
	vatNumber: "",
	establishmentNumber: "",
	addressLine1: "",
	addressLine2: "",
	postalCode: "",
	city: "",
	country: "",
	iban: "",
	emails: [],
	phones: [],
};

/** The scalar keys, which is what a patch may carry and what normalise reads. */
const OWNER_SCALARS = (Object.keys(DEFAULT_OWNER) as (keyof OwnerProfile)[]).filter(
	(key): key is keyof OwnerProfilePatch => key !== "emails" && key !== "phones",
);

const DEFAULT_ACCOUNTING: AccountingTool = { name: "", url: "" };

/**
 * The shape of the setup as it stands today. Adding a step that an existing
 * install has never been asked means bumping this, and nothing else.
 *
 * Version 2: the one long business step became a name step and a business
 * step, the email and phone questions left (they are lists under settings now),
 * and the whole thing moved into its own window. An install that answered
 * version 1 was never asked for a first name or an establishment number, so it
 * is asked once more.
 */
export const ONBOARDING_VERSION = 2;

const DEFAULT_ONBOARDING: OnboardingState = {
	completedAt: null,
	walkthroughSeenAt: null,
	version: 0,
};

const DEFAULTS: AppSettings = {
	theme: "system",
	lock: DEFAULT_LOCK,
	owner: DEFAULT_OWNER,
	seedVersion: 0,
	signaturePath: null,
	accountingTool: DEFAULT_ACCOUNTING,
	lastNotifiedOn: null,
	onboarding: DEFAULT_ONBOARDING,
};

const THEMES: ThemeSetting[] = ["system", "light", "dark"];

let directory: string | null = null;
let cache: AppSettings | null = null;

/**
 * Point the store at a directory. The main process calls this once with the
 * user data folder; a test calls it with a temp folder. Leaving it unset falls
 * back to db/paths.ts, which is the only module here that knows about Electron.
 */
export function configureSettings(dir: string | null): void {
	directory = dir;
	cache = null;
}

function settingsFile(): string {
	if (!directory) {
		// Injected by main.ts at startup rather than read from db/paths.ts here,
		// which imports `electron` and so cannot load in a plain Node test.
		throw new Error("configureSettings() was not called before the settings store was used.");
	}
	return join(directory, "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** A timestamp that is either a non-empty string or absent. */
function iso(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

/** A new id for an entry in one of the owner's two lists. */
function entryId(): string {
	// Not uuidv7: these are keys inside a JSON file rather than table rows, and
	// nothing sorts on them, so this avoids importing the database's column
	// helpers into a module that deliberately knows nothing about the database.
	return randomUUID();
}

type RawContact = { id: string; value: string; label: string | null; isPrimary: boolean };

/**
 * One list of contact details, read defensively and left with exactly one
 * primary. A file written by an older version, or by hand, can hold two
 * primaries or none; every read that follows assumes one, so it is settled here.
 */
function normaliseContacts(raw: unknown, field: "email" | "phone"): RawContact[] {
	const rows = Array.isArray(raw) ? raw : [];
	const seen = new Set<string>();
	const entries: RawContact[] = [];

	for (const row of rows) {
		if (!isRecord(row)) continue;
		const value = str(row[field], "").trim();
		if (!value || seen.has(value.toLowerCase())) continue;
		seen.add(value.toLowerCase());
		entries.push({
			id: typeof row.id === "string" && row.id ? row.id : entryId(),
			value,
			label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : null,
			isPrimary: bool(row.isPrimary, false),
		});
	}

	const primary = entries.findIndex((entry) => entry.isPrimary);
	const chosen = primary === -1 ? 0 : primary;
	return entries.map((entry, index) => ({ ...entry, isPrimary: index === chosen }));
}

function normaliseEmails(raw: unknown): OwnerEmail[] {
	return normaliseContacts(raw, "email").map(({ id, value, label, isPrimary }) => ({
		id,
		email: value,
		label,
		isPrimary,
	}));
}

function normalisePhones(raw: unknown): OwnerPhone[] {
	return normaliseContacts(raw, "phone").map(({ id, value, label, isPrimary }) => ({
		id,
		phone: value,
		label,
		isPrimary,
	}));
}

/**
 * Field by field, so an unknown key, a wrong type or a half-written file cannot
 * produce a settings object the rest of the app then has to guard against.
 */
function normalise(raw: unknown): AppSettings {
	if (!isRecord(raw)) return { ...DEFAULTS, lock: { ...DEFAULT_LOCK }, owner: { ...DEFAULT_OWNER } };

	const lockRaw = isRecord(raw.lock) ? raw.lock : {};
	const ownerRaw = isRecord(raw.owner) ? raw.owner : {};

	const method = lockRaw.method;
	const owner: OwnerProfile = { ...DEFAULT_OWNER };
	for (const key of OWNER_SCALARS) {
		owner[key] = str(ownerRaw[key], DEFAULT_OWNER[key]);
	}
	owner.emails = normaliseEmails(ownerRaw.emails);
	owner.phones = normalisePhones(ownerRaw.phones);

	// Carried forward from the shape that held one name, one address and one
	// number. An install that answered those questions keeps its answers rather
	// than finding the fields empty after an update.
	if (!owner.firstName && !owner.lastName) {
		const legacy = str(ownerRaw.contactName, "").trim();
		if (legacy) {
			const cut = legacy.indexOf(" ");
			owner.firstName = cut === -1 ? legacy : legacy.slice(0, cut);
			owner.lastName = cut === -1 ? "" : legacy.slice(cut + 1).trim();
		}
	}
	if (owner.emails.length === 0) {
		const legacy = str(ownerRaw.email, "").trim();
		if (legacy) owner.emails = [{ id: entryId(), email: legacy, label: null, isPrimary: true }];
	}
	if (owner.phones.length === 0) {
		const legacy = str(ownerRaw.phone, "").trim();
		if (legacy) owner.phones = [{ id: entryId(), phone: legacy, label: null, isPrimary: true }];
	}

	return {
		theme: THEMES.includes(raw.theme as ThemeSetting) ? (raw.theme as ThemeSetting) : DEFAULTS.theme,
		lock: {
			method:
				method === "passphrase" || method === "pin" || method === "none"
					? method
					: DEFAULT_LOCK.method,
			idleMinutes: Math.max(0, int(lockRaw.idleMinutes, DEFAULT_LOCK.idleMinutes)),
			lockOnSleep: bool(lockRaw.lockOnSleep, DEFAULT_LOCK.lockOnSleep),
			lockOnMinimise: bool(lockRaw.lockOnMinimise, DEFAULT_LOCK.lockOnMinimise),
		},
		owner,
		seedVersion: Math.max(0, int(raw.seedVersion, DEFAULTS.seedVersion)),
		signaturePath: typeof raw.signaturePath === "string" && raw.signaturePath ? raw.signaturePath : null,
		lastNotifiedOn:
			typeof raw.lastNotifiedOn === "string" && raw.lastNotifiedOn ? raw.lastNotifiedOn : null,
		accountingTool: {
			name: str(isRecord(raw.accountingTool) ? raw.accountingTool.name : undefined, ""),
			url: str(isRecord(raw.accountingTool) ? raw.accountingTool.url : undefined, ""),
		},
		onboarding: {
			completedAt: iso(isRecord(raw.onboarding) ? raw.onboarding.completedAt : undefined),
			walkthroughSeenAt: iso(isRecord(raw.onboarding) ? raw.onboarding.walkthroughSeenAt : undefined),
			version: Math.max(
				0,
				int(isRecord(raw.onboarding) ? raw.onboarding.version : undefined, DEFAULT_ONBOARDING.version),
			),
		},
	};
}

function read(): AppSettings {
	if (cache) return cache;
	let raw: unknown = null;
	try {
		raw = JSON.parse(readFileSync(settingsFile(), "utf8"));
	} catch {
		// Missing or unreadable is the first-run case and the corrupt case, and both
		// want the same answer: the defaults, in memory, written back on next change.
		raw = null;
	}
	cache = normalise(raw);
	return cache;
}

function write(next: AppSettings): AppSettings {
	const path = settingsFile();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
	cache = next;
	return next;
}

/** A copy nothing outside this module shares, lists included. */
function cloneOwner(owner: OwnerProfile): OwnerProfile {
	return {
		...owner,
		emails: owner.emails.map((entry) => ({ ...entry })),
		phones: owner.phones.map((entry) => ({ ...entry })),
	};
}

export async function get(): Promise<AppSettings> {
	const current = read();
	return { ...current, lock: { ...current.lock }, owner: cloneOwner(current.owner) };
}

export async function getTheme(): Promise<ThemeSetting> {
	return read().theme;
}

export async function setTheme(theme: ThemeSetting): Promise<ThemeSetting> {
	if (!THEMES.includes(theme)) {
		throw new Error(`Unknown theme "${theme}". Use system, light or dark.`);
	}
	return write({ ...read(), theme }).theme;
}

export async function getOwner(): Promise<OwnerProfile> {
	return cloneOwner(read().owner);
}

/**
 * The scalar fields. The two contact lists are not patchable in one go on
 * purpose: a form that had loaded three addresses and posted them back would
 * silently drop a fourth added from anywhere else in between.
 */
export async function setOwner(patch: OwnerProfilePatch): Promise<OwnerProfile> {
	const current = read();
	const owner = cloneOwner(current.owner);
	for (const key of OWNER_SCALARS) {
		const value = patch[key];
		if (value !== undefined) owner[key] = String(value);
	}
	return cloneOwner(write({ ...current, owner }).owner);
}

/** Writes one of the two lists back, then hands out a copy of the result. */
function writeOwner(owner: OwnerProfile): OwnerProfile {
	return cloneOwner(write({ ...read(), owner }).owner);
}

function requireValue(value: unknown, what: "email address" | "phone number"): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed) throw new Error(`An ${what} cannot be empty.`);
	return trimmed;
}

/**
 * Exactly one primary while the list has anything in it. Called after every
 * change, so no caller has to remember which of the three cases it is in:
 * a new primary, a removed primary, or a primary that was never set.
 */
function settlePrimary<T extends { id: string; isPrimary: boolean }>(entries: T[], prefer: string | null): T[] {
	if (entries.length === 0) return entries;
	const chosen =
		(prefer && entries.some((entry) => entry.id === prefer) ? prefer : null) ??
		entries.find((entry) => entry.isPrimary)?.id ??
		entries[0].id;
	return entries.map((entry) => ({ ...entry, isPrimary: entry.id === chosen }));
}

function findEntry<T extends { id: string }>(entries: T[], id: string, what: string): T {
	const found = entries.find((entry) => entry.id === id);
	if (!found) throw new Error(`No ${what} with id "${id}". It may already have been removed.`);
	return found;
}

export async function addOwnerEmail(input: OwnerEmailInput): Promise<OwnerProfile> {
	const email = requireValue(input.email, "email address");
	const owner = cloneOwner(read().owner);
	const existing = owner.emails.find((entry) => entry.email.toLowerCase() === email.toLowerCase());

	if (existing) {
		// Adding an address that is already there is not an error: it happens the
		// moment a mail account is added for an address already typed in by hand.
		// The label and the primary flag still apply, so the call is not wasted.
		if (input.label !== undefined) existing.label = input.label?.trim() || null;
		owner.emails = settlePrimary(owner.emails, input.isPrimary === true ? existing.id : null);
		return writeOwner(owner);
	}

	const entry: OwnerEmail = {
		id: entryId(),
		email,
		label: input.label?.trim() || null,
		isPrimary: false,
	};
	owner.emails = settlePrimary([...owner.emails, entry], input.isPrimary === true ? entry.id : null);
	return writeOwner(owner);
}

export async function updateOwnerEmail(id: string, patch: OwnerEmailPatch): Promise<OwnerProfile> {
	const owner = cloneOwner(read().owner);
	const entry = findEntry(owner.emails, id, "email address");
	if (patch.email !== undefined) entry.email = requireValue(patch.email, "email address");
	if (patch.label !== undefined) entry.label = patch.label?.trim() || null;
	owner.emails = settlePrimary(owner.emails, patch.isPrimary === true ? id : null);
	return writeOwner(owner);
}

export async function removeOwnerEmail(id: string): Promise<OwnerProfile> {
	const owner = cloneOwner(read().owner);
	findEntry(owner.emails, id, "email address");
	owner.emails = settlePrimary(
		owner.emails.filter((entry) => entry.id !== id),
		null,
	);
	return writeOwner(owner);
}

export async function addOwnerPhone(input: OwnerPhoneInput): Promise<OwnerProfile> {
	const phone = requireValue(input.phone, "phone number");
	const owner = cloneOwner(read().owner);
	const existing = owner.phones.find((entry) => entry.phone.toLowerCase() === phone.toLowerCase());

	if (existing) {
		if (input.label !== undefined) existing.label = input.label?.trim() || null;
		owner.phones = settlePrimary(owner.phones, input.isPrimary === true ? existing.id : null);
		return writeOwner(owner);
	}

	const entry: OwnerPhone = {
		id: entryId(),
		phone,
		label: input.label?.trim() || null,
		isPrimary: false,
	};
	owner.phones = settlePrimary([...owner.phones, entry], input.isPrimary === true ? entry.id : null);
	return writeOwner(owner);
}

export async function updateOwnerPhone(id: string, patch: OwnerPhonePatch): Promise<OwnerProfile> {
	const owner = cloneOwner(read().owner);
	const entry = findEntry(owner.phones, id, "phone number");
	if (patch.phone !== undefined) entry.phone = requireValue(patch.phone, "phone number");
	if (patch.label !== undefined) entry.label = patch.label?.trim() || null;
	owner.phones = settlePrimary(owner.phones, patch.isPrimary === true ? id : null);
	return writeOwner(owner);
}

export async function removeOwnerPhone(id: string): Promise<OwnerProfile> {
	const owner = cloneOwner(read().owner);
	findEntry(owner.phones, id, "phone number");
	owner.phones = settlePrimary(
		owner.phones.filter((entry) => entry.id !== id),
		null,
	);
	return writeOwner(owner);
}

/**
 * The non-secret half of the lock settings. The method recorded here says what
 * the user chose; whether a secret actually exists is vault.ts's answer, not
 * this file's.
 */
export async function getLock(): Promise<LockSettings> {
	return { ...read().lock };
}

export async function setLock(patch: Partial<LockSettings>): Promise<LockSettings> {
	const current = read();
	const lock: LockSettings = {
		method: patch.method ?? current.lock.method,
		idleMinutes: Math.max(0, Math.trunc(patch.idleMinutes ?? current.lock.idleMinutes)),
		lockOnSleep: patch.lockOnSleep ?? current.lock.lockOnSleep,
		lockOnMinimise: patch.lockOnMinimise ?? current.lock.lockOnMinimise,
	};
	return { ...write({ ...current, lock }).lock };
}

/** The seed version already applied to this installation. See seed.ts. */
export async function getLastNotifiedOn(): Promise<string | null> {
	return read().lastNotifiedOn;
}

export async function setLastNotifiedOn(day: string | null): Promise<void> {
	write({ ...read(), lastNotifiedOn: day });
}

export async function getAccountingTool(): Promise<AccountingTool> {
	return read().accountingTool;
}

export async function setAccountingTool(patch: Partial<AccountingTool>): Promise<AccountingTool> {
	const current = read();
	return write({ ...current, accountingTool: { ...current.accountingTool, ...patch } })
		.accountingTool;
}

export async function getSignaturePath(): Promise<string | null> {
	return read().signaturePath;
}

export async function setSignaturePath(path: string | null): Promise<string | null> {
	return write({ ...read(), signaturePath: path }).signaturePath;
}

export async function getSeedVersion(): Promise<number> {
	return read().seedVersion;
}

export async function setSeedVersion(version: number): Promise<number> {
	return write({ ...read(), seedVersion: Math.max(0, Math.trunc(version)) }).seedVersion;
}

export async function getOnboarding(): Promise<OnboardingState> {
	return { ...read().onboarding };
}

/**
 * Patched rather than replaced, because the setup window and the walkthrough
 * write different fields at different times and neither knows about the other.
 */
export async function setOnboarding(patch: OnboardingPatch): Promise<OnboardingState> {
	const current = read();
	const next = { ...current.onboarding, ...patch };
	write({ ...current, onboarding: next });
	return { ...next };
}

/**
 * True on a genuinely first launch, and after a reset. The version check is what
 * makes a new step reach an install that finished an older setup.
 */
export async function needsOnboarding(): Promise<boolean> {
	const state = read().onboarding;
	return state.completedAt === null || state.version < ONBOARDING_VERSION;
}
