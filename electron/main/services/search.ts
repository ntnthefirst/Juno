/**
 * One search box over everything: clients, projects, contacts, documents,
 * calendar events and mail.
 *
 * The queries live here rather than in the domain services because the ranking
 * has to be decided across all of them at once, and a caller that stitched six
 * lists together would be making that decision in the adapter.
 *
 * Mail is the exception in how it is matched: it has an FTS5 index kept by
 * triggers (decision 21), so its own service does that query and this one asks
 * for it rather than running a LIKE over message bodies.
 */
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { SearchHit, SearchKind, SearchQuery } from "../../shared/types";
import { getDb, type Db } from "../db";
import { calendarEvents, clientAddresses, clientEmails, clients, contacts, documents, projects } from "../db/schema";
import { primaryAddresses, primaryEmails } from "./clients";
import { listThreads } from "./mail-threads";

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

const ALL_KINDS: SearchKind[] = ["client", "project", "contact", "document", "event", "mail"];

export async function global(
	term: string,
	limit = DEFAULT_LIMIT,
	db: Db = getDb(),
): Promise<SearchHit[]> {
	return query({ term, limit }, db);
}

export async function query(input: SearchQuery, db: Db = getDb()): Promise<SearchHit[]> {
	const needle = input.term.trim();
	if (!needle) return [];

	const cap = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const kinds = new Set<SearchKind>(input.kinds && input.kinds.length > 0 ? input.kinds : ALL_KINDS);
	for (const kind of kinds) {
		if (!ALL_KINDS.includes(kind)) throw new Error(`"${kind}" is not something Juno searches.`);
	}

	const clientEmail = primaryEmails(db);
	const clientAddress = primaryAddresses(db);
	const clientRows = !kinds.has("client") ? [] : db
		.select({ id: clients.id, name: clients.name, city: clientAddress.city, email: clientEmail.email })
		.from(clients)
		.leftJoin(clientEmail, eq(clientEmail.clientId, clients.id))
		.leftJoin(clientAddress, eq(clientAddress.clientId, clients.id))
		.where(
			and(
				isNull(clients.deletedAt),
				anyOf(
					contains(clients.name, needle),
					contains(clients.vatNumber, needle),
					sql`exists (select 1 from ${clientEmails} where ${clientEmails.clientId} = ${clients.id} and ${isNull(clientEmails.deletedAt)} and ${contains(clientEmails.email, needle)})`,
					sql`exists (select 1 from ${clientAddresses} where ${clientAddresses.clientId} = ${clients.id} and ${isNull(clientAddresses.deletedAt)} and ${contains(clientAddresses.city, needle)})`,
				),
			),
		)
		.limit(cap)
		.all();

	const projectRows = !kinds.has("project") ? [] : db
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

	const contactRows = !kinds.has("contact") ? [] : db
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

	const documentRows = !kinds.has("document")
		? []
		: db
				.select({
					id: documents.id,
					title: documents.title,
					issuedOn: documents.issuedOn,
					clientName: clients.name,
				})
				.from(documents)
				.innerJoin(clients, eq(documents.clientId, clients.id))
				.where(
					and(
						isNull(documents.deletedAt),
						isNull(clients.deletedAt),
						anyOf(contains(documents.title, needle), contains(clients.name, needle)),
					),
				)
				.limit(cap)
				.all();

	const eventRows = !kinds.has("event")
		? []
		: db
				.select({
					id: calendarEvents.id,
					title: calendarEvents.title,
					startLocal: calendarEvents.startLocal,
					location: calendarEvents.location,
					clientName: clients.name,
				})
				.from(calendarEvents)
				.leftJoin(clients, eq(calendarEvents.clientId, clients.id))
				.where(
					and(
						isNull(calendarEvents.deletedAt),
						anyOf(
							contains(calendarEvents.title, needle),
							contains(calendarEvents.notes, needle),
							contains(calendarEvents.location, needle),
						),
					),
				)
				.limit(cap)
				.all();

	// Mail goes through its own service so the FTS5 index does the matching.
	// A LIKE over every body would scan the largest table in the database.
	const mailRows = !kinds.has("mail") ? [] : await listThreads({ search: needle, limit: cap }, db);

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
		...documentRows.map((row) => ({
			kind: "document" as const,
			id: row.id,
			title: row.title,
			subtitle: row.clientName,
			on: row.issuedOn,
		})),
		...eventRows.map((row) => ({
			kind: "event" as const,
			id: row.id,
			title: row.title,
			subtitle: [row.clientName, row.location].filter(Boolean).join(", ") || null,
			on: row.startLocal.slice(0, 10),
		})),
		...mailRows.map((row) => ({
			kind: "mail" as const,
			id: row.id,
			title: row.subject || "(no subject)",
			subtitle: [row.clientName, row.participants[0]?.name ?? row.participants[0]?.address]
				.filter(Boolean)
				.join(", ") || null,
			on: row.lastMessageAt ? row.lastMessageAt.slice(0, 10) : null,
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
