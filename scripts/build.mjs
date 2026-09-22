/**
 * `npm run build`: a complete, installable Juno.
 *
 * Typecheck, compile the main process, build the renderer, then package with
 * electron-builder. The result lands in `release/`.
 *
 * With no argument it builds for the machine it runs on, which is what you want
 * locally. `--win`, `--mac` and `--linux` name a target explicitly, which is
 * what CI wants: each runner builds the platform it is, because a Windows
 * installer cannot be signed from a Linux box and a dmg cannot be made off a
 * Mac at all.
 */
import { spawn } from "node:child_process";

const TARGETS = ["--win", "--mac", "--linux"];
const PUBLISH = ["never", "onTag", "onTagOrDraft", "always"];

const argv = process.argv.slice(2);
const targets = argv.filter((arg) => TARGETS.includes(arg));

// The release workflow passes `--publish always`. Locally it is left out, and
// nothing is uploaded anywhere.
const publishAt = argv.indexOf("--publish");
const publish = publishAt === -1 ? "never" : argv[publishAt + 1];

if (!PUBLISH.includes(publish)) {
	console.error(`--publish takes one of ${PUBLISH.join(", ")}.`);
	process.exit(1);
}

// The `publishAt !== -1` guard matters: without it, a missing --publish makes
// publishAt + 1 equal 0 and the first argument is skipped, so a typo in the
// target silently builds for the current platform instead of failing.
const unknown = argv.filter(
	(arg, index) =>
		!TARGETS.includes(arg) &&
		arg !== "--publish" &&
		!(publishAt !== -1 && index === publishAt + 1),
);

if (unknown.length > 0) {
	console.error(`Unknown option: ${unknown.join(", ")}. Use one of ${TARGETS.join(", ")}.`);
	process.exit(1);
}

function step(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed`)),
		);
	});
}

try {
	await step("npm", ["run", "typecheck"]);
	await step("npm", ["run", "compile"]);
	await step("npx", ["electron-builder", ...targets, "--publish", publish]);
	console.log(`\nBuilt${targets.length ? ` for ${targets.join(" ")}` : ""}. See release/.`);
} catch (error) {
	console.error(`\n${error.message}`);
	process.exit(1);
}
