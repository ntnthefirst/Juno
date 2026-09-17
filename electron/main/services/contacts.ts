/**
 * Contacts. People at a client, one of whom may be the primary.
 *
 * Every rule about a contact lives in this file. The IPC and MCP adapters call
 * these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Contact, ContactInput, ContactPatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { contacts } from "../db/schema";
import { requireClient } from "./clients";

function requireName(name: unknown): string {
	const value = typeof name === "string" ? name.trim() : "";
	if (!value) throw new Error("A contact needs a name.");
	return value;
}

function liveContact(id: string, db: Db): Contact {
	const row = db
		.select()
		.from(contacts)
		.where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
		.get();
	if (!row) throw new Error(`No contact with id "${id}". It does not exist or it was deleted.`);
	return row;
}

function clearPrimaryOnSiblings(db: Db, clientId: string, keepId: string): void {
	db.update(contacts)
		.set({ isPrimary: false, updatedAt: now() })
		.where(
			and(
				eq(contacts.clientId, clientId),
				ne(contacts.id, keepId),
				eq(contacts.isPrimary, true),
				isNull(contacts.deletedAt),
			),
		)
		.run();
}

export async function listForClient(clientId: string, db: Db = getDb()): Promise<Contact[]> {
	return db
		.select()
		.from(contacts)
		.where(and(eq(contacts.clientId, clientId), isNull(contacts.deletedAt)))
		.orderBy(desc(contacts.isPrimary), asc(sql`lower(${contacts.name})`))
		.all();
}

export async function create(input: ContactInput, db: Db = getDb()): Promise<Contact> {
	const name = requireName(input.name);
	const makePrimary = input.isPrimary === true;

	return db.transaction((tx) => {
		requireClient(input.clientId, tx);
		const row = tx
			.insert(contacts)
			.values({ ...input, name, isPrimary: makePrimary })
			.returning()
			.get();
		if (makePrimary) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function update(
	id: string,
	patch: ContactPatch,
	db: Db = getDb(),
): Promise<Contact> {
	return db.transaction((tx) => {
		liveContact(id, tx);

		const values: Partial<typeof contacts.$inferInsert> = { ...patch, updatedAt: now() };
		if (patch.name !== undefined) values.name = requireName(patch.name);

		const row = tx.update(contacts).set(values).where(eq(contacts.id, id)).returning().get();
		if (patch.isPrimary === true) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function remove(id: string, db: Db = getDb()): Promise<Contact> {
	const stamp = now();
	const row = db
		.update(contacts)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No contact with id "${id}" to delete. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<Contact> {
	const row = db
		.update(contacts)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(contacts.id, id), isNotNull(contacts.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted contact with id "${id}" to restore.`);
	return row;
}

/**
 * Clearing the siblings and setting the target are one transaction, so a failure
 * halfway cannot leave a client with two primary contacts or none.
 */
export async function setPrimary(id: string, db: Db = getDb()): Promise<Contact> {
	return db.transaction((tx) => {
		const existing = liveContact(id, tx);
		clearPrimaryOnSiblings(tx, existing.clientId, existing.id);
		return tx
			.update(contacts)
			.set({ isPrimary: true, updatedAt: now() })
			.where(eq(contacts.id, id))
			.returning()
			.get();
	});
}
