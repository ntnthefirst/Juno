/**
 * Runs a project's command and keeps what it printed.
 *
 * Be clear about what this is. The command runs in the platform's shell, with
 * the user's own account and privileges, exactly as if it had been typed into a
 * terminal. That is what makes `npm run dev` and `docker compose up` work at
 * all, and there is no version of this feature that is meaningfully weaker:
 * anything that can start a dev server can start anything.
 *
 * So the whole of the containment is who is allowed to ask:
 *
 * - The command text is written in the app, by a person, and nowhere else.
 *   There is no MCP tool that writes one and none that runs one (decision 35).
 * - A run is started by a click, never by a timer, a sync or an automation.
 * - Nothing here interpolates anything into the command. It is stored whole and
 *   handed over whole, so there is no place for a client name or a file name to
 *   become part of a shell line.
 *
 * A run lives in memory. A process is not a record: it does not survive a
 * restart, and writing every line it prints into SQLite would be a log file
 * with extra steps and a database that grows while a dev server idles.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { ProjectCommand, ProjectRun } from "../../shared/types";
import { folderFor } from "./project-storage";
import { requireProject } from "./projects";
import { ensureFolder } from "./project-storage";

/** Lines kept per run. Enough to see a stack trace, not enough to hold a build. */
const MAX_LINES = 500;

type Live = { run: ProjectRun; child: ChildProcess | null };

const runs = new Map<string, Live>();
const listeners = new Set<(run: ProjectRun) => void>();

export function onChange(listener: (run: ProjectRun) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function snapshot(run: ProjectRun): ProjectRun {
	return { ...run, output: [...run.output] };
}

function publish(live: Live): void {
	const copy = snapshot(live.run);
	for (const listener of listeners) listener(copy);
}

function append(live: Live, text: string): void {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	for (const line of lines) {
		if (line === "" && live.run.output.length === 0) continue;
		live.run.output.push(line);
	}
	if (live.run.output.length > MAX_LINES) {
		live.run.output.splice(0, live.run.output.length - MAX_LINES);
	}
}

/**
 * Where a command runs: its own folder if it has one, then the project's
 * checkout, then the project's storage folder as a last resort so a run never
 * inherits whatever directory the application happens to have been launched
 * from.
 */
export function workingDirFor(command: ProjectCommand): string {
	if (command.workingDir && existsSync(command.workingDir)) return command.workingDir;

	const project = requireProject(command.projectId);
	if (project.localPath && existsSync(project.localPath)) return project.localPath;

	return ensureFolder(folderFor(project));
}

export function list(projectId?: string): ProjectRun[] {
	const all = [...runs.values()].map((live) => snapshot(live.run));
	return projectId ? all.filter((run) => run.projectId === projectId) : all;
}

export function get(commandId: string): ProjectRun | null {
	const live = runs.get(commandId);
	return live ? snapshot(live.run) : null;
}

export function isRunning(commandId: string): boolean {
	return runs.get(commandId)?.run.state === "running";
}

/**
 * Starts a command. One run per command at a time: a second `npm run dev` would
 * fight the first one for the port and neither would say why.
 */
export function start(command: ProjectCommand): ProjectRun {
	const existing = runs.get(command.id);
	if (existing?.run.state === "running") {
		throw new Error(`${command.label} is already running. Stop it first.`);
	}

	const cwd = workingDirFor(command);
	const live: Live = {
		run: {
			commandId: command.id,
			projectId: command.projectId,
			label: command.label,
			command: command.command,
			workingDir: cwd,
			state: "running",
			pid: null,
			startedAt: new Date().toISOString(),
			endedAt: null,
			exitCode: null,
			error: null,
			output: [],
		},
		child: null,
	};
	runs.set(command.id, live);

	let child: ChildProcess;
	try {
		child = spawn(command.command, {
			cwd,
			shell: true,
			windowsHide: true,
			// On everything but Windows the child becomes its own process group,
			// so stopping it can take the whole tree down rather than leaving the
			// shell's children running with nothing holding them.
			detached: process.platform !== "win32",
			env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		});
	} catch (cause: unknown) {
		live.run.state = "failed";
		live.run.endedAt = new Date().toISOString();
		live.run.error = cause instanceof Error ? cause.message : String(cause);
		publish(live);
		return snapshot(live.run);
	}

	live.child = child;
	live.run.pid = child.pid ?? null;

	child.stdout?.on("data", (chunk: Buffer) => {
		append(live, chunk.toString("utf8"));
		publish(live);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		append(live, chunk.toString("utf8"));
		publish(live);
	});

	child.on("error", (cause: Error) => {
		live.run.state = "failed";
		live.run.error = cause.message;
		live.run.endedAt = new Date().toISOString();
		live.child = null;
		publish(live);
	});

	child.on("close", (code, signal) => {
		if (live.run.state !== "running") return;
		live.run.state = code === 0 || signal !== null ? "exited" : "failed";
		live.run.exitCode = code;
		live.run.endedAt = new Date().toISOString();
		live.child = null;
		publish(live);
	});

	publish(live);
	return snapshot(live.run);
}

/**
 * Stops a run and everything it started.
 *
 * `shell: true` means the child is a shell and the dev server is its child, so
 * signalling the shell alone leaves the server holding the port. Windows has no
 * process groups to signal, and taskkill with /T is the way to take the tree.
 */
export function stop(commandId: string): ProjectRun | null {
	const live = runs.get(commandId);
	if (!live) return null;
	if (live.run.state !== "running" || !live.child?.pid) return snapshot(live.run);

	const pid = live.child.pid;
	try {
		if (process.platform === "win32") {
			spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
		} else {
			process.kill(-pid, "SIGTERM");
		}
	} catch (cause: unknown) {
		live.run.error = cause instanceof Error ? cause.message : String(cause);
	}

	live.run.state = "exited";
	live.run.endedAt = new Date().toISOString();
	publish(live);
	return snapshot(live.run);
}

/** Clears a finished run from the list. A running one is stopped first. */
export function clear(commandId: string): void {
	if (isRunning(commandId)) stop(commandId);
	runs.delete(commandId);
}

/**
 * Called on quit. A dev server left behind by a closed app is a port nobody can
 * explain and a process nobody goes looking for.
 */
export function stopAll(): void {
	for (const commandId of [...runs.keys()]) stop(commandId);
}

/** Tests only. Drops every run without signalling anything. */
export function resetForTests(): void {
	runs.clear();
	listeners.clear();
}
