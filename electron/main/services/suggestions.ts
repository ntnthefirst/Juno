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
 * event) and `project` (a project named in the words, offered as a link). The
 * project kind waits for conversations to be filed under projects, which the
 * schema on this branch does not have yet, so it is never offered here.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { CalendarEvent, MessageSuggestion, SuggestionKind, SuggestionSources } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now as stamp } from "../db/columns";
import { mailAccounts, mailMessages, mailSuggestionStates, mailThreads } from "../db/schema";
import * as calendar from "./calendar";
import { htmlToText } from "./mail-html";
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
 * Add to calendar. The press is the confirmation, and a local calendar entry
 * is not one of the things that need the gate. The answer is recorded before
 * the event is written, so a second press cannot make a second event, and
 * taken back if the event could not be made.
 */
export async function accept(
	messageId: string,
	kind: string,
	db: Db = getDb(),
	today: Date = new Date(),
): Promise<CalendarEvent> {
	if (requireKind(kind) !== "event") {
		throw new Error("Only a calendar suggestion can be added from here.");
	}
	const sources = await settings.getSuggestionSources();
	if (!sources.calendar) throw new Error("Calendar suggestions are switched off.");
	if (answered(db, messageId, "event")) throw new Error("That suggestion was already answered.");
	const found = findEvent(db, messageId, today);
	if (!found) throw new Error("That suggestion is no longer there. Open the message again.");

	const at = stamp();
	const [state] = db
		.insert(mailSuggestionStates)
		.values({ messageId, kind: "event", state: "accepted", createdAt: at, updatedAt: at })
		.returning()
		.all();
	try {
		return await calendar.create(
			{ title: found.title, startLocal: found.startLocal, clientId: found.clientId },
			db,
		);
	} catch (cause: unknown) {
		db.update(mailSuggestionStates)
			.set({ deletedAt: stamp(), updatedAt: stamp() })
			.where(eq(mailSuggestionStates.id, state!.id))
			.run();
		throw cause;
	}
}
