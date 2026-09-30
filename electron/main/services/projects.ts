/**
 * Projects. A piece of work, with a value in integer cents, dates that carry no
 * time of day, and the places the work lives.
 *
 * A project need not belong to a client. The work a one-person business does
 * for itself is the same shape as the work it does for someone else, and
 * inventing a client for it would put a fiction in the client list. So
 * `clientId` is nullable and every read that wants a client name joins it left.
 *
 * Every rule about a project lives in this file. The IPC and MCP adapters call
 * these functions and contain nothing else. See .claude/rules/architecture.md.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { existsSync } from "node:fs";
import type {
	Project,
	ProjectInput,
	ProjectLinkKind,
	ProjectPatch,
	ProjectStorageChoice,
	ProjectStorageInfo,
	ProjectSummary,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import {
	clients,
	projectAssets,
	projectCommands,
	projectLinks,
	projects,
	referenceItems,
} from "../db/schema";
import { requireClient } from "./clients";
import {
	checkChosenFolder,
	defaultFolderFor,
	ensureFolder,
	folderFor,
	moveFolder,
	resolveInside,
	usage,
} from "./project-storage";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ListProjectsQuery {
	clientId?: string;
	statusId?: string | null;
	/** True lists only the projects with no client, false only those with one. */
	unassigned?: boolean;
}

function requireName(name: unknown): string {
	const value = typeof name === "string" ? name.trim() : "";
	if (!value) throw new Error("A project needs a name.");
	return value;
}

function checkDate(value: string | null | undefined, field: string): void {
	if (value === null || value === undefined) return;
	if (!DATE_ONLY.test(value)) {
		throw new Error(`${field} must be a calendar date like 2026-03-14, not "${value}".`);
	}
}

function checkCents(value: number | null | undefined): void {
	if (value === null || value === undefined) return;
	if (!Number.isInteger(value)) {
		throw new Error(
			"agreedValueCents is a whole number of cents. 1250,00 EUR is 125000, never 1250.00.",
		);
	}
	if (value < 0) throw new Error("agreedValueCents cannot be negative.");
}

function checkStatus(statusId: string | null | undefined, db: Db): void {
	if (!statusId) return;
	const found = db
		.select({ id: referenceItems.id })
		.from(referenceItems)
		.where(and(eq(referenceItems.id, statusId), isNull(referenceItems.deletedAt)))
		.get();
	if (!found) {
		throw new Error(`No status with id "${statusId}". Pick one from the project_status set.`);
	}
}

/**
 * The checkout, if one was given. It has to be a folder that is really there: a
 * path with a slip in it would otherwise only show itself when a command
 * refused to start, as an error from the shell rather than from here.
 */
function checkLocalPath(value: string | null | undefined): void {
	if (value === null || value === undefined || value === "") return;
	if (!existsSync(value)) {
		throw new Error(`There is no folder at ${value}. Check the path, or leave it empty.`);
	}
}

function checkFields(input: ProjectInput | ProjectPatch, db: Db): void {
	checkDate(input.startsOn, "startsOn");
	checkDate(input.dueOn, "dueOn");
	checkCents(input.agreedValueCents);
	checkLocalPath(input.localPath);
	if (input.statusId !== undefined) checkStatus(input.statusId, db);
	if (input.clientId !== undefined && input.clientId !== null) requireClient(input.clientId, db);
}

/** The link kinds, asset counts and command counts for a page of projects. */
function decorations(ids: string[], db: Db) {
	const kinds = new Map<string, ProjectLinkKind[]>();
	const assets = new Map<string, number>();
	const commands = new Map<string, number>();
	if (ids.length === 0) return { kinds, assets, commands };

	for (const row of db
		.selectDistinct({ projectId: projectLinks.projectId, kind: projectLinks.kind })
		.from(projectLinks)
		.where(and(inArray(projectLinks.projectId, ids), isNull(projectLinks.deletedAt)))
		.all()) {
		const list = kinds.get(row.projectId) ?? [];
		list.push(row.kind as ProjectLinkKind);
		kinds.set(row.projectId, list);
	}

	for (const row of db
		.select({ projectId: projectAssets.projectId, n: count() })
		.from(projectAssets)
		.where(and(inArray(projectAssets.projectId, ids), isNull(projectAssets.deletedAt)))
		.groupBy(projectAssets.projectId)
		.all()) {
		assets.set(row.projectId, row.n);
	}

	for (const row of db
		.select({ projectId: projectCommands.projectId, n: count() })
		.from(projectCommands)
		.where(and(inArray(projectCommands.projectId, ids), isNull(projectCommands.deletedAt)))
		.groupBy(projectCommands.projectId)
		.all()) {
		commands.set(row.projectId, row.n);
	}

	return { kinds, assets, commands };
}

