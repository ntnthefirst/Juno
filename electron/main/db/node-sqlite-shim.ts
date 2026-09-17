/**
 * Presents the `better-sqlite3` interface over Node's built-in `node:sqlite`,
 * so `drizzle-orm/better-sqlite3` can drive it unchanged.
 *
 * Why this exists: decision 18. `better-sqlite3` is a node-gyp module and the
 * development machine has no C++ compiler, and a native module would also need
 * rebuilding against Electron's ABI on every Electron bump.
 *
 * This is deliberately the ONLY place that knows the two APIs differ. Drizzle's
 * better-sqlite3 session calls exactly four things, confirmed by reading
 * `node_modules/drizzle-orm/better-sqlite3/session.cjs`:
 *
 *   client.prepare(sql)                 -> statement
 *   client.transaction(fn)              -> a function that runs fn in a transaction
 *   stmt.run / stmt.get / stmt.all      -> positional parameters
 *   stmt.raw().get / stmt.raw().all     -> the same rows as arrays, not objects
 *
 * `node:sqlite` covers all of it: `setReturnArrays(true)` is what `raw()` does,
 * and transactions are plain BEGIN / COMMIT / ROLLBACK. Verified against the real
 * method surface inside Electron 41.10.7 (Node 24.18.0, SQLite 3.53.1).
 *
 * If a Drizzle upgrade breaks, it breaks here and nowhere else.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";

type Params = readonly unknown[];

/** The array-row view Drizzle reaches for through `raw()`. */
export interface RawStatement {
	get(...params: Params): unknown;
	all(...params: Params): unknown[];
}

export interface ShimStatement {
	run(...params: Params): { changes: number | bigint; lastInsertRowid: number | bigint };
	get(...params: Params): unknown;
	all(...params: Params): unknown[];
	raw(): RawStatement;
}

export interface ShimDatabase {
	prepare(sql: string): ShimStatement;
	exec(sql: string): void;
	transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
	close(): void;
	readonly native: DatabaseSync;
}

function wrapStatement(native: StatementSync): ShimStatement {
	// Array mode is set for the duration of one call and then cleared. Leaving it
	// on would be faster, but Drizzle reuses the same prepared statement for both
	// object rows and array rows, so a sticky flag silently returns the wrong
	// shape to whichever caller comes second.
	const inArrayMode = <R>(run: () => R): R => {
		native.setReturnArrays(true);
		try {
			return run();
		} finally {
			native.setReturnArrays(false);
		}
	};

	return {
		run: (...params) =>
			native.run(...(params as Parameters<StatementSync["run"]>)) as {
				changes: number | bigint;
				lastInsertRowid: number | bigint;
			},
		get: (...params) => native.get(...(params as Parameters<StatementSync["get"]>)),
		all: (...params) => native.all(...(params as Parameters<StatementSync["all"]>)),
		raw: () => ({
			get: (...params) =>
				inArrayMode(() => native.get(...(params as Parameters<StatementSync["get"]>))),
			all: (...params) =>
				inArrayMode(() => native.all(...(params as Parameters<StatementSync["all"]>))),
		}),
	};
}

export function openDatabase(filename: string): ShimDatabase {
	const native = new DatabaseSync(filename);

	// WAL lets a reader run while a writer is active, which matters once mail sync
	// writes in the background while the interface reads. NORMAL is the correct
	// durability pairing with WAL: a crash cannot corrupt the file, only lose the
	// last transaction. foreign_keys is OFF by default in SQLite and has to be
	// turned on per connection, every time.
	native.exec("PRAGMA journal_mode = WAL");
	native.exec("PRAGMA synchronous = NORMAL");
	native.exec("PRAGMA foreign_keys = ON");
	native.exec("PRAGMA busy_timeout = 5000");

	let depth = 0;

	return {
		native,
		prepare: (sql) => wrapStatement(native.prepare(sql)),
		exec: (sql) => native.exec(sql),
		close: () => native.close(),
		transaction<A extends unknown[], R>(fn: (...args: A) => R) {
			return (...args: A): R => {
				// Drizzle manages its own savepoints for nesting, but a service that
				// wraps one transactional call in another would otherwise emit a
				// second BEGIN and throw. Counting depth makes the inner call join
				// the outer transaction instead.
				if (depth > 0) return fn(...args);
				native.exec("BEGIN");
				depth++;
				try {
					const result = fn(...args);
					native.exec("COMMIT");
					return result;
				} catch (error) {
					native.exec("ROLLBACK");
					throw error;
				} finally {
					depth--;
				}
			};
		},
	};
}
