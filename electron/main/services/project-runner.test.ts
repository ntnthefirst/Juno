/**
 * The runner starts a real process, so these tests start a real one too. `echo`
 * is the one command every shell this app runs on has, and it exits on its own,
 * which is what keeps this test from depending on the stop path to finish.
 *
 * Nothing here touches the database: a command carrying its own working
 * directory never asks for the project behind it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectCommand, ProjectRun } from "../../shared/types";
import * as runner from "./project-runner";

let cwd: string;

function commandOf(line: string, label = "Test"): ProjectCommand {
	return {
		id: `command-${Math.random().toString(16).slice(2)}`,
		ownerId: "owner",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		projectId: "project",
		label,
		command: line,
		workingDir: cwd,
		kind: "shell",
		sortOrder: 0,
	};
}

/** Resolves when the run is no longer running, or after the timeout. */
function settled(commandId: string, timeoutMs = 10000): Promise<ProjectRun> {
	return new Promise((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			stop();
			rejectPromise(new Error("The run never finished."));
		}, timeoutMs);

		const stop = runner.onChange((run) => {
			if (run.commandId !== commandId || run.state === "running") return;
			clearTimeout(timer);
			stop();
			resolvePromise(run);
		});
	});
}

beforeEach(() => {
	runner.resetForTests();
	cwd = mkdtempSync(join(tmpdir(), "juno-run-"));
});

afterEach(() => {
	runner.stopAll();
	runner.resetForTests();
	rmSync(cwd, { recursive: true, force: true });
});

describe("running a project's command", () => {
	it("captures what the command printed and the code it exited with", async () => {
		const command = commandOf("echo juno-runner-ok");
		const finished = settled(command.id);

		const started = runner.start(command);
		expect(started.state).toBe("running");
		expect(started.workingDir).toBe(cwd);

		const run = await finished;
		expect(run.state).toBe("exited");
		expect(run.exitCode).toBe(0);
		expect(run.output.join("\n")).toContain("juno-runner-ok");
	});

	it("marks a command that exits badly as failed", async () => {
		const command = commandOf("exit 3");
		const finished = settled(command.id);

		runner.start(command);
		const run = await finished;

		expect(run.state).toBe("failed");
		expect(run.exitCode).toBe(3);
	});

	it("refuses to start the same command twice at once", () => {
		// A long-running one, so the second start meets a run that is still going.
		// It runs in the repo rather than in the temp folder: stopping a tree is
		// asynchronous on both platforms, and a process still dying holds its
		// working directory open long enough to fail the cleanup below.
		const command = {
			...commandOf(process.platform === "win32" ? "ping -n 6 127.0.0.1" : "sleep 5", "Dev server"),
			workingDir: process.cwd(),
		};
		runner.start(command);

		expect(() => runner.start(command)).toThrow(/already running/);
		expect(runner.isRunning(command.id)).toBe(true);

		runner.stop(command.id);
		expect(runner.isRunning(command.id)).toBe(false);
	});

	it("lists only the runs of the project asked for", async () => {
		const mine = commandOf("echo one");
		const theirs = { ...commandOf("echo two"), projectId: "another" };
		const both = Promise.all([settled(mine.id), settled(theirs.id)]);

		runner.start(mine);
		runner.start(theirs);
		await both;

		expect(runner.list("project").map((run) => run.commandId)).toEqual([mine.id]);
		expect(runner.list()).toHaveLength(2);
	});
});
