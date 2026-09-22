/**
 * Briefings: one question answered across every domain at once.
 *
 * "What needs attention today", "where does this client stand", "what does
 * this month look like". Each reads the same services the screens read, so a
 * briefing can never disagree with what clicking through shows.
 *
 * It lives here rather than in a screen because it is the answer an agent
 * asks for, and phase 6 exists so the window and the agent get one
 * implementation of it. The headline is written to be read aloud on its own:
 * an agent that pastes it has said something true and complete.
 *
 * Nothing here decides anything. Every item points at a record a person can
 * open, which is the test PLAN.md sets for phase 6: an answer he can verify by
 * clicking through.
 */
import type { Briefing, BriefingItem, BriefingSection } from "../../shared/types";
import { getDb, type Db } from "../db";
import * as actions from "./agent-actions";
import * as calendar from "./calendar";
import { addLocalDays, systemTimeZone } from "./calendar-time";
import * as clients from "./clients";
import { todayIsoDate } from "./document-context";
import * as documents from "./documents";
import * as outbox from "./mail-outbox";
import * as threads from "./mail-threads";
import * as projects from "./projects";
import * as reminders from "./reminders";

/** How far ahead "today" looks for things that are about to land. */
const LOOKAHEAD_DAYS = 7;

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

function section(
	key: string,
	title: string,
	items: BriefingItem[],
	emptyText: string,
): BriefingSection {
	return { key, title, items, emptyText };
}

/**
 * Sentence from the parts that are not empty, so an empty day reads as one.
 *
 * The first part is used as the caller wrote it. Capitalising here would
 * rename a client: a business called "obet" in lower case is called that, and
 * a briefing that opens with "Obet" has corrected its owner's spelling.
 */
function headlineOf(parts: string[], nothing: string): string {
	const real = parts.filter(Boolean);
	if (real.length === 0) return nothing;
	if (real.length === 1) return `${real[0]!}.`;
	return `${real.slice(0, -1).join(", ")} and ${real[real.length - 1]}.`;
}

/**
 * What wants attention today, and what lands in the next week.
 *
 * Reminders come from their own bucketing, so "overdue" means here exactly
 * what it means on the Reminders screen.
 */
