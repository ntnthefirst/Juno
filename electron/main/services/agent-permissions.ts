/**
 * What an agent may do without asking, and the one table that says which
 * permission row every tool belongs to.
 *
 * Decision 57 amends decision 24. A call used to park whenever its tool was
 * side-effectful. Now the owner sets a level per row (Settings > MCP >
 * Permissions) and this file turns a call into one of three outcomes:
 *
 * - **refuse**, when the row is Off, with the sentence that names the setting;
 * - **park**, in the confirmation gate, when the row is Ask first;
 * - **run**, when the row is Allow, and only for rows that may be Allow.
 *
 * Send, sign, file and delete are the rows that may not. Their level is
 * ignored when it is read, refused when it is written, and clamped when the
 * settings file is loaded, so no route reaches Allow for them. Neither is an
 * automation ever unattended: a scheduled step that is not a plain read parks
 * whatever the level, because nobody is there to have chosen Allow for it
 * (.claude/rules/mcp.md section 5).
 *
 * **Every tool must be in the table.** `mcp/host.test.ts` fails when one is
 * not, and `rowOf` throws for one that is not, so a new tool cannot be added
 * and quietly run unclassified.
 */
import {
	AGENT_LEVELS,
	INSTRUCTION_AREAS,
	MAX_INSTRUCTION_LENGTH,
	PERMISSION_KINDS,
	PERMISSION_ROWS,
	isLocked,
} from "../../shared/agent-permissions";
import type {
	AgentActionSource,
	AgentInstructions,
	AgentInstructionsView,
	AgentLevel,
	AgentPermissionKind,
	AgentPermissionRow,
	AgentPermissions,
	AgentPermissionsView,
} from "../../shared/types";
import * as settings from "./settings";

/** What a caller is told, in words that point at the setting. Code lets an adapter pick its own shape. */
export class AgentPermissionError extends Error {
	readonly code: "TURNED_OFF" | "LOCKED" | "UNKNOWN_ROW" | "UNCLASSIFIED" | "NOT_FOR_AUTOMATIONS";
	constructor(code: AgentPermissionError["code"], message: string) {
		super(message);
		this.name = "AgentPermissionError";
		this.code = code;
	}
}

/**
 * The table. A name appears in exactly one row.
 *
 * - **read**: nothing is written. `mail.sync` and `updates.check` fetch and
 *   change nothing the owner made, so they sit here and run when reading does.
 * - **change**: writes to local records and notes.
 * - **drafts**: writes a mail draft that opens in the editor. Nothing leaves.
 * - **send**: anything that sends, signs or files. Filing is every move on the
 *   mail server, which is why `mail.file.*` is here and not under change.
 *   Writing a mailbox rule is here too, because a rule files mail by itself on
 *   every new message: it is a standing permission to file, and `mail.rules.*`
 *   cannot be used from an automation at all (decision 64).
 * - **delete**: anything that removes. Soft deletes count, because to the
 *   owner they are gone.
 */
