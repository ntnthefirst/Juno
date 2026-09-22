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
 *
 * Two things used to make this slow to reach a window, and both are gone:
 *
 * 1. The main process was compiled twice, once up front to have something on
 *    disk and once more as the watch started. Each pass is the whole program.
 *    The watch is now the only compiler, and this waits for its first pass.
 * 2. Every process went through `npm` or `npx`, which on Windows is a shell, a
 *    package manager and a resolver before the real work starts. The binaries
 *    are resolved from node_modules and spawned directly.
 *
 * Nothing here waits on a port either. Vite says when it is listening and tsc
 * says when it has emitted, so the two are read rather than polled.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { devDataDir } from "./dev-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

// npm turns an unknown flag on `npm run dev --clean` into this env var, and
// passes `-- --clean` through as a real argument. Both spellings are natural to
// reach for, so both work.
const clean = process.argv.includes("--clean") || process.env.npm_config_clean === "true";

const dataDir = devDataDir();

/**
 * Where a run remembers the pids it started, so the next one can find them.
 *
 * `stopAll` frees a normal exit's vite, tsc and Electron. Nothing frees them
 * when this script itself dies harder than that: the terminal closes, the host
 * kills the session, the machine sleeps mid-shutdown. Each of those leaves a
 * process holding the port the next `npm run dev` needs, and that run fails
 * with "Port 5173 is already in use" against a window from a session that is
 * long gone.
 */
const pidFile = join(dataDir, "dev.pids.json");

/** Stops whatever the last run left behind, before this run starts anything of its own. */
function killStale() {
	if (!existsSync(pidFile)) return;
	let pids;
	try {
		pids = JSON.parse(readFileSync(pidFile, "utf8"));
	} catch {
		pids = [];
	}
	for (const pid of pids) {
		if (typeof pid !== "number") continue;
		try {
			// Signal 0 checks whether the pid is still alive without killing it,
			// so a number the OS has since handed to an unrelated process is left
			// alone rather than killed on a guess.
			process.kill(pid, 0);
		} catch {
			continue;
		}
		try {
			process.kill(pid);
			console.log(`[dev] Stopped a leftover process from an earlier run (pid ${pid}).`);
		} catch {
			// Gone between the check above and this line. Nothing to report.
		}
	}
	rmSync(pidFile, { force: true });
}

// Ahead of --clean, which would otherwise delete the record of what to stop
// along with the rest of the directory.
killStale();

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
const children = new Set();
let shuttingDown = false;

function savePids() {
	const pids = [...children].map((child) => child.pid).filter((pid) => typeof pid === "number");
	try {
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(pidFile, JSON.stringify(pids));
	} catch {
		// Best effort: a failed write here only means the next run cannot clean
		// up automatically, not that this one fails to start.
	}
}

function run(command, args, options = {}) {
	const child = spawn(command, args, { cwd: root, env, ...options });
	children.add(child);
	savePids();
	child.on("exit", () => {
		children.delete(child);
		savePids();
	});
	return child;
}

/**
 * The entry script of a dev dependency, by path.
 *
 * Not require.resolve: both packages declare "exports", which deliberately
 * hides their bin scripts from resolution even though running them is exactly
 * what a launcher does.
 */
function binScript(...parts) {
	const path = join(root, "node_modules", ...parts);
	if (!existsSync(path)) {
		throw new Error(`Missing ${parts.join("/")}. Run npm install.`);
	}
	return path;
}

/** Runs a script of our own in this same Node, which is already warm. */
function runNode(script, args = [], options = {}) {
	return run(process.execPath, [join(root, "scripts", script), ...args], options);
}

function stopAll() {
	shuttingDown = true;
	for (const child of children) child.kill();
	// A clean stop needs no cleanup on the next run's part.
	rmSync(pidFile, { force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		stopAll();
		process.exit(0);
	});
}

/** Prefixes a child's output the way `concurrently` did, without the wrapper. */
function label(child, name) {
	const write = (chunk) => {
		for (const line of chunk.toString().split(/\r?\n/)) {
			if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
		}
	};
	child.stdout?.on("data", write);
	child.stderr?.on("data", write);
}

const piped = { stdio: ["inherit", "pipe", "pipe"] };

// Vite colours its output, and the escape codes land in the middle of the URL
// it prints, so anything reading that line has to strip them first.
// Built from a char code rather than written as a literal: an escape
// character inside a regex literal is invisible in a diff, which is what
// no-control-regex exists to catch.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

// ------------------------------------------------------------------ renderer

// Vite compiles on demand, so there is nothing to build, only a port to come
// up. It prints the URL when it has, which is the signal Electron waits for.
const vite = run(process.execPath, [binScript("vite", "bin", "vite.js")], piped);
label(vite, "vite");

let viteReady = false;
let resolveVite;
const viteListening = new Promise((resolve) => (resolveVite = resolve));

vite.stdout.on("data", (chunk) => {
	if (viteReady) return;
	const found = /(http:\/\/localhost:\d+)\//.exec(chunk.toString().replace(ANSI, ""));
	if (!found) return;
	viteReady = true;
	resolveVite(found[1]);
});

// --------------------------------------------------------------- main process

// The watch is the only thing that compiles the main process. tsc ends every
// pass with a summary line, which is what says dist-electron is complete.
const tsc = run(
	process.execPath,
	[
		binScript("typescript", "bin", "tsc"),
		"-p",
		"tsconfig.main.json",
		"--watch",
		"--preserveWatchOutput",
		"--pretty",
		"false",
	],
	piped,
);

let launched = false;

tsc.stdout.on("data", (chunk) => {
	const text = chunk.toString();
	for (const line of text.split(/\r?\n/)) {
		if (line.trim()) process.stdout.write(`[main] ${line}\n`);
	}

	const pass = /Found (\d+) error/.exec(text);
	if (!pass) return;

	// A window opened against half-emitted output crashes in a way that reads as
	// a bug in the code rather than a compile error scrolled off the top.
	if (pass[1] !== "0") {
		if (!launched) console.log("[dev] Main process has errors. Fix them and this continues.");
		return;
	}

	if (launched) return;
	launched = true;
	launch().catch((error) => {
		console.error(`[dev] ${error.message}`);
		stopAll();
		process.exit(1);
	});
});

tsc.stderr.on("data", (chunk) => process.stderr.write(`[main] ${chunk}`));

// --------------------------------------------------------------------- launch

async function launch() {
	// tsc emits .ts and nothing else. The migrations, the document fonts and the
	// package.json that marks dist-electron CommonJS are copied by this, and
	// Electron does not boot without them.
	await new Promise((resolve, reject) => {
		const after = runNode("after-main.mjs", [], piped);
		label(after, "main");
		after.on("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`after-main exited ${code}`)),
		);
	});

	const url = await viteListening;
	console.log(`[dev] Renderer on ${url}`);

	const electron = run(require("electron"), ["."], piped);
	label(electron, "app");
	electron.on("exit", (code) => {
		if (shuttingDown) return;
		stopAll();
		process.exit(code ?? 0);
	});
}
