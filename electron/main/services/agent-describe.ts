/**
 * An agent's request, put into words.
 *
 * A request stores the arguments the agent gave, and most of them are ids: a
 * client, a draft, a thread. Shown as they are, nobody can tell what is being
 * asked, so this resolves each id to the record it names and reads the other
 * arguments as labels and values. It only reads. The result is for the window
 * to draw; nothing here approves, rejects or changes a record.
 *
 * It lives in the services layer and takes the tools' titles as an argument,
 * because the registry that knows them sits above it.
 */
import { eq } from "drizzle-orm";
import type {
	AgentAction,
	AgentActionView,
	AgentAuditView,
	AgentEntityKind,
	AgentEntityRef,
	AgentField,
	AuditEvent,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import {
	automations,
	calendarEvents,
	clients,
	contacts,
	documents,
	documentTemplates,
	mailAccounts,
	mailFolders,
	mailMessages,
	mailOutbox,
	mailTemplates,
	mailThreads,
	projects,
	reminders,
} from "../db/schema";

export type TitleOf = (toolName: string) => string;

/** How many records one argument may name before the rest is left out. */
const MAX_ENTITIES = 8;
const MAX_VALUE = 160;
const MAX_BLOCK = 2000;

const ROLES: Record<AgentEntityKind, string> = {
	client: "Client",
	contact: "Contact",
	project: "Project",
	mailAccount: "Account",
	mailFolder: "Folder",
	mailThread: "Conversation",
	mailMessage: "Message",
	mailDraft: "Draft",
	mailTemplate: "Template",
	documentTemplate: "Template",
	document: "Document",
	reminder: "Reminder",
	event: "Event",
	automation: "Automation",
};

/** The argument names that always mean one kind of record. */
const KEY_KINDS: Record<string, AgentEntityKind> = {
	client_id: "client",
	contact_id: "contact",
	project_id: "project",
	account_id: "mailAccount",
	folder_id: "mailFolder",
	thread_id: "mailThread",
	thread_ids: "mailThread",
	message_id: "mailMessage",
	message_ids: "mailMessage",
	reply_to_message_id: "mailMessage",
	document_id: "document",
	document_ids: "document",
};

/** What a bare `id` means, by the tool it is passed to. The most specific prefix wins. */
const ID_KINDS: [prefix: string, kind: AgentEntityKind][] = [
	["mail.outbox.", "mailDraft"],
	["mail.send", "mailDraft"],
	["mail.threads.", "mailThread"],
	["mail.messages.", "mailMessage"],
	["mail.folders.", "mailFolder"],
	["mail.accounts.", "mailAccount"],
	["mail.templates.", "mailTemplate"],
	["templates.", "documentTemplate"],
	["contacts.", "contact"],
	["clients.", "client"],
	["projects.", "project"],
	["documents.", "document"],
	["calendar.", "event"],
	["reminders.", "reminder"],
	["automations.", "automation"],
];

/** What `id` means in a tool name, or null when it is something this does not name. */
export function kindOfId(toolName: string): AgentEntityKind | null {
	// clients.emails.update takes the id of an email row, not of a client.
	if (/^(clients|projects)\.[a-z_]+\./.test(toolName)) return null;
	for (const [prefix, kind] of ID_KINDS) if (toolName.startsWith(prefix)) return kind;
	return null;
}

function kindOfKey(toolName: string, key: string): AgentEntityKind | null {
	if (key === "id") return kindOfId(toolName);
	if (key === "template_id") return toolName.startsWith("templates.") ? "documentTemplate" : "mailTemplate";
	if (key === "parent_id") return toolName.startsWith("mail.folders.") ? "mailFolder" : null;
	return KEY_KINDS[key] ?? null;
}

type Found = { label: string | null; detail: string | null; gone: boolean };
const MISSING: Found = { label: null, detail: null, gone: true };

function parseNames(json: string): string {
	try {
		const value: unknown = JSON.parse(json);
		if (!Array.isArray(value)) return "";
		return value
			.map((entry) => (entry && typeof entry === "object" ? ((entry as { name?: string | null; address?: string }).name || (entry as { address?: string }).address) : null))
			.filter((name): name is string => typeof name === "string" && name.length > 0)
			.join(", ");
	} catch {
		return "";
	}
}

function dayOf(date: string | null | undefined): string {
	if (!date) return "";
	const parts = date.slice(0, 10).split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

function clientName(db: Db, id: string | null): string | null {
	if (!id) return null;
	return db.select({ name: clients.name }).from(clients).where(eq(clients.id, id)).get()?.name ?? null;
}

/** One record by id. A deleted record is still named, and marked gone. */
function find(db: Db, kind: AgentEntityKind, id: string): Found {
	switch (kind) {
		case "client": {
			const row = db.select({ name: clients.name, deletedAt: clients.deletedAt }).from(clients).where(eq(clients.id, id)).get();
			return row ? { label: row.name, detail: null, gone: row.deletedAt !== null } : MISSING;
		}
		case "contact": {
			const row = db.select({ name: contacts.name, clientId: contacts.clientId, deletedAt: contacts.deletedAt }).from(contacts).where(eq(contacts.id, id)).get();
			return row ? { label: row.name, detail: clientName(db, row.clientId), gone: row.deletedAt !== null } : MISSING;
		}
		case "project": {
			const row = db.select({ name: projects.name, clientId: projects.clientId, deletedAt: projects.deletedAt }).from(projects).where(eq(projects.id, id)).get();
			return row ? { label: row.name, detail: clientName(db, row.clientId), gone: row.deletedAt !== null } : MISSING;
		}
		case "mailAccount": {
			const row = db.select({ label: mailAccounts.label, email: mailAccounts.email, deletedAt: mailAccounts.deletedAt }).from(mailAccounts).where(eq(mailAccounts.id, id)).get();
			return row ? { label: row.label || row.email, detail: row.label ? row.email : null, gone: row.deletedAt !== null } : MISSING;
		}
		case "mailFolder": {
			const row = db.select({ name: mailFolders.name, accountId: mailFolders.accountId, deletedAt: mailFolders.deletedAt }).from(mailFolders).where(eq(mailFolders.id, id)).get();
			if (!row) return MISSING;
			const account = db.select({ email: mailAccounts.email }).from(mailAccounts).where(eq(mailAccounts.id, row.accountId)).get();
			return { label: row.name, detail: account?.email ?? null, gone: row.deletedAt !== null };
		}
		case "mailThread": {
			const row = db.select({ subject: mailThreads.subject, deletedAt: mailThreads.deletedAt }).from(mailThreads).where(eq(mailThreads.id, id)).get();
			return row ? { label: row.subject || "(no subject)", detail: null, gone: row.deletedAt !== null } : MISSING;
		}
		case "mailMessage": {
			const row = db.select({ subject: mailMessages.subject, fromName: mailMessages.fromName, fromAddress: mailMessages.fromAddress, deletedAt: mailMessages.deletedAt }).from(mailMessages).where(eq(mailMessages.id, id)).get();
			if (!row) return MISSING;
			const from = row.fromName || row.fromAddress;
			return { label: row.subject || "(no subject)", detail: from ? `From ${from}` : null, gone: row.deletedAt !== null };
		}
		case "mailDraft": {
			const row = db.select({ subject: mailOutbox.subject, toJson: mailOutbox.toJson, state: mailOutbox.state, deletedAt: mailOutbox.deletedAt }).from(mailOutbox).where(eq(mailOutbox.id, id)).get();
			if (!row) return MISSING;
			const to = parseNames(row.toJson);
			return { label: row.subject || "(no subject)", detail: [to ? `To ${to}` : null, row.state !== "draft" ? row.state : null].filter(Boolean).join(", ") || null, gone: row.deletedAt !== null };
		}
		case "mailTemplate": {
			const row = db.select({ name: mailTemplates.name, deletedAt: mailTemplates.deletedAt }).from(mailTemplates).where(eq(mailTemplates.id, id)).get();
			return row ? { label: row.name, detail: null, gone: row.deletedAt !== null } : MISSING;
		}
		case "documentTemplate": {
			const row = db.select({ name: documentTemplates.name, deletedAt: documentTemplates.deletedAt }).from(documentTemplates).where(eq(documentTemplates.id, id)).get();
			return row ? { label: row.name, detail: null, gone: row.deletedAt !== null } : MISSING;
		}
		case "document": {
			const row = db.select({ title: documents.title, clientId: documents.clientId, deletedAt: documents.deletedAt }).from(documents).where(eq(documents.id, id)).get();
			return row ? { label: row.title, detail: clientName(db, row.clientId), gone: row.deletedAt !== null } : MISSING;
		}
		case "reminder": {
			const row = db.select({ title: reminders.title, dueOn: reminders.dueOn, deletedAt: reminders.deletedAt }).from(reminders).where(eq(reminders.id, id)).get();
			return row ? { label: row.title, detail: `Due ${dayOf(row.dueOn)}`, gone: row.deletedAt !== null } : MISSING;
		}
		case "event": {
			const row = db.select({ title: calendarEvents.title, startLocal: calendarEvents.startLocal, deletedAt: calendarEvents.deletedAt }).from(calendarEvents).where(eq(calendarEvents.id, id)).get();
			return row ? { label: row.title, detail: dayOf(row.startLocal), gone: row.deletedAt !== null } : MISSING;
		}
		case "automation": {
			const row = db.select({ name: automations.name, deletedAt: automations.deletedAt }).from(automations).where(eq(automations.id, id)).get();
			return row ? { label: row.name, detail: null, gone: row.deletedAt !== null } : MISSING;
		}
	}
}

function refOf(db: Db, kind: AgentEntityKind, id: string): AgentEntityRef {
	return { role: ROLES[kind], kind, id, ...find(db, kind, id) };
}

/** Keys whose values are never shown, in any form. */
const SECRET = /pass(word|phrase)?|secret|token|credential/i;

function humanise(key: string): string {
	const words = key.replace(/_/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function clip(text: string): string {
	return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 3)}...` : text;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MOMENT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function plain(value: string): string {
	const day = ISO_DAY.exec(value);
	if (day) return `${day[3]}/${day[2]}/${day[1]}`;
	const moment = ISO_MOMENT.exec(value);
	if (moment) return `${moment[3]}/${moment[2]}/${moment[1]} ${moment[4]}:${moment[5]}`;
	return value;
}

/** An argument as text a person reads, or null when there is nothing to show. */
function render(value: unknown): { text: string; long: boolean } | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "string") {
		const text = plain(value);
		const long = text.length > MAX_VALUE || text.includes("\n");
		// A block can hold more than a line, but a whole mail body is not what a
		// person needs to decide, and the full arguments are one click away.
		return { text: long && text.length > MAX_BLOCK ? `${text.slice(0, MAX_BLOCK)}...` : text, long };
	}
	if (typeof value === "number") return { text: String(value), long: false };
	if (typeof value === "boolean") return { text: value ? "Yes" : "No", long: false };
	if (Array.isArray(value)) {
		if (value.length === 0) return null;
		const parts = value.map((item) => {
			if (typeof item === "string") return plain(item);
			if (item && typeof item === "object") {
				const entry = item as { name?: string | null; address?: string };
				if (typeof entry.address === "string") return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
			}
			return null;
		});
		if (parts.every((part): part is string => part !== null)) {
			const shown = parts.slice(0, 6).join(", ");
			return { text: parts.length > 6 ? `${shown} and ${parts.length - 6} more` : shown, long: false };
		}
		return { text: `${value.length} ${value.length === 1 ? "item" : "items"}`, long: false };
	}
	return { text: clip(JSON.stringify(value)), long: true };
}

/** Puts one parked request into words. */
export function describeAction(action: AgentAction, titleOf: TitleOf, db: Db = getDb()): AgentActionView {
	const entities: AgentEntityRef[] = [];
	const fields: AgentField[] = [];
	const consumed = new Set<string>();

	for (const [key, value] of Object.entries(action.args)) {
		const kind = kindOfKey(action.toolName, key);
		if (!kind) continue;
		const ids = (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === "string" && id.length > 0);
		if (ids.length === 0) continue;
		consumed.add(key);
		for (const id of ids.slice(0, MAX_ENTITIES)) entities.push(refOf(db, kind, id));
		if (ids.length > MAX_ENTITIES) {
			fields.push({ label: `More ${ROLES[kind].toLowerCase()}s`, value: `${ids.length - MAX_ENTITIES} not shown`, long: false });
		}
	}

	for (const [key, value] of Object.entries(action.args)) {
		if (consumed.has(key) || key === "id") continue;
		if (SECRET.test(key)) {
			fields.push({ label: humanise(key), value: "Set, not shown", long: false });
			continue;
		}
		const shown = render(value);
		if (shown) fields.push({ label: humanise(key.replace(/_?ids?$/, "") || key), value: shown.text, long: shown.long });
	}

	return { actionId: action.id, title: titleOf(action.toolName), entities, fields };
}

export function describeActions(actions: AgentAction[], titleOf: TitleOf, db: Db = getDb()): AgentActionView[] {
	return actions.map((action) => describeAction(action, titleOf, db));
}

/** A log row keeps no arguments, so all it can name is the record it touched. */
export function describeAudit(events: AuditEvent[], titleOf: TitleOf, db: Db = getDb()): AgentAuditView[] {
	return events.map((event) => {
		const kind = event.entityId ? kindOfId(event.toolName) : null;
		return {
			eventId: event.id,
			title: titleOf(event.toolName),
			entity: kind && event.entityId ? refOf(db, kind, event.entityId) : null,
		};
	});
}
