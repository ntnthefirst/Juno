/**
 * The database connection. One per process, opened once, closed on quit.
 *
 * Storage is `node:sqlite` behind a shim that presents the better-sqlite3
 * interface, so Drizzle can drive it. See decision 18 and ./node-sqlite-shim.ts.
 *
 * Drizzle is assembled by hand here instead of through `drizzle()` from
 * `drizzle-orm/better-sqlite3`. That entry point does a top-level
 * `require("better-sqlite3")` and throws before it ever looks at the client it
 * was handed, even though it never uses the import on that path. Every piece
 * below is a published subpath export, and this mirrors exactly what its own
 * `construct()` does.
 *
 * This module deliberately does NOT import `electron`. Paths live in ./paths.ts,
 * so a service and its test can build a database in a plain Node process.
 */
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm/relations";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core/db";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core/dialect";
import { openDatabase, type ShimDatabase } from "./node-sqlite-shim";
import * as schema from "./schema";

export type Db = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

let connection: ShimDatabase | null = null;
let db: Db | null = null;

export function createDrizzle(client: ShimDatabase): Db {
	const dialect = new SQLiteSyncDialect({ casing: undefined });
	const tablesConfig = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
	const relational = {
		fullSchema: schema,
		schema: tablesConfig.tables,
		tableNamesMap: tablesConfig.tableNamesMap,
	};
	const session = new BetterSQLiteSession(
		client as never,
		dialect,
		relational as never,
		{ logger: undefined },
	);
	return new BaseSQLiteDatabase("sync", dialect, session as never, relational as never) as Db;
}

export function getDb(): Db {
	if (!db) throw new Error("Database used before openDb(). Call it after app.whenReady().");
	return db;
}

export function getConnection(): ShimDatabase {
	if (!connection) throw new Error("Database used before openDb().");
	return connection;
}

export function openDb(filename: string): Db {
	if (db) return db;
	connection = openDatabase(filename);
	db = createDrizzle(connection);
	return db;
}

export function closeDb(): void {
	connection?.close();
	connection = null;
	db = null;
}

export { schema };
