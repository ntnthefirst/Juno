/**
 * One search box over clients, projects and contacts.
 *
 * The queries live here rather than in the three domain services because the
 * ranking has to be decided across all three at once, and a caller that stitched
 * three lists together would be making that decision in the adapter.
 */
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { SearchHit } from "../../shared/types";
import { getDb, type Db } from "../db";
import { clients, contacts, projects } from "../db/schema";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function contains(column: AnySQLiteColumn, term: string): SQL {
	return sql`lower(${column}) like ${`%${escapeLike(term)}%`} escape '\\'`;
}

function anyOf(...matchers: SQL[]): SQL {
	const combined = or(...matchers);
	if (!combined) throw new Error("A search needs at least one column to match on.");
	return combined;
}

export async function global(
	term: string,
	limit = DEFAULT_LIMIT,
	db: Db = getDb(),
): Promise<SearchHit[]> {
	const needle = term.trim();
	if (!needle) return [];

	const cap = Math.min(Math.max(limit, 1), MAX_LIMIT);

	const clientRows = db
		.select({ id: clients.id, name: clients.name, city: clients.city, email: clients.email })
		.from(clients)
		.where(
			and(
				isNull(clients.deletedAt),
				anyOf(
					contains(clients.name, needle),
					contains(clients.email, needle),
					contains(clients.city, needle),
					contains(clients.vatNumber, needle),
				),
			),
		)
		.limit(cap)
		.all();

	const projectRows = db
		.select({ id: projects.id, name: projects.name, clientName: clients.name })
		.from(projects)
		.innerJoin(clients, eq(projects.clientId, clients.id))
		.where(
			and(
				isNull(projects.deletedAt),
				isNull(clients.deletedAt),
				anyOf(contains(projects.name, needle), contains(projects.description, needle)),
			),
		)
		.limit(cap)
		.all();

	const contactRows = db
		.select({
			id: contacts.id,
			name: contacts.name,
			role: contacts.role,
			email: contacts.email,
			clientName: clients.name,
		})
		.from(contacts)
		.innerJoin(clients, eq(contacts.clientId, clients.id))
		.where(
			and(
				isNull(contacts.deletedAt),
				isNull(clients.deletedAt),
				anyOf(
					contains(contacts.name, needle),
					contains(contacts.email, needle),
					contains(contacts.role, needle),
				),
			),
		)
		.limit(cap)
		.all();

	const hits: SearchHit[] = [
		...clientRows.map((row) => ({
			kind: "client" as const,
			id: row.id,
			title: row.name,
			subtitle: row.city ?? row.email,
		})),
		...projectRows.map((row) => ({
			kind: "project" as const,
			id: row.id,
			title: row.name,
			subtitle: row.clientName,
		})),
		...contactRows.map((row) => ({
			kind: "contact" as const,
			id: row.id,
			title: row.name,
			subtitle: row.role ? `${row.role}, ${row.clientName}` : row.clientName,
		})),
	];

	// A name that starts with what was typed is almost always the one wanted, so it
	// wins over a match buried in the middle of a longer name.
	const lowered = needle.toLowerCase();
	hits.sort((a, b) => {
		const aStarts = a.title.toLowerCase().startsWith(lowered) ? 0 : 1;
		const bStarts = b.title.toLowerCase().startsWith(lowered) ? 0 : 1;
		if (aStarts !== bStarts) return aStarts - bStarts;
		return a.title.localeCompare(b.title);
	});

	return hits.slice(0, cap);
}
