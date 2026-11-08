/**
 * Calendar subscription channels. Thin: the rules, the fetching and the
 * address guard live in ../services/calendar-subscriptions.ts.
 *
 * `preview`, `create` and `update` carry an address for the main process to
 * fetch. That is the second exception in security.md section 2, after a
 * template's picture: the person typed or pasted it on the Add calendar page,
 * and the service fetches it only under the public-address guard.
 */
import { ipcMain } from "electron";
import type { CalendarSubscriptionInput, CalendarSubscriptionPatch } from "../../shared/types";
import * as subscriptions from "../services/calendar-subscriptions";

export function registerCalendarSubscriptionsIpc(): void {
	ipcMain.handle("calendar.subscriptions.list", () => subscriptions.list());
	ipcMain.handle("calendar.subscriptions.get", (_event, id: string) => subscriptions.get(id));
	ipcMain.handle("calendar.subscriptions.preview", (_event, url: string) => subscriptions.preview(url));
	ipcMain.handle("calendar.subscriptions.create", (_event, input: CalendarSubscriptionInput) => subscriptions.create(input));
	ipcMain.handle("calendar.subscriptions.update", (_event, id: string, patch: CalendarSubscriptionPatch) =>
		subscriptions.update(id, patch),
	);
	ipcMain.handle("calendar.subscriptions.refresh", (_event, id: string) => subscriptions.refresh(id));
	ipcMain.handle("calendar.subscriptions.remove", (_event, id: string) => subscriptions.remove(id));
}
