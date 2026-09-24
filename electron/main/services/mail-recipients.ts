/**
 * Who a message can go to, and which clients an address belongs to.
 *
 * The composer asks nobody to pick a client from a list before typing an
 * address. It is the wrong way round: the address is what a person knows, and
 * the client is what Juno can work out from it. So this module answers two
 * questions, and both take addresses rather than ids:
 *
 *   suggest("lau")           what could they mean
 *   clientsFor([...])        who do these addresses belong to
 *
 * An address can belong to more than one client, because two clients can share
 * a bookkeeper, and a message to both concerns both. Nothing here picks one.
 */
import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { MailRecipientSuggestion } from "../../shared/types";
import { getDb, type Db } from "../db";
import { clientEmails, clients, contacts, mailMessages } from "../db/schema";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A single address, cleaned the way everything else stores one. */
function normalise(address: string): string {
	return address.trim().toLowerCase();
}

export function isEmailAddress(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

interface Match {
	clientId: string;
	clientName: string;
	address: string;
	name: string | null;
	source: "client" | "contact";
}

/**
 * Every client an address belongs to, by the client's own addresses and by its
 * contacts. Keyed by the normalised address, so a caller can ask about the
 * whole To line at once.
 */
export function clientMatches(db: Db, addresses: string[]): Map<string, Match[]> {
	const wanted = [...new Set(addresses.map(normalise).filter(Boolean))];
	const out = new Map<string, Match[]>();
	if (wanted.length === 0) return out;

	const add = (match: Match) => {
		const list = out.get(match.address) ?? [];
		if (list.some((existing) => existing.clientId === match.clientId)) return;
		list.push(match);
		out.set(match.address, list);
	};

	for (const row of db
		.select({
			clientId: clientEmails.clientId,
			clientName: clients.name,
			email: clientEmails.email,
		})
		.from(clientEmails)
		.innerJoin(clients, eq(clients.id, clientEmails.clientId))
		.where(
			and(
				isNull(clientEmails.deletedAt),
				isNull(clients.deletedAt),
				inArray(sql`lower(${clientEmails.email})`, wanted),
			),
		)
		.all()) {
		add({
			clientId: row.clientId,
			clientName: row.clientName,
			address: normalise(row.email),
			name: row.clientName,
			source: "client",
		});
	}

	for (const row of db
		.select({
			clientId: contacts.clientId,
			clientName: clients.name,
			email: contacts.email,
			name: contacts.name,
		})
		.from(contacts)
		.innerJoin(clients, eq(clients.id, contacts.clientId))
		.where(
			and(
				isNull(contacts.deletedAt),
				isNull(clients.deletedAt),
				inArray(sql`lower(${contacts.email})`, wanted),
			),
		)
		.all()) {
		if (!row.email) continue;
		add({
			clientId: row.clientId,
			clientName: row.clientName,
			address: normalise(row.email),
			name: row.name,
			source: "contact",
		});
	}

	return out;
}

/**
 * The clients an address list concerns, deduplicated, with the address that
 * brought each one in. The composer shows these; the outbox stores them.
 */
export async function clientsFor(
	addresses: string[],
	db: Db = getDb(),
): Promise<{ clientId: string; clientName: string; matchedAddress: string }[]> {
	const out: { clientId: string; clientName: string; matchedAddress: string }[] = [];
	for (const matches of clientMatches(db, addresses).values()) {
		for (const match of matches) {
			if (out.some((entry) => entry.clientId === match.clientId)) continue;
			out.push({ clientId: match.clientId, clientName: match.clientName, matchedAddress: match.address });
		}
	}
	return out;
}

/**
 * What a partly typed recipient could mean: client addresses, contact
 * addresses, and addresses already in the mail on this machine, in that order
 * of usefulness. A client or contact name matches too, because "Jansen" is what
 * a person remembers and the address is what they cannot.
 */
export async function suggest(
	term: string,
	options: { limit?: number } = {},
	db: Db = getDb(),
): Promise<MailRecipientSuggestion[]> {
	const needle = term.trim().toLowerCase();
	if (needle.length < 2) return [];
	const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const pattern = `%${escapeLike(needle)}%`;

	const found = new Map<string, MailRecipientSuggestion>();
	const put = (entry: MailRecipientSuggestion) => {
		const existing = found.get(entry.address);
		if (!existing) {
			found.set(entry.address, entry);
			return;
		}
		// The same address from two sources: keep the richer name and every client.
		existing.name = existing.name ?? entry.name;
		for (const client of entry.clients) {
			if (!existing.clients.some((c) => c.id === client.id)) existing.clients.push(client);
		}
	};

	for (const row of db
		.select({ clientId: clientEmails.clientId, clientName: clients.name, email: clientEmails.email })
		.from(clientEmails)
		.innerJoin(clients, eq(clients.id, clientEmails.clientId))
		.where(
			and(
				isNull(clientEmails.deletedAt),
				isNull(clients.deletedAt),
				sql`(lower(${clientEmails.email}) like ${pattern} escape '\\' or lower(${clients.name}) like ${pattern} escape '\\')`,
			),
		)
		.limit(limit * 2)
		.all()) {
		put({
			address: normalise(row.email),
			name: row.clientName,
			clients: [{ id: row.clientId, name: row.clientName }],
			source: "client",
		});
	}

	for (const row of db
		.select({
			clientId: contacts.clientId,
			clientName: clients.name,
			email: contacts.email,
			name: contacts.name,
		})
		.from(contacts)
		.innerJoin(clients, eq(clients.id, contacts.clientId))
		.where(
			and(
				isNull(contacts.deletedAt),
				isNull(clients.deletedAt),
				sql`${contacts.email} is not null`,
				sql`(lower(${contacts.email}) like ${pattern} escape '\\' or lower(${contacts.name}) like ${pattern} escape '\\')`,
			),
		)
		.limit(limit * 2)
		.all()) {
		if (!row.email) continue;
		put({
			address: normalise(row.email),
			name: row.name,
			clients: [{ id: row.clientId, name: row.clientName }],
			source: "contact",
		});
	}

	// Addresses that have written before. Newest first, which is a better guess
	// than alphabetical and cheap on the (from_address) index.
	for (const row of db
		.select({ address: mailMessages.fromAddress, name: mailMessages.fromName })
		.from(mailMessages)
		.where(
			and(
				isNull(mailMessages.deletedAt),
				sql`${mailMessages.fromAddress} is not null`,
				like(sql`lower(${mailMessages.fromAddress})`, pattern),
			),
		)
		.orderBy(desc(mailMessages.internalDate))
		.limit(limit * 4)
		.all()) {
		if (!row.address) continue;
		put({ address: normalise(row.address), name: row.name, clients: [], source: "message" });
	}

	const order: Record<MailRecipientSuggestion["source"], number> = { client: 0, contact: 1, message: 2 };
	return [...found.values()]
		.sort((a, b) => {
			if (order[a.source] !== order[b.source]) return order[a.source] - order[b.source];
			return a.address.localeCompare(b.address);
		})
		.slice(0, limit);
}
