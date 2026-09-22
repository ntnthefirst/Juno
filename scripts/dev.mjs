/**
 * `npm run dev`: the whole development stack in one command.
 *
 * Starts the Vite server for the renderer, a TypeScript watch for the main
 * process, and Electron once both are ready. Everything it writes goes to a
 * development data directory of its own, so an installed Juno on the same
 * machine is never touched.
 *
 * `npm run dev -- --clean` (or `npm run dev --clean`, or `npm run dev:clean`)
 * deletes that directory first: a fresh database, no accounts, no seeded rows,
 * which is the only honest way to test a first run or a migration from empty.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { devDataDir } from "./dev-data.mjs";

// npm turns an unknown flag on `npm run dev --clean` into this env var, and
// passes `-- --clean` through as a real argument. Both spellings are natural to
// reach for, so both work.
const clean = process.argv.includes("--clean") || process.env.npm_config_clean === "true";

const dataDir = devDataDir();

if (clean) {
	if (existsSync(dataDir)) {
		rmSync(dataDir, { recursive: true, force: true });
		console.log(`Cleaned development data: ${dataDir}`);
	} else {
		console.log(`Nothing to clean: ${dataDir} does not exist`);
	}
}

console.log(`Development data: ${dataDir}`);

const env = { ...process.env, JUNO_DEV: "1", JUNO_DEV_DATA: dataDir };

function run(command, args, options = {}) {
	return spawn(command, args, {
		stdio: "inherit",
		shell: process.platform === "win32",
		env,
		...options,
	});
}

// The main process has to exist on disk before Electron is told to start, and
// before the watch takes over. A failure here is a compile error worth stopping
// for rather than a window that opens against stale output.
const build = run("npm", ["run", "build:main"]);

build.on("exit", (code) => {
	if (code !== 0) process.exit(code ?? 1);

	const child = run("npx", [
		"concurrently",
		"-k",
		"-n",
		"vite,main,app",
		"-c",
		"cyan,yellow,magenta",
		"npm:dev:renderer",
		"npm:dev:main",
		"npm:dev:electron",
	]);

	child.on("exit", (childCode) => process.exit(childCode ?? 0));
});
