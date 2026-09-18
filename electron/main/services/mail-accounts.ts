/**
 * Mail accounts: the settings row and the credential beside it.
 *
 * The password takes a one-way trip. It arrives in `create` or `update`, goes
 * into the credential store under a key the row remembers, and is read back by
 * exactly one function, `connectionFor`, which only the sync and the connection
 * test call. Nothing returned from this module carries it.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type {
	MailAccount,
	MailAccountInput,
	MailAccountPatch,
	MailConnectionTest,
	MailSecurity,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now, uuidv7 } from "../db/columns";
import { mailAccounts } from "../db/schema";
import { credentialStore } from "./mail-credentials";
import { describeMailError, openMailbox, type MailConnection } from "./mail-source";

type Row = typeof mailAccounts.$inferSelect;

const SECURITIES: MailSecurity[] = ["tls", "starttls"];

function toRecord(row: Row): MailAccount {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		label: row.label,
		email: row.email,
		imapHost: row.imapHost,
		imapPort: row.imapPort,
		imapSecurity: row.imapSecurity as MailSecurity,
		username: row.username,
		horizonDays: row.horizonDays,
		syncIntervalMinutes: row.syncIntervalMinutes,
		syncEnabled: row.syncEnabled,
		lastSyncAt: row.lastSyncAt,
		lastSyncError: row.lastSyncError,
		hasCredential: credentialStore().get(row.credentialKey) !== null,
	};
}

function validate(input: MailAccountInput | MailAccountPatch): void {
	if (input.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
		throw new Error("The address has to look like name@example.be.");
	}
	if (input.imapHost !== undefined && !/^[a-z0-9.-]+$/i.test(input.imapHost.trim())) {
		throw new Error("The server has to be a hostname, like imap.example.be.");
	}
	if (input.imapPort !== undefined && (!Number.isInteger(input.imapPort) || input.imapPort < 1 || input.imapPort > 65535)) {
		throw new Error("The port has to be between 1 and 65535.");
	}
	if (input.imapSecurity !== undefined && !SECURITIES.includes(input.imapSecurity)) {
		throw new Error("Security has to be tls or starttls. Bureau never connects in the clear.");
	}
	if (input.horizonDays !== undefined && (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 3650)) {
		throw new Error("The sync horizon has to be between 1 and 3650 days.");
	}
	if (input.syncIntervalMinutes !== undefined && (!Number.isInteger(input.syncIntervalMinutes) || input.syncIntervalMinutes < 1 || input.syncIntervalMinutes > 1440)) {
		throw new Error("The sync interval has to be between 1 and 1440 minutes.");
	}
	if (input.password !== undefined && !input.password) {
		throw new Error("The password cannot be empty.");
	}
}

export async function list(db: Db = getDb()): Promise<MailAccount[]> {
	return db
		.select()
		.from(mailAccounts)
		.where(isNull(mailAccounts.deletedAt))
		.orderBy(asc(mailAccounts.createdAt))
		.all()
		.map(toRecord);
}

export async function get(id: string, db: Db = getDb()): Promise<MailAccount | null> {
	const row = db
		.select()
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, id), isNull(mailAccounts.deletedAt)))
		.get();
	return row ? toRecord(row) : null;
}

function requireRow(id: string, db: Db): Row {
	const row = db
		.select()
		.from(mailAccounts)
		.where(and(eq(mailAccounts.id, id), isNull(mailAccounts.deletedAt)))
		.get();
	if (!row) throw new Error("That mail account does not exist.");
	return row;
}

export async function create(input: MailAccountInput, db: Db = getDb()): Promise<MailAccount> {
	validate(input);
	if (!input.password) throw new Error("A mail account needs a password.");
	const store = credentialStore();
	if (!store.isAvailable()) {
		throw new Error(
			"The operating system keychain is unavailable, so the password cannot be stored. Bureau will not keep it anywhere else.",
		);
	}

	const email = input.email.trim().toLowerCase();
	const credentialKey = uuidv7();
	const stamp = now();
	const row: typeof mailAccounts.$inferInsert = {
		label: input.label?.trim() || email,
		email,
		imapHost: input.imapHost.trim().toLowerCase(),
		imapPort: input.imapPort ?? (input.imapSecurity === "starttls" ? 143 : 993),
		imapSecurity: input.imapSecurity ?? "tls",
		username: input.username?.trim() || email,
		credentialKey,
		horizonDays: input.horizonDays ?? 90,
		syncIntervalMinutes: input.syncIntervalMinutes ?? 10,
		syncEnabled: input.syncEnabled ?? true,
		createdAt: stamp,
		updatedAt: stamp,
	};

	// The secret goes in first. If the row insert then fails, an orphaned
	// credential is harmless; a row with no credential would sync forever with
	// the wrong error.
	store.set(credentialKey, input.password);
	const inserted = db.insert(mailAccounts).values(row).returning().get();
	return toRecord(inserted);
}

export async function update(id: string, patch: MailAccountPatch, db: Db = getDb()): Promise<MailAccount> {
	validate(patch);
	const existing = requireRow(id, db);

	if (patch.password !== undefined) {
		credentialStore().set(existing.credentialKey, patch.password);
	}

	const values: Partial<typeof mailAccounts.$inferInsert> = { updatedAt: now() };
	if (patch.label !== undefined) values.label = patch.label.trim() || existing.email;
	if (patch.email !== undefined) values.email = patch.email.trim().toLowerCase();
	if (patch.imapHost !== undefined) values.imapHost = patch.imapHost.trim().toLowerCase();
	if (patch.imapPort !== undefined) values.imapPort = patch.imapPort;
	if (patch.imapSecurity !== undefined) values.imapSecurity = patch.imapSecurity;
	if (patch.username !== undefined) values.username = patch.username.trim() || (values.email ?? existing.email);
	if (patch.horizonDays !== undefined) values.horizonDays = patch.horizonDays;
	if (patch.syncIntervalMinutes !== undefined) values.syncIntervalMinutes = patch.syncIntervalMinutes;
	if (patch.syncEnabled !== undefined) values.syncEnabled = patch.syncEnabled;
	// A changed server or password deserves a fresh attempt, and the old
	// failure message would be misleading beside the new settings.
	if (patch.password !== undefined || patch.imapHost !== undefined || patch.username !== undefined) {
		values.lastSyncError = null;
	}

	const updated = db
		.update(mailAccounts)
		.set(values)
		.where(eq(mailAccounts.id, id))
		.returning()
		.get();
	if (!updated) throw new Error("That mail account does not exist.");
	return toRecord(updated);
}

/**
 * Soft-deletes the account and forgets its password. The messages stay in the
 * database, soft-deleted with it by the sync's next pass being skipped; a
 * purge is a separate decision and not one this function makes.
 */
