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
 * Dev uses a separate file so development cannot damage real business records.
 * Note that `userData` also differs between a dev run and a packaged run unless
 * the product name matches, which is the usual cause of an app that appears to
 * have "lost" its data.
 */
export function databasePath(): string {
	return join(userDataDir(), process.env.BUREAU_DEV ? "bureau.dev.sqlite" : "bureau.sqlite");
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

export function settingsPath(): string {
	return join(userDataDir(), "settings.json");
}
