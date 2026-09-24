/**
 * Where a project's own files are kept, and the one move that changes it.
 *
 * Two folders matter per project and they are not the same thing:
 *
 * - **The local path** is the checkout: the repository the commands run in.
 *   Juno reads it and never writes to it, because it is the user's working
 *   copy and a back office has no business editing source.
 * - **The storage folder** is the one Juno owns. Managed assets are copied into
 *   it, and it is the folder the three-dot menu offers to move. By default it
 *   sits under userData, which is what gets backed up with the database; a
 *   project carrying four gigabytes of video wants it somewhere with room, and
 *   that is the whole reason `storageMode` exists.
 *
 * Nothing in here takes a path from the renderer or from an agent and joins it
 * onto a root. A caller names a project; this module resolves the folder. The
 * one path that does arrive from outside is the folder a person chose in a
 * native picker, and it is stored whole rather than joined onto anything.
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

let root: string | null = null;

/**
 * Point the default storage at a directory. main.ts calls this with
 * `userData/projects`; a test calls it with a temp folder. Same reasoning as
 * configureDocumentStorage: this module never imports `electron`, so the
 * services that use it stay testable in plain Node.
 */
export function configureProjectStorage(directory: string): void {
	root = directory;
}

export function projectsRoot(): string {
	if (!root) {
		throw new Error("configureProjectStorage() was not called before a project folder was used.");
	}
	return root;
}

/** Where the app would keep this project's files if nobody moved them. */
export function defaultFolderFor(projectId: string): string {
	return join(projectsRoot(), projectId);
}

/**
 * The folder in use. A custom path is taken as it stands, because a person
 * picked it; anything else falls back to the app's own folder rather than
 * throwing, so a project whose external drive is unplugged still opens.
 */
export function folderFor(project: { id: string; storageMode: string; storagePath: string | null }): string {
	if (project.storageMode === "custom" && project.storagePath) return project.storagePath;
	return defaultFolderFor(project.id);
}

export function ensureFolder(path: string): string {
	mkdirSync(path, { recursive: true });
	return path;
}

/**
 * Resolves a managed asset's relative path inside its project folder, and
 * refuses anything that climbs out of it.
 *
 * The relative path comes from the database, so this is a check on Juno's own
 * past writes rather than on user input. It is here anyway: a row written by a
 * future bug, or by hand, must not turn into a read of an arbitrary file.
 */
export function resolveInside(folder: string, relativePath: string): string {
	const base = resolve(folder);
	const target = normalize(resolve(base, relativePath));
	if (target !== base && !target.startsWith(base + sep)) {
		throw new Error("That file is outside the project's folder.");
	}
	return target;
}

/**
 * A file name with no path in it and no character a filesystem refuses.
 *
 * Both separators are split on, not just the platform's: a name can arrive from
 * a file recorded on the other kind of machine, and splitting on one of them
 * leaves the other half of the path inside the name.
 *
 * The control characters are stripped deliberately, which is the thing the lint
 * rule about them wants stated: a name from a picker is the operating system's,
 * but a name from a future caller need not be, and a newline inside one is how
 * a log line stops meaning what it says.
 */
const FORBIDDEN = new Set(['<', '>', ':', '"', "|", "?", "*"]);

function keepable(character: string): boolean {
	// Below 0x20 is a control character. Written as a comparison rather than as a
	// regular expression range, because a range that holds literal control
	// characters is unreadable in a diff and the lint rule is right to say so.
	return character.charCodeAt(0) >= 0x20 && !FORBIDDEN.has(character);
}

export function safeFileName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? "file";
	const cleaned = [...base].filter(keepable).join("").replace(/^\.+/, "").trim();
	return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

/** `report.pdf`, `report-2.pdf`, `report-3.pdf`. Never overwrites. */
export function uniqueNameIn(folder: string, name: string): string {
	const safe = safeFileName(name);
	if (!existsSync(join(folder, safe))) return safe;

	const dot = safe.lastIndexOf(".");
	const stem = dot > 0 ? safe.slice(0, dot) : safe;
	const extension = dot > 0 ? safe.slice(dot) : "";
	for (let n = 2; n < 1000; n += 1) {
		const candidate = `${stem}-${n}${extension}`;
		if (!existsSync(join(folder, candidate))) return candidate;
	}
	throw new Error(`There are already a thousand files called ${stem} in that folder.`);
}

export interface FolderUsage {
	exists: boolean;
	fileCount: number;
	byteSize: number;
}

/** What the three-dot menu reports. Walks the folder, which stays small. */
export function usage(folder: string): FolderUsage {
	if (!existsSync(folder)) return { exists: false, fileCount: 0, byteSize: 0 };

	let fileCount = 0;
	let byteSize = 0;
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) {
				fileCount += 1;
				byteSize += statSync(path).size;
			}
		}
	};
	walk(folder);
	return { exists: true, fileCount, byteSize };
}

/**
 * Moves every managed file from one folder to the other.
 *
 * Copy, verify, then delete. A rename is tried first because moving inside one
 * drive should not rewrite four gigabytes, and it is expected to fail across
 * drives, which is the case this exists for. Nothing is deleted from the source
 * until the destination has the file, so a disk that fills up halfway leaves
 * both copies rather than neither.
 */
export function moveFolder(from: string, to: string): { moved: number } {
	if (resolve(from) === resolve(to)) return { moved: 0 };
	if (!existsSync(from)) {
		ensureFolder(to);
		return { moved: 0 };
	}

	const destination = resolve(to);
	const source = resolve(from);
	if (destination.startsWith(source + sep)) {
		throw new Error("That folder is inside the one being moved. Pick a folder outside it.");
	}

	ensureFolder(destination);
	let moved = 0;

	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			const target = join(destination, relative(source, path));
			if (entry.isDirectory()) {
				ensureFolder(target);
				walk(path);
				continue;
			}
			if (!entry.isFile()) continue;

			mkdirSync(join(target, ".."), { recursive: true });
			try {
				renameSync(path, target);
			} catch {
				// Across drives rename fails, which is the whole point of the move.
				copyFileSync(path, target);
				if (statSync(target).size !== statSync(path).size) {
					throw new Error(`${entry.name} did not copy completely. Nothing was deleted.`);
				}
				unlinkSync(path);
			}
			moved += 1;
		}
	};

	walk(source);

	// The emptied tree, not the files: a failed copy above threw before here.
	rmSync(source, { recursive: true, force: true });
	return { moved };
}

/** A folder a person picked, checked before it is written to a project row. */
export function checkChosenFolder(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) throw new Error("Pick a folder.");
	if (!isAbsolute(trimmed)) throw new Error("Give the full path to the folder, not a relative one.");
	return resolve(trimmed);
}
