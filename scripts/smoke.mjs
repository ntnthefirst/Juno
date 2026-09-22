/**
 * Launches the real application against a throwaway user-data directory, waits
 * for the window to paint, and fails on any renderer error, main-process throw,
 * or a window that never loads.
 *
 * A clean typecheck proves none of this. The custom scheme, the preload bridge
 * and the database only exist at runtime.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electron from "electron";

const userData = mkdtempSync(join(tmpdir(), "juno-smoke-"));
// The demo run now walks eleven screens in two themes, drives the calendar and
// agent dialogs, and starts the MCP bridge as a real child process. Ninety
// seconds is the headroom that leaves; a run that takes longer than this is
// stuck rather than slow.
const TIMEOUT_MS = 90_000;

const child = spawn(
	electron,
	[".", "--user-data-dir=" + userData, "--no-sandbox"],
	{
		env: {
			...process.env,
			JUNO_SMOKE: "1",
			JUNO_SMOKE_SHOT: process.env.JUNO_SMOKE_SHOT ?? join(process.cwd(), ".smoke"),
			ELECTRON_ENABLE_LOGGING: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => {
	stdout += d;
	process.stdout.write(d);
});
child.stderr.on("data", (d) => {
	stderr += d;
	process.stderr.write(d);
});

const timer = setTimeout(() => {
	console.error(`\nSmoke failed: no SMOKE_READY within ${TIMEOUT_MS / 1000}s.`);
	child.kill();
	finish(1);
}, TIMEOUT_MS);

child.on("exit", (code) => {
	clearTimeout(timer);

	const ready = stdout.includes("SMOKE_READY");
	// Electron writes a lot of benign noise to stderr on Windows. Only these
	// matter, and each one means the application is actually broken.
	const fatal = [
		/renderer: /,
		/Uncaught/,
		/ERR_FILE_NOT_FOUND/,
		/Refused to (load|execute|connect)/i,
		/Failed to load resource/i,
		/is not defined/,
		/Cannot find module/,
	].filter((re) => re.test(stderr) || re.test(stdout));

	if (!ready) {
		console.error("\nSmoke failed: the window never finished loading.");
		return finish(1);
	}
	if (fatal.length > 0) {
		console.error("\nSmoke failed: " + fatal.map(String).join(", "));
		return finish(1);
	}
	if (code !== 0 && code !== null) {
		console.error(`\nSmoke failed: the app exited with code ${code}.`);
		return finish(1);
	}

	console.log("\nSmoke passed: the app booted, migrated and painted.");
	finish(0);
});

function finish(code) {
	try {
		rmSync(userData, { recursive: true, force: true });
	} catch {
		// A locked SQLite file on Windows is not a reason to fail the run.
	}
	process.exit(code);
}
