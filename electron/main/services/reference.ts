/**
 * Reference data: the editable lists behind every status and label picker.
 *
 * Decision 16, and the one rule everything here is shaped by:
 *
 *   **Removing a system value hides it. It does not delete it.**
 *
 * A status that twelve records already point at cannot be deleted without either
 * breaking those records or silently rewriting their history. So `hideItem` sets
 * `hidden_at` and stops there. Hidden means: not offered when creating or
 * editing a record, still resolved and still rendered correctly wherever it is
 * already in use.
 *
 * That splits reads in two, and picking the wrong one is the bug this file
 * exists to prevent:
 *
 * - A picker filters `hiddenAt IS NULL` on top of `deletedAt IS NULL`.
 * - Rendering an existing record's value filters neither. Resolve by id, show it.
 *
 * `listSets` returns hidden rows, because the settings screen has to show them in
 * order to offer an unhide. Callers building a picker filter them out.
 */
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { clients, projects, referenceItems, referenceSets } from "../db/schema";
import type {
	ReferenceItem,
	ReferenceItemInput,
	ReferenceItemPatch,
	ReferenceSet,
	ReferenceSetKey,
	ReferenceSetWithItems,
	ReferenceUsage,
	ResetResult,
	ResetUserItems,
} from "../../shared/types";
import { SEED_SETS, seedSet } from "./seed-data";

export type ReferenceErrorCode =
	| "set-not-found"
	| "item-not-found"
	| "custom-items-not-allowed"
	| "invalid-label"
	| "duplicate-key"
	| "not-seeded";

/** Typed, because both adapters have to turn a failure into something readable. */
export class ReferenceDataError extends Error {
	readonly code: ReferenceErrorCode;

	constructor(code: ReferenceErrorCode, message: string) {
		super(message);
		this.name = "ReferenceDataError";
		this.code = code;
	}
}

type SetRow = typeof referenceSets.$inferSelect;
type ItemRow = typeof referenceItems.$inferSelect;

let injected: Db | null = null;

/** Test seam. Application code lets this fall through to the open connection. */
export function useDatabase(db: Db | null): void {
	injected = db;
}

function database(): Db {
	return injected ?? getDb();
}

function toSet(row: SetRow): ReferenceSet {
	return { ...row, key: row.key as ReferenceSetKey };
}

function toItem(row: ItemRow): ReferenceItem {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		setId: row.setId,
		key: row.key,
		label: row.label,
		tone: row.tone,
		seedKey: row.seedKey,
		isSystem: row.isSystem,
		hiddenAt: row.hiddenAt,
		customisedAt: row.customisedAt,
		sortOrder: row.sortOrder,
	};
}

function slugify(label: string): string {
	const slug = label
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return slug || "item";
}

function itemsForSet(db: Db, setId: string): ItemRow[] {
	return db
		.select()
		.from(referenceItems)
		.where(and(eq(referenceItems.setId, setId), isNull(referenceItems.deletedAt)))
		.orderBy(referenceItems.sortOrder, referenceItems.label)
		.all();
}

function requireItem(db: Db, id: string): ItemRow {
	const row = db.select().from(referenceItems).where(eq(referenceItems.id, id)).get();
	if (!row) throw new ReferenceDataError("item-not-found", `No reference item with id ${id}.`);
	return row;
}

function countReferences(db: Db, itemId: string): number {
	const clientRow = db
		.select({ value: count() })
		.from(clients)
		.where(and(eq(clients.statusId, itemId), isNull(clients.deletedAt)))
		.get();
	const projectRow = db
		.select({ value: count() })
		.from(projects)
		.where(and(eq(projects.statusId, itemId), isNull(projects.deletedAt)))
		.get();
	return (clientRow?.value ?? 0) + (projectRow?.value ?? 0);
}

export async function listSets(): Promise<ReferenceSetWithItems[]> {
	const db = database();
	const sets = db
		.select()
		.from(referenceSets)
		.where(isNull(referenceSets.deletedAt))
		.orderBy(referenceSets.label)
		.all();

	// Ordered the way the seed declares them, not alphabetically. Client, project,
	// document, label follows how the records relate; the alphabet put document
	// status between client and project, which reads as an accident.
	const declared = SEED_SETS.map((set) => set.key);
	const rank = (key: string) => {
		const index = declared.indexOf(key as (typeof declared)[number]);
		return index === -1 ? declared.length : index;
	};

	return sets
		.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label))
		.map((set) => ({ set: toSet(set), items: itemsForSet(db, set.id).map(toItem) }));
}

