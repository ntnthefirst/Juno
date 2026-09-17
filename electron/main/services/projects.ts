/**
 * Projects. A piece of work for one client, with a value in integer cents and
 * dates that carry no time of day.
 *
 * Every rule about a project lives in this file. The IPC and MCP adapters call
 * these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Project, ProjectInput, ProjectPatch, ProjectSummary } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, projects, referenceItems } from "../db/schema";
import { requireClient } from "./clients";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ListProjectsQuery {
	clientId?: string;
	statusId?: string | null;
}

function requireName(name: unknown): string {
	const value = typeof name === "string" ? name.trim() : "";
	if (!value) throw new Error("A project needs a name.");
	return value;
}

function checkDate(value: string | null | undefined, field: string): void {
	if (value === null || value === undefined) return;
	if (!DATE_ONLY.test(value)) {
		throw new Error(`${field} must be a calendar date like 2026-03-14, not "${value}".`);
	}
}

function checkCents(value: number | null | undefined): void {
	if (value === null || value === undefined) return;
	if (!Number.isInteger(value)) {
		throw new Error(
			"agreedValueCents is a whole number of cents. 1250,00 EUR is 125000, never 1250.00.",
		);
	}
	if (value < 0) throw new Error("agreedValueCents cannot be negative.");
}

function checkStatus(statusId: string | null | undefined, db: Db): void {
	if (!statusId) return;
	const found = db
		.select({ id: referenceItems.id })
		.from(referenceItems)
		.where(and(eq(referenceItems.id, statusId), isNull(referenceItems.deletedAt)))
		.get();
	if (!found) {
		throw new Error(`No status with id "${statusId}". Pick one from the project_status set.`);
	}
}

function checkFields(input: ProjectInput | ProjectPatch, db: Db): void {
	checkDate(input.startsOn, "startsOn");
	checkDate(input.dueOn, "dueOn");
	checkCents(input.agreedValueCents);
	if (input.statusId !== undefined) checkStatus(input.statusId, db);
}

export async function list(
	query: ListProjectsQuery = {},
	db: Db = getDb(),
): Promise<ProjectSummary[]> {
	const conditions: SQL[] = [isNull(projects.deletedAt)];
	if (query.clientId) conditions.push(eq(projects.clientId, query.clientId));
	if (query.statusId !== undefined) {
		conditions.push(
			query.statusId === null
				? isNull(projects.statusId)
				: eq(projects.statusId, query.statusId),
		);
	}

	const rows = db
		.select({
			id: projects.id,
			clientId: projects.clientId,
			clientName: clients.name,
			name: projects.name,
			status: referenceItems,
			dueOn: projects.dueOn,
			agreedValueCents: projects.agreedValueCents,
		})
		.from(projects)
		.innerJoin(clients, eq(projects.clientId, clients.id))
		.leftJoin(referenceItems, eq(projects.statusId, referenceItems.id))
		.where(and(...conditions))
		// A project with no due date sorts after the dated ones rather than before.
		.orderBy(sql`${projects.dueOn} is null`, asc(projects.dueOn), asc(sql`lower(${projects.name})`))
		.all();

	return rows.map((row) => ({
		id: row.id,
		clientId: row.clientId,
		clientName: row.clientName,
		name: row.name,
		status: row.status ?? null,
		dueOn: row.dueOn,
		agreedValueCents: row.agreedValueCents,
	}));
}

export async function get(id: string, db: Db = getDb()): Promise<Project | null> {
	const row = db
		.select()
		.from(projects)
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.get();
	return row ?? null;
}

export async function create(input: ProjectInput, db: Db = getDb()): Promise<Project> {
	const name = requireName(input.name);
	requireClient(input.clientId, db);
	checkFields(input, db);

	return db.insert(projects).values({ ...input, name }).returning().get();
}

export async function update(
	id: string,
	patch: ProjectPatch,
	db: Db = getDb(),
): Promise<Project> {
	checkFields(patch, db);

	const values: Partial<typeof projects.$inferInsert> = { ...patch, updatedAt: now() };
	if (patch.name !== undefined) values.name = requireName(patch.name);

	const row = db
		.update(projects)
		.set(values)
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No project with id "${id}" to update. It may have been deleted.`);
	return row;
}

export async function remove(id: string, db: Db = getDb()): Promise<Project> {
	const stamp = now();
	const row = db
		.update(projects)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No project with id "${id}" to delete. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<Project> {
	const row = db
		.update(projects)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(projects.id, id), isNotNull(projects.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted project with id "${id}" to restore.`);
	return row;
}
