/**
 * What Juno offers under a message it has read.
 *
 * A suggestion is worked out when the message is opened and never stored:
 * only the answer to it is (`mail_suggestion_states`), so a message that is
 * synced again offers what it says now. Nothing is filed or created until a
 * button is pressed, and Not now hides that suggestion for that message for
 * good. Detection runs here, in the main process, on text that is already
 * local.
 *
 * The kinds are `event` (a day and a time in the words, offered as a calendar
 * event), `project` (the open project of the conversation's client, or a project named in the words, offered as a link of the
 * whole conversation to that project, through the same service the reader's
 * Link to project button uses) and `reminder` (something asked for by a day, or
 * a promise to come back, offered as a reminder through the reminders service).
 */
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { isOpenProjectStatus } from "../../shared/project-status";
import type { MessageSuggestion, SuggestionKind, SuggestionOutcome, SuggestionSources } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now as stamp } from "../db/columns";
import {
	documents,
	mailAccounts,
	mailMessages,
	mailSuggestionStates,
	mailThreads,
	notes,
	projectStatusChanges,
	projects,
	referenceItems,
	timeEntries,
} from "../db/schema";
import * as calendar from "./calendar";
import { htmlToText } from "./mail-html";
import { clientMatches } from "./mail-recipients";
import * as mailThreadsService from "./mail-threads";
import * as settings from "./settings";
import * as remindersService from "./reminders";
import { detectMoment, detectReminder } from "./suggestions-detect";

const KINDS: SuggestionKind[] = ["event", "project", "reminder"];

function requireKind(kind: string): SuggestionKind {
	if (!KINDS.includes(kind as SuggestionKind)) throw new Error(`"${kind}" is not a kind of suggestion.`);
	return kind as SuggestionKind;
}

/** Which kinds may be offered. The settings screen draws these two switches. */
export async function getSources(): Promise<SuggestionSources> {
	return settings.getSuggestionSources();
}

export async function setSources(patch: Partial<SuggestionSources>): Promise<SuggestionSources> {
	return settings.setSuggestionSources(patch);
}

function answered(db: Db, messageId: string, kind: SuggestionKind) {
	return db
		.select()
		.from(mailSuggestionStates)
		.where(
			and(
				eq(mailSuggestionStates.messageId, messageId),
				eq(mailSuggestionStates.kind, kind),
				isNull(mailSuggestionStates.deletedAt),
			),
		)
		.get();
}

function cleanSubject(subject: string): string {
	return subject.replace(/^(\s*(re|fw|fwd|aw|doorst)\s*:\s*)+/i, "").trim();
}

interface Found {
	suggestion: MessageSuggestion;
	startLocal: string;
	title: string;
	clientId: string | null;
}

