/**
 * Where new documents are written.
 *
 * Generated PDFs, imported files and new versions go into one folder. It is the
 * "documents" folder inside the application's data folder unless the owner
 * chose another, for instance one a backup tool already watches.
 *
 * Changing it moves nothing. Every file a document has been is stored with its
 * absolute path, so what is already filed keeps resolving and only what is
 * written afterwards lands in the new place. Page pictures are the one thing
 * stored relative to a folder, so they stay under the default one
 * (page-images.ts) and never go missing when this changes.
 *
 * This module never imports `electron`, so it stays testable in plain Node: the
 * folder dialog lives in documents-folder-picker.ts, and the two folders a
 * running app has to be told about are handed in by main.ts.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { DocumentsFolder } from "../../shared/types";
import * as settings from "./settings";

type Hooks = {
	/** The folder inside the data folder, used when nothing was chosen. */
	defaultDirectory: string;
	/** Points the services that write documents at a folder. */
	apply: (directory: string) => void;
};

let hooks: Hooks | null = null;

export function configureDocumentsFolder(next: Hooks | null): void {
	hooks = next;
}

function configured(): Hooks {
	if (!hooks) throw new Error("configureDocumentsFolder() was not called before the documents folder was used.");
	return hooks;
}

/** Throws a sentence a person can act on when a document could not be written there. */
function assertWritable(directory: string): void {
	try {
		mkdirSync(directory, { recursive: true });
		if (!statSync(directory).isDirectory()) throw new Error("not a folder");
		const probe = join(directory, `.juno-write-test-${process.pid}`);
		writeFileSync(probe, "");
		rmSync(probe, { force: true });
	} catch {
		throw new Error(`Juno cannot write to ${directory}. Choose a folder you can save files in.`);
	}
}

export async function current(): Promise<DocumentsFolder> {
	const { defaultDirectory } = configured();
	const chosen = await settings.getDocumentsFolder();
	return chosen ? { path: chosen, isDefault: false } : { path: defaultDirectory, isDefault: true };
}

/** Called at startup and after every change. A chosen folder that is unusable falls back to the default. */
export async function apply(): Promise<DocumentsFolder> {
	const { apply: point } = configured();
	const folder = await current();
	if (!folder.isDefault) {
		try {
			assertWritable(folder.path);
		} catch {
			const fallback = await reset();
			return fallback;
		}
	}
	if (!existsSync(folder.path)) mkdirSync(folder.path, { recursive: true });
	point(folder.path);
	return folder;
}

export async function set(path: string): Promise<DocumentsFolder> {
	if (!isAbsolute(path)) throw new Error("Choose a folder from the list, not a relative path.");
	const directory = resolve(path);
	assertWritable(directory);
	const { defaultDirectory } = configured();
	await settings.setDocumentsFolder(directory === resolve(defaultDirectory) ? null : directory);
	return apply();
}

export async function reset(): Promise<DocumentsFolder> {
	await settings.setDocumentsFolder(null);
	const { defaultDirectory, apply: point } = configured();
	if (!existsSync(defaultDirectory)) mkdirSync(defaultDirectory, { recursive: true });
	point(defaultDirectory);
	return { path: defaultDirectory, isDefault: true };
}
