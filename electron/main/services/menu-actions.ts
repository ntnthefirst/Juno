/**
 * The menu items the main process performs itself.
 *
 * Everything here is a call to a service the buttons already call, or a small
 * act on the machine (the clipboard, the file manager). An item that needs a
 * form, a confirmation or a screen to move is not here: it is handed back to
 * the window as a named action, because only the window can do it.
 *
 * Nothing here deletes, sends, signs or files. Those stay behind their
 * service and, for an agent, behind the gate (.claude/rules/mcp.md).
 */
import { clipboard } from "electron";
import type { MenuMainAction, MenuOutcome, MenuRequest } from "../../shared/menu";
import { getDb, type Db } from "../db";
import * as calendar from "./calendar";
import * as clients from "./clients";
import * as documentActions from "./document-actions";
import { todayIsoDate } from "./document-context";
import * as projectActions from "./project-actions";
import * as notes from "./notes";
import * as projects from "./projects";
import { addDays } from "./recurrence";
import * as reference from "./reference";
import * as reminders from "./reminders";

export async function perform(request: MenuRequest, action: MenuMainAction, db: Db = getDb()): Promise<MenuOutcome> {
	try {
		switch (action) {
			case "snooze-tomorrow":
				await reminders.snooze(request.id, addDays(todayIsoDate(), 1), db);
				return { type: "done" };

			case "pin-note":
			case "unpin-note":
				await notes.update(request.id, { pinned: action === "pin-note" }, db);
				return { type: "done" };

			case "duplicate-note":
				await notes.duplicate(request.id, db);
				return { type: "done", message: "Note duplicated." };

			case "duplicate-event": {
				const event = await calendar.get(request.id, db);
				if (!event) throw new Error("That event no longer exists.");
				await calendar.create(
					{
						title: event.title,
						startLocal: event.startLocal,
						endLocal: event.endLocal,
						allDay: event.allDay,
						timezone: event.timezone,
						rrule: event.rrule,
						notes: event.notes,
						location: event.location,
						clientId: event.clientId,
						projectId: event.projectId,
					},
					db,
				);
				return { type: "done", message: "Event duplicated." };
			}

			case "archive-client": {
				const set = await reference.getSet("client_status");
				const archived = set?.items.find((item) => item.key === "archived");
				if (!archived) throw new Error("There is no Archived status for clients. Add one in Settings > Statuses.");
				await clients.update(request.id, { statusId: archived.id }, db);
				return { type: "done", message: "Client archived." };
			}

			case "download-file":
				await documentActions.downloadLatest(request.id, db);
				return { type: "none" };

			case "open-in-default-app":
				await documentActions.openPdf(request.id, db);
				return { type: "none" };

			case "open-folder": {
				const project = projects.requireProject(request.id, db);
				if (project.localPath) await projectActions.openLocalFolder(request.id, db);
				else await projectActions.openStorageFolder(request.id, db);
				return { type: "none" };
			}

			case "copy-path": {
				const project = projects.requireProject(request.id, db);
				const info = await projects.storage(request.id, db);
				clipboard.writeText(project.localPath ?? info.path);
				return { type: "done", message: "Folder path copied." };
			}
		}
	} catch (cause: unknown) {
		return { type: "failed", message: cause instanceof Error ? cause.message : "That could not be done." };
	}
}
