/**
 * Where an event happens. Two ways to help fill it in, kept deliberately
 * different in shape.
 *
 * `suggestLocations` touches no network at all: it matches against a client's
 * stored address and against locations typed on past events, both already in
 * this database. It is safe to call on every keystroke.
 *
 * `lookupAddress` is a request to OpenStreetMap's Nominatim service, and it
 * only ever runs when a person presses the button for it, never behind them.
 * Same reasoning as `resolveByMx` in mail-autoconfig.ts: Juno is offline-first,
 * and a network call a person did not ask for is a leak, not a convenience.
 *
 * The location field itself stays free text either way. "Client's office",
 * "online" or a scribble that resolves to nothing are all fine; a suggestion
 * is offered, never required.
 */
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { AddressCandidate, LocationSuggestion } from "../../shared/types";
import { getDb, type Db } from "../db";
import { LOCAL_OWNER_ID } from "../db/columns";
import { calendarEvents, clients } from "../db/schema";

const MIN_QUERY_LENGTH = 2;
const CLIENT_LIMIT = 5;
const RECENT_LIMIT = 5;
const MAX_SUGGESTIONS = 8;
const MAX_CANDIDATES = 5;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
/** Nominatim's usage policy asks for a real identifying agent, not a browser's default. */
const USER_AGENT = "Juno (local, offline-first back office; no server, no tracking)";

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function contains(term: string) {
	return `%${escapeLike(term.toLowerCase())}%`;
}

type ClientAddressRow = {
	name: string;
	addressLine1: string | null;
	addressLine2: string | null;
	postalCode: string | null;
	city: string | null;
	country: string | null;
};

function formatClientAddress(row: ClientAddressRow): string | null {
	const street = [row.addressLine1, row.addressLine2].filter((part) => part && part.trim().length > 0).join(", ");
	const locality = [row.postalCode, row.city].filter((part) => part && part.trim().length > 0).join(" ");
	const parts = [street, locality, row.country].filter((part) => part && part.trim().length > 0);
	return parts.length > 0 ? parts.join(", ") : null;
}

/** Client addresses and past event locations that match what was typed. No network. */
export function suggestLocations(
	query: string,
	db: Db = getDb(),
	ownerId: string = LOCAL_OWNER_ID,
): LocationSuggestion[] {
	const term = query.trim();
	if (term.length < MIN_QUERY_LENGTH) return [];
	const needle = contains(term);

	const clientRows = db
		.select({
			name: clients.name,
			addressLine1: clients.addressLine1,
			addressLine2: clients.addressLine2,
			postalCode: clients.postalCode,
			city: clients.city,
			country: clients.country,
		})
		.from(clients)
		.where(
			and(
				eq(clients.ownerId, ownerId),
				isNull(clients.deletedAt),
				or(
					sql`lower(${clients.name}) like ${needle} escape '\\'`,
					sql`lower(${clients.city}) like ${needle} escape '\\'`,
					sql`lower(${clients.addressLine1}) like ${needle} escape '\\'`,
				),
			),
		)
		.orderBy(asc(clients.sortName))
		.limit(CLIENT_LIMIT)
		.all();

	const seen = new Set<string>();
	const suggestions: LocationSuggestion[] = [];
	for (const row of clientRows) {
		const address = formatClientAddress(row);
		if (!address) continue;
		const key = address.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		suggestions.push({ source: "client", label: row.name, address });
	}

	const recentRows = db
		.select({ location: calendarEvents.location, last: sql<string>`max(${calendarEvents.updatedAt})` })
		.from(calendarEvents)
		.where(
			and(
				eq(calendarEvents.ownerId, ownerId),
				isNull(calendarEvents.deletedAt),
				isNotNull(calendarEvents.location),
				sql`lower(${calendarEvents.location}) like ${needle} escape '\\'`,
			),
		)
		.groupBy(calendarEvents.location)
		.orderBy(desc(sql`max(${calendarEvents.updatedAt})`))
		.limit(RECENT_LIMIT)
		.all();

	for (const row of recentRows) {
		if (!row.location) continue;
		const key = row.location.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		suggestions.push({ source: "recent", label: row.location, address: row.location });
	}

	return suggestions.slice(0, MAX_SUGGESTIONS);
}

/** What Nominatim is asked. Injectable so the tests do not depend on a network. */
export type AddressFetch = typeof fetch;

/**
 * One request to OpenStreetMap's address search, run only when a person asks
 * for it. See the file comment for why this is never automatic.
 */
export async function lookupAddress(query: string, fetchImpl: AddressFetch = fetch): Promise<AddressCandidate[]> {
	const term = query.trim();
	if (term.length < MIN_QUERY_LENGTH) return [];

	const url = new URL(NOMINATIM_URL);
	url.searchParams.set("q", term);
	url.searchParams.set("format", "jsonv2");
	url.searchParams.set("limit", String(MAX_CANDIDATES));

	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.5" },
			signal: AbortSignal.timeout(5000),
		});
	} catch {
		throw new Error("Could not reach the address lookup service. Check your connection, or type the location by hand.");
	}
	if (!response.ok) {
		throw new Error("Could not reach the address lookup service. Check your connection, or type the location by hand.");
	}

	const rows = (await response.json()) as Array<{ display_name?: unknown; lat?: unknown; lon?: unknown }>;
	return rows
		.filter(
			(row): row is { display_name: string; lat: string; lon: string } =>
				typeof row.display_name === "string" && typeof row.lat === "string" && typeof row.lon === "string",
		)
		.map((row) => ({ label: row.display_name, lat: Number(row.lat), lon: Number(row.lon) }))
		.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon))
		.slice(0, MAX_CANDIDATES);
}
