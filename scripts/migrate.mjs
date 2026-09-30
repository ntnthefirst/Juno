/**
 * `npm run db:migrate -- --db <path>`: applies pending migrations to one
 * database file and says what it did. Nothing is seeded.
 *
 * The file is opened by the same SQLite the app ships, never by the host's
 * Node. A write from the wrong build can leave a schema page that parses on
 * one and not on the other (.claude/rules/verify.md). So this compiles the main
 * process first, then runs scripts/migrate-run.cjs under
 * `ELECTRON_RUN_AS_NODE=1 electron`, which loads the compiled shim and runner
 * from dist-electron. No electron API is used, only its bundled Node.
 *
 * The installed application's database and the development one are refused
 * unless `--yes-this-is-the-real-one` is passed. The point of this command is
 * to try a migration on a copy, and a mistyped path should not be able to
 * migrate the real file. Close the app before pointing this at a real one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devDataDir } from "./dev-data.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

const DB_FILE = "juno.sqlite";
// The folder Electron derives from productName in package.json.
const APP_DIR_NAME = "Juno";

function usage() {
	console.error(
		"Usage: npm run db:migrate -- --db <path> [--yes-this-is-the-real-one]",
	);
	process.exit(1);
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

function installedDataDir() {
	switch (platform()) {
		case "win32":
			return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
		case "darwin":
			return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
		default:
			return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), APP_DIR_NAME);
	}
}

/** Windows paths compare without regard to case. Links are followed when the file exists. */
function comparable(path) {
	let resolved = resolve(path);
	if (existsSync(resolved)) resolved = realpathSync(resolved);
	return platform() === "win32" ? resolved.toLowerCase() : resolved;
}

function readArgs(argv) {
	let db = null;
	let force = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--db") {
			db = argv[++i] ?? null;
		} else if (arg.startsWith("--db=")) {
			db = arg.slice("--db=".length);
		} else if (arg === "--yes-this-is-the-real-one") {
			force = true;
		} else {
			usage();
		}
	}
	if (!db) usage();
	return { db: resolve(db), force };
}

const { db, force } = readArgs(process.argv.slice(2));

const protectedFiles = [
	["the installed application's database", join(installedDataDir(), DB_FILE)],
	["the development database", join(devDataDir(), DB_FILE)],
];
for (const [label, path] of protectedFiles) {
	if (comparable(db) === comparable(path) && !force) {
		fail(
			`${db} is ${label}. Point --db at a copy, or pass --yes-this-is-the-real-one with the app closed.`,
		);
	}
}

if (existsSync(db)) {
	if (!statSync(db).isFile()) fail(`${db} is not a file. Point --db at a database file.`);
} else if (!existsSync(dirname(db))) {
	fail(`The folder ${dirname(db)} does not exist. Create it first, then run this again.`);
}

const build = spawnSync("npm", ["run", "build:main"], {
	cwd: root,
	shell: platform() === "win32",
	stdio: "inherit",
});
if (build.status !== 0) fail("The main process did not compile, so nothing was migrated.");

const run = spawnSync(
	require("electron"),
	[join(root, "scripts", "migrate-run.cjs"), db, join(root, "dist-electron", "main", "db")],
	{
		cwd: root,
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		stdio: "inherit",
	},
);
if (run.error) fail(`Could not start Electron: ${run.error.message}`);
process.exit(run.status ?? 1);