export const TOOL_ROWS: Record<AgentPermissionKind, string[]> = {
	read: [
		"agent.get_action",
		"agent.list_actions",
		"audit.list",
		"automations.get",
		"automations.list",
		"automations.runs",
		"briefing.client",
		"briefing.month",
		"briefing.overview",
		"briefing.today",
		"calendar.export_ics",
		"calendar.get_event",
		"calendar.list_events",
		"calendar.upcoming",
		"clients.addresses.list_for_client",
		"clients.emails.list_for_client",
		"clients.get",
		"clients.links.list_for_client",
		"clients.list",
		"clients.notes.list",
		"clients.phones.list_for_client",
		"clients.timeline",
		"contacts.list_for_client",
		"desktop.get",
		"documents.find_matches",
		"documents.get",
		"documents.list",
		"documents.list_versions",
		"documents.signatures",
		"documents.timeline",
		"geocoding.lookup_address",
		"geocoding.suggest_locations",
		"mail.accounts.guess",
		"mail.accounts.list",
		"mail.accounts.look_up",
		"mail.accounts.test",
		"mail.blocks.list",
		"mail.folders.list",
		"mail.messages.body",
		"mail.messages.get",
		"mail.outbox.get",
		"mail.outbox.list",
		"mail.recipients.clients_for",
		"mail.recipients.suggest",
		"mail.rules.get",
		"mail.rules.history",
		"mail.rules.list",
		"mail.sync",
		"mail.sync_status",
		"mail.templates.get",
		"mail.templates.list",
		"mail.templates.preview",
		"mail.templates.render",
		"mail.threads.get",
		"mail.threads.list",
		"notes.get",
		"notes.list",
		"notes.search",
		"pages.get",
		"projects.get",
		"projects.get_storage",
		"projects.list",
		"projects.list_assets",
		"projects.list_commands",
		"projects.list_links",
		"projects.timeline",
		"recent.list",
		"reference.get_set",
		"reference.list_sets",
		"reference.usage",
		"reminders.get",
		"reminders.history",
		"reminders.list",
		"reminders.suggestions",
		"search.global",
		"settings.get_owner",
		"settings.get_theme",
		"suggestions.list",
		"templates.components.get",
		"templates.components.list",
		"templates.components.list_images",
		"templates.fill",
		"templates.get",
		"templates.list",
		"templates.list_images",
		"templates.preview",
		"time.list",
		"updates.check",
		"updates.status",
	],
	change: [
		"automations.create",
		"automations.disable",
		"automations.run",
		"automations.update",
		"calendar.create_event",
		"calendar.import_ics",
		"calendar.restore_event",
		"calendar.update_event",
		"clients.addresses.create",
		"clients.addresses.restore",
		"clients.addresses.set_primary",
		"clients.addresses.update",
		"clients.create",
		"clients.emails.create",
		"clients.emails.restore",
		"clients.emails.set_primary",
		"clients.emails.update",
		"clients.links.create",
		"clients.links.restore",
		"clients.links.update",
		"clients.notes.create",
		"clients.notes.restore",
		"clients.notes.update",
		"clients.phones.create",
		"clients.phones.restore",
		"clients.phones.set_primary",
		"clients.phones.update",
		"clients.restore",
		"clients.update",
		"contacts.create",
		"contacts.restore",
		"contacts.set_primary",
		"contacts.update",
		"documents.add_version",
		"documents.generate",
		"documents.import",
		"documents.link",
		"documents.render_pdf",
		"documents.set_status",
		"mail.accounts.create",
		"mail.accounts.update",
		"mail.blocks.create",
		"mail.blocks.reorder",
		"mail.blocks.update",
		"mail.folders.create",
		"mail.folders.rename",
		"mail.folders.set_sync",
		"mail.outbox.cancel",
		"mail.templates.create",
		"mail.templates.hide",
		"mail.templates.update",
		"mail.threads.link_client",
		"mail.threads.link_project",
		"mail.threads.unlink_client",
		"mail.threads.unlink_project",
		"notes.create",
		"notes.duplicate",
		"notes.restore",
		"notes.update",
		"pages.create",
		"pages.update",
		"projects.add_file_from_mail",
		"projects.archive",
		"projects.create",
		"projects.create_link",
		"projects.restore",
		"projects.set_cover",
		"projects.update",
		"projects.update_asset",
		"projects.update_link",
		"reference.create_item",
		"reference.hide_item",
		"reference.reorder",
		"reference.reset_all",
		"reference.reset_set",
		"reference.unhide_item",
		"reference.update_item",
		"reminders.accept",
		"reminders.complete",
		"reminders.create",
		"reminders.reopen",
		"reminders.restore",
		"reminders.snooze",
		"reminders.update",
		"desktop.update",
		"settings.add_owner_email",
		"settings.add_owner_phone",
		"settings.remove_owner_email",
		"settings.remove_owner_phone",
		"settings.set_owner",
		"settings.set_theme",
		"settings.update_owner_email",
		"settings.update_owner_phone",
		"templates.add_image",
		"templates.components.add_image",
		"templates.components.create",
		"templates.components.detach",
		"templates.components.update",
		"templates.create",
		"templates.import_docx",
		"templates.update",
		"time.create",
		"time.start",
		"time.stop",
		"time.update",
		"updates.set_auto_install",
	],
	drafts: ["mail.draft", "mail.outbox.attach_project_file", "mail.reply"],
	send: [
		"mail.file.archive",
		"mail.file.archive_messages",
		"mail.file.junk",
		"mail.file.junk_messages",
		"mail.file.move",
		"mail.file.move_messages",
		"mail.file.set_flagged",
		"mail.file.set_folder_seen",
		"mail.file.set_seen",
		"mail.file.trash",
		"mail.file.trash_messages",
		"mail.rules.create",
		"mail.rules.reorder",
		"mail.rules.update",
		"mail.send",
		"mail.send_from_template",
	],
	delete: [
		"automations.delete",
		"calendar.remove_event",
		"clients.addresses.delete",
		"clients.delete",
		"clients.emails.delete",
		"clients.links.delete",
		"clients.notes.delete",
		"clients.phones.delete",
		"contacts.delete",
		"documents.remove",
		"documents.remove_version",
		"mail.accounts.remove",
		"mail.blocks.delete",
		"mail.file.delete",
		"mail.file.delete_messages",
		"mail.file.empty_folder",
		"mail.folders.remove",
		"mail.rules.delete",
		"notes.delete",
		"projects.delete",
		"projects.delete_asset",
		"projects.delete_link",
		"reminders.remove",
		"templates.components.delete",
	],
};

/**
 * Tools that let a caller see what became of its own requests. Whatever the
 * Read row says, they answer: a caller whose reads are turned off or parked
 * would otherwise have no way to learn that one of its requests was answered.
 */
const FOLLOW_UP_TOOLS = new Set(["agent.get_action", "agent.list_actions"]);

const ROW_OF = new Map<string, AgentPermissionKind>();
for (const kind of PERMISSION_KINDS) {
	for (const name of TOOL_ROWS[kind]) {
		if (ROW_OF.has(name)) throw new Error(`"${name}" is in two permission rows.`);
		ROW_OF.set(name, kind);
	}
}

