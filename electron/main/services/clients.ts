/**
 * Clients. The root record; contacts, projects and eventually documents and mail
 * all hang off one.
 *
 * Every rule about a client lives in this file. The IPC and MCP adapters call
 * these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, eq, isNotNull, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ListClientsQuery } from "../../shared/api";
import type { Client, ClientInput, ClientPatch, ClientSummary } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clientAddresses, clientEmails, clients, projects, referenceItems } from "../db/schema";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * A project counts as open unless its status says the work has ended. Matching on
 * the reference item's stable key rather than its label, because the label is the
 * user's to rename.
 */
const CLOSED_PROJECT_STATUS_KEYS = [
	"done",
	"completed",
	"delivered",
	"cancelled",
	"archived",
	"lost",
];

export function sortNameFor(name: string): string {
	return name.toLowerCase();
}

function requireName(name: unknown): string {
	const value = typeof name === "string" ? name.trim() : "";
	if (!value) throw new Error("A client needs a name.");
	return value;
}

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function contains(column: AnySQLiteColumn, term: string): SQL {
	return sql`lower(${column}) like ${`%${escapeLike(term)}%`} escape '\\'`;
}

function checkStatus(statusId: string | null | undefined, db: Db): void {
	if (!statusId) return;
	const found = db
		.select({ id: referenceItems.id })
		.from(referenceItems)
		.where(and(eq(referenceItems.id, statusId), isNull(referenceItems.deletedAt)))
		.get();
	if (!found) {
		throw new Error(`No status with id "${statusId}". Pick one from the client_status set.`);
	}
}

/**
 * The client a contact or a project is being attached to. Exported because those
 * services need the same check and the same message, and duplicating it is how
 * two screens end up disagreeing about what a valid client is.
 */
export function requireClient(clientId: string, db: Db = getDb()): Client {
	const row = db
		.select()
		.from(clients)
		.where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
		.get();
	if (!row) {
		throw new Error(`No client with id "${clientId}". It does not exist or it was deleted.`);
	}
	return row;
}

/**
 * The one email and the one address a summary or a placeholder shows, resolved
 * with a join rather than a query per client. A client with none joins to
 * nothing and the column comes back null, which is exactly what "no primary
 * email yet" is.
 */
export function primaryEmails(db: Db) {
	return db
		.select({ clientId: clientEmails.clientId, email: clientEmails.email })
		.from(clientEmails)
		.where(and(eq(clientEmails.isPrimary, true), isNull(clientEmails.deletedAt)))
		.as("primary_emails");
}

export function primaryAddresses(db: Db) {
	return db
		.select({
			clientId: clientAddresses.clientId,
			city: clientAddresses.city,
		})
		.from(clientAddresses)
		.where(and(eq(clientAddresses.isPrimary, true), isNull(clientAddresses.deletedAt)))
		.as("primary_addresses");
}

/**
 * One statement, not one per client: the counts come from a grouped subquery that
 * is joined in, so a list of 500 clients is still a single round trip.
 */
function projectCounts(db: Db) {
	const projectStatus = alias(referenceItems, "project_status");
	const isOpen = sql`${projectStatus.key} is null or ${notInArray(projectStatus.key, CLOSED_PROJECT_STATUS_KEYS)}`;
	return db
		.select({
			clientId: projects.clientId,
			total: sql<number>`count(*)`.as("project_total"),
			open: sql<number>`sum(case when ${isOpen} then 1 else 0 end)`.as("project_open"),
		})
		.from(projects)
		.leftJoin(projectStatus, eq(projects.statusId, projectStatus.id))
		.where(isNull(projects.deletedAt))
		.groupBy(projects.clientId)
		.as("project_counts");
}

export async function list(
	query: ListClientsQuery = {},
	db: Db = getDb(),
): Promise<ClientSummary[]> {
	const conditions: SQL[] = [];
	if (!query.includeDeleted) conditions.push(isNull(clients.deletedAt));
	if (query.statusId !== undefined) {
		conditions.push(
			query.statusId === null
				? isNull(clients.statusId)
				: eq(clients.statusId, query.statusId),
		);
	}

	const term = query.search?.trim();
	if (term) {
		const match = or(
			contains(clients.name, term),
			contains(clients.vatNumber, term),
			sql`exists (select 1 from ${clientEmails} where ${clientEmails.clientId} = ${clients.id} and ${isNull(clientEmails.deletedAt)} and ${contains(clientEmails.email, term)})`,
			sql`exists (select 1 from ${clientAddresses} where ${clientAddresses.clientId} = ${clients.id} and ${isNull(clientAddresses.deletedAt)} and ${contains(clientAddresses.city, term)})`,
		);
		if (match) conditions.push(match);
	}

	const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const offset = Math.max(query.offset ?? 0, 0);
	const counts = projectCounts(db);
	const email = primaryEmails(db);
	const address = primaryAddresses(db);

	const rows = db
		.select({
			id: clients.id,
			name: clients.name,
			city: address.city,
			email: email.email,
			status: referenceItems,
			projectCount: counts.total,
			openProjectCount: counts.open,
		})
		.from(clients)
		.leftJoin(referenceItems, eq(clients.statusId, referenceItems.id))
		.leftJoin(counts, eq(counts.clientId, clients.id))
		.leftJoin(email, eq(email.clientId, clients.id))
		.leftJoin(address, eq(address.clientId, clients.id))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(asc(clients.sortName))
		.limit(limit)
		.offset(offset)
		.all();

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		status: row.status ?? null,
		city: row.city ?? null,
		email: row.email ?? null,
		projectCount: Number(row.projectCount ?? 0),
		openProjectCount: Number(row.openProjectCount ?? 0),
	}));
}

export async function get(id: string, db: Db = getDb()): Promise<Client | null> {
	const row = db
		.select()
		.from(clients)
		.where(and(eq(clients.id, id), isNull(clients.deletedAt)))
		.get();
	return row ?? null;
}

export async function create(input: ClientInput, db: Db = getDb()): Promise<Client> {
	const name = requireName(input.name);
	checkStatus(input.statusId, db);

	return db
		.insert(clients)
		.values({ ...input, name, sortName: sortNameFor(name) })
		.returning()
		.get();
}

export async function update(
	id: string,
	patch: ClientPatch,
	db: Db = getDb(),
): Promise<Client> {
	if (patch.statusId !== undefined) checkStatus(patch.statusId, db);

	const values: Partial<typeof clients.$inferInsert> = { ...patch, updatedAt: now() };
	if (patch.name !== undefined) {
		const name = requireName(patch.name);
		values.name = name;
		values.sortName = sortNameFor(name);
	}

	const row = db
		.update(clients)
		.set(values)
		.where(and(eq(clients.id, id), isNull(clients.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No client with id "${id}" to update. It may have been deleted.`);
	return row;
}

export async function remove(id: string, db: Db = getDb()): Promise<Client> {
	const stamp = now();
	const row = db
		.update(clients)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(clients.id, id), isNull(clients.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No client with id "${id}" to delete. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<Client> {
	const row = db
		.update(clients)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(clients.id, id), isNotNull(clients.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted client with id "${id}" to restore.`);
	return row;
}
