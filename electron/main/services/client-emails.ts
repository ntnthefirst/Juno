/**
 * A client's email addresses. There can be several; at most one is primary.
 *
 * Every rule about a client email lives in this file. The IPC and MCP adapters
 * call these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { ClientEmail, ClientEmailInput, ClientEmailPatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clientEmails } from "../db/schema";
import { requireClient } from "./clients";

function requireEmail(email: unknown): string {
	const value = typeof email === "string" ? email.trim() : "";
	if (!value) throw new Error("An email address cannot be empty.");
	return value;
}

function liveEmail(id: string, db: Db): ClientEmail {
	const row = db
		.select()
		.from(clientEmails)
		.where(and(eq(clientEmails.id, id), isNull(clientEmails.deletedAt)))
		.get();
	if (!row) throw new Error(`No email with id "${id}". It does not exist or it was deleted.`);
	return row;
}

function clearPrimaryOnSiblings(db: Db, clientId: string, keepId: string): void {
	db.update(clientEmails)
		.set({ isPrimary: false, updatedAt: now() })
		.where(
			and(
				eq(clientEmails.clientId, clientId),
				ne(clientEmails.id, keepId),
				eq(clientEmails.isPrimary, true),
				isNull(clientEmails.deletedAt),
			),
		)
		.run();
}

function hasLiveSiblings(db: Db, clientId: string): boolean {
	return (
		db
			.select({ id: clientEmails.id })
			.from(clientEmails)
			.where(and(eq(clientEmails.clientId, clientId), isNull(clientEmails.deletedAt)))
			.limit(1)
			.get() !== undefined
	);
}

export async function listForClient(clientId: string, db: Db = getDb()): Promise<ClientEmail[]> {
	return db
		.select()
		.from(clientEmails)
		.where(and(eq(clientEmails.clientId, clientId), isNull(clientEmails.deletedAt)))
		.orderBy(desc(clientEmails.isPrimary), asc(sql`lower(${clientEmails.email})`))
		.all();
}

export async function create(input: ClientEmailInput, db: Db = getDb()): Promise<ClientEmail> {
	const email = requireEmail(input.email);

	return db.transaction((tx) => {
		requireClient(input.clientId, tx);
		// The first email on a client is what "common" means until the user says
		// otherwise, so it does not sit unset with nothing marked primary.
		const makePrimary = input.isPrimary === true || !hasLiveSiblings(tx, input.clientId);
		const row = tx
			.insert(clientEmails)
			.values({ ...input, email, isPrimary: makePrimary })
			.returning()
			.get();
		if (makePrimary) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function update(
	id: string,
	patch: ClientEmailPatch,
	db: Db = getDb(),
): Promise<ClientEmail> {
	return db.transaction((tx) => {
		liveEmail(id, tx);

		const values: Partial<typeof clientEmails.$inferInsert> = { ...patch, updatedAt: now() };
		if (patch.email !== undefined) values.email = requireEmail(patch.email);

		const row = tx.update(clientEmails).set(values).where(eq(clientEmails.id, id)).returning().get();
		if (patch.isPrimary === true) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function remove(id: string, db: Db = getDb()): Promise<ClientEmail> {
	const stamp = now();
	const row = db
		.update(clientEmails)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(clientEmails.id, id), isNull(clientEmails.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No email with id "${id}" to remove. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<ClientEmail> {
	const row = db
		.update(clientEmails)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(clientEmails.id, id), isNotNull(clientEmails.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted email with id "${id}" to restore.`);
	return row;
}

/**
 * Clearing the siblings and setting the target are one transaction, so a
 * failure halfway cannot leave a client with two primary emails or none.
 */
export async function setPrimary(id: string, db: Db = getDb()): Promise<ClientEmail> {
	return db.transaction((tx) => {
		const existing = liveEmail(id, tx);
		clearPrimaryOnSiblings(tx, existing.clientId, existing.id);
		return tx
			.update(clientEmails)
			.set({ isPrimary: true, updatedAt: now() })
			.where(eq(clientEmails.id, id))
			.returning()
			.get();
	});
}
