/**
 * The half of `npm run db:migrate` that touches the database.
 *
 * Runs under `ELECTRON_RUN_AS_NODE=1 electron`, so `node:sqlite` is the build
 * the app ships. It loads the compiled shim and migration runner from
 * dist-electron and imports nothing that needs the electron API. Arguments are
 * the database file and the compiled db folder, both absolute; scripts/migrate.mjs
 * has already checked them.
 *
 * This is CommonJS because the compiled main process is, and the repo's own
 * package.json says "module".
 */
const { join } = require("node:path");

const [dbPath, dbDir] = process.argv.slice(2);

let connection = null;
try {
	const { openDatabase } = require(join(dbDir, "node-sqlite-shim.js"));
	const { runMigrations } = require(join(dbDir, "migrate.js"));

	connection = openDatabase(dbPath);
	const { applied, alreadyCurrent } = runMigrations(connection, join(dbDir, "migrations"));

	for (const name of applied) console.log(name);
	const noun = (n) => (n === 1 ? "1 migration" : `${n} migrations`);
	console.log(
		applied.length > 0
			? `Applied ${noun(applied.length)} to ${dbPath}.`
			: `${dbPath} is already current (${noun(alreadyCurrent)}).`,
	);
} catch (error) {
	console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	// Closing folds the WAL back into the file, so a copy taken afterwards is whole.
	if (connection) connection.close();
}