/**
 * The image each card shows: the chosen cover while it is still there, and the
 * project's first image otherwise. A cover pointing at a deleted asset falls
 * through to the next image rather than to a hole, because a card with a grey
 * rectangle on it reads as a bug.
 */
function covers(ids: string[], chosen: Map<string, string | null>, db: Db): Map<string, string> {
	const out = new Map<string, string>();
	if (ids.length === 0) return out;

	const images = db
		.select({ id: projectAssets.id, projectId: projectAssets.projectId })
		.from(projectAssets)
		.where(
			and(
				inArray(projectAssets.projectId, ids),
				eq(projectAssets.kind, "image"),
				isNull(projectAssets.deletedAt),
			),
		)
		.orderBy(asc(projectAssets.sortOrder), asc(projectAssets.id))
		.all();

	const live = new Set(images.map((row) => row.id));
	for (const row of images) {
		if (!out.has(row.projectId)) out.set(row.projectId, row.id);
	}
	for (const [projectId, assetId] of chosen) {
		if (assetId && live.has(assetId)) out.set(projectId, assetId);
	}
	return out;
}

export async function list(
	query: ListProjectsQuery = {},
	db: Db = getDb(),
): Promise<ProjectSummary[]> {
	const conditions: SQL[] = [isNull(projects.deletedAt)];
	if (query.clientId) conditions.push(eq(projects.clientId, query.clientId));
	if (query.unassigned === true) conditions.push(isNull(projects.clientId));
	if (query.unassigned === false) conditions.push(isNotNull(projects.clientId));
	if (query.statusId !== undefined) {
		conditions.push(
			query.statusId === null ? isNull(projects.statusId) : eq(projects.statusId, query.statusId),
		);
	}

	const rows = db
		.select({
			id: projects.id,
			clientId: projects.clientId,
			clientName: clients.name,
			name: projects.name,
			status: referenceItems,
			dueOn: projects.dueOn,
			agreedValueCents: projects.agreedValueCents,
			description: projects.description,
			localPath: projects.localPath,
			updatedAt: projects.updatedAt,
			coverAssetId: projects.coverAssetId,
		})
		.from(projects)
		.leftJoin(clients, eq(projects.clientId, clients.id))
		.leftJoin(referenceItems, eq(projects.statusId, referenceItems.id))
		.where(and(...conditions))
		// A project with no due date sorts after the dated ones rather than before.
		.orderBy(sql`${projects.dueOn} is null`, asc(projects.dueOn), asc(sql`lower(${projects.name})`))
		.all();

	const ids = rows.map((row) => row.id);
	const { kinds, assets, commands } = decorations(ids, db);
	const cover = covers(ids, new Map(rows.map((row) => [row.id, row.coverAssetId])), db);

	return rows.map((row) => ({
		id: row.id,
		clientId: row.clientId,
		clientName: row.clientName ?? null,
		name: row.name,
		status: row.status ?? null,
		dueOn: row.dueOn,
		agreedValueCents: row.agreedValueCents,
		description: row.description,
		localPath: row.localPath,
		updatedAt: row.updatedAt,
		coverAssetId: cover.get(row.id) ?? null,
		linkKinds: kinds.get(row.id) ?? [],
		assetCount: assets.get(row.id) ?? 0,
		commandCount: commands.get(row.id) ?? 0,
	}));
}

export async function get(id: string, db: Db = getDb()): Promise<Project | null> {
	const row = db
		.select()
		.from(projects)
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.get();
	return (row as Project | undefined) ?? null;
}

