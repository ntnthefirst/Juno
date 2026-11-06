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
 * event) and `project` (a project named in the words, offered as a link of the
 * whole conversation to that project, through the same service the reader's
 * Link to project button uses).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { MessageSuggestion, SuggestionKind, SuggestionOutcome, SuggestionSources } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now as stamp } from "../db/columns";
import { mailAccounts, mailMessages, mailSuggestionStates, mailThreads, projects } from "../db/schema";
import * as calendar from "./calendar";
import { htmlToText } from "./mail-html";
import * as mailThreadsService from "./mail-threads";
import * as settings from "./settings";
import { detectMoment } from "./suggestions-detect";

const KINDS: SuggestionKind[] = ["event", "project"];

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
			headline: `${sender} mentions ${moment.dayLabel} at ${moment.time}.`,
			question: `Add "${title}" to the calendar?`,
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

/**
 * A project named in the subject or the words, on a conversation that is not
 * filed under one yet. The longest name wins, and two different projects
 * named at the same length are no suggestion at all, because a wrong guess
 * costs more than a missing one. A project of another client than the
 * conversation's is never offered, the same rule linking applies.
 */
function findProject(db: Db, messageId: string): FoundProject | null {
	const row = db
		.select({ message: mailMessages, thread: mailThreads })
		.from(mailMessages)
		.innerJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
		.where(and(eq(mailMessages.id, messageId), isNull(mailMessages.deletedAt)))
		.get();
	if (!row || row.thread.projectId) return null;
	const { message, thread } = row;

	const body = message.bodyText?.trim() ? message.bodyText : message.bodyHtml ? htmlToText(message.bodyHtml) : "";
	const text = `${message.subject}
${body}`;
	if (!text.trim()) return null;

	const matches = db
		.select({ id: projects.id, name: projects.name, clientId: projects.clientId })
		.from(projects)
		.where(isNull(projects.deletedAt))
		.all()
		.filter((project) => project.name.trim().length >= 3)
		.filter((project) => !thread.clientId || !project.clientId || project.clientId === thread.clientId)
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
			headline: `This looks like part of ${chosen.name.trim()}.`,
			question: "Link this message to the project?",
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
 * neither a local calendar entry nor a link between a conversation and a
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
	if (answered(db, messageId, checked)) throw new Error("That suggestion was already answered.");

	const event = checked === "event" ? findEvent(db, messageId, today) : null;
	const project = checked === "project" ? findProject(db, messageId) : null;
	if (!event && !project) throw new Error("That suggestion is no longer there. Open the message again.");

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
