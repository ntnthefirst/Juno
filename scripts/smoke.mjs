/**
 * Launches the real application against a throwaway user-data directory, waits
 * for the window to paint, and fails on any renderer error, main-process throw,
 * or a window that never loads.
 *
 * A clean typecheck proves none of this. The custom scheme, the preload bridge
 * and the database only exist at runtime.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electron from "electron";

const userData = mkdtempSync(join(tmpdir(), "juno-smoke-"));
// The demo run walks seventeen screens in two themes, the setup window and the
// walkthrough after it, both template editors, every settings tab and both
// sides of the MCP switch, and it starts the bridge as a real child process.
// Each capture also waits for a composited frame first, which is what stops
// the screenshots being one step stale. Four minutes is the headroom that
// leaves; a run that takes longer than this is stuck rather than slow.
const TIMEOUT_MS = 240_000;

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

	reportStaleShots();
	console.log("\nSmoke passed: the app booted, migrated and painted.");
	finish(0);
});

/**
 * Says how many screenshots came out identical, and does not fail the run for
 * it.
 *
 * `capturePage` returns whatever the compositor last produced. A window that is
 * occluded or minimised is not composited at all, so a run under a window
 * somebody clicked in front of writes a folder where whole stretches of images
 * are the same picture, each under a different name, and every one of them
 * looks plausible on its own. That is a set of screenshots nobody should read
 * as evidence, and until this line existed nothing said which kind of run had
 * just happened.
 *
 * It is a warning rather than a failure because the cause is the state of the
 * desktop, not the state of the code, and a check that fails because somebody
 * opened a window is a check people learn to ignore.
 */
function reportStaleShots() {
	const dir = process.env.JUNO_SMOKE_SHOT ?? join(process.cwd(), ".smoke");
	let files;
	try {
		files = readdirSync(dir).filter((name) => name.endsWith(".png"));
	} catch {
		return;
	}
	if (files.length === 0) return;

	const seen = new Set();
	let repeated = 0;
	for (const name of files) {
		const hash = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
		if (seen.has(hash)) repeated += 1;
		else seen.add(hash);
	}

	if (repeated === 0) {
		console.log(`Screenshots: ${files.length}, all different.`);
		return;
	}
	console.log(
		`Screenshots: ${files.length}, of which ${repeated} repeat an earlier image. ` +
			"The window was not being composited for part of the run, so those are the " +
			"frame from an earlier step. Run it again with the window in front before " +
			"reading them.",
	);
}

function finish(code) {
	try {
		rmSync(userData, { recursive: true, force: true });
	} catch {
		// A locked SQLite file on Windows is not a reason to fail the run.
	}
	process.exit(code);
}