export async function remove(id: string, db: Db = getDb()): Promise<MailAccount> {
	const existing = requireRow(id, db);
	credentialStore().delete(existing.credentialKey);
	const stamp = now();
	const updated = db
		.update(mailAccounts)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(eq(mailAccounts.id, id))
		.returning()
		.get()!;
	return toRecord(updated);
}

/** Records the outcome of a sync run. Called by the sync engine only. */
export async function recordSync(
	id: string,
	result: { error: string | null },
	db: Db = getDb(),
): Promise<void> {
	const stamp = now();
	db.update(mailAccounts)
		.set({
			lastSyncAt: result.error ? undefined : stamp,
			lastSyncError: result.error,
			updatedAt: stamp,
		})
		.where(eq(mailAccounts.id, id))
		.run();
}

/**
 * The connection details including the secret. The one function that reads a
 * password, and it is not exported through any adapter.
 */
export function connectionFor(id: string, db: Db = getDb()): MailConnection {
	const row = requireRow(id, db);
	const password = credentialStore().get(row.credentialKey);
	if (password === null) {
		throw new Error(
			`No password is stored for ${row.email}. Enter it again in account settings.`,
		);
	}
	return {
		host: row.imapHost,
		port: row.imapPort,
		security: row.imapSecurity as MailSecurity,
		username: row.username,
		password,
	};
}

/**
 * Tries the settings without storing anything. Used by the account form before
 * saving, so a typo is caught while the person is still looking at the field.
 * With `password` left out, the stored credential of an existing account is
 * used, which is how "test the saved account" works without echoing it back.
 */
export async function test(
	input: { id?: string; imapHost?: string; imapPort?: number; imapSecurity?: MailSecurity; username?: string; password?: string },
	db: Db = getDb(),
): Promise<MailConnectionTest> {
	let connection: MailConnection;
	if (input.id && !input.password) {
		const stored = connectionFor(input.id, db);
		connection = {
			host: input.imapHost?.trim().toLowerCase() || stored.host,
			port: input.imapPort ?? stored.port,
			security: input.imapSecurity ?? stored.security,
			username: input.username?.trim() || stored.username,
			password: stored.password,
		};
	} else {
		if (!input.imapHost || !input.username || !input.password) {
			return { ok: false, message: "A server, a username and a password are needed to test.", folderCount: 0 };
		}
		connection = {
			host: input.imapHost.trim().toLowerCase(),
			port: input.imapPort ?? (input.imapSecurity === "starttls" ? 143 : 993),
			security: input.imapSecurity ?? "tls",
			username: input.username.trim(),
			password: input.password,
		};
	}

	let source: Awaited<ReturnType<typeof openMailbox>> | null = null;
	try {
		source = await openMailbox(connection);
		const folders = await source.listFolders();
		return { ok: true, message: null, folderCount: folders.length };
	} catch (error) {
		return { ok: false, message: describeMailError(error, connection), folderCount: 0 };
	} finally {
		await source?.close();
	}
}
