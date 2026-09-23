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
import * as settings from "./settings";
import { verifyTransport, type SmtpConnection } from "./mail-transport";

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
		smtpHost: row.smtpHost,
		smtpPort: row.smtpPort,
		smtpSecurity: row.smtpSecurity as MailSecurity,
		smtpUsername: row.smtpUsername,
		fromName: row.fromName,
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
		throw new Error("Security has to be tls or starttls. Juno never connects in the clear.");
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
	if (input.smtpHost !== undefined && input.smtpHost !== null && input.smtpHost.trim() && !/^[a-z0-9.-]+$/i.test(input.smtpHost.trim())) {
		throw new Error("The SMTP server has to be a hostname, like smtp.example.be.");
	}
	if (input.smtpPort !== undefined && (!Number.isInteger(input.smtpPort) || input.smtpPort < 1 || input.smtpPort > 65535)) {
		throw new Error("The SMTP port has to be between 1 and 65535.");
	}
	if (input.smtpSecurity !== undefined && !SECURITIES.includes(input.smtpSecurity)) {
		throw new Error("SMTP security has to be tls or starttls. Juno never sends in the clear.");
	}
}

function hostOrNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim().toLowerCase() ?? "";
	return trimmed ? trimmed : null;
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
			"The operating system keychain is unavailable, so the password cannot be stored. Juno will not keep it anywhere else.",
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
		smtpHost: hostOrNull(input.smtpHost),
		smtpPort: input.smtpPort ?? (input.smtpSecurity === "starttls" ? 587 : 465),
		smtpSecurity: input.smtpSecurity ?? "tls",
		smtpUsername: input.smtpUsername?.trim() || null,
		fromName: input.fromName?.trim() || null,
		createdAt: stamp,
		updatedAt: stamp,
	};

	// The secret goes in first. If the row insert then fails, an orphaned
	// credential is harmless; a row with no credential would sync forever with
	// the wrong error.
	store.set(credentialKey, input.password);
	const inserted = db.insert(mailAccounts).values(row).returning().get();

	// An address Juno now reads mail at is one of the owner's own addresses, so
	// it joins the list the profile keeps and the documents print from. Adding
	// one already on the list changes nothing, and this never moves the primary:
	// which address a contract carries is the owner's choice, not a side effect
	// of setting up a mailbox.
	// No label: the settings screen marks an address that has an account of its
	// own, so writing one here would print the same fact twice.
	await settings.addOwnerEmail({ email: inserted.email });

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
	if (patch.smtpHost !== undefined) values.smtpHost = hostOrNull(patch.smtpHost);
	if (patch.smtpPort !== undefined) values.smtpPort = patch.smtpPort;
	if (patch.smtpSecurity !== undefined) values.smtpSecurity = patch.smtpSecurity;
	if (patch.smtpUsername !== undefined) values.smtpUsername = patch.smtpUsername?.trim() || null;
	if (patch.fromName !== undefined) values.fromName = patch.fromName?.trim() || null;
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

/**
 * The SMTP side of the same account, with the same secret. Null host means the
 * account was set up for reading only, and the error says what to add.
 */
export function smtpConnectionFor(id: string, db: Db = getDb()): SmtpConnection {
	const row = requireRow(id, db);
	if (!row.smtpHost) {
		throw new Error(`${row.email} has no outgoing server. Add one in account settings.`);
	}
	const password = credentialStore().get(row.credentialKey);
	if (password === null) {
		throw new Error(`No password is stored for ${row.email}. Enter it again in account settings.`);
	}
	return {
		host: row.smtpHost,
		port: row.smtpPort,
		security: row.smtpSecurity as MailSecurity,
		username: row.smtpUsername || row.username,
		password,
		fromAddress: row.email,
		fromName: row.fromName,
	};
}

/** Tries the outgoing settings without sending anything. */
export async function testSmtp(
	input: { id?: string; smtpHost?: string | null; smtpPort?: number; smtpSecurity?: MailSecurity; smtpUsername?: string | null; username?: string; password?: string },
	db: Db = getDb(),
): Promise<MailConnectionTest> {
	let connection: SmtpConnection;
	if (input.id && !input.password) {
		const row = requireRow(input.id, db);
		const password = credentialStore().get(row.credentialKey);
		if (password === null) {
			return { ok: false, message: `No password is stored for ${row.email}. Enter it again in account settings.`, folderCount: 0 };
		}
		const host = input.smtpHost !== undefined ? hostOrNull(input.smtpHost) : row.smtpHost;
		if (!host) return { ok: false, message: "An outgoing server is needed to test.", folderCount: 0 };
		connection = {
			host,
			port: input.smtpPort ?? row.smtpPort,
			security: input.smtpSecurity ?? (row.smtpSecurity as MailSecurity),
			username: (input.smtpUsername !== undefined ? input.smtpUsername?.trim() : row.smtpUsername) || row.username,
			password,
			fromAddress: row.email,
			fromName: row.fromName,
		};
	} else {
		const host = hostOrNull(input.smtpHost);
		const username = input.smtpUsername?.trim() || input.username?.trim();
		if (!host || !username || !input.password) {
			return { ok: false, message: "An outgoing server, a username and a password are needed to test.", folderCount: 0 };
		}
		connection = {
			host,
			port: input.smtpPort ?? (input.smtpSecurity === "starttls" ? 587 : 465),
			security: input.smtpSecurity ?? "tls",
			username,
			password: input.password,
			fromAddress: username,
			fromName: null,
		};
	}
	try {
		await verifyTransport(connection);
		return { ok: true, message: null, folderCount: 0 };
	} catch (error) {
		return { ok: false, message: describeMailError(error, connection), folderCount: 0 };
	}
}

