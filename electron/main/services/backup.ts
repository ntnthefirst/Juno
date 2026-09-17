/**
 * Copies of the database file, made on demand and kept in the user data folder.
 *
 * Two things here are not obvious and both are deliberate:
 *
 * - **A backup is made with `VACUUM INTO`, not `copyFileSync`.** The connection
 *   runs in WAL mode, so the .sqlite file on its own is missing whatever has not
 *   been checkpointed yet. `VACUUM INTO` writes a consistent, already compacted
 *   database, which is what a backup has to be.
 * - **A restore validates first, then replaces.** The candidate has to open as a
 *   SQLite database and has to contain `_migrations`, because a file that does
 *   not is either not ours or predates the schema, and finding that out after
 *   overwriting the live file is finding out too late.
 *
 * This module does not import `electron`. The live connection is closed through
 * a hook the main process wires up, so a service never reaches into app or
 * window code, and a plain Node test can drive the whole thing.
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BackupInfo } from "../../shared/types";

/** Older copies past this are pruned, oldest first, after every new backup. */
const KEEP = 10;

const PREFIX = "bureau-";
const SUFFIX = ".sqlite";

let directory: string | null = null;
let databaseFile: string | null = null;
let closeHook: (() => void) | null = null;

/**
 * Point the service at a folder and a database file. The main process calls this
 * once; a test calls it with a temp folder. Unset falls back to db/paths.ts.
 */
export function configureBackups(options: { directory?: string; databaseFile?: string }): void {
	if (options.directory !== undefined) directory = options.directory;
	if (options.databaseFile !== undefined) databaseFile = options.databaseFile;
}

/**
 * How the main process hands over the ability to close the live connection. A
 * service that imported the window or the app could not be tested, and would
 * make the layering a suggestion rather than a rule.
 */
export function setCloseHook(fn: (() => void) | null): void {
	closeHook = fn;
}

export function backupsFolder(): string {
	if (!directory) {
		// Injected by main.ts at startup rather than read from db/paths.ts here,
		// which imports `electron` and so cannot load in a plain Node test.
		throw new Error("configureBackups() was not called before the backup service was used.");
	}
	if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
	return directory;
}

function liveDatabase(): string {
	if (!databaseFile) {
		throw new Error("configureBackups() was not called before the backup service was used.");
	}
	return databaseFile;
}

/** 2026-09-17T14-05-09Z: UTC, sortable, and legal in a filename on every platform. */
function stamp(at: Date): string {
	return `${at.toISOString().slice(0, 19).replace(/:/g, "-")}Z`;
}

function describe(path: string): BackupInfo {
	const stats = statSync(path);
	return {
		path,
		createdAt: new Date(stats.mtimeMs).toISOString(),
		sizeBytes: stats.size,
	};
}

export async function create(): Promise<BackupInfo> {
	const source = liveDatabase();
	if (!existsSync(source)) {
		throw new Error("There is no database to back up yet.");
	}

	const folder = backupsFolder();
	const target = join(folder, `${PREFIX}${stamp(new Date())}${SUFFIX}`);
	if (existsSync(target)) rmSync(target);

	// A second connection to the same file. WAL allows it, and it means a backup
	// does not need the live handle and cannot disturb it.
	const handle = new DatabaseSync(source);
	try {
		handle.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
	} finally {
		handle.close();
	}

	await prune();
	return describe(target);
}

export async function list(): Promise<BackupInfo[]> {
	const folder = backupsFolder();
	if (!existsSync(folder)) return [];
	return readdirSync(folder)
		.filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
		.map((name) => describe(join(folder, name)))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.path.localeCompare(a.path));
}

async function prune(): Promise<number> {
	const all = await list();
	let removed = 0;
	for (const backup of all.slice(KEEP)) {
		rmSync(backup.path, { force: true });
		removed++;
	}
	return removed;
}

/**
 * Opens the candidate and looks for the migrations journal. A file that has one
 * was written by this application; a file that does not is a photo, a truncated
 * download or somebody else's database, and none of those may replace the live
 * file.
 */
export function validate(path: string): void {
	if (!existsSync(path)) throw new Error(`There is no file at ${path}.`);

	let candidate: DatabaseSync;
	try {
		// readOnly matters: DatabaseSync creates the file it is pointed at otherwise,
		// so a typo in a path would be "validated" as an empty database.
		candidate = new DatabaseSync(path, { readOnly: true });
	} catch {
		throw new Error("That file is not a readable SQLite database.");
	}

	let hasJournal = false;
	try {
		// The constructor does not read the file, so a file that is not a database
		// only fails here. Both failures mean the same thing to the caller.
		hasJournal =
			candidate
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
				.get() !== undefined;
	} catch {
		throw new Error("That file is not a readable SQLite database.");
	} finally {
		candidate.close();
	}

	if (!hasJournal) {
		throw new Error("That database has no _migrations table, so it is not a Bureau backup.");
	}
}

/**
 * Replaces the live database. The caller restarts the app afterwards, because
 * every prepared statement and every cached row in the process now describes a
 * file that is gone.
 */
export async function restore(path: string): Promise<void> {
	validate(path);

	const target = liveDatabase();
	if (existsSync(target)) {
		// A safety copy first. A restore that turns out to be the wrong file is
		// otherwise unrecoverable.
		await create();
	}

	closeHook?.();

	copyFileSync(path, target);
	// The WAL and shm files describe the database that was just replaced. Left in
	// place, SQLite would apply them over the restored file and corrupt it.
	for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
		if (existsSync(sidecar)) rmSync(sidecar, { force: true });
	}
}
