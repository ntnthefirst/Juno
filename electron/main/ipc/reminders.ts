/**
 * Reminder channels. Thin: the rules live in ../services/reminders.ts and the
 * derived suggestions in ../services/reminders-derive.ts.
 */
import { ipcMain, shell } from "electron";
import type { ReminderInput, ReminderPatch, ReminderSuggestion } from "../../shared/types";
import * as derive from "../services/reminders-derive";
import * as reminders from "../services/reminders";

export function registerRemindersIpc(): void {
	ipcMain.handle("reminders.list", (_event, query?: Parameters<typeof reminders.list>[0]) =>
		reminders.list(query ?? {}),
	);
	ipcMain.handle("reminders.get", (_event, id: string) => reminders.get(id));

	ipcMain.handle("reminders.create", (_event, input: ReminderInput) => reminders.create(input));
	ipcMain.handle("reminders.update", (_event, id: string, patch: ReminderPatch) =>
		reminders.update(id, patch),
	);

	ipcMain.handle("reminders.complete", (_event, id: string, note?: string | null) =>
		reminders.complete(id, { note: note ?? null }),
	);
	ipcMain.handle("reminders.snooze", (_event, id: string, until: string) =>
		reminders.snooze(id, until),
	);
	ipcMain.handle("reminders.reopen", (_event, id: string) => reminders.reopen(id));

	ipcMain.handle("reminders.remove", (_event, id: string) => reminders.remove(id));
	ipcMain.handle("reminders.restore", (_event, id: string) => reminders.restore(id));
	ipcMain.handle("reminders.history", (_event, id: string) => reminders.history(id));

	ipcMain.handle("reminders.suggestions", () => derive.suggestions());

	ipcMain.handle("reminders.accept", (_event, suggestion: ReminderSuggestion) =>
		reminders.create({
			title: suggestion.title,
			dueOn: suggestion.dueOn,
			notes: suggestion.notes,
			category: suggestion.category,
			clientId: suggestion.clientId,
			projectId: suggestion.projectId,
			actionUrl: suggestion.actionUrl,
			actionLabel: suggestion.actionLabel,
		}),
	);

	ipcMain.handle("reminders.openAction", async (_event, id: string) => {
		const reminder = await reminders.get(id);
		if (!reminder?.actionUrl) throw new Error("That reminder has no link.");
		// Only http and https. A reminder's link is data, and a file: or a custom
		// scheme handed to the shell is a way to run something.
		if (!/^https?:\/\//i.test(reminder.actionUrl)) {
			throw new Error("That link is not a web address, so Bureau will not open it.");
		}
		await shell.openExternal(reminder.actionUrl);
	});
}
