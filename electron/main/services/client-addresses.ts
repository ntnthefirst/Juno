/**
 * A client's addresses. There can be several, each with an optional free-text
 * label ("Kantoor Leuven", "Magazijn"); at most one is primary.
 *
 * Every rule about a client address lives in this file. The IPC and MCP
 * adapters call these functions and contain nothing else. See
 * .claude/rules/architecture.md.
 */
import { and, asc, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { ClientAddress, ClientAddressInput, ClientAddressPatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clientAddresses } from "../db/schema";
import { requireClient } from "./clients";

function requireLine1(line1: unknown): string {
	const value = typeof line1 === "string" ? line1.trim() : "";
	if (!value) throw new Error("An address needs at least a street and number.");
	return value;
}

function liveAddress(id: string, db: Db): ClientAddress {
	const row = db
		.select()
		.from(clientAddresses)
		.where(and(eq(clientAddresses.id, id), isNull(clientAddresses.deletedAt)))
		.get();
	if (!row) throw new Error(`No address with id "${id}". It does not exist or it was deleted.`);
	return row;
}

function clearPrimaryOnSiblings(db: Db, clientId: string, keepId: string): void {
	db.update(clientAddresses)
		.set({ isPrimary: false, updatedAt: now() })
		.where(
			and(
				eq(clientAddresses.clientId, clientId),
				ne(clientAddresses.id, keepId),
				eq(clientAddresses.isPrimary, true),
				isNull(clientAddresses.deletedAt),
			),
		)
		.run();
}

function hasLiveSiblings(db: Db, clientId: string): boolean {
	return (
		db
			.select({ id: clientAddresses.id })
			.from(clientAddresses)
			.where(and(eq(clientAddresses.clientId, clientId), isNull(clientAddresses.deletedAt)))
			.limit(1)
			.get() !== undefined
	);
}

export async function listForClient(
	clientId: string,
	db: Db = getDb(),
): Promise<ClientAddress[]> {
	return db
		.select()
		.from(clientAddresses)
		.where(and(eq(clientAddresses.clientId, clientId), isNull(clientAddresses.deletedAt)))
		.orderBy(desc(clientAddresses.isPrimary), asc(clientAddresses.createdAt))
		.all();
}

export async function create(
	input: ClientAddressInput,
	db: Db = getDb(),
): Promise<ClientAddress> {
	const addressLine1 = requireLine1(input.addressLine1);

	return db.transaction((tx) => {
		requireClient(input.clientId, tx);
		const makePrimary = input.isPrimary === true || !hasLiveSiblings(tx, input.clientId);
		const row = tx
			.insert(clientAddresses)
			.values({ ...input, addressLine1, isPrimary: makePrimary })
			.returning()
			.get();
		if (makePrimary) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function update(
	id: string,
	patch: ClientAddressPatch,
	db: Db = getDb(),
): Promise<ClientAddress> {
	return db.transaction((tx) => {
		liveAddress(id, tx);

		const values: Partial<typeof clientAddresses.$inferInsert> = { ...patch, updatedAt: now() };
		if (patch.addressLine1 !== undefined) values.addressLine1 = requireLine1(patch.addressLine1);

		const row = tx
			.update(clientAddresses)
			.set(values)
			.where(eq(clientAddresses.id, id))
			.returning()
			.get();
		if (patch.isPrimary === true) clearPrimaryOnSiblings(tx, row.clientId, row.id);
		return row;
	});
}

export async function remove(id: string, db: Db = getDb()): Promise<ClientAddress> {
	const stamp = now();
	const row = db
		.update(clientAddresses)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(clientAddresses.id, id), isNull(clientAddresses.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No address with id "${id}" to remove. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<ClientAddress> {
	const row = db
		.update(clientAddresses)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(clientAddresses.id, id), isNotNull(clientAddresses.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted address with id "${id}" to restore.`);
	return row;
}

/**
 * Clearing the siblings and setting the target are one transaction, so a
 * failure halfway cannot leave a client with two primary addresses or none.
 */
export async function setPrimary(id: string, db: Db = getDb()): Promise<ClientAddress> {
	return db.transaction((tx) => {
		const existing = liveAddress(id, tx);
		clearPrimaryOnSiblings(tx, existing.clientId, existing.id);
		return tx
			.update(clientAddresses)
			.set({ isPrimary: true, updatedAt: now() })
			.where(eq(clientAddresses.id, id))
			.returning()
			.get();
	});
}