export async function getSet(key: ReferenceSetKey): Promise<ReferenceSetWithItems | null> {
	const db = database();
	const set = db
		.select()
		.from(referenceSets)
		.where(and(eq(referenceSets.key, key), isNull(referenceSets.deletedAt)))
		.get();
	if (!set) return null;
	return { set: toSet(set), items: itemsForSet(db, set.id).map(toItem) };
}

export async function createItem(input: ReferenceItemInput): Promise<ReferenceItem> {
	const db = database();
	const label = input.label.trim();
	if (!label) throw new ReferenceDataError("invalid-label", "A reference item needs a label.");

	const set = db
		.select()
		.from(referenceSets)
		.where(and(eq(referenceSets.id, input.setId), isNull(referenceSets.deletedAt)))
		.get();
	if (!set) {
		throw new ReferenceDataError("set-not-found", `No reference set with id ${input.setId}.`);
	}
	if (!set.allowsCustomItems) {
		throw new ReferenceDataError(
			"custom-items-not-allowed",
			`The set "${set.label}" does not take items of your own.`,
		);
	}

	const key = (input.key ?? slugify(label)).trim();
	const clash = db
		.select({ id: referenceItems.id })
		.from(referenceItems)
		.where(
			and(
				eq(referenceItems.setId, set.id),
				eq(referenceItems.key, key),
				isNull(referenceItems.deletedAt),
			),
		)
		.get();
	if (clash) {
		throw new ReferenceDataError(
			"duplicate-key",
			`The set "${set.label}" already has an item with the key "${key}".`,
		);
	}

	const highest = db
		.select({ value: sql<number>`coalesce(max(${referenceItems.sortOrder}), -10)` })
		.from(referenceItems)
		.where(eq(referenceItems.setId, set.id))
		.get();

	const row = db
		.insert(referenceItems)
		.values({
			setId: set.id,
			key,
			label,
			tone: input.tone ?? null,
			seedKey: null,
			isSystem: false,
			sortOrder: input.sortOrder ?? (highest?.value ?? -10) + 10,
		})
		.returning()
		.get();
	return toItem(row);
}

