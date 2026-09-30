/**
 * A client's links: website, social profiles and anything else with an address.
 *
 * Every rule about a client link lives in this file. The IPC and MCP adapters
 * call these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { ClientLink, ClientLinkInput, ClientLinkPatch } from "../../shared/types";
import { guessClientLinkKind, isClientLinkKind } from "../../shared/client-links";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clientLinks } from "../db/schema";
import { requireClient } from "./clients";

const NOT_AN_ADDRESS = "is not a web address. Use a form like https://www.example.be.";

/**
 * An absolute http or https address. A bare "hyge.be" gets https, because that
 * is what somebody typing it meant; any other scheme is refused, since the
 * address is later handed to the operating system to open.
 */
export function normaliseUrl(url: unknown): string {
	const raw = typeof url === "string" ? url.trim() : "";
	if (!raw) throw new Error("A link needs an address.");
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(mailto|javascript|data|file|tel):/i.test(raw);
	let parsed: URL;
	try {
		parsed = new URL(hasScheme ? raw : `https://${raw}`);
	} catch {
		throw new Error(`"${raw}" ${NOT_AN_ADDRESS}`);
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("Only http and https addresses can be saved as a link.");
	}
	if (!parsed.hostname.includes(".")) throw new Error(`"${raw}" ${NOT_AN_ADDRESS}`);
	return parsed.href;
}

function cleanLabel(label: unknown): string | null {
	if (label === null || label === undefined) return null;
	return typeof label === "string" && label.trim() ? label.trim() : null;
}

function requireKind(kind: unknown): string {
	if (!isClientLinkKind(kind)) {
		throw new Error("The kind must be one of website, linkedin, instagram, facebook, x, youtube, github or other.");
	}
	return kind;
}

function liveLink(id: string, db: Db): ClientLink {
	const row = db
		.select()
		.from(clientLinks)
		.where(and(eq(clientLinks.id, id), isNull(clientLinks.deletedAt)))
		.get();
	if (!row) throw new Error(`No link with id "${id}". It does not exist or it was deleted.`);
	return row;
}

export async function listForClient(clientId: string, db: Db = getDb()): Promise<ClientLink[]> {
	return db
		.select()
		.from(clientLinks)
		.where(and(eq(clientLinks.clientId, clientId), isNull(clientLinks.deletedAt)))
		.orderBy(asc(clientLinks.createdAt), asc(clientLinks.id))
		.all();
}

export async function get(id: string, db: Db = getDb()): Promise<ClientLink> {
	return liveLink(id, db);
}

export async function create(input: ClientLinkInput, db: Db = getDb()): Promise<ClientLink> {
	const url = normaliseUrl(input.url);
	const kind = input.kind === undefined ? guessClientLinkKind(url) : requireKind(input.kind);
	requireClient(input.clientId, db);
	return db
		.insert(clientLinks)
		.values({ clientId: input.clientId, url, kind, label: cleanLabel(input.label) })
		.returning()
		.get();
}

export async function update(id: string, patch: ClientLinkPatch, db: Db = getDb()): Promise<ClientLink> {
	liveLink(id, db);
	const values: Partial<typeof clientLinks.$inferInsert> = { updatedAt: now() };
	if (patch.url !== undefined) values.url = normaliseUrl(patch.url);
	if (patch.kind !== undefined) values.kind = requireKind(patch.kind);
	if (patch.label !== undefined) values.label = cleanLabel(patch.label);
	return db.update(clientLinks).set(values).where(eq(clientLinks.id, id)).returning().get();
}

export async function remove(id: string, db: Db = getDb()): Promise<ClientLink> {
	const stamp = now();
	const row = db
		.update(clientLinks)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(clientLinks.id, id), isNull(clientLinks.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No link with id "${id}" to remove. It may already be deleted.`);
	return row;
}

export async function restore(id: string, db: Db = getDb()): Promise<ClientLink> {
	const row = db
		.update(clientLinks)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(clientLinks.id, id), isNotNull(clientLinks.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted link with id "${id}" to restore.`);
	return row;
}
