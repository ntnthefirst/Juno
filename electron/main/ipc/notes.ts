import { ipcMain } from "electron";
import type { NoteInput, NotePatch, NoteQuery, PageInput, PagePatch } from "../../shared/types";
import * as notes from "../services/notes";
import * as pageActions from "../services/page-actions";
import * as pages from "../services/pages";

export function registerNotesIpc(): void {
	ipcMain.handle("notes.list", (_event, query?: NoteQuery) => notes.list(query));
	ipcMain.handle("notes.get", (_event, id: string) => notes.get(id));
	ipcMain.handle("notes.search", (_event, term: string, query?: NoteQuery) => notes.search(term, query));
	ipcMain.handle("notes.create", (_event, input?: NoteInput) => notes.create(input));
	ipcMain.handle("notes.update", (_event, id: string, patch: NotePatch) => notes.update(id, patch));
	ipcMain.handle("notes.duplicate", (_event, id: string) => notes.duplicate(id));
	ipcMain.handle("notes.remove", (_event, id: string) => notes.remove(id));
	ipcMain.handle("notes.restore", (_event, id: string) => notes.restore(id));

	ipcMain.handle("pages.get", (_event, id: string) => pages.get(id));
	ipcMain.handle("pages.create", (_event, input?: PageInput) => pages.create(input));
	ipcMain.handle("pages.update", (_event, id: string, patch: PagePatch) => pages.update(id, patch));
	ipcMain.handle("pages.chooseImage", (_event, id: string) => pageActions.chooseImage(id));
	ipcMain.handle("pages.openLink", (_event, url: string) => pageActions.openLink(url));
}