function findEvent(db: Db, messageId: string, today: Date): Found | null {
	const row = db
		.select({ message: mailMessages, account: mailAccounts, thread: mailThreads })
		.from(mailMessages)
		.innerJoin(mailAccounts, eq(mailMessages.accountId, mailAccounts.id))
		.innerJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
		.where(and(eq(mailMessages.id, messageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) return null;
	const { message, account, thread } = row;

	// Mail the person wrote themselves is not something to schedule.
	if (message.fromAddress && message.fromAddress.toLowerCase() === account.email.toLowerCase()) return null;

	const text = message.bodyText?.trim() ? message.bodyText : message.bodyHtml ? htmlToText(message.bodyHtml) : "";
	if (!text) return null;

	const written = new Date(message.sentAt ?? message.internalDate);
	const moment = detectMoment(text, Number.isNaN(written.getTime()) ? today : written, today);
	if (!moment) return null;

	const sender = message.fromName?.trim() || message.fromAddress || "Someone";
	const title = cleanSubject(message.subject) || `Appointment with ${sender}`;
	return {
		startLocal: moment.startLocal,
		title,
		clientId: thread.clientId,
		suggestion: {
			kind: "event",
			messageId,
			headline: `${sender} mentions ${moment.dayLabel} at ${moment.time}`,
			question: `Add "${title}" to the calendar?`,
		},
	};
}

interface FoundReminder {
	suggestion: MessageSuggestion;
	title: string;
	dueOn: string;
	notes: string;
	clientId: string | null;
}

function findReminder(db: Db, messageId: string, today: Date): FoundReminder | null {
	const row = db
		.select({ message: mailMessages, account: mailAccounts, thread: mailThreads })
		.from(mailMessages)
		.innerJoin(mailAccounts, eq(mailMessages.accountId, mailAccounts.id))
		.innerJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
		.where(and(eq(mailMessages.id, messageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!row) return null;
	const { message, account, thread } = row;

	// What the owner wrote is the owner's own promise, not a request to chase.
	if (message.fromAddress && message.fromAddress.toLowerCase() === account.email.toLowerCase()) return null;

	const text = message.bodyText?.trim() ? message.bodyText : message.bodyHtml ? htmlToText(message.bodyHtml) : "";
	if (!text) return null;

	const written = new Date(message.sentAt ?? message.internalDate);
	const found = detectReminder(text, Number.isNaN(written.getTime()) ? today : written, today);
	if (!found) return null;

	const sender = message.fromName?.trim() || message.fromAddress || "Someone";
	const subject = cleanSubject(message.subject);
	const deadline = found.kind === "deadline";
	return {
		title: deadline ? subject || `Request from ${sender}` : `Hear back from ${sender}`,
		dueOn: found.dueOn,
		notes: subject ? `From the mail "${subject}" from ${sender}.` : `From a mail from ${sender}.`,
		clientId: thread.clientId,
		suggestion: {
			kind: "reminder",
			messageId,
			headline: deadline
				? `${sender} asks for something by ${found.dayLabel}`
				: `${sender} says they will follow up`,
			question: `Add a reminder for ${found.dayLabel}?`,
		},
	};
}

interface FoundProject {
	suggestion: MessageSuggestion;
	threadId: string;
	projectId: string;
}

/** A project's name has to be a word of its own in the text, not a piece of one. */
function mentions(text: string, name: string): boolean {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(String.raw`(^|[^\p{L}\p{N}])${escaped}($|[^\p{L}\p{N}])`, "iu").test(text);
}

function parseAddresses(json: string): string[] {
	try {
		const list = JSON.parse(json) as { address?: string | null }[];
		return Array.isArray(list) ? list.map((entry) => entry?.address ?? "").filter(Boolean) : [];
	} catch {
		return [];
	}
}

/**
 * The client a conversation is about: the one it is filed under, or else the
 * one client that the sender and recipients belong to once the owner's own
 * address is left out. Two different clients on one thread is no answer.
 */
function clientOf(
	db: Db,
	thread: { clientId: string | null },
	message: typeof mailMessages.$inferSelect,
	own: string,
): string | null {
	if (thread.clientId) return thread.clientId;
	const mine = own.toLowerCase();
	const addresses = [message.fromAddress ?? "", ...parseAddresses(message.toJson), ...parseAddresses(message.ccJson)].filter(
		(address) => address && address.toLowerCase() !== mine,
	);
	const found = new Set<string>();
	for (const matches of clientMatches(db, addresses).values()) for (const match of matches) found.add(match.clientId);
	return found.size === 1 ? [...found][0]! : null;
}

/** The latest sign of life per project. One bounded query per record kind, each indexed by project. */
function lastActivity(db: Db, ids: string[], own: Map<string, string>): Map<string, string> {
	const latest = new Map(own);
	const bump = (id: string | null, at: string | null) => {
		if (!id || !at) return;
		const seen = latest.get(id);
		if (!seen || at > seen) latest.set(id, at);
	};
	for (const row of db
		.select({ id: mailThreads.projectId, at: max(mailThreads.lastMessageAt) })
		.from(mailThreads)
		.where(and(inArray(mailThreads.projectId, ids), isNull(mailThreads.deletedAt)))
		.groupBy(mailThreads.projectId)
		.all())
		bump(row.id, row.at);
	for (const row of db
		.select({ id: timeEntries.projectId, at: max(timeEntries.startedAt) })
		.from(timeEntries)
		.where(and(inArray(timeEntries.projectId, ids), isNull(timeEntries.deletedAt)))
		.groupBy(timeEntries.projectId)
		.all())
		bump(row.id, row.at);
	for (const row of db
		.select({ id: documents.projectId, at: max(documents.updatedAt) })
		.from(documents)
		.where(and(inArray(documents.projectId, ids), isNull(documents.deletedAt)))
		.groupBy(documents.projectId)
		.all())
		bump(row.id, row.at);
	for (const row of db
		.select({ id: notes.projectId, at: max(notes.updatedAt) })
		.from(notes)
		.where(and(inArray(notes.projectId, ids), isNull(notes.deletedAt)))
		.groupBy(notes.projectId)
		.all())
		bump(row.id, row.at);
	for (const row of db
		.select({ id: projectStatusChanges.projectId, at: max(projectStatusChanges.changedAt) })
		.from(projectStatusChanges)
		.where(and(inArray(projectStatusChanges.projectId, ids), isNull(projectStatusChanges.deletedAt)))
		.groupBy(projectStatusChanges.projectId)
		.all())
		bump(row.id, row.at);
	return latest;
}

/**
 * A project to offer for a conversation that is not filed under one yet.
 *
 * When the conversation belongs to a client, the candidates are that client's
 * open projects and nothing else: a single one is offered, and with several
 * the one named in the words wins, then the most recently active, so the owner
 * gets one offer rather than none. A project of another client than the
 * conversation's is never offered, the same rule linking applies.
 *
 * With no open project of a client to go on, a project named in the subject or the
 * words still counts. The longest name wins, and two different projects named
 * at the same length are no suggestion, because a wrong guess costs more than
 * a missing one.
 */
function findProject(db: Db, messageId: string): FoundProject | null {
	const row = db
		.select({ message: mailMessages, thread: mailThreads, account: mailAccounts })
		.from(mailMessages)
		.innerJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
		.innerJoin(mailAccounts, eq(mailMessages.accountId, mailAccounts.id))
		.where(and(eq(mailMessages.id, messageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!row || row.thread.projectId) return null;
	const { message, thread, account } = row;

	const body = message.bodyText?.trim() ? message.bodyText : message.bodyHtml ? htmlToText(message.bodyHtml) : "";
	const text = `${message.subject}
${body}`;

	const clientId = clientOf(db, thread, message, account.email);
	if (clientId) {
		const open = db
			.select({ id: projects.id, name: projects.name, updatedAt: projects.updatedAt, statusKey: referenceItems.key })
			.from(projects)
			.leftJoin(referenceItems, eq(projects.statusId, referenceItems.id))
			.where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt)))
			.limit(200)
			.all()
			.filter((project) => isOpenProjectStatus(project.statusKey));
		if (open.length > 0) {
			let chosen = open[0]!;
			if (open.length > 1) {
				const named = open.filter((project) => project.name.trim().length >= 3 && mentions(text, project.name.trim()));
				const pool = named.length > 0 ? named : open;
				const activity = lastActivity(
					db,
					pool.map((project) => project.id),
					new Map(pool.map((project) => [project.id, project.updatedAt])),
				);
				chosen = [...pool].sort(
					(a, b) => (activity.get(b.id) ?? "").localeCompare(activity.get(a.id) ?? "") || b.id.localeCompare(a.id),
				)[0]!;
			}
			return {
				threadId: thread.id,
				projectId: chosen.id,
				suggestion: {
					kind: "project",
					messageId,
					headline: `You are working on ${chosen.name.trim()} with this client`,
					question: "Link this conversation to the project?",
				},
			};
		}
	}

	if (!text.trim()) return null;
	const matches = db
		.select({ id: projects.id, name: projects.name, clientId: projects.clientId })
		.from(projects)
		.where(isNull(projects.deletedAt))
		.all()
		.filter((project) => project.name.trim().length >= 3)
		.filter((project) => !clientId || !project.clientId || project.clientId === clientId)
		.filter((project) => mentions(text, project.name.trim()));
	if (matches.length === 0) return null;
	const longest = Math.max(...matches.map((project) => project.name.trim().length));
	const best = matches.filter((project) => project.name.trim().length === longest);
	if (best.length !== 1) return null;
	const chosen = best[0]!;
	return {
		threadId: thread.id,
		projectId: chosen.id,
		suggestion: {
			kind: "project",
			messageId,
			headline: `This looks like part of ${chosen.name.trim()}`,
			question: "Link this conversation to the project?",
		},
	};
}

/** What can be offered under this message right now. Writes nothing. */
export async function forMessage(
	messageId: string,
	db: Db = getDb(),
	today: Date = new Date(),
): Promise<MessageSuggestion[]> {
	const sources = await settings.getSuggestionSources();
	const out: MessageSuggestion[] = [];
	if (sources.calendar && !answered(db, messageId, "event")) {
		const found = findEvent(db, messageId, today);
		if (found) out.push(found.suggestion);
	}
	if (sources.projects && !answered(db, messageId, "project")) {
		const found = findProject(db, messageId);
		if (found) out.push(found.suggestion);
	}
	if (sources.reminders && !answered(db, messageId, "reminder")) {
		const found = findReminder(db, messageId, today);
		if (found) out.push(found.suggestion);
	}
	return out;
}

/** Not now: this suggestion is not offered under this message again. */
export async function dismiss(messageId: string, kind: string, db: Db = getDb()): Promise<void> {
	const checked = requireKind(kind);
	const message = db
		.select({ id: mailMessages.id })
		.from(mailMessages)
		.where(and(eq(mailMessages.id, messageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!message) throw new Error("That message does not exist.");
	if (answered(db, messageId, checked)) return;
	const at = stamp();
	db.insert(mailSuggestionStates)
		.values({ messageId, kind: checked, state: "dismissed", createdAt: at, updatedAt: at })
		.run();
}

/**
 * The button that does what was offered. The press is the confirmation, and
 * neither a local calendar entry, a reminder nor a link between a conversation and a
 * project is one of the things that need the gate. The answer is recorded
 * before the work is done, so a second press cannot do it twice, and taken
 * back if the work could not be done.
 */
export async function accept(
	messageId: string,
	kind: string,
	db: Db = getDb(),
	today: Date = new Date(),
): Promise<SuggestionOutcome> {
	const checked = requireKind(kind);
	const sources = await settings.getSuggestionSources();
	if (checked === "event" && !sources.calendar) throw new Error("Calendar suggestions are switched off.");
	if (checked === "project" && !sources.projects) throw new Error("Project suggestions are switched off.");
	if (checked === "reminder" && !sources.reminders) throw new Error("Reminder suggestions are switched off.");
	if (answered(db, messageId, checked)) throw new Error("That suggestion was already answered.");

	const event = checked === "event" ? findEvent(db, messageId, today) : null;
	const project = checked === "project" ? findProject(db, messageId) : null;
	const reminder = checked === "reminder" ? findReminder(db, messageId, today) : null;
	if (!event && !project && !reminder) throw new Error("That suggestion is no longer there. Open the message again.");

	const at = stamp();
	const [state] = db
		.insert(mailSuggestionStates)
		.values({ messageId, kind: checked, state: "accepted", createdAt: at, updatedAt: at })
		.returning()
		.all();
	try {
		if (event) {
			const created = await calendar.create(
				{ title: event.title, startLocal: event.startLocal, clientId: event.clientId },
				db,
			);
			return { kind: "event", event: created };
		}
		if (reminder) {
			const created = await remindersService.create(
				{ title: reminder.title, dueOn: reminder.dueOn, notes: reminder.notes, clientId: reminder.clientId },
				db,
				`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
			);
			return { kind: "reminder", reminder: created };
		}
		const found = project!;
		const thread = await mailThreadsService.linkProject(found.threadId, found.projectId, db);
		return { kind: "project", thread, projectId: found.projectId, projectName: thread.projectName ?? "" };
	} catch (cause: unknown) {
		db.update(mailSuggestionStates)
			.set({ deletedAt: stamp(), updatedAt: stamp() })
			.where(eq(mailSuggestionStates.id, state!.id))
			.run();
		throw cause;
	}
}
