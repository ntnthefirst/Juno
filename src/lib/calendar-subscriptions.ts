import type { CalendarSubscription } from "@shared/types";

/**
 * Subscribes to the calendar that comes with a mail account, such as Google's
 * secret address in iCal format, as the Add account frame's "Google Calendar"
 * switch does. Read only, fetched every hour, in the accent colour, and listed
 * under the account in Settings > Mail accounts.
 *
 * Juno fetches the address before anything is saved, so this rejects with a
 * sentence to show under the field when the address is wrong, and saves
 * nothing then. The account must already exist.
 */
export function subscribeAccountCalendar(
	address: string,
	name: string,
	mailAccountId: string,
): Promise<CalendarSubscription> {
	return window.juno.calendar.subscriptions.create({
		url: address,
		name,
		mailAccountId,
		refreshMinutes: 60,
		colour: "accent",
	});
}

/** When a subscription was last read, as the settings row says it: a time today, else a day. */
export function updatedLabel(iso: string | null, now: Date = new Date()): string {
	if (!iso) return "not fetched yet";
	const at = new Date(iso);
	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
	if (sameDay(at, now)) {
		return `updated ${new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit" }).format(at)}`;
	}
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (sameDay(at, yesterday)) return "updated yesterday";
	return `updated ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(at)}`;
}
