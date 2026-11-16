/**
 * Dragging a document out of Juno, to the desktop, Explorer or another app,
 * drags its newest version's file. The window names the documents by id and
 * this resolves each to its file, never a path from the window.
 *
 * What is dragged is a copy, under the document's title, in a folder of its
 * own in the system's temporary folder: the name Juno keeps a file under is
 * not one a person wants on their desktop, and an app the file is dropped on
 * may open it where it lies and save into it, which a kept version must never
 * be (decision 75). A hard link would be quicker and would let that happen.
 * The copies of the drag before are removed when a new one starts.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { dragFileNames } from "./drag-name";
import { getDb, type Db } from "../db";
import * as documents from "./documents";

/** More than this at once is not a drag a person means. */
export const MAX_DRAG_FILES = 50;

let dragRoot = join(tmpdir(), "juno-drag");

/** For tests. */
export function configureDragRoot(path: string): void {
	dragRoot = path;
}

function clearEarlierDrags(): void {
	if (!existsSync(dragRoot)) return;
	for (const entry of readdirSync(dragRoot)) {
		try {
			rmSync(join(dragRoot, entry), { recursive: true, force: true });
		} catch {
			// Still open in the app it was dropped on. It goes with the next drag, or with the system's own clean-up.
		}
	}
}

/** The files to drag for these documents: a copy of each one's newest version, named by its title. Documents with no file are left out. */
export async function dragFiles(ids: readonly string[], db: Db = getDb()): Promise<string[]> {
	const wanted = ids.slice(0, MAX_DRAG_FILES);
	const records = [];
	for (const id of wanted) {
		const record = await documents.get(id, db);
		if (record?.latestVersion && record.pdfPath && existsSync(record.pdfPath)) records.push(record);
	}
	if (records.length === 0) return [];
	clearEarlierDrags();
	mkdirSync(dragRoot, { recursive: true });
	const folder = mkdtempSync(join(dragRoot, "drag-"));
	const names = dragFileNames(
		records.map((record) => ({ title: record.title, storedName: record.latestVersion!.fileName ?? basename(record.pdfPath!) })),
	);
	return records.map((record, at) => {
		const target = join(folder, names[at]!);
		copyFileSync(record.pdfPath!, target);
		return target;
	});
}
