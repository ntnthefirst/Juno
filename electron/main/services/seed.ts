/**
 * Puts the shipped reference data into the database, on every launch.
 *
 * Idempotent by construction: a missing set or item is inserted, an existing one
 * is matched by `seed_key` rather than by label, and nothing is ever deleted.
 *
 * The two rules from decision 16 that this file exists to hold:
 * - **An upgrade never overwrites an edited row.** A row with `customised_at`
 *   set is left exactly as the user left it.
 * - **An upgrade never resurrects a hidden row.** A row with `hidden_at` set
 *   stays hidden, including through a version bump.
 *
 * The applied version is stored in the settings file rather than in the
 * database, because it describes the installation, and because it has to be
 * readable before the first query runs.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { now } from "../db/columns";
import { referenceItems, referenceSets } from "../db/schema";
import { SEED_SETS, SEED_VERSION, type SeedSet } from "./seed-data";
import * as settings from "./settings";

export interface SeedResult {
	setsCreated: number;
	itemsCreated: number;
	itemsUpdated: number;
	fromVersion: number;
	toVersion: number;
}

export interface SeedSource {
	version: number;
	sets: SeedSet[];
}

/**
 * The seed source is a parameter so a test can apply a later version without
 * editing the shipped constant. Application code calls this with one argument.
 */
export async function ensureSeeded(
	db: Db,
	source: SeedSource = { version: SEED_VERSION, sets: SEED_SETS },
): Promise<SeedResult> {
	const applied = await settings.getSeedVersion();
	const upgrading = applied < source.version;

	const result: SeedResult = {
		setsCreated: 0,
		itemsCreated: 0,
		itemsUpdated: 0,
		fromVersion: applied,
		toVersion: source.version,
	};

	db.transaction((tx) => {
		for (const set of source.sets) {
			const existingSet = tx
				.select()
				.from(referenceSets)
				.where(and(eq(referenceSets.key, set.key), isNull(referenceSets.deletedAt)))
				.get();

			let setId: string;
			if (existingSet) {
				setId = existingSet.id;
				if (upgrading) {
					tx
						.update(referenceSets)
						.set({
							label: set.label,
							description: set.description,
							allowsCustomItems: set.allowsCustomItems,
							updatedAt: now(),
						})
						.where(eq(referenceSets.id, setId))
						.run();
				}
			} else {
				const created = tx
					.insert(referenceSets)
					.values({
						key: set.key,
						label: set.label,
						description: set.description,
						allowsCustomItems: set.allowsCustomItems,
					})
					.returning()
					.get();
				setId = created.id;
				result.setsCreated++;
			}

			for (const item of set.items) {
				// Matched without filtering deleted or hidden rows on purpose: finding
				// one of those and leaving it alone is the whole point. Filtering them
				// out here would insert a duplicate and undo the user's removal.
				const existing = tx
					.select()
					.from(referenceItems)
					.where(and(eq(referenceItems.setId, setId), eq(referenceItems.seedKey, item.seedKey)))
					.get();

				if (!existing) {
					tx
						.insert(referenceItems)
						.values({
							setId,
							key: item.key,
							label: item.label,
							tone: item.tone,
							seedKey: item.seedKey,
							isSystem: true,
							sortOrder: item.sortOrder,
						})
						.run();
					result.itemsCreated++;
					continue;
				}

				const untouched =
					existing.customisedAt === null &&
					existing.hiddenAt === null &&
					existing.deletedAt === null;
				if (!upgrading || !untouched) continue;

				// sortOrder is deliberately not updated here. Reordering is a user edit
				// and an upgrade has no business rewriting the order of a list the user
				// arranged. A new row still lands at its shipped position.
				tx
					.update(referenceItems)
					.set({
						key: item.key,
						label: item.label,
						tone: item.tone,
						updatedAt: now(),
					})
					.where(eq(referenceItems.id, existing.id))
					.run();
				result.itemsUpdated++;
			}
		}
	});

	if (upgrading) await settings.setSeedVersion(source.version);

	return result;
}
