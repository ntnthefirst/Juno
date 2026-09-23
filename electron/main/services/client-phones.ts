/**
 * A client's phone numbers. There can be several; at most one is primary.
 *
 * Every rule about a client phone lives in this file. The IPC and MCP adapters
 * call these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { ClientPhone, ClientPhoneInput, ClientPhonePatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clientPhones } from "../db/schema";
import { requireClient } from "./clients";

function requirePhone(phone: unknown): string {
	const value = typeof phone === "string" ? phone.trim() : "";
	if (!value) throw new Error("A phone number cannot be empty.");
	return value;
}

function livePhone(id: string, db: Db): ClientPhone {
	const row = db
		.select()
		.from(clientPhones)
		.where(and(eq(clientPhones.id, id), isNull(clientPhones.deletedAt)))
		.get();
	if (!row) throw new Error(`No phone number with id "${id}". It does not exist or it was deleted.`);
	return row;
}

function clearPrimaryOnSiblings(db: Db, clientId: string, keepId: string): void {
	db.update(clientPhones)
		.set({ isPrimary: false, updatedAt: now() })
		.where(
			and(
				eq(clientPhones.clientId, clientId),
				ne(clientPhones.id, keepId),
				eq(clientPhones.isPrimary, true),
				isNull(clientPhones.deletedAt),
			),
		)
		.run();
}

function hasLiveSiblings(db: Db, clientId: string): boolean {
	return (
		db
			.select({ id: clientPhones.id })
			.from(clientPhones)
			.where(and(eq(clientPhones.clientId, clientId), isNull(clientPhones.deletedAt)))
			.limit(1)
			.get() !== undefined
	);
}

export async function listForClient(clientId: string, db: Db = getDb()): Promise<ClientPhone[]> {
	return db
		.select()
		.from(clientPhones)
		.where(and(eq(clientPhones.clientId, clientId), isNull(clientPhones.deletedAt)))
		.orderBy(desc(clientPhones.isPrimary), asc(sql`lower(${clientPhones.phone})`))
		.all();
}

export async function create(input: ClientPhoneInput, db: Db = getDb()): Promise<ClientPhone> {
	const phone = requirePhone(input.phone);

	return db.transaction((tx) => {
		requireClient(input.clientId, tx);
		const makePrimary = input.isPrimary === true || !hasLiveSiblings(tx, input.clientId);
		const row = tx
			.insert(clientPhones)
			.values({ ...input, phone, isPrimary: makePrimary })
			.returning()
			.get();
		if (makePrimary) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function update(
	id: string,
	patch: ClientPhonePatch,
	db: Db = getDb(),
): Promise<ClientPhone> {
	return db.transaction((tx) => {
		livePhone(id, tx);

		const values: Partial<typeof clientPhones.$inferInsert> = { ...patch, updatedAt: now() };
		if (patch.phone !== undefined) values.phone = requirePhone(patch.phone);

		const row = tx.update(clientPhones).set(values).where(eq(clientPhones.id, id)).returning().get();
		if (patch.isPrimary === true) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function remove(id: string, db: Db = getDb()): Promise<ClientPhone> {
	const stamp = now();
	const row = db
		.update(clientPhones)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(clientPhones.id, id), isNull(clientPhones.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No phone number with id "${id}" to remove. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<ClientPhone> {
	const row = db
		.update(clientPhones)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(clientPhones.id, id), isNotNull(clientPhones.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted phone number with id "${id}" to restore.`);
	return row;
}

/**
 * Clearing the siblings and setting the target are one transaction, so a
 * failure halfway cannot leave a client with two primary numbers or none.
 */
export async function setPrimary(id: string, db: Db = getDb()): Promise<ClientPhone> {
	return db.transaction((tx) => {
		const existing = livePhone(id, tx);
		clearPrimaryOnSiblings(tx, existing.clientId, existing.id);
		return tx
			.update(clientPhones)
			.set({ isPrimary: true, updatedAt: now() })
			.where(eq(clientPhones.id, id))
			.returning()
			.get();
	});
}