export async function today(
	db: Db = getDb(),
	date: string = todayIsoDate(),
	timezone: string = systemTimeZone(),
): Promise<Briefing> {
	const to = addLocalDays(date, LOOKAHEAD_DAYS);

	const actionable = await reminders.list({ actionableOnly: true }, db, date);
	const overdue = actionable.filter((row) => row.bucket === "overdue");
	const dueToday = actionable.filter((row) => row.bucket === "today");
	const soon = actionable.filter((row) => row.bucket === "soon");

	const items = await calendar.listRange(
		{ from: date, to, timezone, includeDeadlines: true },
		db,
		date,
	);
	const todaysEvents = items.filter(
		(item) => item.kind === "event" && item.startLocal.slice(0, 10) <= date && item.endLocal.slice(0, 10) >= date,
	);
	const upcomingEvents = items.filter(
		(item) => item.kind === "event" && item.startLocal.slice(0, 10) > date,
	);
	const deadlines = items.filter((item) => item.kind === "deadline");

	const unsent = await outbox.list({ states: ["pending", "failed"] }, db);
	const waiting = await actions.list({ states: ["pending"] }, db);
	const specimens = (await documents.list({}, db)).filter((row) => row.isSpecimen);

	const sections: BriefingSection[] = [
		section(
			"reminders",
			"Needs doing",
			[
				...overdue.map((row) => toReminderItem(row, true)),
				...dueToday.map((row) => toReminderItem(row, true)),
				...soon.map((row) => toReminderItem(row, false)),
			],
			"Nothing is due.",
		),
		section(
			"today",
			"On today",
			todaysEvents.map(toEventItem),
			"Nothing scheduled.",
		),
		section(
			"upcoming",
			`Next ${LOOKAHEAD_DAYS} days`,
			[...upcomingEvents.map(toEventItem), ...deadlines.map(toDeadlineItem)],
			"Nothing scheduled.",
		),
		section(
			"waiting",
			"Waiting on you",
			[
				...waiting.map((action) => ({
					kind: "action" as const,
					id: action.id,
					title: action.summary,
					detail: "An agent asked for this. Approve or reject it under Agent.",
					on: null,
					urgent: true,
				})),
				...unsent.map((message) => ({
					kind: "outbox" as const,
					id: message.id,
					title: message.subject || "(no subject)",
					detail:
						message.state === "failed"
							? `Sending failed. ${message.lastError ?? ""}`.trim()
							: "Waiting for you to approve it in the outbox.",
					on: null,
					urgent: message.state === "failed",
				})),
				...specimens.map((document) => ({
					kind: "document" as const,
					id: document.id,
					title: document.title,
					detail: "Generated from a template nobody has reviewed. Do not send it to a client.",
					on: document.issuedOn,
					urgent: false,
				})),
			],
			"Nothing is waiting.",
		),
	];

	const headline = headlineOf(
		[
			overdue.length > 0 ? `${plural(overdue.length, "reminder is", "reminders are")} overdue` : "",
			dueToday.length > 0 ? `${plural(dueToday.length, "reminder", "reminders")} due today` : "",
			todaysEvents.length > 0 ? `${plural(todaysEvents.length, "event", "events")} on the calendar` : "",
			waiting.length > 0 ? `${plural(waiting.length, "request", "requests")} waiting for you` : "",
			unsent.length > 0 ? `${plural(unsent.length, "message", "messages")} unsent` : "",
		],
		"Nothing is overdue, due today or waiting on you.",
	);

	return { title: `Today, ${date}`, from: date, to, headline, sections };
}

function toReminderItem(row: Awaited<ReturnType<typeof reminders.list>>[number], urgent: boolean): BriefingItem {
	return {
		kind: "reminder",
		id: row.id,
		title: row.title,
		detail: [row.clientName, row.bucket === "overdue" ? "overdue" : null].filter(Boolean).join(", ") || null,
		on: row.dueOn,
		urgent,
	};
}

type Item = Awaited<ReturnType<typeof calendar.listRange>>[number];

function toEventItem(item: Item): BriefingItem {
	if (item.kind !== "event") throw new Error("Not an event.");
	return {
		kind: "event",
		id: item.eventId,
		title: item.title,
		detail: [item.clientName, item.allDay ? "all day" : item.startLocal.slice(11, 16)]
			.filter(Boolean)
			.join(", ") || null,
		on: item.startLocal.slice(0, 10),
		urgent: false,
	};
}

function toDeadlineItem(item: Item): BriefingItem {
	if (item.kind !== "deadline") throw new Error("Not a deadline.");
	return {
		kind: "deadline",
		id: item.projectId,
		title: `${item.projectName} is due`,
		detail: item.clientName,
		on: item.dueOn,
		urgent: false,
	};
}

/**
 * Where one client stands: their projects, what is owed, what was sent, and
 * when they were last in touch.
 */
