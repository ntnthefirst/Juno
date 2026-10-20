/**
 * The composer's "From this computer": the operating system's own file picker,
 * in the main process, so the window never holds a path (.claude/rules/security.md
 * section 2). Any kind of file may be sent; whether it can also be kept as a
 * document is decided per file in mail-outbox-files.ts.
 */
import { BrowserWindow, dialog } from "electron";
import type { MailOutboxMessage } from "../../shared/types";
import { getDb, type Db } from "../db";
import * as outbox from "./mail-outbox";
import { addFromPath } from "./mail-outbox-files";

/** Null when the picker is cancelled, which is not an error. */
export async function choose(outboxId: string, db: Db = getDb()): Promise<MailOutboxMessage | null> {
	// Refused before the dialog opens, rather than after somebody picked ten files.
	outbox.requireEditable(outboxId, db);
	const parent = BrowserWindow.getFocusedWindow();
	const options = { title: "Attach files", properties: ["openFile" as const, "multiSelections" as const] };
	const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
	if (result.canceled || result.filePaths.length === 0) return null;
	let message: MailOutboxMessage | null = null;
	for (const path of result.filePaths) message = await addFromPath(outboxId, path, db);
	return message;
}