/** The row, or a message naming what was asked for. Used by every sibling service. */
export function requireProject(id: string, db: Db = getDb()): Project {
	const row = db
		.select()
		.from(projects)
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.get();
	if (!row) throw new Error(`No project with id "${id}". It may have been deleted.`);
	return row as Project;
}

export async function create(input: ProjectInput, db: Db = getDb()): Promise<Project> {
	const name = requireName(input.name);
	checkFields(input, db);

	return db
		.insert(projects)
		.values({ ...input, name, clientId: input.clientId ?? null })
		.returning()
		.get() as Project;
}

export async function update(id: string, patch: ProjectPatch, db: Db = getDb()): Promise<Project> {
	checkFields(patch, db);

	const values: Partial<typeof projects.$inferInsert> = { ...patch, updatedAt: now() };
	if (patch.name !== undefined) values.name = requireName(patch.name);

	const row = db
		.update(projects)
		.set(values)
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No project with id "${id}" to update. It may have been deleted.`);
	return row as Project;
}

export async function remove(id: string, db: Db = getDb()): Promise<Project> {
	const stamp = now();
	const row = db
		.update(projects)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No project with id "${id}" to delete. It may already be deleted.`);
	return row as Project;
}

export async function restore(id: string, db: Db = getDb()): Promise<Project> {
	const row = db
		.update(projects)
		.set({ deletedAt: null, updatedAt: now() })
		.where(and(eq(projects.id, id), isNotNull(projects.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No deleted project with id "${id}" to restore.`);
	return row as Project;
}

/* ------------------------------------------------------------------ storage */

export async function storage(id: string, db: Db = getDb()): Promise<ProjectStorageInfo> {
	const project = requireProject(id, db);
	const path = folderFor(project);
	const found = usage(path);
	return {
		projectId: project.id,
		mode: project.storageMode,
		path,
		defaultPath: defaultFolderFor(project.id),
		exists: found.exists,
		fileCount: found.fileCount,
		byteSize: found.byteSize,
	};
}

/** The project's name as a folder, falling back to its id when nothing survives. */
function folderNameFor(project: Project): string {
	const cleaned = project.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return cleaned || project.id;
}

/**
 * Moves a project's files, or points it somewhere else and leaves them.
 *
 * The files move first and the row is written second. The other order leaves a
 * project whose row says one folder and whose files are in another, and nothing
 * would ever tell you which of the two was right.
 */
export async function setStorage(
	id: string,
	choice: ProjectStorageChoice,
	db: Db = getDb(),
): Promise<Project> {
	const project = requireProject(id, db);
	const from = folderFor(project);

	let to: string;
	if (choice.mode === "custom") {
		if (!choice.path) throw new Error("Pick a folder to keep this project's files in.");
		// One folder per project inside the one the person chose, so pointing two
		// projects at the same drive does not mix their files together.
		to = resolveInside(checkChosenFolder(choice.path), folderNameFor(project));
	} else {
		to = defaultFolderFor(project.id);
	}

	if (choice.move === false) ensureFolder(to);
	else moveFolder(from, to);

	const row = db
		.update(projects)
		.set({
			storageMode: choice.mode,
			storagePath: choice.mode === "custom" ? to : null,
			updatedAt: now(),
		})
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.returning()
		.get();
	return row as Project;
}

/** Null clears the choice, which falls the card back to the first image. */
export async function setCover(
	id: string,
	assetId: string | null,
	db: Db = getDb(),
): Promise<Project> {
	requireProject(id, db);

	if (assetId) {
		const asset = db
			.select({ id: projectAssets.id, projectId: projectAssets.projectId })
			.from(projectAssets)
			.where(and(eq(projectAssets.id, assetId), isNull(projectAssets.deletedAt)))
			.get();
		if (!asset) throw new Error("That file is no longer there, so it cannot be the cover.");
		if (asset.projectId !== id) throw new Error("That file belongs to another project.");
	}

	const row = db
		.update(projects)
		.set({ coverAssetId: assetId, updatedAt: now() })
		.where(and(eq(projects.id, id), isNull(projects.deletedAt)))
		.returning()
		.get();
	return row as Project;
}