export async function client(
	clientId: string,
	db: Db = getDb(),
	date: string = todayIsoDate(),
): Promise<Briefing> {
	const record = await clients.get(clientId, db);
	if (!record) throw new Error(`No client with id "${clientId}".`);

	const clientProjects = await projects.list({ clientId }, db);
	const open = clientProjects.filter((project) => !project.status || project.status.key !== "delivered");
	const clientDocuments = await documents.list({ clientId }, db);
	const clientReminders = (await reminders.list({ clientId }, db, date)).filter(
		(row) => row.bucket !== "done",
	);
	const threadCount = await threads.countForClient(clientId, db);
	const sent = await outbox.list({ states: ["sent"] }, db);
	const sentToClient = sent.filter((message) => message.clientId === clientId);

	const sections: BriefingSection[] = [
		section(
			"projects",
			"Projects",
			clientProjects.map((project) => ({
				kind: "deadline" as const,
				id: project.id,
				title: project.name,
				detail: [project.status?.label, project.dueOn ? `due ${project.dueOn}` : null]
					.filter(Boolean)
					.join(", ") || null,
				on: project.dueOn,
				urgent: Boolean(project.dueOn && project.dueOn < date),
			})),
			"No projects yet.",
		),
		section(
			"reminders",
			"Open reminders",
			clientReminders.map((row) => toReminderItem(row, row.bucket === "overdue")),
			"Nothing open.",
		),
		section(
			"documents",
			"Documents",
			clientDocuments.map((document) => ({
				kind: "document" as const,
				id: document.id,
				title: document.title,
				detail: document.isSpecimen ? "specimen, not reviewed" : document.issuedOn,
				on: document.issuedOn,
				urgent: false,
			})),
			"No documents yet.",
		),
		section(
			"mail",
			"Mail",
			sentToClient.slice(0, 10).map((message) => ({
				kind: "outbox" as const,
				id: message.id,
				title: message.subject || "(no subject)",
				detail: message.sentAt ? `sent ${message.sentAt.slice(0, 10)}` : null,
				on: message.sentAt ? message.sentAt.slice(0, 10) : null,
				urgent: false,
			})),
			threadCount > 0 ? `${plural(threadCount, "thread", "threads")} linked, nothing sent from Bureau.` : "No mail linked yet.",
		),
	];

	const headline = headlineOf(
		[
			`${record.name} has ${plural(open.length, "open project", "open projects")}`,
			clientReminders.length > 0 ? `${plural(clientReminders.length, "open reminder", "open reminders")}` : "",
			threadCount > 0 ? `${plural(threadCount, "mail thread", "mail threads")}` : "",
		],
		`${record.name} has nothing open.`,
	);

	return { title: record.name, from: date, to: date, headline, sections };
}

/**
 * A month: everything with a date in it, from every domain that has dates.
 *
 * `month` is `YYYY-MM`.
 */
export async function month(
	monthKey: string,
	db: Db = getDb(),
	date: string = todayIsoDate(),
	timezone: string = systemTimeZone(),
): Promise<Briefing> {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
		throw new Error(`"${monthKey}" is not a month. Use YYYY-MM, like 2026-03.`);
	}
	const from = `${monthKey}-01`;
	const [year, monthNumber] = monthKey.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
	const to = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

	const items = await calendar.listRange(
		{ from, to, timezone, includeReminders: true, includeDeadlines: true },
		db,
		date,
	);
	const events = items.filter((item) => item.kind === "event");
	const dueReminders = items.filter((item) => item.kind === "reminder");
	const deadlines = items.filter((item) => item.kind === "deadline");

	const sections: BriefingSection[] = [
		section(
			"paperwork",
			"Paperwork due",
			dueReminders.map((item) =>
				item.kind === "reminder"
					? {
							kind: "reminder" as const,
							id: item.reminderId,
							title: item.title,
							detail: [item.clientName, item.category].filter(Boolean).join(", ") || null,
							on: item.dueOn,
							urgent: item.bucket === "overdue",
						}
					: ({} as BriefingItem),
			),
			"No paperwork due this month.",
		),
		section("deadlines", "Project deadlines", deadlines.map(toDeadlineItem), "No deadlines this month."),
		section("events", "On the calendar", events.map(toEventItem), "Nothing scheduled."),
	];

	const headline = headlineOf(
		[
			dueReminders.length > 0 ? `${plural(dueReminders.length, "piece", "pieces")} of paperwork due` : "",
			deadlines.length > 0 ? `${plural(deadlines.length, "project deadline", "project deadlines")}` : "",
			events.length > 0 ? `${plural(events.length, "event", "events")}` : "",
		],
		"Nothing is due, scheduled or deadlined this month.",
	);

	return { title: monthKey, from, to, headline, sections };
}
