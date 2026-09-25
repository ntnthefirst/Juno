/**
 * The project operations that need Electron: the pickers, and opening things.
 *
 * Kept apart from the record logic in projects.ts, project-links.ts and
 * project-assets.ts so those stay testable in plain Node. This module is the
 * seam where a project meets the operating system.
 *
 * Every path it hands to the shell was resolved from an id by a service. The
 * renderer names a link, a file or a project; it never names a path, which is
 * what keeps this from being the arbitrary opener that
 * .claude/rules/security.md section 2 forbids.
 */
import { dialog, shell } from "electron";
import { existsSync } from "node:fs";
import type { ProjectAsset, ProjectStorageInfo } from "../../shared/types";
import { getDb, type Db } from "../db";
import * as assets from "./project-assets";
import { classifyTarget } from "./project-links";
import * as links from "./project-links";
import { ensureFolder, folderFor } from "./project-storage";
import * as projects from "./projects";

/** Adds one or more files to a project. Cancelling picks nothing and is not an error. */
export async function chooseAssets(
	projectId: string,
	storage: "managed" | "linked",
	db: Db = getDb(),
): Promise<ProjectAsset[]> {
	projects.requireProject(projectId, db);

	const result = await dialog.showOpenDialog({
		title: storage === "linked" ? "Link to files" : "Add files to this project",
		properties: ["openFile", "multiSelections"],
	});
	if (result.canceled || result.filePaths.length === 0) return [];

	const added: ProjectAsset[] = [];
	for (const sourcePath of result.filePaths) {
		added.push(await assets.add({ projectId, sourcePath, storage }, db));
	}
	return added;
}

/** Picks the checkout on disk. Returns null when the picker was cancelled. */
export async function chooseLocalFolder(): Promise<string | null> {
	const result = await dialog.showOpenDialog({
		title: "Where is this project on your machine?",
		properties: ["openDirectory"],
	});
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0] ?? null;
}

/**
 * Picks where a project keeps the files Juno owns, and moves what is already
 * there. The picker and the move are one call because a person who chose a
 * folder has finished deciding, and a second confirmation for the move would
 * be asking the same question twice.
 */
export async function chooseStorageFolder(
	projectId: string,
	move: boolean,
	db: Db = getDb(),
): Promise<ProjectStorageInfo | null> {
	projects.requireProject(projectId, db);

	const result = await dialog.showOpenDialog({
		title: "Keep this project's files in",
		properties: ["openDirectory", "createDirectory"],
	});
	if (result.canceled || result.filePaths.length === 0) return null;

	await projects.setStorage(projectId, { mode: "custom", path: result.filePaths[0], move }, db);
	return projects.storage(projectId, db);
}

/** Back to the app's own folder, carrying the files with it. */
export async function useAppStorage(
	projectId: string,
	move: boolean,
	db: Db = getDb(),
): Promise<ProjectStorageInfo> {
	await projects.setStorage(projectId, { mode: "app", move }, db);
	return projects.storage(projectId, db);
}

export async function openStorageFolder(projectId: string, db: Db = getDb()): Promise<void> {
	const project = projects.requireProject(projectId, db);
	const folder = ensureFolder(folderFor(project));
	const error = await shell.openPath(folder);
	if (error) throw new Error(error);
}

export async function openLocalFolder(projectId: string, db: Db = getDb()): Promise<void> {
	const project = projects.requireProject(projectId, db);
	if (!project.localPath) {
		throw new Error("This project has no folder on this machine yet. Set one first.");
	}
	if (!existsSync(project.localPath)) {
		throw new Error(`There is no folder at ${project.localPath} any more.`);
	}
	const error = await shell.openPath(project.localPath);
	if (error) throw new Error(error);
}

/**
 * Opens a link the way its target asks to be opened. The protocol check is in
 * project-links.ts and runs again here rather than being trusted from the row:
 * a target written before a rule tightened must not slip through on a read.
 */
export async function openLink(id: string, db: Db = getDb()): Promise<void> {
	const link = await links.get(id, db);
	if (!link) throw new Error("That link is no longer in this project.");

	const target = classifyTarget(link.target);
	if (target.type === "url") {
		await shell.openExternal(target.url);
		return;
	}
	if (!existsSync(target.path)) {
		throw new Error(`There is nothing at ${target.path} any more. It may have been moved.`);
	}
	const error = await shell.openPath(target.path);
	if (error) throw new Error(error);
}

export async function openAsset(id: string, db: Db = getDb()): Promise<void> {
	const error = await shell.openPath(assets.pathOf(id, db).path);
	if (error) throw new Error(error);
}

export async function revealAsset(id: string, db: Db = getDb()): Promise<void> {
	shell.showItemInFolder(assets.pathOf(id, db).path);
}
