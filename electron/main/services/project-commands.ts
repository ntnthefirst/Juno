/**
 * The commands that start a project: `npm run dev`, `docker compose up`.
 *
 * This file stores them. project-runner.ts runs them, and the split matters:
 * storing a string is a record like any other, and running one is the single
 * most powerful thing Juno does on this machine.
 *
 * Nothing here is reachable from an agent. Decision 35, and
 * .claude/rules/mcp.md section 7 on tools that take a raw statement: a tool that
 * writes a command plus a tool that runs one is a remote shell with two steps,
 * and the approval gate in front of it would be asking a person to read a shell
 * command and guess. The agent may read the list and nothing else.
 */
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ProjectCommand, ProjectCommandInput, ProjectCommandKind, ProjectCommandPatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { projectCommands } from "../db/schema";
import { requireProject } from "./projects";

const KINDS: ProjectCommandKind[] = ["shell", "docker"];

function requireLabel(label: unknown): string {
	const value = typeof label === "string" ? label.trim() : "";
	if (!value) throw new Error("A command needs a name, so the button says what it does.");
	return value;
}

function requireCommand(command: unknown): string {
	const value = typeof command === "string" ? command.trim() : "";
	if (!value) throw new Error("Enter the command to run, such as npm run dev.");
	if (value.includes("\n")) {
		throw new Error("A command is one line. Put a sequence in a script and call the script.");
	}
	return value;
}

function checkWorkingDir(dir: string | null | undefined): string | null {
	if (dir === null || dir === undefined) return null;
	const value = dir.trim();
	if (!value) return null;
	if (!isAbsolute(value)) throw new Error("Give the full path to the folder to run in.");
	if (!existsSync(value)) throw new Error(`There is no folder at ${value}.`);
	return value;
}

function checkKind(kind: unknown): ProjectCommandKind {
	if (typeof kind !== "string" || !KINDS.includes(kind as ProjectCommandKind)) {
		throw new Error(`Unknown command kind "${String(kind)}". Use shell or docker.`);
	}
	return kind as ProjectCommandKind;
}

function nextSortOrder(projectId: string, db: Db): number {
	const row = db
		.select({ highest: max(projectCommands.sortOrder) })
		.from(projectCommands)
		.where(and(eq(projectCommands.projectId, projectId), isNull(projectCommands.deletedAt)))
		.get();
	return (row?.highest ?? -1) + 1;
}

export async function listForProject(projectId: string, db: Db = getDb()): Promise<ProjectCommand[]> {
	return db
		.select()
		.from(projectCommands)
		.where(and(eq(projectCommands.projectId, projectId), isNull(projectCommands.deletedAt)))
		.orderBy(asc(projectCommands.sortOrder), asc(projectCommands.id))
		.all() as ProjectCommand[];
}

export async function get(id: string, db: Db = getDb()): Promise<ProjectCommand | null> {
	const row = db
		.select()
		.from(projectCommands)
		.where(and(eq(projectCommands.id, id), isNull(projectCommands.deletedAt)))
		.get();
	return (row as ProjectCommand | undefined) ?? null;
}

export function requireCommandRow(id: string, db: Db = getDb()): ProjectCommand {
	const row = db
		.select()
		.from(projectCommands)
		.where(and(eq(projectCommands.id, id), isNull(projectCommands.deletedAt)))
		.get();
	if (!row) throw new Error(`No command with id "${id}". It may have been deleted.`);
	return row as ProjectCommand;
}

export async function create(
	input: ProjectCommandInput,
	db: Db = getDb(),
): Promise<ProjectCommand> {
	requireProject(input.projectId, db);

	return db
		.insert(projectCommands)
		.values({
			projectId: input.projectId,
			label: requireLabel(input.label),
			command: requireCommand(input.command),
			workingDir: checkWorkingDir(input.workingDir),
			kind: input.kind ? checkKind(input.kind) : "shell",
			sortOrder: input.sortOrder ?? nextSortOrder(input.projectId, db),
		})
		.returning()
		.get() as ProjectCommand;
}

export async function update(
	id: string,
	patch: ProjectCommandPatch,
	db: Db = getDb(),
): Promise<ProjectCommand> {
	const values: Partial<typeof projectCommands.$inferInsert> = { updatedAt: now() };
	if (patch.label !== undefined) values.label = requireLabel(patch.label);
	if (patch.command !== undefined) values.command = requireCommand(patch.command);
	if (patch.workingDir !== undefined) values.workingDir = checkWorkingDir(patch.workingDir);
	if (patch.kind !== undefined) values.kind = checkKind(patch.kind);
	if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

	const row = db
		.update(projectCommands)
		.set(values)
		.where(and(eq(projectCommands.id, id), isNull(projectCommands.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No command with id "${id}" to update. It may have been deleted.`);
	return row as ProjectCommand;
}

export async function remove(id: string, db: Db = getDb()): Promise<ProjectCommand> {
	const stamp = now();
	const row = db
		.update(projectCommands)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(projectCommands.id, id), isNull(projectCommands.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No command with id "${id}" to delete. It may already be deleted.`);
	return row as ProjectCommand;
}

export async function reorder(
	projectId: string,
	orderedIds: string[],
	db: Db = getDb(),
): Promise<ProjectCommand[]> {
	const stamp = now();
	db.transaction((tx) => {
		orderedIds.forEach((id, index) => {
			tx.update(projectCommands)
				.set({ sortOrder: index, updatedAt: stamp })
				.where(and(eq(projectCommands.id, id), eq(projectCommands.projectId, projectId)))
				.run();
		});
	});
	return listForProject(projectId, db);
}
