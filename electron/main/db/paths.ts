/**
 * Where files live on disk. Separated from db/index.ts on purpose: this is the
 * only database module that imports `electron`, so services and their tests can
 * build a database without pulling Electron into a plain Node process.
 */
import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function userDataDir(): string {
	const dir = app.getPath("userData");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * One filename, because a development run already has a whole userData
 * directory of its own: main.ts points `userData` at `dev-data.ts` before
 * anything reads a path. A second dev-only filename on top of that would mean
 * two ways to be in development and only one of them being right.
 *
 * Note that `userData` also differs between a dev run and a packaged run unless
 * the product name matches, which is the usual cause of an app that appears to
 * have "lost" its data.
 */
export function databasePath(): string {
	return join(userDataDir(), "juno.sqlite");
}

export function backupsDir(): string {
	const dir = join(userDataDir(), "backups");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export function documentsDir(): string {
	const dir = join(userDataDir(), "documents");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

/** Attachments, one folder per account and message. Never in the database. */
export function mailDir(): string {
	const dir = join(userDataDir(), "mail");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export function settingsPath(): string {
	return join(userDataDir(), "settings.json");
}