/** The row a tool belongs to. Throws for a tool nobody classified. */
export function rowOf(toolName: string): AgentPermissionKind {
	const kind = ROW_OF.get(toolName);
	if (!kind) {
		throw new AgentPermissionError(
			"UNCLASSIFIED",
			`"${toolName}" has no permission row, so it cannot run. Add it to TOOL_ROWS in services/agent-permissions.ts.`,
		);
	}
	return kind;
}

export function classifiedTools(): string[] {
	return [...ROW_OF.keys()];
}

export function rows(): AgentPermissionRow[] {
	return PERMISSION_ROWS.map((row) => ({ ...row }));
}

export async function getPermissions(): Promise<AgentPermissions> {
	return settings.getAgentPermissions();
}

/**
 * Sets levels. A locked row cannot be set to Allow, and saying so is an error
 * rather than a quiet "ask", because a person who clicked it should hear no.
 */
export async function setPermissions(patch: Partial<AgentPermissions>): Promise<AgentPermissions> {
	for (const [key, level] of Object.entries(patch)) {
		if (!PERMISSION_KINDS.includes(key as AgentPermissionKind)) {
			throw new AgentPermissionError("UNKNOWN_ROW", `"${key}" is not a permission row.`);
		}
		if (!AGENT_LEVELS.includes(level as AgentLevel)) {
			throw new AgentPermissionError("UNKNOWN_ROW", `"${String(level)}" is not a level. Use off, ask or allow.`);
		}
		if (isLocked(key as AgentPermissionKind) && level === "allow") {
			throw new AgentPermissionError(
				"LOCKED",
				"Sending, signing, filing and deleting always ask first. They cannot be set to Allow.",
			);
		}
	}
	return settings.setAgentPermissions(patch);
}

export async function getInstructions(): Promise<AgentInstructions> {
	return settings.getAgentInstructions();
}

export async function setInstructions(instructions: AgentInstructions): Promise<AgentInstructions> {
	return settings.setAgentInstructions(instructions);
}

export type Verdict = "run" | "park";

export interface GateInput {
	name: string;
	readOnly: boolean;
	source: AgentActionSource;
}

const LABELS: Record<AgentPermissionKind, string> = Object.fromEntries(
	PERMISSION_ROWS.map((row) => [row.kind, row.label]),
) as Record<AgentPermissionKind, string>;

/**
 * Decides what happens to a call. The only place that does.
 *
 * Order matters and each step is a rule from the amendment:
 * 1. the tool must be classified;
 * 2. a row that is Off refuses, except the follow-up tools;
 * 3. a locked row parks, whatever the level says;
 * 4. an automation parks anything that is not a plain read, because it is
 *    unattended and a level of Allow was chosen for a person asking, not for
 *    a timer;
 * 5. otherwise Allow runs and Ask first parks.
 */
export async function gate(input: GateInput): Promise<Verdict> {
	const kind = rowOf(input.name);
	if (FOLLOW_UP_TOOLS.has(input.name)) return "run";

	if (input.source === "automation" && isForbiddenInAutomation(input.name)) {
		throw new AgentPermissionError(
			"NOT_FOR_AUTOMATIONS",
			"An automation cannot add, change or remove a mailbox rule. A person does that in Juno, or approves an agent's request for it.",
		);
	}

	const levels = await settings.getAgentPermissions();
	const level = levels[kind];

	if (level === "off") {
		throw new AgentPermissionError(
			"TURNED_OFF",
			`${LABELS[kind]}: turned off under Settings > MCP > Permissions.`,
		);
	}
	if (isLocked(kind)) return "park";
	if (input.source === "automation" && kind !== "read") return "park";
	return level === "allow" ? "run" : "park";
}

/**
 * A tool an automation may not call, parked or not: the ones that write a mailbox
 * rule. A rule files mail on its own, so an automation that could add or change
 * one would be an unattended way to give itself the permission to file, which
 * is what the approval gate exists to prevent (decision 64). Reading rules is
 * fine. Derived from the row, so a rule tool added later is covered without
 * being listed here.
 */
export function isForbiddenInAutomation(toolName: string): boolean {
	return toolName.startsWith("mail.rules.") && ROW_OF.get(toolName) !== "read";
}

/** True for a tool in a row that can never be Allow. False for one nobody classified. */
export function isLockedTool(toolName: string): boolean {
	const kind = ROW_OF.get(toolName);
	return kind !== undefined && isLocked(kind);
}

/** What the permissions page draws. */
export async function permissionsView(): Promise<AgentPermissionsView> {
	return { rows: rows(), levels: await getPermissions() };
}

export async function setPermissionsView(patch: Partial<AgentPermissions>): Promise<AgentPermissionsView> {
	await setPermissions(patch);
	return permissionsView();
}

/** What the instructions page draws. */
export async function instructionsView(): Promise<AgentInstructionsView> {
	return {
		instructions: await getInstructions(),
		areas: INSTRUCTION_AREAS.map((area) => ({ ...area })),
		maxLength: MAX_INSTRUCTION_LENGTH,
	};
}

export async function setInstructionsView(instructions: AgentInstructions): Promise<AgentInstructionsView> {
	await setInstructions(instructions);
	return instructionsView();
}