export async function updateItem(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem> {
	const db = database();
	const existing = requireItem(db, id);

	const label = patch.label === undefined ? existing.label : patch.label.trim();
	if (!label) throw new ReferenceDataError("invalid-label", "A reference item needs a label.");

	const row = db
		.update(referenceItems)
		.set({
			label,
			tone: patch.tone === undefined ? existing.tone : patch.tone,
			sortOrder: patch.sortOrder ?? existing.sortOrder,
			// Set once, on the first edit. From here on an upgrade leaves the row alone.
			customisedAt:
				existing.isSystem && existing.customisedAt === null ? now() : existing.customisedAt,
			updatedAt: now(),
		})
		.where(eq(referenceItems.id, id))
		.returning()
		.get();
	return toItem(row);
}

/**
 * Hide, never delete. Records already point at this row, and they have to keep
 * rendering the value they were given.
 */
export async function hideItem(id: string): Promise<ReferenceItem> {
	const db = database();
	const existing = requireItem(db, id);
	if (existing.hiddenAt !== null) return toItem(existing);

	const stamp = now();
	const row = db
		.update(referenceItems)
		.set({ hiddenAt: stamp, updatedAt: stamp })
		.where(eq(referenceItems.id, id))
		.returning()
		.get();
	return toItem(row);
}

export async function unhideItem(id: string): Promise<ReferenceItem> {
	const db = database();
	const existing = requireItem(db, id);
	if (existing.hiddenAt === null) return toItem(existing);

	const row = db
		.update(referenceItems)
		.set({ hiddenAt: null, updatedAt: now() })
		.where(eq(referenceItems.id, id))
		.returning()
		.get();
	return toItem(row);
}

/** How many live records point at this item. Drives the warning before hiding. */
export async function usage(id: string): Promise<ReferenceUsage> {
	const db = database();
	requireItem(db, id);
	return { itemId: id, inUseBy: countReferences(db, id) };
}

/**
 * Ordering is a user edit, so it marks system rows as customised. That costs
 * those rows future label updates from an upgrade, which is the safe side of the
 * trade: an upgrade rearranging a list somebody arranged by hand is worse.
 */
export async function reorder(setId: string, orderedIds: string[]): Promise<ReferenceItem[]> {
	const db = database();
	const set = db
		.select()
		.from(referenceSets)
		.where(and(eq(referenceSets.id, setId), isNull(referenceSets.deletedAt)))
		.get();
	if (!set) throw new ReferenceDataError("set-not-found", `No reference set with id ${setId}.`);

	db.transaction((tx) => {
		orderedIds.forEach((id, index) => {
			const existing = tx
				.select()
				.from(referenceItems)
				.where(and(eq(referenceItems.id, id), eq(referenceItems.setId, setId)))
				.get();
			if (!existing) {
				throw new ReferenceDataError("item-not-found", `No item ${id} in this set.`);
			}
			tx
				.update(referenceItems)
				.set({
					sortOrder: index * 10,
					customisedAt:
						existing.isSystem && existing.customisedAt === null ? now() : existing.customisedAt,
					updatedAt: now(),
				})
				.where(eq(referenceItems.id, id))
				.run();
		});
	});

	return itemsForSet(db, setId).map(toItem);
}

function emptyResult(): ResetResult {
	return { restored: 0, unhidden: 0, userItemsKept: 0, userItemsRemoved: 0 };
}

function add(a: ResetResult, b: ResetResult): ResetResult {
	return {
		restored: a.restored + b.restored,
		unhidden: a.unhidden + b.unhidden,
		userItemsKept: a.userItemsKept + b.userItemsKept,
		userItemsRemoved: a.userItemsRemoved + b.userItemsRemoved,
	};
}

/**
 * Restores every shipped row in one set to the values it arrived with, clears
 * `hidden_at` and `customised_at`, and does whatever the caller asked with the
 * rows the user made themselves.
 *
 * A user row still in use is hidden rather than deleted even when "remove" was
 * asked for, for the same reason a system row is: records point at it. Those
 * count as kept, because they are still there.
 *
 * A system row whose seed key no longer ships is left untouched. It cannot be
 * restored to anything, and deleting it would break the records using it.
 */
export async function resetSet(key: ReferenceSetKey, userItems: ResetUserItems): Promise<ResetResult> {
	const db = database();
	const seed = seedSet(key);
	if (!seed) throw new ReferenceDataError("not-seeded", `The set "${key}" does not ship with Bureau.`);

	return db.transaction((tx): ResetResult => {
		const result = emptyResult();
		const stamp = now();

		let set = tx
			.select()
			.from(referenceSets)
			.where(and(eq(referenceSets.key, key), isNull(referenceSets.deletedAt)))
			.get();

		if (!set) {
			set = tx
				.insert(referenceSets)
				.values({
					key: seed.key,
					label: seed.label,
					description: seed.description,
					allowsCustomItems: seed.allowsCustomItems,
				})
				.returning()
				.get();
		} else {
			tx
				.update(referenceSets)
				.set({
					label: seed.label,
					description: seed.description,
					allowsCustomItems: seed.allowsCustomItems,
					updatedAt: stamp,
				})
				.where(eq(referenceSets.id, set.id))
				.run();
		}

		for (const item of seed.items) {
			const existing = tx
				.select()
				.from(referenceItems)
				.where(and(eq(referenceItems.setId, set.id), eq(referenceItems.seedKey, item.seedKey)))
				.get();

			if (!existing) {
				tx
					.insert(referenceItems)
					.values({
						setId: set.id,
						key: item.key,
						label: item.label,
						tone: item.tone,
						seedKey: item.seedKey,
						isSystem: true,
						sortOrder: item.sortOrder,
					})
					.run();
				result.restored++;
				continue;
			}

			if (existing.hiddenAt !== null) result.unhidden++;
			tx
				.update(referenceItems)
				.set({
					key: item.key,
					label: item.label,
					tone: item.tone,
					sortOrder: item.sortOrder,
					isSystem: true,
					hiddenAt: null,
					customisedAt: null,
					deletedAt: null,
					updatedAt: stamp,
				})
				.where(eq(referenceItems.id, existing.id))
				.run();
			result.restored++;
		}

		const userRows = tx
			.select()
			.from(referenceItems)
			.where(
				and(
					eq(referenceItems.setId, set.id),
					eq(referenceItems.isSystem, false),
					isNull(referenceItems.deletedAt),
				),
			)
			.all();

		for (const row of userRows) {
			if (userItems === "keep") {
				result.userItemsKept++;
				continue;
			}
			// Counted through the outer handle on purpose: it is the same connection,
			// so the read happens inside this transaction and sees its writes.
			if (countReferences(db, row.id) > 0) {
				if (row.hiddenAt === null) {
					tx
						.update(referenceItems)
						.set({ hiddenAt: stamp, updatedAt: stamp })
						.where(eq(referenceItems.id, row.id))
						.run();
				}
				result.userItemsKept++;
				continue;
			}
			tx
				.update(referenceItems)
				.set({ deletedAt: stamp, updatedAt: stamp })
				.where(eq(referenceItems.id, row.id))
				.run();
			result.userItemsRemoved++;
		}

		return result;
	});
}

export async function resetAll(userItems: ResetUserItems): Promise<ResetResult> {
	let total = emptyResult();
	for (const set of SEED_SETS) {
		total = add(total, await resetSet(set.key, userItems));
	}
	return total;
}
