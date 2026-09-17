/**
 * The five columns every table carries, and the helpers that produce their
 * values. See decision 4 and .claude/rules/data.md.
 *
 * Spreading `standardColumns` into a table definition is not optional. A table
 * without these cannot be synced, cannot be scoped to an owner, and cannot tell
 * "deleted" apart from "not yet received".
 */
import { randomBytes } from "node:crypto";
import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * UUIDv7: 48 bits of millisecond timestamp, then randomness. Time-sortable, so
 * it clusters in the index instead of scattering writes the way v4 does.
 *
 * Implemented here rather than pulled from a package because it is twelve lines
 * and the main process compiles to CommonJS, where an ESM-only dependency is a
 * problem that costs more than the code does.
 */
export function uuidv7(): string {
	const ms = Date.now();
	const b = randomBytes(16);

	b[0] = Math.floor(ms / 2 ** 40) & 0xff;
	b[1] = Math.floor(ms / 2 ** 32) & 0xff;
	b[2] = Math.floor(ms / 2 ** 24) & 0xff;
	b[3] = Math.floor(ms / 2 ** 16) & 0xff;
	b[4] = Math.floor(ms / 2 ** 8) & 0xff;
	b[5] = ms & 0xff;

	b[6] = (b[6]! & 0x0f) | 0x70; // version 7
	b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant

	const h = b.toString("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Timestamps are UTC ISO-8601 strings, always. Local time is a display concern
 * and storing it is the bug that shows up twice a year at the DST boundary.
 */
export function now(): string {
	return new Date().toISOString();
}

/**
 * The single owner until there is more than one. Having the column and a stable
 * value now is what makes a colleague or a sync server possible later without a
 * migration that touches every row.
 */
export const LOCAL_OWNER_ID = "00000000-0000-7000-8000-000000000001";

export const standardColumns = {
	id: text("id").primaryKey().$defaultFn(uuidv7),
	ownerId: text("owner_id").notNull().$defaultFn(() => LOCAL_OWNER_ID),
	createdAt: text("created_at").notNull().$defaultFn(now),
	updatedAt: text("updated_at").notNull().$defaultFn(now),
	deletedAt: text("deleted_at"),
};

/**
 * The extra columns a seeded reference row carries, per decision 16. A system
 * row is hidden, never deleted, because records already point at it.
 */
export const seededColumns = {
	/** Stable identifier for a shipped row, so an upgrade can find it again. */
	seedKey: text("seed_key"),
	isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
	/** Set when the user removes a system row. Hidden, never deleted. */
	hiddenAt: text("hidden_at"),
	/** Set on first edit. An upgrade must never overwrite a row that has this. */
	customisedAt: text("customised_at"),
	sortOrder: integer("sort_order").notNull().default(0),
};
