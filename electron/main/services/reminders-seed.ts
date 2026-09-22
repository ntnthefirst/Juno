/**
 * The recurring paperwork Juno starts you off with.
 *
 * **These dates are starting points, not advice.** Belgian filing and payment
 * deadlines shift, depend on the regime you are in, and are the accountant's to
 * confirm. Every seeded reminder therefore carries a note saying so, leans early
 * through its lead days, and is editable like any other.
 *
 * Getting a reminder a week too early costs nothing. Getting one a week late
 * costs money, so where there was doubt the date here is the earlier one.
 */
import type { ReminderCategory } from "./reminders";
import type { RecurrencePattern } from "./recurrence";

export const REMINDER_SEED_VERSION = 1;

export interface SeedReminder {
	seedKey: string;
	title: string;
	notes: string;
	category: ReminderCategory;
	pattern: RecurrencePattern;
	interval: number;
	anchorDay?: number;
	leadDays: number;
	/** Month and day the first occurrence falls on, in the seeding year. */
	firstMonth: number;
	firstDay: number;
}

const CONFIRM =
	"Juno does not know your exact deadline. Check this date with your accountant once, " +
	"then correct it here and it will be right every time after.";

export const SEED_REMINDERS: SeedReminder[] = [
	{
		seedKey: "vat_return",
		title: "VAT return (btw-aangifte)",
		notes: `File the quarterly VAT return. ${CONFIRM}`,
		category: "paperwork",
		pattern: "months",
		interval: 3,
		anchorDay: 20,
		leadDays: 7,
		firstMonth: 1,
		firstDay: 20,
	},
	{
		seedKey: "social_contributions",
		title: "Social contributions (sociale bijdragen)",
		notes: `Quarterly contribution to the social insurance fund. ${CONFIRM}`,
		category: "payment",
		pattern: "quarter_end",
		interval: 1,
		leadDays: 14,
		firstMonth: 3,
		firstDay: 31,
	},
	{
		seedKey: "client_listing",
		title: "Annual client listing (klantenlisting)",
		notes: `The yearly listing of VAT-registered clients. ${CONFIRM}`,
		category: "paperwork",
		pattern: "years",
		interval: 1,
		anchorDay: 31,
		leadDays: 21,
		firstMonth: 3,
		firstDay: 31,
	},
	{
		seedKey: "insurance_review",
		title: "Check insurance and subscriptions",
		notes:
			"Once a year, read what renews automatically and decide whether it should. " +
			"Nothing files this one; it is a prompt to look.",
		category: "renewal",
		pattern: "years",
		interval: 1,
		anchorDay: 15,
		leadDays: 14,
		firstMonth: 9,
		firstDay: 15,
	},
	{
		seedKey: "backup_check",
		title: "Check that a recent backup exists",
		notes:
			"Juno keeps its data in one file on this machine. Open Settings, make a backup, " +
			"and put a copy somewhere that is not this computer.",
		category: "other",
		pattern: "months",
		interval: 1,
		anchorDay: 1,
		leadDays: 0,
		firstMonth: 1,
		firstDay: 1,
	},
];
