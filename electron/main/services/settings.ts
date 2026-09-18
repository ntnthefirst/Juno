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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	AccountingTool,
	AppSettings,
	LockSettings,
	OwnerProfile,
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
	contactName: "",
	email: "",
	phone: "",
	vatNumber: "",
	addressLine1: "",
	addressLine2: "",
	postalCode: "",
	city: "",
	country: "",
	iban: "",
};

const DEFAULT_ACCOUNTING: AccountingTool = { name: "", url: "" };

const DEFAULTS: AppSettings = {
	theme: "system",
	lock: DEFAULT_LOCK,
	owner: DEFAULT_OWNER,
	seedVersion: 0,
	signaturePath: null,
	accountingTool: DEFAULT_ACCOUNTING,
	lastNotifiedOn: null,
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

/**
 * Field by field, so an unknown key, a wrong type or a half-written file cannot
 * produce a settings object the rest of the app then has to guard against.
 */
function normalise(raw: unknown): AppSettings {
	if (!isRecord(raw)) return { ...DEFAULTS, lock: { ...DEFAULT_LOCK }, owner: { ...DEFAULT_OWNER } };

	const lockRaw = isRecord(raw.lock) ? raw.lock : {};
	const ownerRaw = isRecord(raw.owner) ? raw.owner : {};

	const method = lockRaw.method;
	const owner = { ...DEFAULT_OWNER };
	for (const key of Object.keys(DEFAULT_OWNER) as (keyof OwnerProfile)[]) {
		owner[key] = str(ownerRaw[key], DEFAULT_OWNER[key]);
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

export async function get(): Promise<AppSettings> {
	const current = read();
	return { ...current, lock: { ...current.lock }, owner: { ...current.owner } };
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
	return { ...read().owner };
}

export async function setOwner(patch: Partial<OwnerProfile>): Promise<OwnerProfile> {
	const current = read();
	const owner = { ...current.owner };
	for (const key of Object.keys(DEFAULT_OWNER) as (keyof OwnerProfile)[]) {
		const value = patch[key];
		if (value !== undefined) owner[key] = String(value);
	}
	return { ...write({ ...current, owner }).owner };
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
